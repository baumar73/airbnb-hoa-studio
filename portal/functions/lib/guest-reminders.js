import {loadStoredCases,saveStoredCases} from './storage.js';
import {validateEmailAddress} from './workflow.js';
import {planGuestJourney,guestReminderMessage} from './journey.js';
import {sendViaGmail} from './email.js';
import {externalFeeRequestAuthorized} from './compliance.js';

async function recordResult(env,id,claimId,state,now) {
  for(let attempt=0;attempt<4;attempt++) {
    const cases=await loadStoredCases(env),c=cases.find(c=>c.id===id);
    if(!c || c.automation?.reminderClaim?.id!==claimId) return false;
    c.automation.reminderClaim.state=state;
    if(state==='sent') c.automation.lastGuestReminderAt=now.toISOString();
    try {await saveStoredCases(env,cases);return true;}
    catch(error) {if(error.code!=='CASE_CONFLICT'||attempt===3) throw error;}
  }
}

export async function runGuestReminders(env,now=new Date(),send=sendViaGmail) {
  const result={sent:0,waitingForContact:0,conflicts:0,uncertain:0,suppressed:0};
  if(env.AUTO_GUEST_REMINDERS!=='yes') return {...result,disabled:true};
  if(!env.CASE_STORE || env.REQUIRE_ATOMIC_CASES!=='yes') throw new Error('Guest reminders require mandatory atomic storage');
  const origin=new URL(env.PORTAL_ORIGIN);
  if(origin.protocol!=='https:'||!origin.hostname.endsWith('.com')||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash) throw new Error('Configure the verified canonical HTTPS .com portal origin');
  const ids=(await loadStoredCases(env)).map(c=>c.id);
  for(const id of ids) {
    // Reload at claim time: old incomplete snapshots must not generate reminders.
    const cases=await loadStoredCases(env),c=cases.find(c=>c.id===id);
    if(!c) continue;
    const compliance=JSON.parse(await env.CASES.get('compliance-config')||'{}');
    const plan=planGuestJourney(c,now,{feeRequestAuthorized:externalFeeRequestAuthorized(c,compliance)}),claim=c.automation?.reminderClaim;
    if(!plan.guestTasks.length||!plan.nextReminderAt||new Date(plan.nextReminderAt)>now) continue;
    if(claim && ['claimed','uncertain'].includes(claim.state)) {result.uncertain++;continue;}
    const email=String(c.wizard?.adults?.[0]?.email||'').trim();
    // Before the guest supplies a contact address, the configured Airbnb
    // onboarding channel is required. Never invent a recipient or message owner
    // as a substitute for actually contacting the guest.
    if(!validateEmailAddress(email)) {result.waitingForContact++;continue;}
    const claimId=crypto.randomUUID();
    c.automation={...c.automation,reminderClaim:{id:claimId,state:'claimed',claimedAt:now.toISOString(),tasks:plan.guestTasks.map(t=>t.id)}};
    try {await saveStoredCases(env,cases);}
    catch(error) {if(error.code==='CASE_CONFLICT'){result.conflicts++;continue;}throw error;}
    const latest=(await loadStoredCases(env)).find(c=>c.id===id);
    const current=latest && planGuestJourney(latest,now,{feeRequestAuthorized:externalFeeRequestAuthorized(latest,JSON.parse(await env.CASES.get('compliance-config')||'{}'))});
    if(!current?.guestTasks.length || String(latest.wizard?.adults?.[0]?.email||'').trim()!==email) {
      await recordResult(env,id,claimId,'suppressed',now);result.suppressed++;continue;
    }
    try {
      await send(env,{to:[email],cc:[],...guestReminderMessage(current,origin.origin)});
    } catch {
      // SMTP can accept DATA before a connection fails. Do not blindly resend.
      try {await recordResult(env,id,claimId,'uncertain',now);} catch { /* persistent claim still prevents a duplicate */ }
      result.uncertain++;continue;
    }
    // If this write fails, the persistent claim deliberately remains blocked.
    // A reconciliation worker must inspect delivery before any retry.
    try {await recordResult(env,id,claimId,'sent',now);result.sent++;}
    catch {result.uncertain++;}
  }
  return result;
}
