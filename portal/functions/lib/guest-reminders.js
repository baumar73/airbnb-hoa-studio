import {loadStoredCases,saveStoredCases} from './storage.js';
import {reminderDeliveryTarget} from './guest-contact.js';
import {planGuestJourney,guestReminderMessage} from './journey.js';
import {sendViaGmail} from './email.js';
import {externalFeeRequestAuthorized} from './compliance.js';
import {recipientDigest} from './reminder-delivery.js';

async function recordResult(env,id,claimId,state,now) {
  for(let attempt=0;attempt<4;attempt++) {
    const cases=await loadStoredCases(env),c=cases.find(c=>c.id===id);
    if(!c || c.automation?.reminderClaim?.id!==claimId) return false;
    c.automation.reminderClaim.state=state;
    const attempt=c.automation.reminderAttempts?.find(a=>a.id===claimId);
    if(attempt) attempt.state=state;
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
    if((c.automation?.reminderAttempts||[]).some(a=>Object.values(a.deliveryNotices||{}).some(n=>!n.reviewedAt))) { result.uncertain++; continue; }
    const compliance=JSON.parse(await env.CASES.get('compliance-config')||'{}');
    const plan=planGuestJourney(c,now,{feeRequestAuthorized:externalFeeRequestAuthorized(c,compliance)}),claim=c.automation?.reminderClaim;
    if(!plan.guestTasks.length||!plan.nextReminderAt||new Date(plan.nextReminderAt)>now) continue;
    if(claim && ['claimed','uncertain'].includes(claim.state)) {result.uncertain++;continue;}
    const target=reminderDeliveryTarget(c,env,now);
    // Without a direct address, only an enabled, owner-verified Airbnb reply
    // route is usable. Never invent a recipient or substitute an owner alert.
    if(!target) {result.waitingForContact++;continue;}
    const claimId=crypto.randomUUID();
    const messageId=`<${claimId}@${origin.hostname}>`;
    const attempt={id:claimId,state:'claimed',channel:target.channel,messageId,recipientHash:await recipientDigest(target.to),claimedAt:now.toISOString(),tasks:plan.guestTasks.map(t=>t.id)};
    c.automation={...c.automation,reminderClaim:{id:claimId,state:'claimed',channel:target.channel,messageId,claimedAt:now.toISOString(),tasks:attempt.tasks},reminderAttempts:[...(c.automation?.reminderAttempts||[]),attempt].slice(-100)};
    try {await saveStoredCases(env,cases);}
    catch(error) {if(error.code==='CASE_CONFLICT'){result.conflicts++;continue;}throw error;}
    const latest=(await loadStoredCases(env)).find(c=>c.id===id);
    if(!latest) { result.suppressed++; continue; }
    const current=latest && planGuestJourney(latest,now,{feeRequestAuthorized:externalFeeRequestAuthorized(latest,JSON.parse(await env.CASES.get('compliance-config')||'{}'))});
    if(!current?.guestTasks.length || reminderDeliveryTarget(latest,env,now)?.key!==target.key) {
      await recordResult(env,id,claimId,'suppressed',now);result.suppressed++;continue;
    }
    try {
      const message=guestReminderMessage(current,origin.origin);
      if(target.channel==='airbnb_relay')Object.assign(message,{subject:target.subject,inReplyTo:target.inReplyTo,references:target.references});
      await send(env,{to:[target.to],cc:[],...message,messageId});
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
