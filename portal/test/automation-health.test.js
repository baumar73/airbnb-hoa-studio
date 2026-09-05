import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./loaders/cloudflare-sockets-loader.mjs',import.meta.url);
const {runAutomationCycle,automationHealth,findStalledWork,notifyAutomationFailure,readAutomationStatus}=await import('../functions/lib/automation-health.js');
const {onRequest}=await import('../functions/[[path]].js');
const at='2026-09-05T12:00:00Z';
function fixture(){
  const values=new Map(),calls=[],notifications=[];
  const env={CASES:{get:async k=>values.get(k)||null,put:async(k,v)=>values.set(k,v)},ADMIN_USER:'owner',ADMIN_PASSWORD:'synthetic-only'};
  const jobs={mail:async()=>calls.push('mail'),reminders:async()=>calls.push('reminders'),submissions:async()=>calls.push('submissions'),inspect:async()=>[],notify:async text=>{notifications.push(text);return true;}};
  return {env,values,calls,notifications,jobs};
}
test('mail failure stops downstream sends, records its stage and alerts only after repetition',async()=>{
  const {env,jobs,calls,notifications}=fixture();
  jobs.mail=async()=>{calls.push('mail');throw new Error('credential and private guest data must not escape');};
  const first=await runAutomationCycle(env,jobs,new Date(at));
  assert.equal(first.state,'failed');assert.equal(first.stage,'mail');assert.equal(first.consecutiveFailures,1);
  assert.equal(notifications.length,0);assert.deepEqual(calls,['mail']);
  const second=await runAutomationCycle(env,jobs,new Date('2026-09-05T12:30:00Z'));
  assert.equal(second.consecutiveFailures,2);assert.equal(notifications.length,1);
  await runAutomationCycle(env,jobs,new Date('2026-09-05T13:00:00Z'));
  assert.equal(notifications.length,1);assert.doesNotMatch(JSON.stringify(second)+notifications.join(''),/credential|private guest/);
});
test('successful recovery runs in order and clears failure count without sending a recovery to-do',async()=>{
  const {env,jobs,calls,notifications}=fixture();
  jobs.reminders=async()=>{throw new Error('synthetic');};
  assert.equal((await runAutomationCycle(env,jobs,new Date(at))).stage,'reminders');
  jobs.reminders=async()=>calls.push('reminders');calls.length=0;
  const status=await runAutomationCycle(env,jobs,new Date('2026-09-05T12:30:00Z'));
  assert.deepEqual(calls,['mail','reminders','submissions']);assert.equal(status.consecutiveFailures,0);
  assert.equal(automationHealth(status,new Date('2026-09-05T13:00:00Z')).ok,true);
  assert.equal(automationHealth(status,new Date('2026-09-05T14:01:00Z')).reason,'stale');
  assert.equal(notifications.length,0);
});
test('diagnostics retain safe stage counts and explicit enabled flags, never arbitrary job output',async()=>{
  const {env,jobs}=fixture();env.AUTO_GUEST_REMINDERS='yes';
  jobs.reminders=async()=>({sent:2,waitingForContact:3,email:'private@example.test',password:'never-store'});
  jobs.mail=async()=>({bookings:1,hoaLinked:2,hoaUnassigned:1,body:'never-store'});
  const status=await runAutomationCycle(env,jobs,new Date(at));
  assert.deepEqual(status.results.reminders,{sent:2,waitingForContact:3});
  assert.deepEqual(status.results.mail,{bookings:1,hoaLinked:2,hoaUnassigned:1});
  assert.deepEqual(status.enabled,{guestReminders:true,hoaSubmission:false});
  assert.doesNotMatch(JSON.stringify(status),/private@example|never-store/);
});
test('stuck claims are counted even after cancellation, never automatically unlocked or resent',async()=>{
  const cases=[{status:'canceled',automation:{reminderClaim:{state:'claimed',claimedAt:'2026-09-05T10:00:00Z'}}},{automation:{reminderClaim:{state:'uncertain'}}},{reviewLockedAt:'2026-09-05T10:00:00Z'},{reviewLockedAt:'2026-09-05T10:00:00Z',submission:{sentAt:at}},{automation:{reminderClaim:{state:'claimed',claimedAt:'2026-09-05T11:59:00Z'}}}];
  const original=structuredClone(cases);
  assert.deepEqual(findStalledWork(cases,new Date(at)),{reminderDelivery:2,hoaDelivery:1});assert.deepEqual(cases,original);
  const {env,jobs,notifications}=fixture();jobs.inspect=async()=>cases;
  const status=await runAutomationCycle(env,jobs,new Date(at));
  assert.equal(automationHealth(status,new Date(at)).reason,'delivery_reconciliation');assert.equal(notifications.length,1);
});
test('missing heartbeat is unhealthy and failed notification does not consume its cooldown',async()=>{
  assert.equal(automationHealth(null,new Date(at)).ok,false);
  const {env,jobs}=fixture();jobs.mail=async()=>{throw new Error('synthetic');};jobs.notify=async()=>false;
  await runAutomationCycle(env,jobs,new Date(at));
  const status=await runAutomationCycle(env,jobs,new Date('2026-09-05T12:30:00Z'));
  assert.equal(status.lastAlertAt,undefined);
  let sent=0;await notifyAutomationFailure(env,status,new Date('2026-09-05T13:00:00Z'),async()=>{sent++;return true;});assert.equal(sent,1);
});
test('corrupt persisted automation status is treated as absent so the next cycle can recover',async()=>{
  const {env,jobs,values}=fixture();values.set('automation-health-v1','{"state":');
  assert.equal(await readAutomationStatus(env),null);
  const status=await runAutomationCycle(env,jobs,new Date(at));
  assert.equal(status.state,'completed');assert.equal(JSON.parse(values.get('automation-health-v1')).state,'completed');
});
test('public health exposes no details and detailed status requires owner credentials',async()=>{
  const {env,jobs}=fixture();await runAutomationCycle(env,jobs,new Date());
  const request=(path,auth)=>onRequest({env,request:new Request('https://portal.example.test'+path,{headers:auth?{Authorization:auth}:{}})});
  const publicResponse=await request('/automation-healthz');assert.equal(publicResponse.status,200);assert.equal(await publicResponse.text(),'ok');
  assert.equal((await request('/admin/automation-health')).status,401);
  assert.equal((await request('/admin/automation-health','Bearer '+'x'.repeat(40))).status,401);
  const admin=await request('/admin/automation-health','Basic '+btoa('owner:synthetic-only'));assert.equal(admin.status,200);
  assert.equal((await admin.json()).status.state,'completed');
});
test('opt-in cloud health flags an absent local reviewer even when other stages succeed',async()=>{
  const {env,jobs,notifications}=fixture();env.REVIEW_RELIABILITY='yes';
  const status=await runAutomationCycle(env,jobs,new Date(at));
  assert.equal(status.reviewer.offline,true);
  assert.equal(automationHealth(status,new Date(at)).reason,'reviewer_unavailable');
  assert.equal(notifications.length,1);
});
test('enabled reminders without a recipient make health actionable until the next successful check',async()=>{
  const {env,jobs,notifications}=fixture();env.AUTO_GUEST_REMINDERS='yes';
  jobs.reminders=async()=>({waitingForContact:1});
  const status=await runAutomationCycle(env,jobs,new Date(at));
  assert.equal(automationHealth(status,new Date(at)).reason,'guest_contact_unavailable');
  assert.equal(notifications.length,1);assert.match(notifications[0],/Airbnb/);
  await runAutomationCycle(env,jobs,new Date('2026-09-05T12:30:00Z'));assert.equal(notifications.length,1);
  jobs.reminders=async()=>({waitingForContact:0});
  const recovered=await runAutomationCycle(env,jobs,new Date('2026-09-05T13:00:00Z'));
  assert.equal(automationHealth(recovered,new Date('2026-09-05T13:00:00Z')).ok,true);
  env.AUTO_GUEST_REMINDERS='no';jobs.reminders=async()=>({waitingForContact:1});
  const disabled=await runAutomationCycle(env,jobs,new Date('2026-09-05T13:30:00Z'));
  assert.equal(automationHealth(disabled,new Date('2026-09-05T13:30:00Z')).ok,true);
});
