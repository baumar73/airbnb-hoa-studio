// Run only against Miniflare/workerd: no real account, credentials or tenants.
import * as miniflare from 'miniflare';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {loadStoredCases,saveStoredCases,loadKnowledgeChanges,inheritCaseSnapshot} from '../functions/lib/storage.js';
import {archivePackage,loadArchivedPackage} from '../functions/lib/package-archive.js';
const script=await readFile(new URL('../case-store/src/index.js',import.meta.url),'utf8');
const options={modules:true,script,compatibilityDate:'2026-06-01',
  durableObjects:{CASE_STORE:{className:'CaseStore',useSQLite:true}},
  kvNamespaces:['LEGACY_CASES'],bindings:{ALLOW_CASE_IMPORT:'yes'}};
const mf=new miniflare.Miniflare(miniflare.convertV4MiniflareOptions ? miniflare.convertV4MiniflareOptions(options) : options);
try {
  const namespace=await mf.getDurableObjectNamespace('CASE_STORE');
  const actor=namespace.get(namespace.idFromName('reservations-v1'));
  const legacy=await mf.getKVNamespace('LEGACY_CASES');
  await legacy.put('cases','[]');
  const expectedHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('[]')))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const imported=await actor.fetch('https://case-store/initialize',{method:'POST',body:JSON.stringify({expectedHash,expectedCount:0})});
  assert.equal(imported.status,200);
  assert.equal((await actor.fetch('https://case-store/initialize',{method:'POST',body:JSON.stringify({expectedHash,expectedCount:0})})).status,409);
  const env={CASE_STORE:namespace,DATA_ENCRYPTION_KEY:Buffer.alloc(32,3).toString('base64')};
  const first=await loadStoredCases(env);
  first.push({id:'guest-a',wizard:{adults:[{firstName:'Jane'}]}},{id:'guest-b'});
  await saveStoredCases(env,first);
  const initialExport=await loadKnowledgeChanges(env,{limit:1});
  assert.equal(initialExport.changes.length,1);assert.equal(initialExport.hasMore,true);
  assert.equal(initialExport.changes[0].value.wizard.adults[0].firstName,'Jane');
  const initialTail=await loadKnowledgeChanges(env,{cursor:initialExport.nextCursor});
  assert.equal(initialTail.changes[0].id,'guest-b');
  assert.equal(initialTail.epoch,initialExport.epoch);
  const a=await loadStoredCases(env),b=await loadStoredCases(env);
  a[0].status='canceled';b[1].notes='independent';
  await Promise.all([saveStoredCases(env,a),saveStoredCases(env,b)]);
  const saved=await loadStoredCases(env);
  assert.equal(saved[0].status,'canceled');assert.equal(saved[1].notes,'independent');
  const x=await loadStoredCases(env),y=await loadStoredCases(env);
  x[1].notes='first';y[1].notes='second';
  const outcomes=await Promise.allSettled([saveStoredCases(env,x),saveStoredCases(env,y)]);
  assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,1);
  assert.equal(outcomes.find(o=>o.status==='rejected').reason.code,'CASE_CONFLICT');
  const raw=await (await actor.fetch('https://case-store/cases')).json();
  assert.ok(raw.cases[0].wizardCiphertext);assert.equal(raw.cases[0].wizard,undefined);
  const prepare=await loadStoredCases(env);prepare[1].reviewHash='synthetic-review';prepare[1].pathType='full';await saveStoredCases(env,prepare);
  const fixture=new Uint8Array(150000).fill(73);
  await archivePackage(env,prepare,prepare[1],[{filename:'synthetic.pdf',bytes:fixture}],'synthetic-context');
  const archived=(await loadStoredCases(env))[1];
  assert.deepEqual((await loadArchivedPackage(env,archived)).attachments[0].bytes,fixture);
  const beforeDelete=await loadKnowledgeChanges(env,{cursor:initialTail.nextCursor});
  assert.equal(beforeDelete.changes.length,2);
  const remove=await loadStoredCases(env);
  await saveStoredCases(env,inheritCaseSnapshot(remove,remove.filter(c=>c.id!=='guest-b')));
  const deletion=await loadKnowledgeChanges(env,{cursor:beforeDelete.nextCursor});
  assert.deepEqual(deletion.changes.map(c=>[c.id,c.value]),[['guest-b',null]]);
  assert.equal((await loadKnowledgeChanges(env,{cursor:deletion.nextCursor})).changes.length,0);
  assert.equal((await mf.dispatchFetch('https://worker.example/cases')).status,404);
  assert.equal((await mf.dispatchFetch('https://worker.example/knowledge-changes')).status,404);
  console.log('workerd integration OK: explicit import, isolated encrypted records, concurrent updates, stale-write rejection, chunked immutable archive, knowledge pagination/deletion checkpoints, no public access');
} finally {await mf.dispose();}
