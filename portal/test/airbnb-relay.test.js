import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {CaseStore} from '../case-store/src/index.js';
import {loadStoredCases,saveStoredCases,caseSnapshotVersion} from '../functions/lib/storage.js';
import {captureAirbnbRelay,verifyAirbnbRelay,usableAirbnbRelay} from '../functions/lib/airbnb-relay.js';
register('./loaders/cloudflare-sockets-loader.mjs',import.meta.url);
const {onRequest}=await import('../functions/[[path]].js');
const {runGuestReminders}=await import('../functions/lib/guest-reminders.js');
const {decodeMessage}=await import('../functions/lib/imap.js');
const {pollMail}=await import('../functions/lib/mailpoll.js');
const {socketAttempts,resetSocketAttempts}=await import('cloudflare:sockets');
const NOW=new Date(),ORIGIN='https://example.com';
const future=days=>new Date(+NOW+days*86400000).toISOString().slice(0,10);
const fixture=id=>({id,guestName:'Synthetic Guest',reservationCode:'HMTEST000001',token:'synthetic-relay-token',pathType:'full',screeningRoute:'paper',
  checkIn:future(20),checkOut:future(50),nights:30,adults:1,steps:[],createdAt:new Date(+NOW-2*86400000).toISOString()});
const mail=()=>({from:'Airbnb <automated@airbnb.com>',subject:'New message from Synthetic Guest',date:NOW.toISOString(),
  replyTo:'Synthetic Guest <synthetic-thread@reply.airbnb.com>',replyToCount:1,messageId:'<synthetic-inbound@airbnb.com>',messageIdCount:1,
  text:'Reservation HMTEST000001. Synthetic private message that must not be stored.'});
