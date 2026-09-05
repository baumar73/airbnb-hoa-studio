import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import { CaseStore } from '../case-store/src/index.js';
import { loadStoredCases, saveStoredCases, inheritCaseSnapshot, putEncryptedSecret, caseSnapshotVersion } from '../functions/lib/storage.js';
import {caseReviewDigest,reviewContextHash} from '../functions/lib/review.js';
import {reconcileBookingUpdate,acknowledgeBookingChange} from '../functions/lib/booking-reconcile.js';
import { register } from 'node:module';
register('./loaders/cloudflare-sockets-loader.mjs', import.meta.url);
const {onRequest}=await import('../functions/[[path]].js');
const {persistDeliveryOutcome}=await import('../functions/lib/delivery.js');
const {runGuestReminders}=await import('../functions/lib/guest-reminders.js');
const {computeAlerts}=await import('../cron/src/index.js');
const {archivePackage,loadArchivedPackage}=await import('../functions/lib/package-archive.js');
const {automaticReleaseState,runAutomaticSubmissions}=await import('../functions/lib/auto-submit.js');
const {submitApprovedPackage}=await import('../functions/lib/submit.js');
const {reconcileAcceptedPackage}=await import('../functions/lib/package-reconciliation.js');

// The fake serializes transactions, matching the actor's atomic storage API.
// A separate workerd test verifies the same behavior in Cloudflare's runtime.
function setup() {
  const values = new Map(), legacy = new Map();
  let queue = Promise.resolve();
  const storage = {
    get: async k => structuredClone(values.get(k)),
    put: async (k,v) => values.set(k, structuredClone(v)),
    delete: async k => values.delete(k),
    transaction(fn) { const task = queue.then(() => fn(storage)); queue = task.catch(() => {}); return task; },
  };
  const actor = new CaseStore({storage}, {});
  values.set('snapshot', {revision:0, ids:[], versions:{}});
  const env = {DATA_ENCRYPTION_KEY: Buffer.alloc(32,7).toString('base64'), CASES:{get:async k=>legacy.get(k)??null,put:async(k,v)=>legacy.set(k,v),delete:async k=>legacy.delete(k)}, CASE_STORE:{idFromName:n=>n,get:()=>({fetch:(url,options)=>actor.fetch(new Request(url,options))})}};
  return {env,values,legacy,actor};
}
async function seed(env) {
  const cases=await loadStoredCases(env);
  cases.push({id:'a',guestName:'Jane Smith',wizard:{adults:[{firstName:'Jane',idNumber:'private-test-id'}]}},{id:'b',guestName:'John Doe'});
  await saveStoredCases(env,cases);
}
test('one HOA source cannot be assigned to different cases by concurrent snapshots',async()=>{
  const {env}=setup();await seed(env);
  const left=await loadStoredCases(env),right=await loadStoredCases(env);
  const event={id:'synthetic-source-hash',review:{kind:'confirmed'}};
  left[0].hoaMailEvents=[event];right[1].hoaMailEvents=[event];
  const results=await Promise.allSettled([saveStoredCases(env,left),saveStoredCases(env,right)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'CASE_CONFLICT');
  const current=await loadStoredCases(env);
  assert.equal(current.filter(c=>c.hoaMailEvents?.some(e=>e.id===event.id)).length,1);
  // Updating the reservation that already owns the source remains possible.
  current.find(c=>c.hoaMailEvents?.length).hoaMailEvents[0].review.by='Synthetic owner';
  await saveStoredCases(env,current);
});
test('a batch cannot attach the same HOA source to two reservations',async()=>{
  const {env,values}=setup();await seed(env);
  const cases=await loadStoredCases(env),before=structuredClone([...values]);
  for(const c of cases)c.hoaMailEvents=[{id:'same-source'}];
  await assert.rejects(saveStoredCases(env,cases),{code:'CASE_CONFLICT'});
  assert.deepEqual([...values],before);
});
test('an old browser draft cannot overwrite a newer saved form or changed booking',async()=>{
  const {env}=setup();
  const cases=await loadStoredCases(env);
  cases.push({id:'draft-case',token:'drafttoken123',guestName:'Jane Smith',pathType:'full',screeningRoute:'paper',hoaOccupancyConfirmedAt:'2026-09-01',adults:1,nights:30,checkIn:'2026-11-01',checkOut:'2026-12-01',steps:[]});
  await saveStoredCases(env,cases);
  const request=(method,form)=>onRequest({env,request:new Request('https://portal.example.test/w/drafttoken123',{method,headers:{Origin:'https://portal.example.test'},...(form?{body:new URLSearchParams(form)}:{})})});
  const page=await (await request('GET')).text();
  const version=page.match(/name="draftVersion" value="([0-9]+)"/)?.[1];
  assert.ok(version,'the rendered form carries its source revision');
  // Execute the actual rendered handler against a minimal DOM adapter. This
  // is a unit test, not a claim of full real-browser/mobile verification.
  const script=[...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('let saving = false'));
  let handler,posted,navigated=false;
  const notice={textContent:''},form={action:'https://portal.example.test/w/drafttoken123',elements:{draftVersion:{value:version},a0_firstName:{value:'Keep my entries'}},addEventListener:(event,fn)=>{handler=fn;}};
  const sandbox={document:{querySelectorAll:()=>[],querySelector:()=>form,getElementById:()=>notice},location:{assign:()=>{navigated=true;}},FormData:class extends Map{constructor(f){super(Object.entries(f.elements).map(([k,v])=>[k,v.value]));}},fetch:async(url,options)=>{posted=options.body;return {status:409,ok:false};}};
  runInNewContext(script,sandbox);
  await handler({currentTarget:form,preventDefault(){},submitter:{name:'saveMode',value:'draft'}});
  assert.equal(posted.get('saveMode'),'draft');assert.equal(posted.get('draftVersion'),version);
  assert.equal(navigated,false);assert.equal(form.elements.a0_firstName.value,'Keep my entries');assert.match(notice.textContent,/Not saved/);
  sandbox.fetch=async()=>{throw new Error('offline');};
  await handler({currentTarget:form,preventDefault(){}});
  assert.equal(navigated,false);assert.match(notice.textContent,/connection was interrupted/);
  assert.equal((await request('POST',{draftVersion:version,saveMode:'draft',a0_firstName:'New draft'})).status,303);
  const stale=await request('POST',{draftVersion:version,saveMode:'draft',a0_firstName:'Old tab'});
  assert.equal(stale.status,409);
  assert.match(await stale.text(),/not saved/);
  assert.equal((await loadStoredCases(env))[0].wizard.adults[0].firstName,'New draft');
  assert.equal((await request('POST',{saveMode:'draft',a0_firstName:'Missing revision'})).status,409);
  const newerPage=await (await request('GET')).text();
  const newerVersion=newerPage.match(/name="draftVersion" value="([0-9]+)"/)[1];
  const changed=await loadStoredCases(env);changed[0].checkIn='2026-11-02';await saveStoredCases(env,changed);
  assert.equal((await request('POST',{draftVersion:newerVersion,saveMode:'draft',a0_firstName:'Stale dates'})).status,409);
  const saved=(await loadStoredCases(env))[0];
  assert.equal(saved.checkIn,'2026-11-02');assert.equal(saved.submission,undefined);
});
test('separate case edits merge without replacing other reservations', async()=>{
  const {env,legacy,values}=setup(); await seed(env);
  const first=await loadStoredCases(env),second=await loadStoredCases(env);
  first[0].notes='first'; second[1].notes='second';
  await Promise.all([saveStoredCases(env,first),saveStoredCases(env,second)]);
  const saved=await loadStoredCases(env);
  assert.equal(saved[0].notes,'first');assert.equal(saved[1].notes,'second');
  assert.equal(legacy.has('cases'),false);
  assert.doesNotMatch(JSON.stringify([...values]),/private-test-id/);
});
test('stale guest edit cannot revert a cancellation', async()=>{
  const {env}=setup();await seed(env);
  const guest=await loadStoredCases(env),poller=await loadStoredCases(env);
  poller[0].status='canceled';await saveStoredCases(env,poller);
  guest[0].wizard.adults[0].firstName='Updated';
  await assert.rejects(saveStoredCases(env,guest),{code:'CASE_CONFLICT'});
  assert.equal((await loadStoredCases(env))[0].status,'canceled');
});
test('stale edits do not resurrect deleted cases', async()=>{
  const {env}=setup();await seed(env);
  const stale=await loadStoredCases(env),owner=await loadStoredCases(env);
  await saveStoredCases(env,inheritCaseSnapshot(owner,owner.filter(c=>c.id!=='a')));
  stale[0].notes='later';await assert.rejects(saveStoredCases(env,stale),{code:'CASE_CONFLICT'});
  assert.equal((await loadStoredCases(env)).some(c=>c.id==='a'),false);
});
test('delivery receipt preserves concurrent cancellation and never replaces the case', async()=>{
  const {env}=setup();await seed(env);
  const claimed=await loadStoredCases(env);
  claimed[0].reviewLockedAt='claim-1';claimed[0].steps=[{id:'submitted_hoa',done:false}];
  await saveStoredCases(env,claimed);
  const poller=await loadStoredCases(env);poller[0].status='canceled';poller[0].notes='keep this';await saveStoredCases(env,poller);
  await persistDeliveryOutcome(env,claimed,claimed[0],{submission:{sentAt:'2026-09-04T12:00:00Z',docs:['synthetic.pdf']}});
  const [saved]=await loadStoredCases(env);
  assert.equal(saved.status,'canceled');assert.equal(saved.notes,'keep this');
  assert.deepEqual(saved.submission.docs,['synthetic.pdf']);assert.equal(saved.steps[0].done,true);
});
test('delivery receipt refuses deleted or replaced delivery claims', async()=>{
  const {env}=setup();await seed(env);
  const claimed=await loadStoredCases(env);claimed[0].reviewLockedAt='first';await saveStoredCases(env,claimed);
  const changed=await loadStoredCases(env);changed[0].reviewLockedAt='second';await saveStoredCases(env,changed);
  await assert.rejects(persistDeliveryOutcome(env,claimed,claimed[0],{submission:{sentAt:'now'}}),{code:'CASE_DELIVERY_CHANGED'});
  await saveStoredCases(env,inheritCaseSnapshot(changed,changed.filter(c=>c.id!=='a')));
  await assert.rejects(persistDeliveryOutcome(env,claimed,claimed[0],{submission:{sentAt:'now'}}),{code:'CASE_DELIVERY_CHANGED'});
  assert.equal((await loadStoredCases(env)).some(c=>c.id==='a'),false);
});
test('matching release timestamp cannot attach an old receipt to replaced review or package bytes',async()=>{
  for(const change of [c=>{c.reviewHash='new-review';},c=>{c.preparedPackage.id='new-package';},c=>{c.preparedPackage.packageHash='new-bytes';}]) {
    const {env}=setup();await seed(env);
    const claimed=await loadStoredCases(env);
    Object.assign(claimed[0],{reviewLockedAt:'same-claim',reviewHash:'old-review',preparedPackage:{id:'old-package',packageHash:'old-bytes'},steps:[{id:'submitted_hoa',done:false}]});
    await saveStoredCases(env,claimed);
    const updated=await loadStoredCases(env);change(updated[0]);await saveStoredCases(env,updated);
    await assert.rejects(persistDeliveryOutcome(env,claimed,claimed[0],{submission:{sentAt:'2026-09-05T12:00:00Z'}}),{code:'CASE_DELIVERY_CHANGED'});
    const [saved]=await loadStoredCases(env);
    assert.equal(saved.submission,undefined);assert.equal(saved.steps[0].done,false);assert.equal(saved.reviewLockedAt,'same-claim');
  }
});
test('snapshot metadata is required and missing backend never falls back when required', async()=>{
  const {env}=setup();await seed(env);
  await assert.rejects(saveStoredCases(env,[{id:'a'}]),{code:'CASE_SNAPSHOT_REQUIRED'});
  delete env.CASE_STORE;env.REQUIRE_ATOMIC_CASES='yes';
  await assert.rejects(loadStoredCases(env),{code:'CASE_STORE_UNAVAILABLE'});
});
test('normalizing view labels is not treated as a write to unrelated cases', async()=>{
  const {env}=setup();await seed(env);
  const loaded=await loadStoredCases(env);
  const view=inheritCaseSnapshot(loaded,loaded.map(c=>({...c,displayLabel:'normalized'})),true);
  const poller=await loadStoredCases(env);poller[1].status='canceled';await saveStoredCases(env,poller);
  view[0].notes='safe';await saveStoredCases(env,view);
  const saved=await loadStoredCases(env);assert.equal(saved[1].status,'canceled');
});
test('actor refuses plaintext wizard data and uninitialized reads', async()=>{
  const {actor,values}=setup();
  const r=await actor.fetch(new Request('https://case-store/cases',{method:'PATCH',body:JSON.stringify({changes:[{id:'x',expectedVersion:0,value:{id:'x',wizard:{private:'data'}}}]})}));
  assert.equal(r.status,400);
  values.delete('snapshot');assert.equal((await actor.fetch(new Request('https://case-store/cases'))).status,503);
});

test('review API reads encrypted cases and accepts only a current structured report', async()=>{
  const {env}=setup();
  env.ADMIN_USER='review-test';env.ADMIN_PASSWORD='test-only';
  const cases=await loadStoredCases(env);
  cases.push({id:'review-case',guestName:'Jane Smith',pathType:'full',screeningRoute:'paper',
    reviewHash:'abc123',ownerReviewReadyAt:'2026-09-04T00:00:00Z',adults:1,nights:30,
    checkIn:'2026-10-01',checkOut:'2026-10-31',token:'private-not-for-review',notes:'unrelated private notes',
    wizard:{adults:[{firstName:'Jane',idNumber:'test-id'}]},steps:[]});
  await saveStoredCases(env,cases);
  const call=(path,form)=>onRequest({env,request:new Request('https://portal.example.test'+path,{method:form?'POST':'GET',headers:{Authorization:'Basic '+btoa('review-test:test-only'),Origin:'https://portal.example.test','Content-Type':'application/json'},body:form?JSON.stringify(form):undefined})});
  const res=await call('/admin/review/candidates');assert.equal(res.status,200);
  const payload=await res.json();
  assert.equal(payload.cases[0].wizard,undefined);assert.equal(payload.ownerSignature,undefined);
  assert.equal(payload.cases[0].token,undefined);assert.equal(payload.cases[0].notes,undefined);
  const report={status:'green',confidence:.9,findings:[],documents:[],summary:'Consistent',model:'test'};
  let result=await call('/admin/review/result',{id:'review-case',reviewHash:'stale',reviewContextHash:payload.cases[0].reviewContextHash,report});
  assert.equal(result.status,409);
  result=await call('/admin/review/result',{id:'review-case',reviewHash:'abc123',reviewContextHash:payload.cases[0].reviewContextHash,report:{...report,status:'invented'}});
  assert.equal(result.status,400);
  // Incomplete paperwork must not become green just because a model says so.
  result=await call('/admin/review/result',{id:'review-case',reviewHash:'abc123',reviewContextHash:payload.cases[0].reviewContextHash,report});
  assert.equal(result.status,409);
  result=await call('/admin/review/result',{id:'review-case',reviewHash:'abc123',reviewContextHash:payload.cases[0].reviewContextHash,report:{...report,status:'red',findings:['Missing fields']}});
  assert.equal(result.status,200);
  const [saved]=await loadStoredCases(env);assert.equal(saved.aiReview.status,'red');assert.equal(saved.submission,undefined);
});

async function reminderFixture() {
  const {env}=setup();
  Object.assign(env,{AUTO_GUEST_REMINDERS:'yes',REQUIRE_ATOMIC_CASES:'yes',PORTAL_ORIGIN:'https://example.com'});
  const cases=await loadStoredCases(env);
  cases.push({id:'remind',pathType:'full',screeningRoute:'paper',checkIn:'2026-11-01',checkOut:'2026-12-01',createdAt:'2026-09-01T00:00:00Z',adults:1,steps:[],token:'never-include-this-token',wizard:{adults:[{email:'synthetic@example.test',idNumber:'never-include-this-id'}]}});
  await saveStoredCases(env,cases);
  return env;
}

test('hybrid review API atomically claims, retries after failure and fences duplicate workers',async()=>{
  const {env}=setup();env.REVIEW_RELIABILITY='yes';env.REVIEW_API_TOKEN='r'.repeat(40);
  const cases=await loadStoredCases(env);
  cases.push({id:'retry',wizard:{},reviewHash:'hash',ownerReviewReadyAt:'2026-09-05',pathType:'guest-registration',steps:[]});
  await saveStoredCases(env,cases);
  const call=(path,data,origin='https://portal.example.test')=>onRequest({env,request:new Request('https://portal.example.test/admin/review/'+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+env.REVIEW_API_TOKEN,Origin:origin},body:data?JSON.stringify(data):undefined})});
  const queue=await (await call('candidates')).json();assert.equal(queue.protocol,2);
  const input={id:'retry',reviewHash:'hash',reviewContextHash:queue.cases[0].reviewContextHash};
  assert.equal((await call('claim',input,'https://evil.example.test')).status,403);
  const concurrent=await Promise.all([call('claim',input),call('claim',input)]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  const claim=await concurrent.find(r=>r.status===200).json();assert.ok(claim.token);
  assert.equal((await (await call('candidates')).json()).cases.length,0);
  const report={status:'red',confidence:.9,summary:'synthetic',findings:['synthetic'],model:'test'};
  assert.equal((await call('result',{...input,report})).status,409);
  const submission={...input,claimToken:claim.token,report};
  assert.equal((await call('result',submission)).status,200);
  // A lost HTTP acknowledgement must not overwrite the first accepted result.
  assert.equal((await call('result',{...submission,report:{...report,summary:'overwrite'}})).status,200);
  assert.equal((await loadStoredCases(env))[0].aiReview.summary,'synthetic');
  // This synthetic case has no real PDF; real completed packets leave the queue.
  const changed=await loadStoredCases(env);changed[0].reviewHash='new';await saveStoredCases(env,changed);
  assert.equal((await call('result',submission)).status,409);
  const next=(await (await call('candidates')).json()).cases[0];
  const nextClaim=await (await call('claim',next)).json();
  assert.equal((await call('failure',{...next,claimToken:nextClaim.token,error:'secret must not be stored'})).status,200);
  const saved=(await loadStoredCases(env))[0];assert.equal(saved.reviewJob.state,'waiting');
  assert.doesNotMatch(JSON.stringify(saved),/secret must/);assert.equal(saved.submission,undefined);
  assert.equal((await call('heartbeat',{state:'completed'})).status,200);
  assert.equal((await call('heartbeat',{state:'arbitrary'})).status,400);
});
test('concurrent reminder workers send once directly to the guest, without private values',async()=>{
  const env=await reminderFixture(),now=new Date('2026-09-05T12:00:00Z');
  const sent=[];const send=async(_,message)=>{sent.push(message);return true;};
  await Promise.all([runGuestReminders(env,now,send),runGuestReminders(env,now,send)]);
  assert.equal(sent.length,1);assert.deepEqual(sent[0].to,['synthetic@example.test']);assert.deepEqual(sent[0].cc,[]);
  assert.match(sent[0].text,/adult 1 lastName/);assert.match(sent[0].text,/https:\/\/example.com\//);
  assert.doesNotMatch(JSON.stringify(sent),/never-include/);
  await runGuestReminders(env,now,send);assert.equal(sent.length,1);
  assert.equal((await loadStoredCases(env))[0].automation.reminderClaim.state,'sent');
});
test('explicit false reminder delivery remains uncertain and cannot trigger another send',async()=>{
  const env=await reminderFixture(),now=new Date('2026-09-05T12:00:00Z');
  const result=await runGuestReminders(env,now,async()=>false);
  assert.equal(result.sent,0);assert.equal(result.uncertain,1);
  const [c]=await loadStoredCases(env);assert.equal(c.automation.lastGuestReminderAt,undefined);
  await runGuestReminders(env,new Date('2026-09-10'),()=>assert.fail('must not resend'));
});
test('uncertain reminder transport is not retried and does not mark delivery confirmed',async()=>{
  const env=await reminderFixture(),now=new Date('2026-09-05T12:00:00Z');let attempts=0;
  const send=async()=>{attempts++;throw new Error('synthetic ambiguous disconnect');};
  await runGuestReminders(env,now,send);
  await runGuestReminders(env,new Date('2026-09-10T12:00:00Z'),send);
  assert.equal(attempts,1);
  const [c]=await loadStoredCases(env);assert.equal(c.automation.lastGuestReminderAt,undefined);assert.equal(c.automation.reminderClaim.state,'uncertain');
});
test('disabled reminders and canceled bookings perform no outbound communication',async()=>{
  const env=await reminderFixture(),now=new Date('2026-09-05T12:00:00Z');let sent=0;
  env.AUTO_GUEST_REMINDERS='no';
  assert.equal((await runGuestReminders(env,now,async()=>{sent++;})).disabled,true);
  env.AUTO_GUEST_REMINDERS='yes';const cases=await loadStoredCases(env);cases[0].status='canceled';await saveStoredCases(env,cases);
  await runGuestReminders(env,now,async()=>{sent++;});assert.equal(sent,0);
});
test('missing guest contact is explicitly reported, not silently replaced by owner email',async()=>{
  const env=await reminderFixture(),now=new Date('2026-09-05T12:00:00Z');
  const cases=await loadStoredCases(env);delete cases[0].wizard;await saveStoredCases(env,cases);
  const result=await runGuestReminders(env,now,async()=>{assert.fail('no recipient was verified');});
  assert.equal(result.waitingForContact,1);assert.equal(result.sent,0);
});
test('watchdog does not ask owner to chase guests when direct reminders are enabled',()=>{
  const c={id:'test',token:'synthetic-private-guest-token',checkIn:'2026-11-01',checkOut:'2026-12-01',createdAt:'2026-09-01',pathType:'full',screeningRoute:'paper',steps:[]};
  const alerts=computeAlerts([structuredClone(c)],new Date('2026-09-05'));
  assert.equal(alerts.some(a=>a.key==='wizardNudge'),true);assert.doesNotMatch(alerts.find(a=>a.key==='wizardNudge').text,/synthetic-private-guest-token|\/v\//);
  assert.equal(computeAlerts([structuredClone(c)],new Date('2026-09-05'),{directGuestReminders:true}).some(a=>a.key==='wizardNudge'),false);
  assert.equal(computeAlerts([{...c,screeningRoute:'online'}],new Date('2026-09-05')).some(a=>a.key==='wizardNudge'),false);
  assert.deepEqual(computeAlerts([{...c,status:'canceled'}],new Date('2026-09-05')),[]);
});
test('immutable package roundtrips encrypted bytes and rejects stale preparation',async()=>{
  const {env,values}=setup();await seed(env);
  const cases=await loadStoredCases(env);cases[0].reviewHash='review-v1';cases[0].pathType='full';await saveStoredCases(env,cases);
  const files=[{filename:'synthetic-test.pdf',bytes:new TextEncoder().encode('%PDF synthetic test payload not an HOA template')}];
  const manifest=await archivePackage(env,cases,cases[0],files,'context-v1');
  const [current]=await loadStoredCases(env);
  assert.equal(current.preparedPackage.id,manifest.id);
  assert.doesNotMatch(JSON.stringify([...values]),/synthetic test payload/);
  const restored=await loadArchivedPackage(env,current);assert.deepEqual(restored.attachments,files);
  await assert.rejects(archivePackage(env,cases,cases[0],files,'context-v1'),{code:'CASE_CONFLICT'});
});
test('archive cannot be overwritten and disappears when its case is deleted',async()=>{
  const {env,actor,values}=setup();await seed(env);
  const cases=await loadStoredCases(env);cases[0].reviewHash='r';await saveStoredCases(env,cases);
  await archivePackage(env,cases,cases[0],[{filename:'test.pdf',bytes:new Uint8Array([1,2,3])}],'context');
  const current=await loadStoredCases(env),c=current[0];
  const found=await actor.fetch(new Request(`https://case-store/packages?caseId=a&id=${c.preparedPackage.id}`));
  const data=await found.json();
  const overwrite=await actor.fetch(new Request('https://case-store/packages',{method:'POST',body:JSON.stringify({caseId:'a',expectedVersion:2,...data})}));
  assert.equal(overwrite.status,409);
  await saveStoredCases(env,inheritCaseSnapshot(current,current.filter(c=>c.id!=='a')));
  await assert.rejects(loadArchivedPackage(env,c),{code:'CASE_ARCHIVE_MISSING'});
  assert.equal([...values.keys()].some(k=>k.startsWith('package:a:')),false);
});

async function automaticFixture() {
  const {env,legacy}=setup();
  Object.assign(env,{AUTO_HOA_SUBMIT:'yes',REQUIRE_ATOMIC_CASES:'yes',OWNER_SIGNATURE_AUTHORIZATION:'hoa-paperwork-v1',OWNER_AUTHORIZATION_REFERENCE:'synthetic-test-authorization',AUDIT_HASH_SALT:'synthetic-audit-salt-only'});
  const bytes=Buffer.alloc(120);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);Buffer.from('IHDR').copy(bytes,12);bytes.writeUInt32BE(640,16);bytes.writeUInt32BE(170,20);
  const sig=bytes.toString('base64');
  await putEncryptedSecret(env,'owner-signature-png',sig);
  const compliance={policyVersion:'fl-2026.09.02',landlordNoticeAddress:'synthetic address',governingDocumentsVerifiedAt:'synthetic',approvalAuthorityCitation:'synthetic',rulesVersion:'synthetic',hoaESignAcceptedAt:'synthetic',privacySecurityReviewedAt:'synthetic',fairHousingReviewedAt:'synthetic',feeAuthorityCitation:'synthetic',airbnbFeeDisclosureVerifiedAt:'synthetic'};
  legacy.set('compliance-config',JSON.stringify(compliance));legacy.set('submit-live','yes');
  compliance.airbnbExternalFeeAuthorizationReference='synthetic authorization';legacy.set('compliance-config',JSON.stringify(compliance));
  const cases=await loadStoredCases(env);
  const c={id:'automatic',guestName:'Jane Smith',reservationCode:'SYNTHETIC123',checkIn:'2026-11-01',checkOut:'2026-12-01',nights:30,adults:1,pathType:'full',screeningRoute:'paper',ownerReviewReadyAt:'2026-09-05T00:00:00Z',
    steps:['ids_provided','fee_sent','screening_complete'].map(id=>({id,done:true})),
    wizard:{adults:[{firstName:'Jane',middleName:'None',lastName:'Smith',birthDate:'1980-01-01',gender:'F',phone:'555-0100',email:'synthetic@example.test',street:'synthetic',city:'synthetic',state:'FL',zip:'00000',idType:'drivers_license',idNumber:'synthetic',idState:'FL',employer:'Retired',employerPhone:'N/A',sigPng:sig,esignConsent:true,signatureAudit:{signedAt:'2026-09-05T00:00:00Z',contentHash:'synthetic'}}],references:[{name:'One',phone:'1',address:'test'},{name:'Two',phone:'2',address:'test'}],emergency:[{name:'One',phone:'1'},{name:'Two',phone:'2'}],esignConsent:true,esignConsentVersion:'fl-2026.09.02',rulesAcknowledged:true}};
  c.reviewHash=await caseReviewDigest(c,c.wizard);cases.push(c);await saveStoredCases(env,cases);
  const context=await reviewContextHash(c,sig,compliance);
  await archivePackage(env,cases,c,[1,2,3,4].map(i=>({filename:`synthetic-${i}.pdf`,bytes:new TextEncoder().encode(`synthetic PDF fixture ${i}`)})),context);
  const current=await loadStoredCases(env);
  current[0].aiReview={status:'green',confidence:.9,findings:[],summary:'Synthetic validation',model:'test',reviewHash:c.reviewHash,reviewContextHash:context,packageId:current[0].preparedPackage.id,packageHash:current[0].preparedPackage.packageHash};
  await saveStoredCases(env,current);
  return {env,sig,compliance};
}
test('explicit false package delivery does not create a submitted record',async()=>{
  const {env}=await automaticFixture();
  await runAutomaticSubmissions(env,new Date('2026-09-05'),(c,cases)=>submitApprovedPackage(c,cases,env,{sendMail:async()=>false,sendNotice:async()=>true}));
  const [c]=await loadStoredCases(env);
  assert.equal(c.submission,undefined);assert.equal(c.submissionError.phase,'delivery_uncertain');assert.ok(c.reviewLockedAt);
  await runAutomaticSubmissions(env,new Date('2026-09-06'),()=>assert.fail('must not resend'));
});
test('standing authorization releases a complete reviewed package once without owner interaction',async()=>{
  const {env}=await automaticFixture();let deliveries=0;
  const submit=async(c,cases)=>{deliveries++;await persistDeliveryOutcome(env,cases,c,{submission:{sentAt:'2026-09-05T12:00:00Z',packageId:c.preparedPackage.id,docs:c.preparedPackage.documents.map(d=>d.filename)}});return true;};
  await Promise.all([runAutomaticSubmissions(env,new Date('2026-09-05'),submit),runAutomaticSubmissions(env,new Date('2026-09-05'),submit)]);
  assert.equal(deliveries,1);
  const [c]=await loadStoredCases(env);assert.equal(c.autoRelease.scope,'hoa-paperwork-v1');assert.ok(c.submission);assert.equal(c.steps.some(s=>s.id==='board_approved'&&s.done),false);
});
test('automation rejects missing fee evidence, changed signatures, stale review and revoked authority',async()=>{
  const {env,sig,compliance}=await automaticFixture();const [c]=await loadStoredCases(env);
  assert.equal((await automaticReleaseState(c,env,sig,compliance)).ok,true);
  const unpaid=structuredClone(c);unpaid.steps.find(s=>s.id==='fee_sent').done=false;
  assert.ok((await automaticReleaseState(unpaid,env,sig,compliance)).missing.includes('fee_sent'));
  assert.equal((await automaticReleaseState(c,env,sig+'changed',compliance)).ok,false);
  const stale=structuredClone(c);stale.aiReview.packageHash='old';assert.equal((await automaticReleaseState(stale,env,sig,compliance)).ok,false);
  delete env.OWNER_SIGNATURE_AUTHORIZATION;
  assert.ok((await automaticReleaseState(c,env,sig,compliance)).missing.includes('standing_owner_authorization'));
  let deliveries=0;await runAutomaticSubmissions(env,new Date('2026-09-05'),async()=>{deliveries++;});assert.equal(deliveries,0);
});

test('actual package dispatcher sends archived bytes once across concurrent workers and restart',async()=>{
  const {env}=await automaticFixture();let deliveries=0;
  env.ASSETS={fetch:()=>assert.fail('reviewed PDFs must not be regenerated')};
  const submit=(c,cases)=>submitApprovedPackage(c,cases,env,{sendMail:async(_env,message)=>{
    deliveries++;
    assert.equal(message.attachments.length,4);
    assert.equal(new TextDecoder().decode(message.attachments[3].bytes),'synthetic PDF fixture 4');
    assert.ok(message.to.length);
    assert.ok(![...message.to,...message.cc].includes('synthetic@example.test'),'guest is not a package recipient');
  },sendNotice:async()=>true});
  const results=await Promise.all([runAutomaticSubmissions(env,new Date('2026-09-05'),submit),runAutomaticSubmissions(env,new Date('2026-09-05'),submit)]);
  assert.equal(results.reduce((sum,r)=>sum+r.sent,0),1);
  await runAutomaticSubmissions(env,new Date('2026-09-06'),submit);
  assert.equal(deliveries,1);
  const [saved]=await loadStoredCases(env);
  assert.equal(saved.submission.packageHash,saved.preparedPackage.packageHash);
  assert.ok(saved.reviewLockedAt);
  assert.equal(saved.steps.some(s=>s.id==='board_approved'&&s.done),false);
});

test('package transport timeout retains a durable lock and excludes raw provider errors',async()=>{
  const {env}=await automaticFixture();let deliveries=0;const notices=[];
  const submit=(c,cases)=>submitApprovedPackage(c,cases,env,{sendMail:async()=>{
    deliveries++;throw Error('synthetic-private-password https://example.test/v/private-guest-token SMTP timeout');
  },sendNotice:async(_env,message)=>{notices.push(message);return true;}});
  const result=await runAutomaticSubmissions(env,new Date('2026-09-05'),submit);
  assert.equal(result.failed,1);assert.equal(result.sent,0);
  const [saved]=await loadStoredCases(env);
  assert.equal(saved.submission,undefined);assert.ok(saved.reviewLockedAt);
  assert.equal(saved.submissionError.phase,'delivery_uncertain');
  assert.doesNotMatch(JSON.stringify({saved,notices}),/synthetic-private-password|private-guest-token/);
  await runAutomaticSubmissions(env,new Date('2026-09-06'),submit);
  assert.equal(deliveries,1);
});

test('accepted package with failed receipt storage is not reported sent or retried after recovery',async()=>{
  const {env}=await automaticFixture();const originalGet=env.CASE_STORE.get;
  let unavailable=false,deliveries=0;const notices=[];
  env.CASE_STORE.get=()=>({fetch:(url,options)=>unavailable?Promise.resolve(new Response('synthetic unavailable',{status:503})):originalGet().fetch(url,options)});
  const submit=(c,cases)=>submitApprovedPackage(c,cases,env,{sendMail:async()=>{deliveries++;unavailable=true;},sendNotice:async(_env,message)=>{notices.push(message);return true;}});
  const result=await runAutomaticSubmissions(env,new Date('2026-09-05'),submit);
  assert.equal(result.sent,0);assert.equal(result.failed,1);
  unavailable=false;
  const [saved]=await loadStoredCases(env);
  assert.equal(saved.submission,undefined);assert.ok(saved.reviewLockedAt);
  assert.ok(notices.some(n=>n.includes('NICHT erneut senden')));
  await runAutomaticSubmissions(env,new Date('2026-09-06'),submit);
  assert.equal(deliveries,1);
});

test('cancellation or missing payment after package claim prevents SMTP dispatch',async()=>{
  for(const change of [c=>{c.status='canceled';},c=>{c.steps.find(s=>s.id==='fee_sent').done=false;}]) {
    const {env}=await automaticFixture();let deliveries=0;
    const submit=async(c,cases)=>{
      const fresh=await loadStoredCases(env);change(fresh[0]);await saveStoredCases(env,fresh);
      return submitApprovedPackage(c,cases,env,{sendMail:async()=>{deliveries++;},sendNotice:async()=>true});
    };
    assert.equal((await runAutomaticSubmissions(env,new Date('2026-09-05'),submit)).failed,1);
    const [saved]=await loadStoredCases(env);
    assert.equal(deliveries,0);assert.equal(saved.submission,undefined);
    assert.equal(saved.submissionError.phase,'preparation_failed');assert.ok(saved.reviewLockedAt);
  }
});

test('concurrent cancellation during SMTP is retained alongside the accepted package receipt',async()=>{
  const {env}=await automaticFixture();let deliveries=0;
  const submit=(c,cases)=>submitApprovedPackage(c,cases,env,{sendMail:async()=>{
    deliveries++;const fresh=await loadStoredCases(env);fresh[0].status='canceled';fresh[0].notes='Preserve cancellation';await saveStoredCases(env,fresh);
  },sendNotice:async()=>true});
  assert.equal((await runAutomaticSubmissions(env,new Date('2026-09-05'),submit)).sent,1);
  const [saved]=await loadStoredCases(env);
  assert.equal(saved.status,'canceled');assert.equal(saved.notes,'Preserve cancellation');assert.ok(saved.submission);
  await runAutomaticSubmissions(env,new Date('2026-09-06'),submit);assert.equal(deliveries,1);
});

test('failure of an owner notification cannot turn an accepted package into a resend',async()=>{
  const {env}=await automaticFixture();let deliveries=0,notices=0;
  const submit=(c,cases)=>{
    const ownerCase={...c,autoRelease:undefined};
    return submitApprovedPackage(ownerCase,cases,env,{sendMail:async()=>{deliveries++;},sendNotice:async()=>{notices++;throw Error('synthetic notification outage');}});
  };
  assert.equal((await runAutomaticSubmissions(env,new Date('2026-09-05'),submit)).sent,1);
  assert.equal(notices,1);assert.ok((await loadStoredCases(env))[0].submission);
  await runAutomaticSubmissions(env,new Date('2026-09-06'),submit);assert.equal(deliveries,1);
});

test('process interruption after durable release claim does not resend on the next run',async()=>{
  const {env}=await automaticFixture();let deliveries=0;
  await assert.rejects(runAutomaticSubmissions(env,new Date('2026-09-05'),async()=>{throw Error('synthetic process interruption');}),/synthetic process interruption/);
  const [saved]=await loadStoredCases(env);
  assert.ok(saved.reviewLockedAt);assert.equal(saved.submission,undefined);
  const result=await runAutomaticSubmissions(env,new Date('2026-09-06'),async()=>{deliveries++;});
  assert.equal(deliveries,0);assert.equal(result.blocked,1);
});

test('case deleted during accepted delivery is never resurrected or reported durably sent',async()=>{
  const {env}=await automaticFixture();let deliveries=0;const notices=[];
  const submit=(c,cases)=>submitApprovedPackage(c,cases,env,{sendMail:async()=>{
    deliveries++;const fresh=await loadStoredCases(env);
    await saveStoredCases(env,inheritCaseSnapshot(fresh,[]));
  },sendNotice:async(_env,message)=>{notices.push(message);return true;}});
  const result=await runAutomaticSubmissions(env,new Date('2026-09-05'),submit);
  assert.equal(result.sent,0);assert.equal(result.failed,1);
  assert.deepEqual(await loadStoredCases(env),[]);
  assert.ok(notices.some(n=>n.includes('NICHT erneut senden')));
  await runAutomaticSubmissions(env,new Date('2026-09-06'),submit);assert.equal(deliveries,1);
});

test('switching off live delivery while the archive loads stops the package before SMTP',async()=>{
  const {env}=await automaticFixture();let deliveries=0;
  const originalGet=env.CASE_STORE.get;
  const submit=(c,cases)=>{
    env.CASE_STORE.get=()=>({fetch:async(url,options)=>{
      const response=await originalGet().fetch(url,options);
      if(new URL(url).pathname==='/packages') await env.CASES.put('submit-live','no');
      return response;
    }});
    return submitApprovedPackage(c,cases,env,{sendMail:async()=>{deliveries++;},sendNotice:async()=>true});
  };
  assert.equal((await runAutomaticSubmissions(env,new Date('2026-09-05'),submit)).sent,0);
  assert.equal(deliveries,0);
  const [saved]=await loadStoredCases(env);
  assert.ok(saved.reviewLockedAt);assert.equal(saved.submissionError.phase,'preparation_failed');
});

test('a claimed automatic live package cannot fall back to a test email when live mode is revoked',async()=>{
  const {env}=await automaticFixture();let deliveries=0;
  const submit=async(c,cases)=>{
    await env.CASES.put('submit-live','no');
    return submitApprovedPackage(c,cases,env,{sendMail:async()=>{deliveries++;},sendNotice:async()=>true});
  };
  assert.equal((await runAutomaticSubmissions(env,new Date('2026-09-05'),submit)).sent,0);
  assert.equal(deliveries,0);
  const [saved]=await loadStoredCases(env);
  assert.equal(saved.submission,undefined);assert.equal(saved.testSubmission,undefined);assert.ok(saved.reviewLockedAt);
});

test('revoked standing authorization or review blocks a previously claimed package',async()=>{
  for(const revoke of [
    async env=>{env.AUTO_HOA_SUBMIT='no';},
    async env=>{delete env.OWNER_SIGNATURE_AUTHORIZATION;},
    async env=>{env.OWNER_AUTHORIZATION_REFERENCE='replacement-authorization';},
    async env=>{const cases=await loadStoredCases(env);cases[0].aiReview.status='red';await saveStoredCases(env,cases);},
    async env=>{const cases=await loadStoredCases(env);delete cases[0].aiReview;await saveStoredCases(env,cases);},
  ]) {
    const {env}=await automaticFixture();let deliveries=0;
    const submit=async(c,cases)=>{
      await revoke(env);
      return submitApprovedPackage(c,cases,env,{sendMail:async()=>{deliveries++;},sendNotice:async()=>true});
    };
    assert.equal((await runAutomaticSubmissions(env,new Date('2026-09-05'),submit)).sent,0);
    assert.equal(deliveries,0);
    const [saved]=await loadStoredCases(env);
    assert.equal(saved.submission,undefined);assert.ok(saved.reviewLockedAt);
  }
});

test('booking change during accepted SMTP preserves an unresolved delivery without completing the new stay',async()=>{
  const {env}=await automaticFixture();let deliveries=0,originalPackage;
  const submit=(c,cases)=>submitApprovedPackage(c,cases,env,{sendMail:async()=>{
    deliveries++;originalPackage=c.preparedPackage.id;
    const fresh=await loadStoredCases(env),current=fresh[0];
    reconcileBookingUpdate(current,{code:current.reservationCode,guestName:current.guestName,adults:current.adults,checkIn:'2026-11-08',checkOut:'2026-12-08'});
    acknowledgeBookingChange(current);
    await saveStoredCases(env,fresh);
  },sendNotice:async()=>true});
  const result=await runAutomaticSubmissions(env,new Date('2026-09-05'),submit);
  assert.equal(result.sent,0);assert.equal(result.failed,1);
  const [saved]=await loadStoredCases(env);
  assert.equal(saved.checkIn,'2026-11-08');assert.ok(saved.reviewLockedAt);
  assert.equal(saved.submission,undefined);assert.equal(saved.steps.every(s=>!s.done),true);
  assert.equal(saved.submissionError.phase,'delivery_uncertain');
  assert.equal(saved.submissionError.packageId,originalPackage);
  await runAutomaticSubmissions(env,new Date('2026-09-06'),submit);assert.equal(deliveries,1);
});

async function reconciliationFixture() {
  const {env}=await automaticFixture();env.ADMIN_USER='owner';env.ADMIN_PASSWORD='synthetic-owner';
  const now=new Date(),cases=await loadStoredCases(env),c=cases[0];
  c.reviewLockedAt=new Date(+now-3600000).toISOString();
  c.submissionError={phase:'delivery_uncertain',message:'Synthetic timeout'};
  c.steps.push({id:'submitted_hoa',done:false},{id:'board_approved',done:false},{id:'checkin_released',done:false});
  await saveStoredCases(env,cases);
  const input={caseVersion:String(caseSnapshotVersion(cases,c.id)),reservation:c.reservationCode,
    packageId:c.preparedPackage.id,packageHash:c.preparedPackage.packageHash,
    messageId:'<synthetic-prior-send@example.test>',sentAt:new Date(+now-3500000).toISOString(),attested:true,by:'owner'};
  const call=(changes={},headers={})=>onRequest({env,request:new Request('https://portal.example.test/admin/package-delivery-reconcile',{
    method:'POST',headers:{Origin:'https://portal.example.test',Authorization:'Basic '+btoa('owner:synthetic-owner'),...headers},
    body:new URLSearchParams({...input,attested:'yes',id:c.id,...changes}),
  })});
  return {env,now,cases,c,input,call};
}

test('reconciliation rejects normalized impossible calendar days and 24-hour overflow',async()=>{
  for(const sentAt of ['2026-02-30T12:00:00Z','2026-02-29T12:00:00Z','2026-02-28T24:00:00Z','2026-02-28T12:60:00Z']) {
    const {env,cases,c,input}=await reconciliationFixture();
    c.reviewLockedAt='2026-02-01T00:00:00Z';
    const result=await reconcileAcceptedPackage(env,cases,c,{...input,sentAt},new Date('2026-03-10T00:00:00Z'));
    assert.equal(result.status,400);assert.equal(result.ok,false);assert.ok(!c.submission);
  }
});
test('owner can reconcile a verified archived send without sending again or approving HOA/check-in',async()=>{
  const {env,c,call,input}=await reconciliationFixture();
  const {socketAttempts,resetSocketAttempts}=await import('cloudflare:sockets');resetSocketAttempts();
  const view=await onRequest({env,request:new Request('https://portal.example.test/admin/cases',{headers:{Authorization:'Basic '+btoa('owner:synthetic-owner')}})});
  assert.equal(view.status,200);assert.match(await view.text(),/Record verified prior send/);
  assert.equal((await call()).status,303);
  const [saved]=await loadStoredCases(env);
  assert.equal(saved.submission.packageId,c.preparedPackage.id);
  assert.equal(saved.submission.reconciliation.messageId,input.messageId);
  assert.equal(saved.submission.reconciliation.by,'owner');assert.equal(saved.submission.docs.length,4);
  assert.equal(saved.steps.find(s=>s.id==='submitted_hoa').done,true);
  assert.equal(saved.steps.find(s=>s.id==='board_approved').done,false);
  assert.equal(saved.steps.find(s=>s.id==='checkin_released').done,false);
  assert.equal(saved.submissionError,undefined);assert.equal(saved.reviewLockedAt,c.reviewLockedAt);
  assert.equal((await call()).status,409);
  await runAutomaticSubmissions(env,new Date(),()=>assert.fail('reconciled send must not be repeated'));
  assert.equal(socketAttempts(),0);
});

test('package reconciliation requires owner authentication, origin and exact case revision',async()=>{
  const {env,c,call}=await reconciliationFixture();
  assert.equal((await call({}, {Authorization:''})).status,401);
  env.REVIEW_API_TOKEN='synthetic-review-only-token-long-enough';
  assert.equal((await call({}, {Authorization:'Bearer '+env.REVIEW_API_TOKEN})).status,401);
  assert.equal((await call({}, {Origin:'https://evil.example.test'})).status,403);
  assert.equal((await call({caseVersion:'0'})).status,409);
  assert.equal((await call({reservation:'WRONG'})).status,409);
  assert.equal((await call({packageId:'WRONG'})).status,409);
  assert.equal((await call({packageHash:'WRONG'})).status,409);
  const [saved]=await loadStoredCases(env);assert.equal(saved.submission,undefined);assert.equal(saved.reviewLockedAt,c.reviewLockedAt);
});

test('reconciliation rejects missing attestations, invalid message identifiers and implausible send times',async()=>{
  const {env,call,c}=await reconciliationFixture();
  for(const changes of [{attested:'no'},{messageId:'<a@b>\r\nBcc: evil@example.test'},{messageId:''},{sentAt:'tomorrow'},{sentAt:'2000-01-01T00:00:00Z'},{sentAt:'2999-01-01T00:00:00Z'},{sentAt:'2026-09-05T10:00:00'}])assert.equal((await call(changes)).status,400);
  const [saved]=await loadStoredCases(env);assert.equal(saved.submission,undefined);assert.equal(saved.reviewLockedAt,c.reviewLockedAt);
});

test('recent release, changed booking and missing archive cannot be reconciled through the normal form',async()=>{
  for(const change of [
    c=>{c.reviewLockedAt=new Date().toISOString();},
    c=>{c.bookingChange={pending:true};},
    c=>{c.submissionError.packageId=c.preparedPackage.id;},
    c=>{c.wizard.adults[0].firstName='Changed';},
    c=>{delete c.preparedPackage;},
  ]) {
    const {env,cases,c,input,now}=await reconciliationFixture();change(c);await saveStoredCases(env,cases);
    input.caseVersion=String(caseSnapshotVersion(cases,c.id));
    assert.equal((await reconcileAcceptedPackage(env,cases,c,input,now)).ok,false);
    assert.equal((await loadStoredCases(env))[0].submission,undefined);
  }
});

test('a canceled reservation can retain proof of its prior send without reopening the reservation',async()=>{
  const {env,cases,c,input,now}=await reconciliationFixture();c.status='canceled';await saveStoredCases(env,cases);
  input.caseVersion=String(caseSnapshotVersion(cases,c.id));
  assert.equal((await reconcileAcceptedPackage(env,cases,c,input,now)).ok,true);
  const [saved]=await loadStoredCases(env);assert.equal(saved.status,'canceled');assert.ok(saved.submission);
  assert.equal(saved.steps.find(s=>s.id==='board_approved').done,false);
});

test('concurrent owner reconciliation is saved once and stale decisions are not automatically retried',async()=>{
  const {env,c,input,now}=await reconciliationFixture();
  const first=await loadStoredCases(env),second=await loadStoredCases(env);
  const results=await Promise.allSettled([reconcileAcceptedPackage(env,first,first[0],input,now),reconcileAcceptedPackage(env,second,second[0],input,now)]);
  assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.ok).length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'CASE_CONFLICT');
  const [saved]=await loadStoredCases(env);assert.ok(saved.submission);assert.equal(saved.reviewLockedAt,c.reviewLockedAt);
});

