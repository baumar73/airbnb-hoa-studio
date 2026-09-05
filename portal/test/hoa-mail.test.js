import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./loaders/cloudflare-sockets-loader.mjs',import.meta.url);
const {analyseHoaReply,archiveHoaReply,readHoaReply,configuredHoaSenders}=await import('../functions/lib/hoa-mail.js');
const {pollMail}=await import('../functions/lib/mailpoll.js');
const {decodeMessage,Imap}=await import('../functions/lib/imap.js');
const {onRequest}=await import('../functions/[[path]].js');
const allow=['manager@hoa.example.test'];
const cases=[{id:'one',reservationCode:'HMDEMO0002',guestName:'Mary Jane Smith',checkIn:'2026-10-01',checkOut:'2026-11-01',steps:[{id:'fee_sent',done:false},{id:'board_approved',done:false}]},{id:'two',reservationCode:'HMDEMO0003',guestName:'Mary Jane Smith',checkIn:'2027-10-01',checkOut:'2027-11-01',steps:[]}];
const mail=(changes={})=>({from:'HOA Manager <manager@hoa.example.test>',subject:'Re: Lease application HMDEMO0002',text:'We received the application package.',date:'2026-09-05T10:00:00Z',messageId:'<synthetic-1@hoa.example.test>',...changes});
test('missing sender configuration is empty, never a wildcard or an empty mailbox query',()=>{
  assert.deepEqual(configuredHoaSenders({}),[]);
  assert.deepEqual(configuredHoaSenders({HOA_MAIL_SENDERS:' , manager@hoa.example.test, invalid ,'}),allow);
});
test('email monitoring distinguishes receipt, payment, missing items and approval candidates without granting any step',()=>{
  const before=structuredClone(cases);
  for(const [text,category] of [['We received the application package.','package_receipt'],['We received your $100 payment.','payment_receipt'],['The board has approved this lease.','approval_candidate'],['Please provide the missing signature.','missing_items']]) {
    const result=analyseHoaReply(mail({text}),cases,allow);
    assert.equal(result.caseId,'one');assert.equal(result.matchReason,'reservation_code');
    assert.ok(result.categories.includes(category));assert.equal(result.reviewRequired,true);
  }
  assert.deepEqual(cases,before);
});
test('old quoted approval and subject-only approval do not become new approvals',()=>{
  for(const text of ['Payment has not been received. Approval is still pending.','Please provide the missing signature.\nOn Monday, Owner wrote:\nThe board has approved this lease.','> The board has approved this lease.\nWe are still reviewing it.']) {
    const result=analyseHoaReply(mail({subject:'Re: Approval HMDEMO0002',text}),cases,allow);
    assert.equal(result.categories.includes('approval_candidate'),false);
    assert.equal(result.categories.includes('payment_receipt'),false);
  }
});
test('ambiguous or unknown codes and unverified senders never fall back to name guessing',()=>{
  for(const changes of [{subject:'Re: HMDEMO0002 and HMDEMO0003'},{subject:'Re: HMUNKNOWN99',text:'Mary Jane Smith 2026-10-01 2026-11-01'},{from:'manager@hoa.example.test.attacker.test'},{from:'"manager@hoa.example.test" <stranger@example.test>'}]) {
    assert.equal(analyseHoaReply(mail(changes),cases,allow).caseId,null);
  }
  assert.equal(analyseHoaReply(mail(),cases,[]).matchReason,'sender_not_configured');
  assert.equal(analyseHoaReply(mail({subject:'Approval for Smith',text:'Approved'}),cases,allow).caseId,null);
});
test('complete name and exact stay dates distinguish repeat guests; canceled stays retain correspondence without reopening',()=>{
  const result=analyseHoaReply(mail({subject:'Mary Jane Smith',text:'Your lease for 2027-10-01 to 2027-11-01 is approved.'}),cases,allow);
  assert.equal(result.caseId,'two');assert.equal(result.matchReason,'name_and_stay');
  const canceled=structuredClone(cases);canceled[0].status='canceled';
  assert.equal(analyseHoaReply(mail(),canceled,allow).caseId,'one');assert.equal(canceled[0].status,'canceled');
});
function environment(){
  const values=new Map([['cases',JSON.stringify(cases)]]),options=new Map();
  return {values,options,env:{GMAIL_USER:'synthetic@example.test',GMAIL_APP_PASSWORD:'synthetic-only',HOA_MAIL_SENDERS:allow.join(','),DATA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),CASES:{get:async k=>values.get(k)||null,put:async(k,v,o)=>{values.set(k,v);options.set(k,o);}}}};
}
test('source evidence is encrypted, content-addressed and retained through the matched stay plus 90 days',async()=>{
  const {env,values,options}=environment(),msg=mail({text:'Private identity detail must not appear in plaintext'});
  const analysis=analyseHoaReply(msg,cases,allow);
  const first=await archiveHoaReply(env,msg,analysis,cases,new Date('2026-09-05'));
  const second=await archiveHoaReply(env,msg,analysis,cases,new Date('2026-09-06'));
  assert.equal(first.id,second.id);assert.equal(values.size,2);
  assert.doesNotMatch(values.get('hoa-mail:'+first.id),/Private identity|Mary Jane|manager@/);
  assert.equal((await readHoaReply(env,first.id)).text,msg.text);
  assert.ok(options.get('hoa-mail:'+first.id).expirationTtl>90*86400);
});
test('expired or missing retention blocks source access even if KV retains the bytes',async()=>{
  const {env,values}=environment(),msg=mail();
  const source=await archiveHoaReply(env,msg,analyseHoaReply(msg,cases,allow),cases,new Date('2026-09-05'));
  const key='hoa-mail:'+source.id,original=JSON.parse(values.get(key)),deadline=new Date(original.expiresAt);
  assert.equal((await readHoaReply(env,source.id,new Date(+deadline-1))).text,msg.text);
  assert.equal(await readHoaReply(env,source.id,deadline),null);
  for(const expiresAt of [undefined,'bad',123]) {
    values.set(key,JSON.stringify({...original,expiresAt}));assert.equal(await readHoaReply(env,source.id),null);
  }
  values.set(key,JSON.stringify({...original,expiresAt:null}));
  assert.equal((await readHoaReply(env,source.id,new Date('2030-01-01'))).text,msg.text);
});
test('a later legal hold removes archive expiry on the next scan, and an extended stay extends retention',async()=>{
  const {env,options}=environment(),msg=mail(),analysis=analyseHoaReply(msg,cases,allow),updated=structuredClone(cases);
  const source=await archiveHoaReply(env,msg,analysis,updated,new Date('2026-09-05'));
  const original=options.get('hoa-mail:'+source.id).expirationTtl;
  updated[0].checkOut='2027-11-01';await archiveHoaReply(env,msg,analysis,updated,new Date('2026-09-06'));
  assert.ok(options.get('hoa-mail:'+source.id).expirationTtl>original);
  updated[0].legalHold=true;await archiveHoaReply(env,msg,analysis,updated,new Date('2026-09-07'));
  assert.equal(options.get('hoa-mail:'+source.id),undefined);
});
test('source viewer is owner-only, does not run email HTML and retains private no-store headers',async()=>{
  const {env}=environment();env.ADMIN_USER='owner';env.ADMIN_PASSWORD='test-only';
  const source=await archiveHoaReply(env,mail({text:'<script>unsafe()</script> Private source'}),analyseHoaReply(mail(),cases,allow),cases);
  const request=auth=>onRequest({env,request:new Request('https://portal.example.test/admin/hoa-mail/'+source.id,{headers:auth?{Authorization:auth}:{}})});
  assert.equal((await request()).status,401);
  assert.equal((await request('Bearer '+'x'.repeat(40))).status,401);
  const response=await request('Basic '+btoa('owner:test-only'));
  assert.equal(response.status,200);assert.match(response.headers.get('Cache-Control'),/no-store/);
  const page=await response.text();assert.match(page,/Private source/);assert.doesNotMatch(page,/<script>unsafe/);
  assert.match(page,/&lt;script&gt;/);
});
const rawMessage=(subject,text,id='synthetic-1')=>`* 1 FETCH (BODY[HEADER.FIELDS (SUBJECT FROM DATE MESSAGE-ID)] {100}\r\nSubject: ${subject}\r\nFrom: HOA Manager <manager@hoa.example.test>\r\nDate: Sat, 05 Sep 2026 10:00:00 +0000\r\nMessage-ID: <${id}@hoa.example.test>\r\n\r\n BODY[1] {${text.length}}\r\n${text}\r\n)\r\nA4 OK done\r\n`;
test('poller links every HOA reply once, sends no guest email and never confirms fee or approval',async()=>{
  const {env,values}=environment();let notifications=0;
  const imap={open:async()=>{},close:async()=>{},searchRaw:async q=>q.includes('airbnb.com')?[]:[4],fetchMessage:async()=>rawMessage('Re: HMDEMO0002','We received your $100 payment.')};
  const deps={imap,notify:async()=>{notifications++;return true;}};
  const first=await pollMail(env,deps);assert.equal(first.hoaLinked,1);
  const saved=JSON.parse(values.get('cases'));
  assert.equal(saved[0].hoaMailEvents.length,1);assert.equal(saved[0].steps.some(s=>s.done),false);
  assert.equal(saved[0].approvalCandidate,undefined);
  values.set('hoa-news','[]'); // Old cards may fall outside the bounded dashboard.
  assert.equal((await pollMail(env,deps)).hoaLinked,0);assert.equal(notifications,1);
  assert.doesNotMatch(values.get('hoa-news'),/\$100 payment|manager@/);
});
test('repeated Airbnb cancellation mail closes a case once and never reopens or re-notifies it',async()=>{
  const {env,values}=environment();let notifications=0;
  const imap={open:async()=>{},close:async()=>{},searchRaw:async query=>{
    if(query.includes('canceled OR cancelled OR storniert')) return [77];
    return [];
  },fetchMessage:async()=>rawMessage('Reservation canceled HMDEMO0002','Your Airbnb reservation was canceled.','cancel-77')};
  const deps={imap,notify:async()=>{notifications++;return true;}};
  assert.equal((await pollMail(env,deps)).cancellations,1);
  assert.equal(JSON.parse(values.get('cases'))[0].status,'canceled');assert.equal(notifications,1);
  assert.equal((await pollMail(env,deps)).cancellations,0);
  assert.equal(JSON.parse(values.get('cases'))[0].status,'canceled');assert.equal(notifications,1);
});
test('a notification outage does not discard a durable Airbnb cancellation',async()=>{
  const {env,values}=environment();
  const imap={open:async()=>{},close:async()=>{},searchRaw:async query=>query.includes('canceled OR cancelled OR storniert')?[78]:[],fetchMessage:async()=>rawMessage('Reservation canceled HMDEMO0002','Your Airbnb reservation was canceled.','cancel-78')};
  await pollMail(env,{imap,notify:async()=>{throw Error('notification transport unavailable');}});
  assert.equal(JSON.parse(values.get('cases'))[0].status,'canceled');
  assert.equal(JSON.parse(values.get('mail-seen')).uids.includes('c78'),true);
});
test('a failed case save cannot acknowledge an email as processed before retry',async()=>{
  const {env,values}=environment();let fail=true,notifications=0;
  const put=env.CASES.put;
  env.CASES.put=async(k,...args)=>{if(k==='cases'&&fail) throw new Error('simulated storage failure');return put(k,...args);};
  const deps={imap:{open:async()=>{},close:async()=>{},searchRaw:async q=>q.includes('airbnb.com')?[]:[1],fetchMessage:async()=>rawMessage('HMDEMO0002','Please provide the missing signature.')},notify:async()=>{notifications++;return true;}};
  await assert.rejects(pollMail(env,deps),/simulated storage failure/);
  assert.equal(notifications,0);assert.equal(values.has('hoa-news'),false);
  fail=false;assert.equal((await pollMail(env,deps)).hoaLinked,1);assert.equal(notifications,1);
});
test('multiple replies with the same subject and day are all retained',async()=>{
  const {env,values}=environment();
  const deps={imap:{open:async()=>{},close:async()=>{},searchRaw:async q=>q.includes('airbnb.com')?[]:[1,2],fetchMessage:async uid=>rawMessage('HMDEMO0002',uid===1?'We received your payment.':'The board has approved this lease.',String(uid))},notify:async()=>true};
  assert.equal((await pollMail(env,deps)).hoaLinked,2);
  assert.equal(JSON.parse(values.get('cases'))[0].hoaMailEvents.length,2);
});
test('decoder preserves message identifiers but does not take headers from the body',()=>{
  const decoded=decodeMessage(rawMessage('Re: HMDEMO0002','From: attacker@example.test\nMessage-ID: <fake@example.test>'));
  assert.equal(decoded.messageId,'<synthetic-1@hoa.example.test>');
  assert.equal(decoded.from,'HOA Manager <manager@hoa.example.test>');
});
test('a configured HOA archive folder is selected only after Airbnb message processing',async()=>{
  const {env}=environment();env.HOA_MAILBOX='Verified HOA Folder';const calls=[];
  const imap={open:async()=>{},close:async()=>{},selectMailbox:async name=>calls.push('select:'+name),searchRaw:async query=>{calls.push(query);return [];}};
  await pollMail(env,{imap,notify:async()=>true});
  assert.ok(calls[0].includes('airbnb.com'));assert.equal(calls[2],'select:Verified HOA Folder');assert.ok(calls[3].includes('manager@hoa.example.test'));
});
test('IMAP failures redact login commands and transport deadlines close a stalled socket',async()=>{
  const imap=new Imap({timeoutMs:10});imap.enc=new TextEncoder();imap.w={write:async()=>{}};
  imap.readUntil=async()=> 'A1 NO credentials secret-text\r\n';
  await assert.rejects(imap.cmd('LOGIN synthetic@example.test secret-text'),error=>!error.message.includes('secret-text')&&!error.message.includes('synthetic@'));
  let closed=false;imap.sock={close:async()=>{closed=true;}};imap.readUntil=async()=>new Promise(()=>{});
  await assert.rejects(imap.cmd('NOOP'),/timeout/);assert.equal(closed,true);
});

