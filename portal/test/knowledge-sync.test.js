import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyKnowledgeSyncState,expireKnowledge,KnowledgeSyncError,syncKnowledgeExport} from '../functions/lib/knowledge-sync.js';

const NOW = new Date('2026-09-05T12:00:00Z');

function page(epoch, changes, nextCursor = null, hasMore = false, throughRevision = Math.max(0, ...changes.map(c => c.revision))) {
  return {protocol: 1, epoch, throughRevision, changes, hasMore, nextCursor};
}
function destination(initial = []) {
  const values = new Map(initial.map(entry => [entry.id, structuredClone(entry)]));
  const calls = []; let failNext = null;
  return {values, calls, setFailure(mode) { failNext = mode; },
    async read(id) { return values.get(id) ? structuredClone(values.get(id)) : null; },
    async upsert(id, record, revision) {
      calls.push(['upsert', id, revision]);
      if (failNext === 'after-upsert') { failNext = null; values.set(id, {id, operation:'upsert', revision, record:structuredClone(record)}); throw Error('transport'); }
      if (failNext === 'before-upsert') { failNext = null; throw Error('transport'); }
      const current = values.get(id); if (current && current.revision > revision) return;
      values.set(id, {id, operation:'upsert', revision, record:structuredClone(record)});
    },
    async delete(id, revision) {
      calls.push(['delete', id, revision]);
      if (failNext === 'after-delete') { failNext = null; values.set(id, {id, operation:'delete', revision}); throw Error('transport'); }
      if (failNext === 'before-delete') { failNext = null; throw Error('transport'); }
      const current = values.get(id); if (current && current.revision > revision) return;
      values.set(id, {id, operation:'delete', revision});
    },
    async list() { return [...values.values()].map(value => structuredClone(value)); }};
}
function store(initial = emptyKnowledgeSyncState()) {
  let state = structuredClone(initial); let saves = 0;
  return {get saves() { return saves; }, async load() { return structuredClone(state); }, async save(next) { saves++; state = structuredClone(next); }, current() { return structuredClone(state); }};
}
const upsert = (id, revision, expiresAt = '2026-10-01T00:00:00.000Z') => ({id, revision, operation:'upsert', record:{schema:1,booking:{guestName:'Synthetic'},retention:{expiresAt}}});
const del = (id, revision) => ({id, revision, operation:'delete', reason:'removed'});

test('sync advances the checkpoint only after every page change is durable and resumes by cursor', async () => {
  const d = destination(), s = store(), seen = [];
  const pages = new Map([[null, page('epoch-a',[upsert('a',1)],'c1',true,1)],['c1',page('epoch-a',[upsert('b',2)],null,false,2)]]);
  const result = await syncKnowledgeExport({stateStore:s,destination:d,now:NOW,fetchPage:async cursor => { seen.push(cursor); return pages.get(cursor); }});
  assert.deepEqual(seen,[null,'c1']); assert.equal(result.pages,2); assert.equal(result.applied,2); assert.equal(s.saves,2);
  assert.equal(s.current().cursor,null); assert.equal(s.current().epoch,'epoch-a'); assert.equal(s.current().revisions.a.revision,1);
  assert.equal(d.values.get('b').record.booking.guestName,'Synthetic');
});

test('replays are idempotent, stale revisions cannot overwrite, and deletes fence an equal-revision upsert', async () => {
  const d = destination(), s = store();
  const fetchPage = async () => page('epoch-a',[upsert('a',3)],null,false,3);
  await syncKnowledgeExport({stateStore:s,destination:d,now:NOW,fetchPage});
  await syncKnowledgeExport({stateStore:s,destination:d,now:NOW,fetchPage});
  assert.equal(d.calls.filter(c => c[0] === 'upsert').length,1);
  const deleteStore = store(), deleteDestination = destination();
  await syncKnowledgeExport({stateStore:deleteStore,destination:deleteDestination,now:NOW,fetchPage:async()=>page('epoch-a',[del('a',3)],null,false,3)});
  const replay = await syncKnowledgeExport({stateStore:deleteStore,destination:deleteDestination,now:NOW,fetchPage:async()=>page('epoch-a',[upsert('a',3)],null,false,3)});
  assert.equal(replay.skipped,1); assert.equal(deleteDestination.values.get('a').operation,'delete');
  const stale = await syncKnowledgeExport({stateStore:store({protocol:1,epoch:'epoch-a',cursor:'old',throughRevision:3,revisions:{a:{revision:3,operation:'upsert'}}}),destination:d,now:NOW,fetchPage:async()=>page('epoch-a',[upsert('a',2)],null,false,3)});
  assert.equal(stale.skipped,1); assert.equal(d.values.get('a').revision,3);
});

