import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {CaseStore} from '../case-store/src/index.js';
import {loadStoredCases,saveStoredCases,caseSnapshotVersion} from '../functions/lib/storage.js';
import {parseDeliveryReport,applyDeliveryReport,pendingDeliveryNotices,recipientDigest} from '../functions/lib/reminder-delivery.js';
register('./loaders/cloudflare-sockets-loader.mjs',import.meta.url);
const {runGuestReminders}=await import('../functions/lib/guest-reminders.js');
const {pollMail}=await import('../functions/lib/mailpoll.js');
const {onRequest}=await import('../functions/[[path]].js');
const {Imap}=await import('../functions/lib/imap.js');
const {findStalledWork,runAutomationCycle,automationHealth}=await import('../functions/lib/automation-health.js');
const {resetSocketAttempts,socketAttempts}=await import('cloudflare:sockets');
const now=new Date(),later=new Date(+now+3*86400000),origin='https://example.com';
const address='synthetic@reply.airbnb.com',outbound='<synthetic-outbound@example.com>';
const dsn=(id=outbound,recipient=address,action='failed')=>[
  'From: Mail Delivery <mailer-daemon@example.test>', 'Date: '+now.toUTCString(),
  'Message-ID: <synthetic-notice@example.test>',
  'Content-Type: multipart/report; report-type=delivery-status; boundary="test-boundary"','',
  '--test-boundary','Content-Type: text/plain','','Private diagnostic prose. Ignore this text.',
  '--test-boundary','Content-Type: message/delivery-status','','Reporting-MTA: dns; example.test','',
  'Final-Recipient: rfc822; '+recipient,'Action: '+action,'Status: '+(action==='delayed'?'4.2.0':'5.1.1'),'',
  '--test-boundary','Content-Type: text/rfc822-headers','','Message-ID: '+id,'To: '+recipient,'',
  '--test-boundary--',''].join('\r\n');