// Synthetic evidence only: no actual inbox, payment or HOA decision is used.
const evidenceModule=await import('../functions/lib/hoa-mail.js');
const {planGuestJourney,guestReminderMessage}=await import('../functions/lib/journey.js');
const {validateLiveSubmissionPrerequisites}=await import('../functions/lib/workflow.js');
const evidenceNow=new Date('2026-09-05T12:00:00Z');
const sourceId='a'.repeat(64),laterId='b'.repeat(64);
function evidenceCase() {
  return {...structuredClone(cases[0]),token:'evidencetoken123',pathType:'full',screeningRoute:'online',adults:1,nights:31,
    createdAt:'2026-09-01T00:00:00Z',screeningReportedAt:'2026-09-04T00:00:00Z',
    hoaMailEvents:[{id:sourceId,reviewRequired:true},{id:laterId,reviewRequired:true}],
    steps:[{id:'screening_complete',done:true},{id:'fee_sent',done:false},{id:'board_approved',done:false}]};
}
const review=(c,id,input)=>evidenceModule.reviewHoaEvidence(c,id,{attested:true,by:'test-owner',kind:'confirmed',...input},evidenceNow);
test('verified missing items reopen a submitted or externally completed application without losing the submission',()=>{
  const c=evidenceCase();c.submission={sentAt:'2026-09-03',packageId:'keep-original'};c.reviewLockedAt='2026-09-03T00:00:00Z';
  assert.equal(typeof evidenceModule.reviewHoaEvidence,'function');
  assert.equal(review(c,sourceId,{requestedItems:['signatures']}).ok,true);
  const p=planGuestJourney(c,evidenceNow);
  assert.equal(p.state,'waiting_for_guest');assert.equal(p.guestTasks.length,1);
  assert.match(p.guestTasks[0].text,/signature/i);assert.match(p.guestTasks[0].text,/Tenant Evaluation/);
  assert.ok(p.nextReminderAt);assert.equal(c.submission.packageId,'keep-original');
  assert.equal(c.steps.find(s=>s.id==='screening_complete').done,false);
  assert.equal(c.steps.find(s=>s.id==='board_approved').done,false);
  assert.equal(validateLiveSubmissionPrerequisites(c).ok,false);
});
test('payment, receipt, documents and completion are independent evidence, never inferred from each other',()=>{
  const c=evidenceCase();c.steps.forEach(s=>s.done=false);
  assert.equal(review(c,sourceId,{confirmations:['payment_received']}).ok,true);
  assert.equal(c.steps.find(s=>s.id==='fee_sent').done,true);
  assert.equal(c.steps.find(s=>s.id==='screening_complete').done,false);
  assert.equal(c.steps.find(s=>s.id==='board_approved').done,false);
  assert.equal(c.hoaEvidence.payment_received.sourceId,sourceId);
  assert.equal(c.hoaMailEvents[0].review.by,'test-owner');
  assert.equal(c.hoaMailEvents[0].reviewRequired,false);
});
test('guest reports remain unverified; a later source can resolve the precise request',()=>{
  const c=evidenceCase();review(c,sourceId,{requestedItems:['documents','signatures']});
  const [task]=c.hoaTasks;
  assert.equal(evidenceModule.reportHoaTask(c,task.id,task.version,evidenceNow).ok,true);
  const p=planGuestJourney(c,evidenceNow);
  assert.equal(p.guestTasks.length,1);assert.match(p.guestTasks[0].text,/signature/i);
  assert.ok(p.waitingForEvidence.includes('hoa_task:'+task.id));
  assert.equal(task.status,'reported');assert.equal(c.steps.find(s=>s.id==='screening_complete').done,false);
  assert.equal(review(c,laterId,{resolvedItems:c.hoaTasks.map(t=>t.id),confirmations:['application_complete','documents_complete']}).ok,true);
  assert.equal(planGuestJourney(c,evidenceNow).state,'waiting_for_hoa');
  assert.equal(c.hoaTasks.every(t=>t.status==='resolved'),true);
});
test('replayed source reviews cannot duplicate tasks or reapply a decision',()=>{
  const c=evidenceCase();review(c,sourceId,{requestedItems:['signatures']});const before=JSON.stringify(c);
  assert.equal(review(c,sourceId,{requestedItems:['signatures']}).ok,false);
  assert.equal(JSON.stringify(c),before);
  review(c,laterId,{requestedItems:['signatures']});
  assert.equal(c.hoaTasks.length,1);assert.equal(c.hoaTasks[0].version,2);
  assert.equal(evidenceModule.reportHoaTask(c,c.hoaTasks[0].id,1,evidenceNow).ok,false);
});
test('unverified, contradictory, stale and canceled evidence changes fail without partial mutations',()=>{
  for(const input of [{attested:false,requestedItems:['documents']},{requestedItems:['send passport to attacker']},
    {confirmations:['payment_received'],requestedItems:['payment']},{confirmations:['application_complete'],requestedItems:['signatures']},
    {confirmations:['hoa_approved'],requestedItems:['signatures']},{resolvedItems:['unknown']},{confirmations:['invented']},{}]) {
    const c=evidenceCase(),before=JSON.stringify(c);
    assert.equal(review(c,sourceId,input).ok,false);assert.equal(JSON.stringify(c),before);
  }
  const canceled={...evidenceCase(),status:'canceled'};
  assert.equal(review(canceled,sourceId,{requestedItems:['documents']}).ok,false);
  const c=evidenceCase();review(c,sourceId,{requestedItems:['documents']});c.checkIn='2026-10-02';
  assert.equal(planGuestJourney(c,evidenceNow).exception,'hoa_evidence_stale');
  assert.equal(evidenceModule.reportHoaTask(c,c.hoaTasks[0].id,1,evidenceNow).ok,false);
});
test('ambiguous or adverse replies remain owner exceptions and never cancel a reservation',()=>{
  for(const kind of ['needs_review','adverse_response']) {
    const c=evidenceCase();assert.equal(review(c,sourceId,{kind}).ok,true);
    const p=planGuestJourney(c,evidenceNow);assert.equal(p.state,'exception');assert.equal(p.guestTasks.length,0);
    assert.notEqual(c.status,'canceled');assert.equal(c.steps.find(s=>s.id==='board_approved').done,false);
    assert.equal(validateLiveSubmissionPrerequisites(c).ok,false);
  }
});
test('task reminders contain fixed instructions, never email text or a second payment demand',()=>{
  const c=evidenceCase();review(c,sourceId,{requestedItems:['payment','identity_documents']});
  const authorized=planGuestJourney(c,evidenceNow),blocked=planGuestJourney(c,evidenceNow,{feeRequestAuthorized:false});
  assert.equal(blocked.guestTasks.some(t=>t.includesPayment),false);
  assert.ok(blocked.waitingForEvidence.includes('authorized_payment_instructions'));
  const message=guestReminderMessage(authorized,'https://example.com');
  assert.match(message.text,/Do not pay twice/);assert.match(message.text,/Do not email/);
  assert.doesNotMatch(message.text,/HMDEMO|Mary Jane|manager@/);
});

