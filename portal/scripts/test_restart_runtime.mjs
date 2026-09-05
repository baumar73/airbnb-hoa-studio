// Local workerd restart drill. Only generated fixtures and temporary storage;
// no real Cloudflare account, credentials, tenants, mail or host services.
import * as miniflare from 'miniflare';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {register} from 'node:module';
import assert from 'node:assert/strict';
import {loadStoredCases,saveStoredCases,loadKnowledgeChanges,inheritCaseSnapshot} from '../functions/lib/storage.js';
import {archivePackage,loadArchivedPackage} from '../functions/lib/package-archive.js';
import {claimReview,ownsReview,reviewAvailable} from '../functions/lib/review-jobs.js';
import {findStalledWork} from '../functions/lib/automation-health.js';
register('../test/loaders/cloudflare-sockets-loader.mjs',import.meta.url);
const {runGuestReminders}=await import('../functions/lib/guest-reminders.js');
const root=await mkdtemp(join(tmpdir(),'hoa-restart-fixtures-'));
let mf;
try {
  const script=await readFile(new URL('../case-store/src/index.js',import.meta.url),'utf8');
  const options={modules:true,script,compatibilityDate:'2026-06-01',resourcePersistencePath:root,
    durableObjects:{CASE_STORE:{className:'CaseStore',useSQLite:true}},durableObjectsPersist:join(root,'objects'),
    kvNamespaces:['LEGACY_CASES'],kvPersist:join(root,'kv'),bindings:{ALLOW_CASE_IMPORT:'yes'}};
  const start=async()=>{
    mf=new miniflare.Miniflare(miniflare.convertV4MiniflareOptions?miniflare.convertV4MiniflareOptions(options):options);
    const CASE_STORE=await mf.getDurableObjectNamespace('CASE_STORE');
    const CASES=await mf.getKVNamespace('LEGACY_CASES');
    return {CASE_STORE,CASES,REQUIRE_ATOMIC_CASES:'yes',AUTO_GUEST_REMINDERS:'yes',PORTAL_ORIGIN:'https://example.com',DATA_ENCRYPTION_KEY:Buffer.alloc(32,19).toString('base64')};
  };
  let env=await start();
  const actor=()=>env.CASE_STORE.get(env.CASE_STORE.idFromName('reservations-v1'));
  await env.CASES.put('cases','[]');
  const expectedHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('[]'))).toString('hex');
  assert.equal((await actor().fetch('https://case-store/initialize',{method:'POST',body:JSON.stringify({expectedHash,expectedCount:0})})).status,200);
  const now=new Date('2026-09-05T12:00:00Z'),at=now.toISOString();
  const cases=await loadStoredCases(env);
  cases.push(
    {id:'draft',status:'canceled',wizard:{adults:[{firstName:'Synthetic private draft'}]}},
    {id:'packet',reviewHash:'synthetic-review',pathType:'full',checkIn:'2026-11-01',checkOut:'2026-12-01'},
    {id:'review',wizard:{},reviewHash:'review-v1',ownerReviewReadyAt:at,pathType:'guest-registration',checkIn:'2026-11-01'},
    {id:'reminder',pathType:'full',screeningRoute:'paper',checkIn:'2026-11-01',checkOut:'2026-12-01',adults:1,
      guestContact:{requested:true,email:'synthetic@example.test'},steps:[],createdAt:'2026-09-01T00:00:00Z',
      automation:{reminderClaim:{id:'persisted-reminder',state:'claimed',claimedAt:at}}},
  );
  await saveStoredCases(env,cases);
  const bytes=new Uint8Array(150000).fill(73);
  await archivePackage(env,cases,cases.find(c=>c.id==='packet'),[{filename:'synthetic.pdf',bytes}],'synthetic-context');
  const prepared=await loadStoredCases(env),packet=prepared.find(c=>c.id==='packet');
  packet.reviewLockedAt=at;
  packet.submissionError={phase:'delivery_uncertain',message:'Synthetic interrupted send'};
  const firstLease=claimReview(prepared.find(c=>c.id==='review'),'context-v1',now);
  await saveStoredCases(env,prepared);
  const stale=await loadStoredCases(env),checkpoint=await loadKnowledgeChanges(env,{});
  const staleReview=stale.find(c=>c.id==='review');
  assert.ok(checkpoint.epoch);assert.equal(checkpoint.changes.length,4);

  await mf.dispose();mf=null;
  env=await start();
  const restored=await loadStoredCases(env);
  assert.equal(restored.find(c=>c.id==='draft').wizard.adults[0].firstName,'Synthetic private draft');
  assert.equal(restored.find(c=>c.id==='draft').status,'canceled');
  const restoredPacket=restored.find(c=>c.id==='packet');
  assert.equal(restoredPacket.reviewLockedAt,at);assert.equal(restoredPacket.submission,undefined);
  assert.deepEqual((await loadArchivedPackage(env,restoredPacket)).attachments[0].bytes,bytes);
  const resumedFeed=await loadKnowledgeChanges(env,{cursor:checkpoint.nextCursor});
  assert.equal(resumedFeed.epoch,checkpoint.epoch);assert.equal(resumedFeed.changes.length,0);
  assert.deepEqual(findStalledWork(restored,new Date(+now+21*60000)),{reminderDelivery:1,hoaDelivery:1});
  const reminders=await runGuestReminders(env,new Date(+now+21*60000),()=>assert.fail('restart must not resend a claimed reminder'));
  assert.equal(reminders.sent,0);assert.equal(reminders.uncertain,1);
  const review=restored.find(c=>c.id==='review');
  assert.equal(reviewAvailable(review,'context-v1',now),false);
  assert.equal(ownsReview(review,'context-v1',firstLease.token,new Date(+now+16*60000)),false);
  const secondLease=claimReview(review,'context-v1',new Date(+now+21*60000));
  assert.equal(secondLease.attempt,2);assert.notEqual(secondLease.token,firstLease.token);
  await saveStoredCases(env,restored);
  staleReview.notes='stale process write';
  await assert.rejects(saveStoredCases(env,stale),{code:'CASE_CONFLICT'});
  const raw=await (await actor().fetch('https://case-store/cases')).json();
  assert.doesNotMatch(JSON.stringify(raw),/Synthetic private draft|synthetic@example/);
  await assert.rejects(loadStoredCases({...env,DATA_ENCRYPTION_KEY:Buffer.alloc(32,20).toString('base64')}));
  const beforeDeletion=await loadKnowledgeChanges(env,{cursor:checkpoint.nextCursor});
  const current=await loadStoredCases(env);
  await saveStoredCases(env,inheritCaseSnapshot(current,current.filter(c=>c.id!=='draft')));

  await mf.dispose();mf=null;
  env=await start();
  const final=await loadStoredCases(env);
  assert.equal(final.some(c=>c.id==='draft'),false);
  assert.equal(final.find(c=>c.id==='review').reviewJob.token,secondLease.token);
  const deletion=await loadKnowledgeChanges(env,{cursor:beforeDeletion.nextCursor});
  assert.deepEqual(deletion.changes.map(c=>[c.id,c.value]),[['draft',null]]);
  assert.equal((await actor().fetch('https://case-store/initialize',{method:'POST',body:JSON.stringify({expectedHash,expectedCount:0})})).status,409);
  assert.equal((await mf.dispatchFetch('https://worker.example/cases')).status,404);
  console.log('workerd restart OK: two fresh runtimes, encrypted draft/archive recovery, durable send holds, no reminder resend, review lease expiry/reclaim, stale writer rejection, stable export cursor, durable deletion, wrong-key rejection');
} finally {
  try {if(mf)await mf.dispose();} finally {await rm(root,{recursive:true,force:true});}
}