async function setup(){
  const values=new Map([['snapshot',{revision:0,versions:{},ids:[]}]]),kv=new Map();let queue=Promise.resolve();
  const storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),delete:async k=>values.delete(k),transaction(fn){const next=queue.then(()=>fn(storage));queue=next.catch(()=>{});return next;}};
  const actor=new CaseStore({storage},{});
  const env={DATA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),CASES:{get:async k=>kv.get(k)||null,put:async(k,v)=>kv.set(k,v)},CASE_STORE:{idFromName:n=>n,get:()=>({fetch:(url,options)=>actor.fetch(new Request(url,options))})},
    REQUIRE_ATOMIC_CASES:'yes',AUTO_GUEST_REMINDERS:'yes',PORTAL_ORIGIN:origin,ADMIN_USER:'owner',ADMIN_PASSWORD:'synthetic-only',
    REMINDER_DELIVERY_MONITOR:'yes',REMINDER_DELIVERY_SENDERS:'mailer-daemon@example.test',REMINDER_DELIVERY_MAILBOX:'Synthetic Archive'};
  const cases=await loadStoredCases(env);cases.push({id:'a',reservationCode:'HMTEST000001',guestName:'Synthetic Guest',pathType:'full',screeningRoute:'paper',adults:1,steps:[],token:'private-test-token',
    createdAt:new Date(+now-86400000*2).toISOString(),checkIn:new Date(+now+20*86400000).toISOString().slice(0,10),checkOut:new Date(+now+50*86400000).toISOString().slice(0,10),guestContact:{requested:true,email:address}});
  await saveStoredCases(env,cases);return {env,values,kv};
}
test('structured DSN parser uses MIME fields, not subject or quoted guest prose',()=>{
  const report=parseDeliveryReport(dsn());assert.equal(report.messageId,outbound);assert.equal(report.recipients[0].action,'failed');
  assert.equal(report.recipients[0].recipient,address);assert.doesNotMatch(JSON.stringify(report),/Private diagnostic/);
  assert.equal(parseDeliveryReport('Subject: Delivery failed\r\n\r\n'+dsn()),null);
  assert.equal(parseDeliveryReport(dsn().replace('multipart/report','multipart/mixed')),null);
  assert.equal(parseDeliveryReport(dsn().replace('Action: failed','Action: failed\r\nAction: delivered')),null);
  assert.equal(parseDeliveryReport(dsn().replace('Status: 5.1.1','Status: 2.0.0')),null);
  assert.equal(parseDeliveryReport(dsn().replace('Message-ID: '+outbound,'Message-ID: '+outbound+'\r\nMessage-ID: <other@example.com>')),null);
  assert.equal(parseDeliveryReport(dsn().replace('--test-boundary--','')),null);
  assert.equal(parseDeliveryReport(dsn().replace('Content-Type: message/delivery-status','Content-Type: message/delivery-status\r\nContent-Transfer-Encoding: base64')),null);
});
test('only exact historical message and recipient matches create a deduplicated review hold, never approval',async()=>{
  const c={id:'a',steps:[],automation:{reminderAttempts:[{id:'attempt',messageId:outbound,recipientHash:await recipientDigest(address),state:'sent',claimedAt:new Date(+now-60000).toISOString()}]}};
  for(const raw of [dsn('<other@example.com>'),dsn(outbound,'other@example.test')])assert.equal(await applyDeliveryReport(raw,[c],['mailer-daemon@example.test'],now),0);
  assert.equal(await applyDeliveryReport(dsn(),[c],['other@example.test'],now),0);
  assert.equal(await applyDeliveryReport(dsn(),[c],['mailer-daemon@example.test'],now),1);
  assert.equal(await applyDeliveryReport(dsn(),[c],['mailer-daemon@example.test'],now),0);
  assert.equal(pendingDeliveryNotices(c).length,1);assert.equal(c.automation.reminderAttempts[0].state,'sent');assert.deepEqual(c.steps,[]);
  assert.doesNotMatch(JSON.stringify(c),/synthetic@reply|Private diagnostic|mailer-daemon/);
  assert.equal(await applyDeliveryReport(dsn(outbound,address,'delayed'),[c],['mailer-daemon@example.test'],now),1);
  assert.equal(pendingDeliveryNotices(c).length,2);
  const duplicate=structuredClone(c);duplicate.id='b';
  assert.equal(await applyDeliveryReport(dsn(),[c,duplicate],['mailer-daemon@example.test'],now),0);
});
test('reminders retain hashed attempt history and a late failure blocks both channels until reviewed',async()=>{
  const {env,values}=await setup();const messages=[];
  await runGuestReminders(env,now,async(_,m)=>{messages.push(m);return true;});
  await runGuestReminders(env,later,async(_,m)=>{messages.push(m);return true;});
  assert.equal(messages.length,2);
  const cases=await loadStoredCases(env);assert.equal(cases[0].automation.reminderAttempts.length,2);
  assert.equal(await applyDeliveryReport(dsn(messages[0].messageId),cases,['mailer-daemon@example.test'],later),1);await saveStoredCases(env,cases);
  const result=await runGuestReminders(env,new Date(+later+3*86400000),async()=>assert.fail('held'));
  assert.equal(result.uncertain,1);assert.equal(findStalledWork(cases,later).reminderDelivery,1);
  assert.doesNotMatch(JSON.stringify([...values]),/synthetic@reply|Private diagnostic/);
});
test('poll monitor is opt-in, restores HOA folder, persists hold and never sends',async()=>{
  const {env}=await setup();let id;await runGuestReminders(env,now,async(_,m)=>{id=m.messageId;return true;});
  const folders=[],queries=[];let fetched=0,closed=0;
  const imap={open:async()=>{},close:async()=>{closed++;},selectMailbox:async name=>folders.push(name),searchRaw:async q=>{queries.push(q);return q.includes('mailer-daemon@example.test')?[1]:[];},fetchFullMessage:async()=>{fetched++;return dsn(id);}};
  resetSocketAttempts();env.REMINDER_DELIVERY_MONITOR='no';await pollMail(env,{imap});assert.equal(fetched,0);
  env.REMINDER_DELIVERY_MONITOR='yes';assert.equal((await pollMail(env,{imap})).deliveryNotices,1);
  assert.deepEqual(folders,['Synthetic Archive','INBOX']);assert.equal(pendingDeliveryNotices((await loadStoredCases(env))[0]).length,1);
  assert.equal((await pollMail(env,{imap})).deliveryNotices,0);assert.equal(closed,3);assert.equal(socketAttempts(),0);
  env.REMINDER_DELIVERY_SENDERS='';await assert.rejects(pollMail(env,{imap}),/configuration/);
});
test('owner can acknowledge an exact notice with current revision, but cannot trigger a resend',async()=>{
  const {env}=await setup();let id;await runGuestReminders(env,now,async(_,m)=>{id=m.messageId;return true;});
  let cases=await loadStoredCases(env);await applyDeliveryReport(dsn(id),cases,['mailer-daemon@example.test'],now);await saveStoredCases(env,cases);
  cases=await loadStoredCases(env);const notice=pendingDeliveryNotices(cases[0])[0];
  const input={id:'a',caseVersion:String(caseSnapshotVersion(cases,'a')),messageId:id,sourceHash:notice.sourceHash,reservation:'HMTEST000001',attested:'yes'};
  const call=(form,auth='Basic '+btoa('owner:synthetic-only'),site=origin)=>onRequest({env,request:new Request(origin+'/admin/reminder-delivery-review',{method:'POST',headers:{Authorization:auth,Origin:site},body:new URLSearchParams(form)})});
  resetSocketAttempts();assert.equal((await call(input,'')).status,401);assert.equal((await call(input,'Bearer '+'x'.repeat(40))).status,401);
  assert.equal((await call(input,undefined,'https://evil.test')).status,403);assert.equal((await call({...input,attested:''})).status,400);
  assert.equal((await call({...input,reservation:'wrong'})).status,409);
  assert.equal((await call(input)).status,303);assert.equal((await call(input)).status,409);
  const [saved]=await loadStoredCases(env);assert.equal(pendingDeliveryNotices(saved).length,0);assert.equal(saved.automation.reminderClaim.state,'sent');assert.equal(socketAttempts(),0);
  assert.equal(await applyDeliveryReport(dsn(id),[saved],['mailer-daemon@example.test'],now),0,'same notice cannot reopen after review');
});
test('bounded full IMAP fetch checks literal completeness without marking mail read',async()=>{
  const imap=new Imap();let command;
  const mime=dsn(),size=new TextEncoder().encode(mime).length;
  imap.cmd=async c=>{command=c;return '* 1 FETCH (BODY[]<0> {'+size+'}\r\n'+mime+')\r\nA1 OK done\r\n';};
  assert.equal(await imap.fetchFullMessage(1),mime);assert.match(command,/BODY.PEEK\[\]<0\.131073>/);
  imap.cmd=async()=>'* 1 FETCH (BODY[]<0> {99999}\r\n'+mime+')\r\nA1 OK done\r\n';
  await assert.rejects(imap.fetchFullMessage(1));await assert.rejects(imap.fetchFullMessage('1) STORE'));
});