const {CaseStore}=await import('../case-store/src/index.js');
const {loadStoredCases,saveStoredCases}=await import('../functions/lib/storage.js');
const {socketAttempts,resetSocketAttempts}=await import('cloudflare:sockets');
async function evidenceEnvironment() {
  const {env,values:legacy}=environment(),atomic=new Map([['snapshot',{revision:0,ids:[],versions:{}}]]);
  let queue=Promise.resolve();
  const storage={get:async k=>structuredClone(atomic.get(k)),put:async(k,v)=>atomic.set(k,structuredClone(v)),delete:async k=>atomic.delete(k),
    transaction(fn){const task=queue.then(()=>fn(storage));queue=task.catch(()=>{});return task;}};
  const actor=new CaseStore({storage},{});
  Object.assign(env,{ADMIN_USER:'owner',ADMIN_PASSWORD:'test-only',CASE_STORE:{idFromName:n=>n,get:()=>({fetch:(url,options)=>actor.fetch(new Request(url,options))})}});
  const c=evidenceCase();c.hoaMailEvents=[];c.steps.forEach(s=>s.done=false);
  const source=await archiveHoaReply(env,mail(),analyseHoaReply(mail(),[c],allow),[c]);
  c.hoaMailEvents.push({...source,reviewRequired:true});
  const loaded=await loadStoredCases(env);loaded.push(c);await saveStoredCases(env,loaded);
  const call=(path,form,auth='Basic '+btoa('owner:test-only'),origin='https://portal.example.test')=>onRequest({env,request:new Request('https://portal.example.test'+path,{method:form?'POST':'GET',headers:{Authorization:auth,Origin:origin},body:form?new URLSearchParams(form):undefined})});
  const sourcePath='/admin/hoa-mail/'+source.id;
  const version=async()=>((await (await call(sourcePath)).text()).match(/name="caseVersion" value="(\d+)"/)||[])[1];
  const form=async extra=>({id:c.id,reservation:c.reservationCode,caseVersion:await version(),attested:'yes',kind:'confirmed',...extra});
  return {env,legacy,call,source,sourcePath,version,form,c};
}
test('owner source review creates a guest task end to end without outbound delivery or approval',async()=>{
  resetSocketAttempts();const {env,call,sourcePath,form}=await evidenceEnvironment();
  assert.equal((await call(sourcePath+'/review',await form({requestedItems:'signatures'}))).status,303);
  const [saved]=await loadStoredCases(env);assert.equal(saved.hoaTasks.length,1);
  const response=await call('/v/'+saved.token,null,'');assert.equal(response.status,200);
  const html=await response.text();assert.match(html,/Additional items requested/);assert.match(html,/missing signatures/i);
  assert.doesNotMatch(html,/nothing to do on your end/);assert.doesNotMatch(html,/We received the application package/);
  const task=saved.hoaTasks[0];
  const report=await call('/v/'+saved.token+'/hoa-task-reported',{taskId:task.id,taskVersion:String(task.version),confirmed:'yes'},'');
  assert.equal(report.status,303);assert.equal((await loadStoredCases(env))[0].hoaTasks[0].status,'reported');
  assert.equal((await loadStoredCases(env))[0].submission,undefined);assert.equal(socketAttempts(),0);
});
test('source review requires owner auth, same origin, original verification, current reservation and atomic storage',async()=>{
  const {env,call,sourcePath,form}=await evidenceEnvironment(),input=await form({requestedItems:'documents'});
  assert.equal((await call(sourcePath+'/review',input,'')).status,401);
  assert.equal((await call(sourcePath+'/review',input,'Bearer '+'x'.repeat(40))).status,401);
  assert.equal((await call(sourcePath+'/review',input,undefined,'https://attacker.test')).status,403);
  assert.equal((await call(sourcePath+'/review',{...input,attested:''})).status,400);
  assert.equal((await call(sourcePath+'/review',{...input,reservation:'HMOTHER0002'})).status,409);
  delete env.CASE_STORE;
  assert.equal((await call(sourcePath+'/review',input)).status,503);
});
test('stale or repeated owner forms cannot overwrite subsequent evidence or booking changes',async()=>{
  const {env,call,sourcePath,form}=await evidenceEnvironment(),input=await form({requestedItems:'documents'});
  const changed=await loadStoredCases(env);changed[0].notes='keep';await saveStoredCases(env,changed);
  assert.equal((await call(sourcePath+'/review',input)).status,409);
  const current=await form({requestedItems:'documents'});
  assert.equal((await call(sourcePath+'/review',current)).status,303);
  assert.equal((await call(sourcePath+'/review',current)).status,409);
  const [saved]=await loadStoredCases(env);assert.equal(saved.notes,'keep');assert.equal(saved.hoaTasks.length,1);
});
test('guest reports reject wrong task, stale version, cross-origin writes and canceled reservations',async()=>{
  const {env,call,sourcePath,form,c}=await evidenceEnvironment();
  await call(sourcePath+'/review',await form({requestedItems:'documents'}));
  const [saved]=await loadStoredCases(env),task=saved.hoaTasks[0],path='/v/'+c.token+'/hoa-task-reported';
  const input={taskId:task.id,taskVersion:'1',confirmed:'yes'};
  assert.equal((await call(path,{...input,taskId:'wrong'},'')).status,409);
  assert.equal((await call(path,{...input,taskVersion:'0'},'')).status,409);
  assert.equal((await call(path,input,'','https://attacker.test')).status,403);
  const changed=await loadStoredCases(env);changed[0].status='canceled';await saveStoredCases(env,changed);
  assert.equal((await call(path,input,'')).status,410);
});
test('generic toggles cannot bypass source-backed payment, screening or approval verification',async()=>{
  const {call,c}=await evidenceEnvironment();
  for(const step of ['fee_sent','screening_complete','board_approved']) {
    assert.equal((await call('/admin/toggle',{id:c.id,step})).status,409);
  }
});
test('unreviewed adverse or missing-item mail blocks follow-up and delivery without changing official steps',()=>{
  const c=evidenceCase();c.hoaMailEvents[0].categories=['missing_items'];
  assert.equal(planGuestJourney(c,evidenceNow).exception,'hoa_source_review');
  assert.equal(validateLiveSubmissionPrerequisites(c).ok,false);
  assert.equal(c.steps.find(s=>s.id==='screening_complete').done,true);
  assert.equal(review(c,sourceId,{requestedItems:['signatures']}).ok,true);
  assert.equal(planGuestJourney(c,evidenceNow).state,'waiting_for_guest');
});
test('changed stay evidence can only be superseded with explicit re-verification and keeps its audit history',()=>{
  const c=evidenceCase();review(c,sourceId,{confirmations:['payment_received'],requestedItems:['documents']});
  c.steps.find(s=>s.id==='board_approved').done=true; // Legacy confirmation must not carry across changed dates.
  c.checkIn='2026-10-02';
  assert.equal(review(c,laterId,{confirmations:['payment_received']}).ok,false);
  assert.equal(review(c,laterId,{reconcileContext:true,confirmations:['payment_received'],requestedItems:['signatures']}).ok,true);
  assert.equal(c.hoaTasks[0].status,'superseded');assert.equal(c.hoaTasks[1].status,'open');
  assert.equal(c.hoaMailEvents[0].review.confirmations[0],'payment_received');
  assert.equal(c.steps.find(s=>s.id==='board_approved').done,false);
  assert.equal(planGuestJourney(c,evidenceNow).state,'waiting_for_guest');
});
test('only explicit owner source verification grants HOA approval and does not imply payment',()=>{
  const c=evidenceCase();
  assert.equal(review(c,sourceId,{confirmations:['hoa_approved']}).ok,true);
  assert.equal(c.steps.find(s=>s.id==='board_approved').done,true);
  assert.equal(c.steps.find(s=>s.id==='fee_sent').done,false);
  assert.equal(planGuestJourney(c,evidenceNow).state,'approved');
});
test('new adverse evidence invalidates approval but preserves delivery history and does not cancel',()=>{
  const c=evidenceCase();review(c,sourceId,{confirmations:['hoa_approved']});
  assert.equal(review(c,laterId,{kind:'adverse_response'}).ok,true);
  assert.equal(c.steps.find(s=>s.id==='board_approved').done,false);
  assert.equal(planGuestJourney(c,evidenceNow).exception,'hoa_adverse_response');
  assert.equal(c.hoaEvidence.hoa_approved.sourceId,sourceId);assert.ok(c.hoaEvidence.hoa_approved.disputedAt);
  assert.notEqual(c.status,'canceled');
});
test('explicit Tenant Evaluation sender configuration joins the existing inbox search without a wildcard',()=>{
  assert.deepEqual(configuredHoaSenders({HOA_MAIL_SENDERS:allow[0],TENANT_EVALUATION_MAIL_SENDERS:'evaluation@example.test, invalid'}),[allow[0],'evaluation@example.test']);
});
test('verified manual source assignment survives subsequent mailbox polls',async()=>{
  const {env,call,form,c,legacy}=await evidenceEnvironment();
  const msg=decodeMessage(rawMessage('Application update','We received the application package.','manual-source'));
  const source=await archiveHoaReply(env,msg,analyseHoaReply(msg,[c],allow),[c]);
  const page='/admin/hoa-mail/'+source.id+'?case='+c.id;
  const html=await (await call(page)).text();
  const input=await form({confirmations:'application_received'});
  input.caseVersion=html.match(/name="caseVersion" value="(\d+)"/)[1];
  assert.equal((await call('/admin/hoa-mail/'+source.id+'/review',input)).status,303);
  const imap={open:async()=>{},close:async()=>{},searchRaw:async q=>q.includes('airbnb.com')?[]:[1],
    fetchMessage:async()=>rawMessage(msg.subject,msg.text,'manual-source')};
  await pollMail(env,{imap,notify:async()=>true});
  const news=JSON.parse(legacy.get('hoa-news'));
  assert.equal(news[0].caseId,c.id);assert.equal(news[0].reviewRequired,false);
});
test('reminder worker uses verified tasks, respects reported completion and never sends to HOA',async()=>{
  const {env,call,sourcePath,form}=await evidenceEnvironment();
  env.REQUIRE_ATOMIC_CASES='yes';env.AUTO_GUEST_REMINDERS='yes';env.PORTAL_ORIGIN='https://example.com';
  await call(sourcePath+'/review',await form({requestedItems:'signatures'}));
  const cases=await loadStoredCases(env);cases[0].wizard={adults:[{email:'guest@example.test'}]};await saveStoredCases(env,cases);
  const {runGuestReminders}=await import('../functions/lib/guest-reminders.js');
  const sent=[];
  assert.equal((await runGuestReminders(env,evidenceNow,async(_env,msg)=>sent.push(msg))).sent,1);
  assert.deepEqual(sent[0].to,['guest@example.test']);assert.deepEqual(sent[0].cc,[]);assert.match(sent[0].text,/missing signatures/);
  const [c]=await loadStoredCases(env),task=c.hoaTasks[0];
  await call('/v/'+c.token+'/hoa-task-reported',{taskId:task.id,taskVersion:String(task.version),confirmed:'yes'},'');
  assert.equal((await runGuestReminders(env,new Date('2026-09-10'),async(_env,msg)=>sent.push(msg))).sent,0);
  assert.equal(sent.length,1);
});
test('owner watchdog cannot silently skip an approved case with a new unreviewed HOA problem',async()=>{
  const {computeAlerts}=await import('../cron/src/index.js');
  const c=evidenceCase();c.checkIn='2026-09-12';c.steps.push({id:'checkin_released',done:true});c.steps.find(s=>s.id==='board_approved').done=true;
  c.hoaMailEvents[0].categories=['missing_items'];
  const alerts=computeAlerts([c],evidenceNow);
  assert.ok(alerts.some(a=>a.key==='hoaEvidenceReview'));
});
test('synthetic source-to-approval lifecycle keeps each confirmation separate and performs no real delivery',async()=>{
  resetSocketAttempts();const {env,call,sourcePath,form,c}=await evidenceEnvironment();
  await call(sourcePath+'/review',await form({requestedItems:'signatures'}));
  const follow=async(text,input)=>{
    const all=await loadStoredCases(env),current=all[0],msg=mail({text,messageId:'<'+crypto.randomUUID()+'@hoa.example.test>'});
    const source=await archiveHoaReply(env,msg,analyseHoaReply(msg,all,allow),all);
    current.hoaMailEvents.push({...source});await saveStoredCases(env,all);
    const path='/admin/hoa-mail/'+source.id;
    const page=await (await call(path)).text(),version=page.match(/name="caseVersion" value="(\d+)"/)[1];
    const response=await call(path+'/review',{id:c.id,reservation:c.reservationCode,caseVersion:version,attested:'yes',kind:'confirmed',...input});
    assert.equal(response.status,303);return (await loadStoredCases(env))[0];
  };
  let [saved]=await loadStoredCases(env);const task=saved.hoaTasks[0];
  await call('/v/'+c.token+'/hoa-task-reported',{taskId:task.id,taskVersion:'1',confirmed:'yes'},'');
  saved=await follow('Requested signature accepted. Official application complete.',{resolvedItems:task.id,confirmations:'application_complete'});
  assert.equal(saved.steps.find(s=>s.id==='screening_complete').done,true);
  assert.equal(saved.steps.find(s=>s.id==='fee_sent').done,false);
  assert.equal(saved.steps.find(s=>s.id==='board_approved').done,false);
  saved=await follow('Required fee received.',{confirmations:'payment_received'});
  assert.equal(saved.steps.find(s=>s.id==='board_approved').done,false);
  saved=await follow('Board approval granted for the identified stay.',{confirmations:'hoa_approved'});
  assert.equal(planGuestJourney(saved,evidenceNow).state,'approved');
  assert.match(await (await call('/v/'+c.token,null,'')).text(),/Approved — you&#39;re all set|Approved — you're all set/);
  assert.equal(saved.submission,undefined);assert.equal(socketAttempts(),0);
});