test('unavailable or tampered archive prevents reconciliation without changing the durable claim',async()=>{
  for(const tampered of [false,true]) {
    const {env,cases,c,input,now}=await reconciliationFixture(),originalGet=env.CASE_STORE.get;
    env.CASE_STORE.get=()=>({fetch:async(url,options)=>{
      const response=await originalGet().fetch(url,options);
      if(new URL(url).pathname!=='/packages')return response;
      if(!tampered)return new Response('Synthetic archive outage',{status:503});
      const data=await response.json();data.manifest.documents[0].filename='changed.pdf';
      return Response.json(data);
    }});
    await assert.rejects(reconcileAcceptedPackage(env,cases,c,input,now),{code:tampered?'CASE_ARCHIVE_INVALID':'CASE_ARCHIVE_MISSING'});
    const [saved]=await loadStoredCases(env);assert.equal(saved.submission,undefined);assert.equal(saved.reviewLockedAt,c.reviewLockedAt);
  }
});

test('case changes during reconciliation archive validation require a fresh owner decision',async()=>{
  const {env,cases,c,input,now}=await reconciliationFixture(),originalGet=env.CASE_STORE.get;
  env.CASE_STORE.get=()=>({fetch:async(url,options)=>{
    const response=await originalGet().fetch(url,options);
    if(new URL(url).pathname==='/packages') {
      const changed=await loadStoredCases(env);changed[0].notes='Concurrent operator update';await saveStoredCases(env,changed);
    }
    return response;
  }});
  await assert.rejects(reconcileAcceptedPackage(env,cases,c,input,now),{code:'CASE_CONFLICT'});
  const [saved]=await loadStoredCases(env);assert.equal(saved.submission,undefined);
  assert.equal(saved.notes,'Concurrent operator update');assert.equal(saved.reviewLockedAt,c.reviewLockedAt);
});