async function setup(){
  const values=new Map([['snapshot',{revision:0,versions:{},ids:[]}]]),kv=new Map();let queue=Promise.resolve();
  const storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),delete:async k=>values.delete(k),transaction(fn){const next=queue.then(()=>fn(storage));queue=next.catch(()=>{});return next;}};
  const actor=new CaseStore({storage},{});
  const env={CASES:{get:async k=>kv.get(k)||null,put:async(k,v)=>kv.set(k,v)},DATA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),
    CASE_STORE:{idFromName:n=>n,get:()=>({fetch:(url,opts)=>actor.fetch(new Request(url,opts))})},REQUIRE_ATOMIC_CASES:'yes',AUTO_GUEST_REMINDERS:'yes',AIRBNB_RELAY_REMINDERS:'yes',PORTAL_ORIGIN:ORIGIN,
    ADMIN_USER:'owner',ADMIN_PASSWORD:'synthetic-only'};
  const cases=await loadStoredCases(env);cases.push(fixture('a'));await captureAirbnbRelay(mail(),cases,NOW);await saveStoredCases(env,cases);
  return {env,values};
}
test('relay extraction requires one safe Reply-To, Message-ID and uniquely matching code',async()=>{
  const cases=[fixture('a')];assert.equal(await captureAirbnbRelay(mail(),cases,NOW),true);
  assert.equal(usableAirbnbRelay(cases[0],NOW),null,'unverified candidate cannot send');
  assert.doesNotMatch(JSON.stringify(cases[0].airbnbRelay),/Synthetic private message/);
  for(const bad of [{replyTo:'automated@airbnb.com'},{replyTo:'x@reply.airbnb.com.evil.test'},{replyTo:'a@reply.airbnb.com,b@reply.airbnb.com'},
    {replyTo:'x@reply.airbnb.com>'},{replyTo:'Guest <x@reply.airbnb.com'},
    {replyToCount:2},{messageIdCount:2},{messageId:'<good@airbnb.com>\r\nBcc: x@example.test'},{from:'Airbnb <x@evil.test>'},
    {text:'HMTEST000001 HMTEST000002'},{text:'Only a name, no unique booking code'},{date:new Date(+NOW-31*86400000).toISOString()}]) {
    const clean=[fixture('a')];assert.equal(await captureAirbnbRelay({...mail(),...bad},clean,NOW),false);assert.equal(clean[0].airbnbRelay,undefined);
  }
});
test('reply header decoder keeps duplicate counts and never reads reply headers from message body',()=>{
  const raw='* 1 FETCH (BODY[HEADER.FIELDS (SUBJECT FROM DATE MESSAGE-ID REPLY-TO)] {200}\r\nSubject: New message\r\nFrom: automated@airbnb.com\r\nMessage-ID: <a@airbnb.com>\r\nReply-To: Guest\r\n <synthetic-thread@reply.airbnb.com>\r\nReply-To: other@reply.airbnb.com\r\n\r\n BODY[1] {80}\r\nReply-To: evil@reply.airbnb.com\r\nMessage-ID: <evil@airbnb.com>\r\n)\r\nA1 OK done';
  const decoded=decodeMessage(raw);assert.equal(decoded.replyToCount,2);assert.equal(decoded.messageIdCount,1);assert.doesNotMatch(decoded.replyTo,/evil/);
  const malformed=decodeMessage(raw.replace('Message-ID: <a@airbnb.com>','Message-ID: <a@airbnb.com> <second@airbnb.com>'));
  assert.notEqual(malformed.messageId,'<a@airbnb.com>','must not truncate a malformed header into a valid identifier');
});
test('verified relay is encrypted, context-bound, expiring and excluded from plaintext store',async()=>{
  const {env,values}=await setup();const cases=await loadStoredCases(env),c=cases[0];
  assert.equal(verifyAirbnbRelay(c,c.airbnbRelay.candidate.sourceHash,{attested:true,by:'owner'},NOW),true);
  await saveStoredCases(env,cases);assert.equal(usableAirbnbRelay((await loadStoredCases(env))[0],NOW).to,'synthetic-thread@reply.airbnb.com');
  assert.doesNotMatch(JSON.stringify([...values]),/synthetic-thread|synthetic-inbound|New message from/);
  const changed=structuredClone(c);changed.checkIn=future(21);assert.equal(usableAirbnbRelay(changed,NOW),null);
  assert.equal(usableAirbnbRelay(c,new Date(+NOW+31*86400000)),null);
  c.status='canceled';assert.equal(usableAirbnbRelay(c,NOW),null);
});
test('owner verifies exact candidate with current revision; guest and reviewer cannot authorize transport',async()=>{
  const {env}=await setup();const cases=await loadStoredCases(env),c=cases[0];
  const form={id:c.id,caseVersion:String(caseSnapshotVersion(cases,c.id)),sourceHash:c.airbnbRelay.candidate.sourceHash,reservation:c.reservationCode,attested:'yes',action:'verify'};
  const call=(body,auth='Basic '+btoa('owner:synthetic-only'),origin=ORIGIN)=>onRequest({env,request:new Request(ORIGIN+'/admin/airbnb-relay',{method:'POST',headers:{Authorization:auth,Origin:origin},body:new URLSearchParams(body)})});
  resetSocketAttempts();assert.equal((await call(form,'')).status,401);assert.equal((await call(form,'Bearer '+'x'.repeat(40))).status,401);
  assert.equal((await call(form,undefined,'https://evil.test')).status,403);
  assert.equal((await call({...form,attested:''})).status,400);assert.equal((await call({...form,reservation:'wrong'})).status,409);
  assert.equal((await call(form)).status,303);assert.equal((await call(form)).status,409);assert.equal(socketAttempts(),0);
  assert.equal((await loadStoredCases(env))[0].steps.some(s=>s.done),false);
});
test('relay reminders share atomic claims and include threading headers without private links',async()=>{
  const {env}=await setup();const cases=await loadStoredCases(env),c=cases[0];verifyAirbnbRelay(c,c.airbnbRelay.candidate.sourceHash,{attested:true,by:'owner'},NOW);await saveStoredCases(env,cases);
  const messages=[];const send=async(_,m)=>{messages.push(m);return true;};
  await Promise.all([runGuestReminders(env,NOW,send),runGuestReminders(env,NOW,send)]);
  assert.equal(messages.length,1);assert.deepEqual(messages[0].to,['synthetic-thread@reply.airbnb.com']);assert.deepEqual(messages[0].cc,[]);
  assert.equal(messages[0].inReplyTo,'<synthetic-inbound@airbnb.com>');assert.deepEqual(messages[0].references,['<synthetic-inbound@airbnb.com>']);
  assert.match(messages[0].subject,/^Re: New message/);assert.match(messages[0].messageId,/@example.com>$/);
  assert.doesNotMatch(messages[0].text,/synthetic-relay-token|HMTEST000001/);
  const [saved]=await loadStoredCases(env);assert.equal(saved.automation.reminderClaim.channel,'airbnb_relay');assert.equal(saved.automation.reminderClaim.state,'sent');
  assert.doesNotMatch(JSON.stringify(saved.automation),/synthetic-thread|synthetic-inbound/);
});
test('unverified or disabled relay never sends; opt-out from direct email can use verified Airbnb route',async()=>{
  const {env}=await setup();let sent=0;const send=async()=>{sent++;return true;};
  assert.equal((await runGuestReminders(env,NOW,send)).waitingForContact,1);assert.equal(sent,0);
  const cases=await loadStoredCases(env),c=cases[0];verifyAirbnbRelay(c,c.airbnbRelay.candidate.sourceHash,{attested:true,by:'owner'},NOW);
  c.guestContact={requested:false};c.wizard={adults:[{email:'old@example.test'}]};await saveStoredCases(env,cases);
  env.AIRBNB_RELAY_REMINDERS='no';assert.equal((await runGuestReminders(env,NOW,send)).waitingForContact,1);assert.equal(sent,0);
  env.AIRBNB_RELAY_REMINDERS='yes';await runGuestReminders(env,NOW,send);assert.equal(sent,1);
});
test('an uncertain relay attempt never falls back to direct email or retries after restart',async()=>{
  const {env}=await setup();const cases=await loadStoredCases(env),c=cases[0];verifyAirbnbRelay(c,c.airbnbRelay.candidate.sourceHash,{attested:true,by:'owner'},NOW);await saveStoredCases(env,cases);
  let attempts=0;await runGuestReminders(env,NOW,async()=>{attempts++;throw Error('synthetic timeout');});
  const current=await loadStoredCases(env);current[0].guestContact={requested:true,email:'new@example.test'};await saveStoredCases(env,current);
  await runGuestReminders(env,new Date(+NOW+4*86400000),async()=>{attempts++;return true;});assert.equal(attempts,1);
});
test('concurrent verification cannot bind the same relay to different reservations',async()=>{
  const {env}=await setup();const initial=await loadStoredCases(env);initial.push({...fixture('b'),reservationCode:'HMTEST000002'});
  await captureAirbnbRelay({...mail(),text:'Reservation HMTEST000002'},initial,NOW);await saveStoredCases(env,initial);
  const left=await loadStoredCases(env),right=await loadStoredCases(env);
  verifyAirbnbRelay(left[0],left[0].airbnbRelay.candidate.sourceHash,{attested:true,by:'owner'},NOW);
  verifyAirbnbRelay(right[1],right[1].airbnbRelay.candidate.sourceHash,{attested:true,by:'owner'},NOW);
  const results=await Promise.allSettled([saveStoredCases(env,left),saveStoredCases(env,right)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'CASE_CONFLICT');
});
test('revoking a relay during the send claim suppresses that attempt',async()=>{
  const {env}=await setup();const cases=await loadStoredCases(env),c=cases[0];verifyAirbnbRelay(c,c.airbnbRelay.candidate.sourceHash,{attested:true,by:'owner'},NOW);await saveStoredCases(env,cases);
  const original=env.CASE_STORE.get;let revoked=false;
  env.CASE_STORE.get=name=>({fetch:async(url,options)=>{
    const response=await original(name).fetch(url,options);
    if(!revoked&&options?.method==='PATCH'&&options.body.includes('"state":"claimed"')) {
      revoked=true;const current=await loadStoredCases(env);delete current[0].airbnbRelay.verified;delete current[0].airbnbRelayKey;await saveStoredCases(env,current);
    }return response;
  }});
  assert.equal((await runGuestReminders(env,NOW,async()=>assert.fail('revoked'))).suppressed,1);
});
test('mailbox capture persists only encrypted candidates, is repeat-safe and restores the HOA folder',async()=>{
  const {env,values}=await setup();const cases=await loadStoredCases(env);delete cases[0].airbnbRelay;await saveStoredCases(env,cases);
  env.AIRBNB_RELAY_MAILBOX='Synthetic Archive';
  const raw='* 1 FETCH (BODY[HEADER.FIELDS (SUBJECT FROM DATE MESSAGE-ID REPLY-TO)] {200}\r\nSubject: New message from Synthetic Guest\r\nFrom: automated@airbnb.com\r\nDate: '+NOW.toUTCString()+'\r\nMessage-ID: <poll@airbnb.com>\r\nReply-To: synthetic-thread@reply.airbnb.com\r\n\r\n BODY[1] {80}\r\nReservation HMTEST000001. Private body.\r\n)\r\nA1 OK done';
  const folders=[];let closed=0;
  const imap={open:async()=>{},close:async()=>{closed++;},selectMailbox:async name=>folders.push(name),searchRaw:async q=>q==='from:airbnb.com newer_than:30d'?[1]:[],fetchMessage:async()=>raw};
  resetSocketAttempts();
  assert.equal((await pollMail(env,{imap,notify:async()=>assert.fail('no notifications expected')})).relayCandidates,1);
  assert.equal((await pollMail(env,{imap})).relayCandidates,undefined);
  assert.deepEqual(folders,['Synthetic Archive','INBOX','Synthetic Archive','INBOX']);assert.equal(closed,2);
  const [c]=await loadStoredCases(env);assert.ok(c.airbnbRelay.candidate);assert.equal(usableAirbnbRelay(c,NOW),null);
  assert.doesNotMatch(JSON.stringify([...values]),/synthetic-thread|poll@airbnb|Private body/);assert.equal(socketAttempts(),0);
  // A failed save must not advance cursors or reach a reminder stage.
  const before=await env.CASES.get('mail-seen');let calls=0;
  const original=env.CASE_STORE.get;
  env.CASE_STORE.get=name=>({fetch:(url,options)=>options?.method==='PATCH'?Promise.resolve(Response.json({error:'conflict'},{status:409})):original(name).fetch(url,options)});
  imap.fetchMessage=async()=>raw.replace('<poll@airbnb.com>','<poll-2@airbnb.com>');
  await assert.rejects(pollMail(env,{imap,notify:async()=>{calls++;}}),{code:'CASE_CONFLICT'});
  assert.equal(await env.CASES.get('mail-seen'),before);assert.equal(calls,0);assert.equal(closed,3);
});
test('changed reply destination revokes prior verification; newer same-thread mail does not extend expiry',async()=>{
  const cases=[fixture('a')];await captureAirbnbRelay(mail(),cases,NOW);const c=cases[0];
  verifyAirbnbRelay(c,c.airbnbRelay.candidate.sourceHash,{attested:true,by:'owner'},NOW);
  await captureAirbnbRelay({...mail(),messageId:'<newer@airbnb.com>',date:new Date(+NOW+86400000).toISOString()},cases,new Date(+NOW+86400000));
  assert.equal(c.airbnbRelay.verified.messageId,mail().messageId);
  assert.equal(usableAirbnbRelay(c,new Date(+NOW+30.5*86400000)),null);
  await captureAirbnbRelay({...mail(),replyTo:'changed@reply.airbnb.com',date:new Date(+NOW+86400000).toISOString()},cases,new Date(+NOW+86400000));
  assert.equal(c.airbnbRelay.verified,undefined);assert.equal(c.airbnbRelayKey,undefined);
});
test('private store rejects plaintext relay fields and corrupt encrypted relay fails closed',async()=>{
  const {env,values}=await setup();
  const reply=await env.CASE_STORE.get('test').fetch('https://store/cases',{method:'PATCH',body:JSON.stringify({changes:[{id:'plain',expectedVersion:0,value:{id:'plain',airbnbRelay:{to:'secret@reply.airbnb.com'}}}]})});
  assert.equal(reply.status,400);
  const record=values.get('case:a');record.airbnbRelayEncrypted.ciphertext='corrupt';values.set('case:a',record);
  await assert.rejects(loadStoredCases(env));
});
test('a requested direct address takes priority over a verified relay',async()=>{
  const {env}=await setup();const cases=await loadStoredCases(env),c=cases[0];
  verifyAirbnbRelay(c,c.airbnbRelay.candidate.sourceHash,{attested:true,by:'owner'},NOW);
  c.guestContact={requested:true,email:'direct@example.test'};await saveStoredCases(env,cases);
  const sent=[];await runGuestReminders(env,NOW,async(_,m)=>{sent.push(m);return true;});
  assert.deepEqual(sent[0].to,['direct@example.test']);assert.equal(sent[0].inReplyTo,undefined);
});
test('initial import cannot introduce shared verified relay destinations',async()=>{
  const raw=JSON.stringify([{id:'a',airbnbRelayKey:'a'.repeat(64)},{id:'b',airbnbRelayKey:'a'.repeat(64)}]);
  const expectedHash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))).toString('hex');
  const actor=new CaseStore({storage:{transaction:()=>assert.fail('invalid import must not write')}},{ALLOW_CASE_IMPORT:'yes',LEGACY_CASES:{get:async()=>raw}});
  const response=await actor.fetch(new Request('https://store/initialize',{method:'POST',body:JSON.stringify({expectedHash,expectedCount:2})}));
  assert.equal(response.status,409);
});