test('epoch rollback, malformed pages, stalled cursors and page limits fail closed', async () => {
  const d = destination();
  await assert.rejects(() => syncKnowledgeExport({stateStore:store({protocol:1,epoch:'old',cursor:null,throughRevision:2,revisions:{}}),destination:d,fetchPage:async()=>page('new',[],null,false,2)}), e => e instanceof KnowledgeSyncError && e.code === 'SYNC_EPOCH_MISMATCH');
  await assert.rejects(() => syncKnowledgeExport({stateStore:store(),destination:d,fetchPage:async()=>page('e',[upsert('a',2)],null,false,1)}), e => e.code === 'SYNC_PAGE_INVALID');
  await assert.rejects(() => syncKnowledgeExport({stateStore:store(),destination:d,fetchPage:async()=>page('e',[upsert('a',1)],'same',true,1)}), e => e.code === 'SYNC_CURSOR_STALLED');
  await assert.rejects(() => syncKnowledgeExport({stateStore:store(),destination:d,maxPages:1,fetchPage:async()=>page('e',[upsert('a',1)],'next',true,1)}), e => e.code === 'SYNC_PAGE_LIMIT');
});

test('checkpoint state rejects prototype-pollution keys and malformed revision fences', async () => {
  const d = destination();
  for (const revisions of [JSON.parse('{"__proto__":{"revision":1,"operation":"upsert"}}'),{a:{revision:1,operation:'other'}},[]]) {
    await assert.rejects(() => syncKnowledgeExport({stateStore:store({protocol:1,epoch:null,cursor:null,throughRevision:0,revisions}),destination:d,fetchPage:async()=>page('e',[],null,false,0)}), e => e.code === 'SYNC_STATE_INVALID');
  }
});

test('uncertain writes are accepted only when a read confirms the exact durable outcome', async () => {
  const d = destination(), s = store(); d.setFailure('after-upsert');
  const result = await syncKnowledgeExport({stateStore:s,destination:d,now:NOW,fetchPage:async()=>page('e',[upsert('a',1)],null,false,1)});
  assert.equal(result.applied,1); assert.equal(s.saves,1);
  const failed = destination(), failedStore = store(); failed.setFailure('before-upsert');
  await assert.rejects(() => syncKnowledgeExport({stateStore:failedStore,destination:failed,now:NOW,fetchPage:async()=>page('e',[upsert('a',1)],null,false,1)}), e => e.code === 'DESTINATION_UNCERTAIN');
  assert.equal(failedStore.saves,0); assert.equal(failed.values.has('a'),false);
});

test('matching revision alone does not confirm truncated or wrong destination content',async()=>{
  for(const throws of [false,true]) {
    const d=destination(),s=store();
    d.upsert=async(id,record,revision)=>{d.values.set(id,{id,revision,operation:'upsert',record:{...record,booking:{guestName:'Wrong'}}});if(throws)throw Error('uncertain');};
    await assert.rejects(syncKnowledgeExport({stateStore:s,destination:d,now:NOW,fetchPage:async()=>page('e',[upsert('a',1)])}),{code:throws?'DESTINATION_UNCERTAIN':'DESTINATION_RACE'});
    assert.equal(s.saves,0);
  }
});
test('a replay repairs changed content instead of trusting only the revision fence',async()=>{
  const d=destination(),s=store(),fetchPage=async()=>page('e',[upsert('a',1)]);
  await syncKnowledgeExport({stateStore:s,destination:d,now:NOW,fetchPage});
  d.values.get('a').record.booking.guestName='Wrong';
  const result=await syncKnowledgeExport({stateStore:s,destination:d,now:NOW,fetchPage});
  assert.equal(result.applied,1);assert.equal(d.values.get('a').record.booking.guestName,'Synthetic');
});
test('expiry cannot record an old delete over a newer destination or local revision',async()=>{
  const old=upsert('a',1,'2026-09-01T00:00:00Z');
  for(const localNewer of [false,true]) {
    const d=destination([localNewer?old:upsert('a',2)]);
    d.list=async()=>[old];
    const state=emptyKnowledgeSyncState();if(localNewer)state.revisions.a={revision:2,operation:'upsert'};
    const s=store(state),result=await expireKnowledge({stateStore:s,destination:d,now:NOW});
    assert.equal(result.expired,0);assert.equal(s.saves,0);assert.equal(d.calls.length,0);
    assert.deepEqual(s.current(),state);
  }
});
test('expiry runs independently of source polling and records a deletion fence', async () => {
  const d = destination([{id:'a',operation:'upsert',revision:7,record:{retention:{expiresAt:'2026-09-05T11:59:59Z'}}},{id:'b',operation:'upsert',revision:8,record:{retention:{expiresAt:'2026-10-01T00:00:00Z'}}}]);
  const s = store({protocol:1,epoch:'e',cursor:'c',throughRevision:8,revisions:{}});
  const result = await expireKnowledge({stateStore:s,destination:d,now:NOW});
  assert.equal(result.expired,1); assert.equal(d.values.get('a').operation,'delete'); assert.equal(d.values.get('a').revision,7);
  assert.equal(d.values.get('b').operation,'upsert'); assert.equal(s.current().revisions.a.operation,'delete');
  const second = await expireKnowledge({stateStore:s,destination:d,now:NOW}); assert.equal(second.expired,0); assert.equal(s.saves,1);
});
