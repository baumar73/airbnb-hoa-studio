import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {CaseStore} from '../case-store/src/index.js';
import {loadStoredCases,saveStoredCases,inheritCaseSnapshot} from '../functions/lib/storage.js';
import {projectKnowledgeChange} from '../functions/lib/knowledge-export.js';
register('./loaders/cloudflare-sockets-loader.mjs',import.meta.url);
const {onRequest}=await import('../functions/[[path]].js');
const {socketAttempts,resetSocketAttempts}=await import('cloudflare:sockets');
const NOW=new Date('2026-09-05T12:00:00Z'),ORIGIN='https://portal.example.test';

function fixture(id='a') {
  return {id,guestName:'Synthetic Guest',reservationCode:'HMTEST000001',adults:2,nights:30,
    checkIn:'2026-11-01',checkOut:'2026-12-01',pathType:'full',screeningRoute:'paper',
    token:'NEVER-export-bearer',notes:'NEVER-export-notes',createdAt:'2026-09-01T00:00:00Z',
    feeMailed:'2026-09-04T12:00:00Z',screeningReportedAt:'2026-09-04T12:00:00Z',
    wizard:{adults:[{}, {firstName:'Second',middleName:'Middle',lastName:'Synthetic',email:'second@example.test',
      idNumber:'NEVER-export-id',birthDate:'1980-02-01',sigPng:'NEVER-export-signature',phone:'NEVER-export-phone'}],
      references:[{name:'NEVER-export-reference'}],children:[{name:'NEVER-export-child'}],
      signatureAudit:{ip:'NEVER-export-ip'}},steps:[],
    hoaMailEvents:[{id:'a'.repeat(64),at:'2026-09-04T10:00:00Z',categories:['approval_candidate','payment_receipt'],text:'NEVER-export-mail'}]};
}
function setup() {
  const values=new Map([['snapshot',{revision:0,ids:[],versions:{}}]]),kv=new Map();let queue=Promise.resolve();
  const storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),delete:async k=>values.delete(k),
    transaction(fn){const next=queue.then(()=>fn(storage));queue=next.catch(()=>{});return next;}};
  let actor=new CaseStore({storage},{});
  const env={DATA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),GBRAIN_EXPORT_ENABLED:'yes',GBRAIN_EXPORT_TOKEN:'synthetic-export-token-'.repeat(3),
    REVIEW_API_TOKEN:'synthetic-review-token-'.repeat(3),ADMIN_USER:'test',ADMIN_PASSWORD:'test-password',
    CASES:{get:async k=>kv.get(k)??null,put:async(k,v)=>kv.set(k,v),delete:async k=>kv.delete(k)},
    CASE_STORE:{idFromName:n=>n,get:()=>({fetch:(url,opts)=>actor.fetch(new Request(url,opts))})}};
  return {env,values,kv,restart(){actor=new CaseStore({storage},{});}};
}
async function seed(env,count=1) {
  const cases=await loadStoredCases(env);
  for(let i=0;i<count;i++) {
    const c={...fixture(String.fromCharCode(97+i)),reservationCode:'HMTEST00000'+i};
    c.hoaMailEvents[0].id=i.toString(16).padStart(64,'0');
    cases.push(c);
  }
  await saveStoredCases(env,cases);
}
function call(env,query='',options={}) {
  const headers={Authorization:'Bearer '+env.GBRAIN_EXPORT_TOKEN,...options.headers};
  return onRequest({env,request:new Request(ORIGIN+(options.path||'/api/knowledge/changes')+query,{method:options.method||'GET',headers})});
}

