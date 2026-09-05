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