test('reconciliation has no legacy storage fallback',async()=>{
  const {env,cases,c,input,now,call}=await reconciliationFixture();delete env.CASE_STORE;
  assert.equal((await reconcileAcceptedPackage(env,cases,c,input,now)).status,503);
  assert.equal((await call()).status,503);
});
test('review-only token cannot access owner controls or send a package',async()=>{
  const {env}=await automaticFixture();env.REVIEW_API_TOKEN='synthetic-review-token-at-least-32-chars';env.ADMIN_USER='owner';env.ADMIN_PASSWORD='test-only';
  const call=path=>onRequest({env,request:new Request('https://example.com'+path,{headers:{Authorization:'Bearer '+env.REVIEW_API_TOKEN}})});
  assert.equal((await call('/admin/review/candidates')).status,200);
  assert.equal((await call('/admin/cases')).status,401);
  assert.equal((await call('/admin/submit')).status,401);
});
test('executed document download uses archived bytes after owner signature changes',async()=>{
  const {env}=await automaticFixture();const cases=await loadStoredCases(env),c=cases[0];
  c.token='synthetic-executed-token';c.submission={sentAt:'2026-09-05',packageId:c.preparedPackage.id,packageHash:c.preparedPackage.packageHash,packageManifest:c.preparedPackage};
  await saveStoredCases(env,cases);
  await putEncryptedSecret(env,'owner-signature-png','changed-after-signing');
  env.ASSETS={fetch:()=>assert.fail('an executed document must not be regenerated')};
  const result=await onRequest({env,request:new Request('https://example.com/v/synthetic-executed-token/executed-lease.pdf')});
  assert.equal(result.status,200);assert.equal(await result.text(),'synthetic PDF fixture 4');
});
