import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
import {CaseStore} from '../case-store/src/index.js';
import {loadStoredCases,saveStoredCases} from '../functions/lib/storage.js';
register('./loaders/cloudflare-sockets-loader.mjs',import.meta.url);
const {onRequest}=await import('../functions/[[path]].js');
const {runGuestReminders}=await import('../functions/lib/guest-reminders.js');
const {socketAttempts,resetSocketAttempts}=await import('cloudflare:sockets');
const ORIGIN='https://example.com',NOW=new Date('2026-09-05T12:00:00Z');
async function setup() {
  const values=new Map([['snapshot',{revision:0,ids:[],versions:{}}]]),kv=new Map();let queue=Promise.resolve();
  const storage={get:async k=>structuredClone(values.get(k)),put:async(k,v)=>values.set(k,structuredClone(v)),delete:async k=>values.delete(k),
    transaction(fn){const next=queue.then(()=>fn(storage));queue=next.catch(()=>{});return next;}};
  const actor=new CaseStore({storage},{});
  const env={DATA_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),REQUIRE_ATOMIC_CASES:'yes',AUTO_GUEST_REMINDERS:'yes',PORTAL_ORIGIN:ORIGIN,
    ADMIN_USER:'owner',ADMIN_PASSWORD:'synthetic-only',
    CASES:{get:async k=>kv.get(k)??null,put:async(k,v)=>kv.set(k,v)},
    CASE_STORE:{idFromName:n=>n,get:()=>({fetch:(url,opts)=>actor.fetch(new Request(url,opts))})}};
  const cases=await loadStoredCases(env);
  cases.push({id:'contact',token:'synthetic-contact-token',guestName:'Synthetic Guest',reservationCode:'SYNTHETIC123',adults:1,nights:30,
    pathType:'full',screeningRoute:'online',checkIn:'2026-11-01',checkOut:'2026-12-01',createdAt:'2026-09-01T00:00:00Z',steps:[]});
  await saveStoredCases(env,cases);
  const call=(form,origin=ORIGIN)=>onRequest({env,request:new Request(ORIGIN+'/v/synthetic-contact-token'+(form?'/reminder-contact':''),
    form?{method:'POST',headers:{Origin:origin},body:new URLSearchParams(form)}:{})});
  const version=async()=>{const page=await(await call()).text();return page.match(/name="contactVersion" value="(\d+)"/)?.[1];};
  const requestEmail=async()=>call({contactVersion:await version(),preference:'email',email:'requested@example.test',emailAgain:'requested@example.test',requested:'yes'});
  return {env,values,call,version,requestEmail};
}
test('online guests can request encrypted reminders without paper forms or outbound side effects',async()=>{
  const {env,values,call,version,requestEmail}=await setup();
  const page=await(await call()).text();assert.match(page,/Optional email reminders/);assert.ok(await version());
  resetSocketAttempts();assert.equal((await requestEmail()).status,303);assert.equal(socketAttempts(),0);
  const [c]=await loadStoredCases(env);assert.equal(c.guestContact.email,'requested@example.test');assert.equal(c.guestContact.requested,true);
  assert.equal(c.wizard,undefined);assert.equal(c.submission,undefined);assert.equal(c.screeningReportedAt,undefined);
  assert.equal(c.steps.some(s=>s.done),false);assert.doesNotMatch(JSON.stringify([...values]),/requested@example/);
  assert.match(await(await call()).text(),/requested@example.test/);
});
test('contact changes require explicit request, matching address, current revision and same origin',async()=>{
  const {env,call,version}=await setup();const v=await version();assert.ok(v);
  const form={contactVersion:v,preference:'email',email:'requested@example.test',emailAgain:'requested@example.test',requested:'yes'};
  assert.equal((await call({...form,requested:''})).status,400);
  assert.equal((await call({...form,emailAgain:'typo@example.test'})).status,400);
  assert.equal((await call({...form,email:'bad\r\nBcc: hidden@example.test'})).status,400);
  assert.equal((await call({...form,contactVersion:''})).status,409);
  assert.equal((await call(form,'https://unrelated.example.test')).status,403);
  assert.equal((await call(form)).status,303);assert.equal((await call(form)).status,409);
  const cases=await loadStoredCases(env);cases[0].status='canceled';await saveStoredCases(env,cases);
  assert.equal((await call(form)).status,410);
});
test('email preference overrides paper contact and opting out never falls back to that address',async()=>{
  const {env,call,version,requestEmail}=await setup();assert.equal((await requestEmail()).status,303);
  const cases=await loadStoredCases(env);cases[0].screeningRoute='paper';cases[0].wizard={adults:[{email:'old@example.test'}]};await saveStoredCases(env,cases);
  const sent=[];await runGuestReminders(env,NOW,async(_,message)=>{sent.push(message);return true;});
  assert.deepEqual(sent[0]?.to,['requested@example.test']);assert.doesNotMatch(JSON.stringify(sent),/synthetic-contact-token|SYNTHETIC123/);
  assert.equal((await call({contactVersion:await version(),preference:'airbnb'})).status,303);
  const [c]=await loadStoredCases(env);assert.deepEqual(c.guestContact.requested,false);assert.equal(c.guestContact.email,undefined);
  const result=await runGuestReminders(env,new Date('2026-09-10T12:00:00Z'),async()=>assert.fail('opted out'));
  assert.equal(result.waitingForContact,1);
});
test('corrupted contact ciphertext fails closed instead of using another address',async()=>{
  const {env,values,requestEmail}=await setup();assert.equal((await requestEmail()).status,303);
  const stored=values.get('case:contact');assert.ok(stored.guestContactEncrypted);
  stored.guestContactEncrypted.ciphertext='invalid';values.set('case:contact',stored);
  await assert.rejects(loadStoredCases(env));
});
test('mandatory atomic store rejects plaintext contact fields at its private boundary',async()=>{
  const {env}=await setup();
  const result=await env.CASE_STORE.get('test').fetch('https://case-store/cases',{method:'PATCH',body:JSON.stringify({changes:[{id:'unsafe',expectedVersion:0,value:{id:'unsafe',guestContact:{email:'private@example.test'}}}]})});
  assert.equal(result.status,400);
});
test('contact form stays unavailable on legacy storage and discloses disabled delivery',async()=>{
  const {env,call}=await setup();env.AUTO_GUEST_REMINDERS='no';
  assert.match(await(await call()).text(),/Reminder delivery is not active yet/);
  const cases=await loadStoredCases(env);
  await env.CASES.put('cases',JSON.stringify(cases));
  delete env.CASE_STORE;delete env.REQUIRE_ATOMIC_CASES;
  assert.doesNotMatch(await(await call()).text(),/name="contactVersion"/);
  assert.equal((await call({contactVersion:'1',preference:'airbnb'})).status,503);
});
test('owner dashboard distinguishes missing contact from an actually sent reminder',async()=>{
  const {env}=await setup();
  // The online route may be awaiting authorized fee instructions, so use an
  // incomplete paper task for this contact-only diagnostic.
  const cases=await loadStoredCases(env);cases[0].screeningRoute='paper';await saveStoredCases(env,cases);
  const admin=await onRequest({env,request:new Request(ORIGIN+'/admin/cases',{headers:{Authorization:'Basic '+btoa('owner:synthetic-only')}})});
  assert.equal(admin.status,200);assert.match(await admin.text(),/No usable reminder email/);
});
test('a failed recipient recheck suppresses delivery if the guest opts out during a claim',async()=>{
  const {env,requestEmail}=await setup();assert.equal((await requestEmail()).status,303);
  const cases=await loadStoredCases(env);cases[0].screeningRoute='paper';await saveStoredCases(env,cases);
  const original=env.CASE_STORE.get;let changed=false;
  env.CASE_STORE.get=(name)=>({fetch:async(url,options)=>{
    const response=await original(name).fetch(url,options);
    if(!changed&&options?.method==='PATCH'&&options.body.includes('"state":"claimed"')) {
      changed=true;const current=await loadStoredCases(env);current[0].guestContact={requested:false};await saveStoredCases(env,current);
    }
    return response;
  }});
  const result=await runGuestReminders(env,NOW,async()=>assert.fail('recipient opted out before delivery'));
  assert.equal(result.suppressed,1);assert.equal((await loadStoredCases(env))[0].automation.reminderClaim.state,'suppressed');
});
test('late completion or cancellation and concurrent runs never create extra reminder delivery',async()=>{
  const {env,requestEmail}=await setup();assert.equal((await requestEmail()).status,303);
  const cases=await loadStoredCases(env);cases[0].screeningRoute='paper';await saveStoredCases(env,cases);
  let attempts=0;const send=async()=>{attempts++;return true;};
  await Promise.all([runGuestReminders(env,NOW,send),runGuestReminders(env,NOW,send)]);assert.equal(attempts,1);
  const current=await loadStoredCases(env);current[0].steps=[{id:'board_approved',done:true}];await saveStoredCases(env,current);
  await runGuestReminders(env,new Date('2026-09-10T12:00:00Z'),send);assert.equal(attempts,1);
  const canceled=await loadStoredCases(env);canceled[0].status='canceled';canceled[0].steps=[];await saveStoredCases(env,canceled);
  await runGuestReminders(env,new Date('2026-09-11T12:00:00Z'),send);assert.equal(attempts,1);
});
test('a case deleted after claiming a reminder is suppressed without dereferencing missing state',async()=>{
  const {env,requestEmail}=await setup();assert.equal((await requestEmail()).status,303);
  const cases=await loadStoredCases(env);cases[0].screeningRoute='paper';await saveStoredCases(env,cases);
  const original=env.CASE_STORE.get;let deleted=false;
  env.CASE_STORE.get=(name)=>({fetch:async(url,options)=>{
    const response=await original(name).fetch(url,options);
    if(!deleted&&options?.method==='PATCH'&&options.body.includes('"state":"claimed"')) {
      deleted=true;const current=await loadStoredCases(env);current.splice(0,1);await saveStoredCases(env,current);
    }
    return response;
  }});
  const result=await runGuestReminders(env,NOW,async()=>assert.fail('deleted case must not send'));
  assert.equal(result.suppressed,1);assert.equal((await loadStoredCases(env)).length,0);
});