test('knowledge projection includes guest identity and slot indexes, never sensitive originals',()=>{
  const c=fixture(),before=structuredClone(c);
  const result=projectKnowledgeChange({id:c.id,revision:3,value:c},NOW);
  assert.equal(result.operation,'upsert');assert.equal(result.record.booking.guestName,'Synthetic Guest');
  assert.equal(result.record.applicants[1].slot,2);assert.equal(result.record.applicants[1].name,'Second Middle Synthetic');
  assert.equal(result.record.applicants[0].name,'');assert.equal(result.record.applicants[1].email,'second@example.test');
  assert.match(result.record.paperwork.missing.join('|'),/adult 1/);
  assert.doesNotMatch(JSON.stringify(result),/NEVER-export|1980-02-01/);
  assert.deepEqual(c,before);
});
test('guest payment reports and HOA email candidates never become verified payment or approval',()=>{
  const result=projectKnowledgeChange({id:'a',revision:1,value:fixture()},NOW).record;
  assert.ok(result.payment.guestReportedAt);assert.equal(result.payment.receiptRecorded,false);
  assert.equal(result.hoa.approvalRecorded,false);assert.equal(result.hoa.replies[0].verificationRequired,true);
  assert.equal(result.hoa.replies[0].sourcePath,'/admin/hoa-mail/'+'a'.repeat(64));
  assert.equal(result.provenance.contentTrust,'untrusted_data');
});
test('booked case stays active while HOA is pending; adverse email never cancels the reservation',()=>{
  const c=fixture();c.hoaMailEvents[0].categories=['adverse_response'];
  let record=projectKnowledgeChange({id:'a',revision:1,value:c},NOW).record;
  assert.equal(record.booking.portalStatus,'active');assert.equal(record.hoa.status,'pending');
  assert.equal(record.hoa.adverseResponseNeedsReview,true);assert.equal(record.cancellation.recorded,false);
  c.steps=[{id:'board_approved',done:true}];
  record=projectKnowledgeChange({id:'a',revision:2,value:c},NOW).record;
  assert.equal(record.booking.portalStatus,'active');assert.equal(record.hoa.status,'approval_recorded');
  c.status='canceled';c.cancellation={source:'airbnb-email',detectedAt:'2026-09-05T12:00:00Z'};
  record=projectKnowledgeChange({id:'a',revision:3,value:c},NOW).record;
  assert.equal(record.booking.portalStatus,'canceled');assert.equal(record.cancellation.recorded,true);
  assert.equal(record.cancellation.source,'airbnb-email');
});
test('cancellation is explicit and projection never derives workflow status from wall clock',()=>{
  const c=fixture();c.status='canceled';
  const a=projectKnowledgeChange({id:'a',revision:2,value:c},NOW);
  const b=projectKnowledgeChange({id:'a',revision:2,value:c},new Date('2026-12-20'));
  assert.equal(a.record.workflowState,'canceled');assert.deepEqual(a,b);
});
test('removed, expired, held and invalid-date cases produce content-free removal instructions',()=>{
  const records=[null,{...fixture(),checkOut:'2020-01-01'}, {...fixture(),legalHold:{reason:'NEVER-export-hold'}}, {...fixture(),checkOut:'invalid'}];
  for(const value of records){const result=projectKnowledgeChange({id:'a',revision:3,value},NOW);assert.equal(result.operation,'delete');assert.equal(result.record,undefined);assert.doesNotMatch(JSON.stringify(result),/Synthetic|NEVER-export/);}
});
test('export is opt-in, bearer-only and isolated from guest, legacy and review credentials',async()=>{
  const {env,values,kv}=setup();await seed(env);kv.set('readonly-token','synthetic-legacy-token');
  env.GBRAIN_EXPORT_ENABLED='no';assert.equal((await call(env)).status,404);env.GBRAIN_EXPORT_ENABLED='yes';
  for(const headers of [{Authorization:''},{Authorization:'Bearer '+env.REVIEW_API_TOKEN},{Authorization:'Basic '+btoa('test:test-password')},{Authorization:'', 'X-RO-Token':'synthetic-legacy-token'}])assert.equal((await call(env,'',{headers})).status,401);
  assert.equal(values.has('knowledge-epoch'),false); // no storage access before authentication
  env.GBRAIN_EXPORT_TOKEN='short';assert.equal((await call(env)).status,401);
});
test('read-only export token grants no owner/reviewer mutations or legacy reads',async()=>{
  const {env}=setup();await seed(env);
  for(const path of ['/admin','/admin/review/candidates','/api/ro/cases'])assert.equal((await call(env,'',{path})).status,401);
  for(const method of ['POST','PATCH','DELETE','HEAD']){
    const res=await call(env,'',{method,headers:{Origin:ORIGIN}});assert.equal(res.status,405);assert.match(res.headers.get('cache-control'),/no-store/);
  }
});
test('feed pages do not skip cases in the same transaction and survive restart and lost acknowledgement',async()=>{
  const ctx=setup();await seed(ctx.env,3);
  let cursor='',ids=[];let first;
  for(let i=0;i<3;i++){
    const res=await call(ctx.env,'?limit=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(res.status,200);
    const page=await res.json();if(!first)first=page;
    ids.push(page.changes[0].id);cursor=page.nextCursor;ctx.restart();
  }
  assert.deepEqual(ids,['a','b','c']);
  assert.deepEqual((await (await call(ctx.env,'?limit=1')).json()).changes,first.changes);
  assert.equal((await (await call(ctx.env,'?cursor='+encodeURIComponent(cursor))).json()).changes.length,0);
});
test('updates and durable delete markers remain available to an offline consumer',async()=>{
  const {env}=setup();await seed(env,2);
  const first=await (await call(env)).json();
  const cases=await loadStoredCases(env);cases[1].guestName='Updated Synthetic';
  await saveStoredCases(env,inheritCaseSnapshot(cases,cases.filter(c=>c.id!=='a')));
  const page=await (await call(env,'?cursor='+encodeURIComponent(first.nextCursor))).json();
  assert.equal(page.changes.length,2);assert.deepEqual(page.changes.map(c=>c.operation),['delete','upsert']);
  assert.equal(page.changes[1].record.booking.guestName,'Updated Synthetic');
  assert.ok(page.changes.every(c=>c.revision>first.throughRevision));
});
test('a concurrent update during pagination is delivered at its newer version',async()=>{
  const {env}=setup();await seed(env,3);
  const first=await (await call(env,'?limit=1')).json();
  const cases=await loadStoredCases(env);cases[1].status='canceled';await saveStoredCases(env,cases);
  const second=await (await call(env,'?cursor='+encodeURIComponent(first.nextCursor))).json();
  assert.deepEqual(second.changes.map(c=>c.id),['c','b']);
  assert.equal(second.changes[1].record.workflowState,'canceled');
});
test('cursor mismatch and malformed cursor fail closed, including rollback behind checkpoint',async()=>{
  const {env,values}=setup();await seed(env);
  const first=await (await call(env)).json();
  for(const q of ['?cursor=garbage','?limit=0','?limit=101','?limit=1.5','?limit=NaN'])assert.equal((await call(env,q)).status,400);
  values.set('knowledge-epoch',crypto.randomUUID());
  assert.equal((await call(env,'?cursor='+encodeURIComponent(first.nextCursor))).status,409);
  values.set('knowledge-epoch',first.epoch);const snap=values.get('snapshot');snap.revision=0;
  assert.equal((await call(env,'?cursor='+encodeURIComponent(first.nextCursor))).status,409);
});
test('no legacy fallback, failure redaction, no-store on all export responses',async()=>{
  const {env}=setup();await seed(env);
  let res=await call(env);assert.equal(res.status,200);assert.match(res.headers.get('cache-control'),/no-store/);assert.equal(res.headers.get('x-robots-tag'),'noindex');
  env.CASE_STORE.get=()=>({fetch:async()=>{throw Error('Bearer NEVER-export-transport');}});
  res=await call(env);assert.equal(res.status,503);assert.doesNotMatch(await res.text(),/NEVER-export/);
  delete env.CASE_STORE;assert.equal((await call(env)).status,503);
});
test('one undecryptable record fails the whole page without leaking data or advancing the checkpoint',async()=>{
  const {env,values}=setup();await seed(env,2);
  values.get('case:b').wizardCiphertext='corrupted';
  const res=await call(env);assert.equal(res.status,503);
  const body=await res.json();assert.equal(body.nextCursor,undefined);assert.equal(body.changes,undefined);
  assert.doesNotMatch(JSON.stringify(body),/Synthetic|cipher|corrupted/);
});
test('expiry deadline is explicit and online applicants are not told to complete duplicate paper forms',()=>{
  const c=fixture();c.screeningRoute='online';
  const result=projectKnowledgeChange({id:'a',revision:1,value:c},NOW).record;
  assert.equal(result.retention.expiresAt,'2027-03-01T23:59:59.000Z');
  assert.equal(result.paperwork.complete,null);assert.deepEqual(result.paperwork.missing,[]);
  assert.equal(result.payment.requirement,'handled_online');
});
test('metadata-only HOA references reject arbitrary links, categories and extra fields',()=>{
  const c=fixture();c.hoaMailEvents.push({id:'https://untrusted.example/token',categories:['approval_candidate']});
  c.hoaMailEvents[0].categories.push('NEVER-export-instruction');
  c.hoaMailEvents[0].url='https://untrusted.example/token';
  const record=projectKnowledgeChange({id:'a',revision:1,value:c},NOW).record;
  assert.equal(record.hoa.replies.length,1);assert.equal(record.hoa.repliesTruncated,true);
  assert.doesNotMatch(JSON.stringify(record),/untrusted\.example|NEVER-export/);
});
test('export and guest draft save cause no gbrain, HOA or email outbound delivery',async()=>{
  resetSocketAttempts();const {env}=setup();await seed(env);
  assert.equal((await call(env)).status,200);
  const cases=await loadStoredCases(env);cases[0].hoaOccupancyConfirmedAt='2026-09-01';await saveStoredCases(env,cases);
  const page=await onRequest({env,request:new Request(ORIGIN+'/w/NEVER-export-bearer')});
  const version=(await page.text()).match(/name="draftVersion" value="([0-9]+)"/)[1];
  const response=await onRequest({env,request:new Request(ORIGIN+'/w/NEVER-export-bearer',{method:'POST',headers:{Origin:ORIGIN},body:new URLSearchParams({draftVersion:version,saveMode:'draft',a0_firstName:'Saved Synthetic'})})});
  assert.equal(response.status,303);assert.equal(socketAttempts(),0);
  const saved=(await loadStoredCases(env))[0];assert.equal(saved.submission,undefined);assert.equal(saved.wizard.adults[0].firstName,'Saved Synthetic');
});
