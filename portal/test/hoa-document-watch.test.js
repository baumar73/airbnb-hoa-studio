import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileHoaDocuments, hoaDocumentWatchStatus} from '../functions/lib/hoa-document-watch.js';

const now='2026-09-05T12:00:00.000Z';
const doc=(id='rules',hash='a'.repeat(64))=>({id,title:'Rules.pdf',sha256:hash});
const snapshot=(documents=[doc()])=>({source:'hoa-example',authenticated:true,complete:true,observedAt:now,documents});
test('first complete inventory queues immutable versions, with no approval or policy changes',()=>{
  const r=reconcileHoaDocuments(null,snapshot(),new Date(now));
  assert.equal(r.events[0].type,'added'); assert.equal(r.indexQueue.length,1);
  assert.equal(r.indexQueue[0].reviewStatus,'unreviewed-source');
  assert.equal(r.state.documents.rules.sha256,'a'.repeat(64));
  assert.equal(Object.hasOwn(r,'policy'),false);
});
test('unchanged snapshots stay quiet but unconfirmed embeddings remain queued',()=>{
  const first=reconcileHoaDocuments(null,snapshot(),new Date(now));
  const second=reconcileHoaDocuments(first.state,snapshot(),new Date(now));
  assert.equal(second.events.length,0); assert.equal(second.indexQueue.length,1);
  second.state.indexedHashes=['a'.repeat(64)];
  assert.equal(reconcileHoaDocuments(second.state,snapshot(),new Date(now)).indexQueue.length,0);
});
test('same name with changed content produces a new version; missing files are retained',()=>{
  const a=reconcileHoaDocuments(null,snapshot(),new Date(now));
  const b=reconcileHoaDocuments(a.state,snapshot([doc('rules','b'.repeat(64))]),new Date(now));
  assert.equal(b.events[0].type,'changed'); assert.equal(b.indexQueue[0].sha256,'b'.repeat(64));
  assert.deepEqual(b.state.documents.rules.versions,['a'.repeat(64),'b'.repeat(64)]);
  const c=reconcileHoaDocuments(b.state,snapshot([]),new Date(now));
  assert.equal(c.events[0].type,'missing'); assert.equal(c.state.documents.rules.available,false);
  assert.equal(c.state.documents.rules.versions.length,2);
  assert.equal(reconcileHoaDocuments(c.state,snapshot([]),new Date(now)).events.length,0);
});
test('login failure, partial inventory, stale snapshot and wrong account never replace baseline',()=>{
  const a=reconcileHoaDocuments(null,snapshot(),new Date(now)); const before=structuredClone(a.state);
  for(const s of [{...snapshot([]),authenticated:false},{...snapshot([]),complete:false},{...snapshot([]),source:'wrong'},
    {...snapshot([]),observedAt:'2026-09-04T12:00:00.000Z'}]) {
    assert.throws(()=>reconcileHoaDocuments(a.state,s,new Date(now)));
    assert.deepEqual(a.state,before);
  }
});
test('invalid hashes, unsafe or duplicate IDs and malformed dates fail closed',()=>{
  for(const docs of [[doc('rules','bad')],[doc('__proto__')],[doc(),doc()],[doc('../private')]])
    assert.throws(()=>reconcileHoaDocuments(null,snapshot(docs),new Date(now)));
  assert.throws(()=>reconcileHoaDocuments(null,{...snapshot(),observedAt:'2026-02-30T12:00:00.000Z'},new Date(now)));
});
test('weekly checks and six-hour error retry report overdue state without flooding unchanged runs',()=>{
  const a=reconcileHoaDocuments(null,snapshot(),new Date(now));
  assert.equal(hoaDocumentWatchStatus(a.state,new Date(now)).due,false);
  assert.equal(hoaDocumentWatchStatus(a.state,new Date('2026-09-12T12:00:00Z')).due,true);
  const failed={...a.state,lastAttemptAt:'2026-09-13T10:00:00.000Z',lastError:'LOGIN_REQUIRED'};
  assert.equal(hoaDocumentWatchStatus(failed,new Date('2026-09-13T11:00:00Z')).due,false);
  assert.equal(hoaDocumentWatchStatus(failed,new Date('2026-09-13T17:00:00Z')).due,true);
  assert.equal(hoaDocumentWatchStatus(failed,new Date('2026-09-13T11:00:00Z')).attention,'LOGIN_REQUIRED');
});