test('new delivery holds, changed claims, disabled automation and a newer cooldown stop a claimed reminder',async()=>{
  for(const change of [
    (c,env)=>{env.AUTO_GUEST_REMINDERS='no';},
    c=>{c.automation.reminderClaim.id='replacement-claim';},
    c=>{c.automation.reminderClaim.state='uncertain';},
    c=>{c.automation.reminderAttempts[0].deliveryNotices={synthetic:{reviewedAt:null}};},
    c=>{c.automation.lastGuestReminderAt=NOW.toISOString();},
  ]) {
    const {env,requestEmail}=await setup();await requestEmail();
    const cases=await loadStoredCases(env);cases[0].screeningRoute='paper';await saveStoredCases(env,cases);
    const original=env.CASE_STORE.get;let changed=false,expectedCooldown;
    env.CASE_STORE.get=name=>({fetch:async(url,options)=>{
      const response=await original(name).fetch(url,options);
      if(!changed&&options?.method==='PATCH'&&options.body.includes('"state":"claimed"')) {
        changed=true;const current=await loadStoredCases(env);change(current[0],env);expectedCooldown=current[0].automation.lastGuestReminderAt;await saveStoredCases(env,current);
      }
      return response;
    }});
    const result=await runGuestReminders(env,NOW,async()=>assert.fail('claimed reminder must respect its latest hold'));
    assert.equal(result.sent,0);assert.equal(result.suppressed,1);
    assert.equal((await loadStoredCases(env))[0].automation.lastGuestReminderAt,expectedCooldown);
  }
});

test('loss of the case or claim during SMTP cannot be counted as a recorded reminder send',async()=>{
  for(const change of [
    cases=>{cases.splice(0,1);},
    cases=>{cases[0].automation.reminderClaim.id='replacement';},
    cases=>{cases[0].automation.reminderClaim.state='uncertain';},
  ]) {
    const {env,requestEmail}=await setup();await requestEmail();
    const cases=await loadStoredCases(env);cases[0].screeningRoute='paper';await saveStoredCases(env,cases);
    let sends=0;
    const result=await runGuestReminders(env,NOW,async()=>{
      sends++;const fresh=await loadStoredCases(env);change(fresh);await saveStoredCases(env,fresh);
    });
    assert.equal(sends,1);assert.equal(result.sent,0);assert.equal(result.uncertain,1);
    const [saved]=await loadStoredCases(env);assert.equal(saved?.automation.lastGuestReminderAt,undefined);
  }
});
