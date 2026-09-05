import {reviewBacklog} from './review-jobs.js';
// Diagnostic metadata only. This eventually consistent KV record must NEVER
// authorize a send, unlock a claim or replace atomic per-case delivery state.
const KEY='automation-health-v1';
const MINUTE=60000;
const age=(value,now)=>{const parsed=Date.parse(value||'');return Number.isFinite(parsed)?now.getTime()-parsed:Infinity;};
const save=(env,status)=>env.CASES.put(KEY,JSON.stringify(status));
const safeCounts=result=>Object.fromEntries(['sent','waitingForContact','conflicts','uncertain','suppressed','deliveryNotices','bookingChanges','created','bookings','cancellations','approvals','alerts','news','released','skipped','hoaLinked','hoaUnassigned'].filter(k=>Number.isSafeInteger(result?.[k])&&result[k]>=0).map(k=>[k,result[k]]));

export async function readAutomationStatus(env) {
  const raw=await env.CASES.get(KEY);
  if(!raw)return null;
  try { return JSON.parse(raw); }
  catch { return null; }
}

export function findStalledWork(cases,now=new Date()) {
  const result={reminderDelivery:0,hoaDelivery:0};
  for(const c of cases) {
    const claim=c.automation?.reminderClaim;
    // Cancellation stops new work, but does not resolve a send already begun.
    if(claim?.state==='uncertain'||(claim?.state==='claimed'&&age(claim.claimedAt,now)>15*MINUTE)||
      (c.automation?.reminderAttempts||[]).some(a=>Object.values(a.deliveryNotices||{}).some(n=>!n.reviewedAt))) result.reminderDelivery++;
    if(!c.submission && (c.submissionError?.phase==='delivery_uncertain'||(c.reviewLockedAt&&age(c.reviewLockedAt,now)>15*MINUTE))) result.hoaDelivery++;
  }
  return result;
}

export function automationHealth(status,now=new Date()) {
  if(!status) return {ok:false,reason:'not_started'};
  if(age(status.lastSuccessAt,now)>90*MINUTE) return {ok:false,reason:'stale'};
  if(status.state==='failed') return {ok:false,reason:'stage_failed'};
  if(status.state==='running'&&age(status.startedAt,now)>15*MINUTE) return {ok:false,reason:'stalled'};
  if(status.stalled?.reminderDelivery||status.stalled?.hoaDelivery) return {ok:false,reason:'delivery_reconciliation'};
  if(status.reviewer?.unhealthy) return {ok:false,reason:'reviewer_unavailable'};
  if(status.enabled?.guestReminders&&status.results?.reminders?.waitingForContact>0) return {ok:false,reason:'guest_contact_unavailable'};
  return {ok:true,reason:'ok'};
}

export async function notifyAutomationFailure(env,status,now,notify) {
  if(!status) return;
  const health=automationHealth(status,now);
  // One transient failure stays quiet. Persistent failure, a stale successful
  // heartbeat or uncertain delivery is a genuine exception, not a guest to-do.
  const missingContact=status.enabled?.guestReminders&&status.results?.reminders?.waitingForContact>0;
  const actionable=missingContact||Boolean(status.reviewer?.unhealthy)||(status.consecutiveFailures>=2)||Boolean(status.stalled?.reminderDelivery||status.stalled?.hoaDelivery)||
    (status.lastSuccessAt&&age(status.lastSuccessAt,now)>90*MINUTE)||
    (status.state==='running'&&age(status.startedAt,now)>15*MINUTE);
  if(!actionable||health.ok||age(status.lastAlertAt,now)<24*60*MINUTE) return;
  try {
    if(await notify('⚠️ HOA-Automatik: Ein Hintergrundablauf oder der lokale Prüfdienst braucht Aufmerksamkeit. Technischen Status unter /admin/automation-health prüfen.'+(missingContact?' Mindestens ein Gast mit fälligen Aufgaben hat keinen nutzbaren aktivierten Versandweg. Unter /admin/cases die E-Mail-Erreichbarkeit oder verifizierte Airbnb-Antwortverbindung prüfen und nötigenfalls in der bestehenden Unterhaltung nachfassen.':'')+(status.reviewer?.urgent?' Offene Prüfungen betreffen Anreisen innerhalb von sieben Tagen.':'')+' Unklare Sendungen werden nicht automatisch erneut versendet.')) {
      status.lastAlertAt=now.toISOString();await save(env,status);
    }
  } catch { /* Leave cooldown open; the public health endpoint remains unhealthy. */ }
}

export async function runAutomationCycle(env,jobs,now=new Date()) {
  const previous=await readAutomationStatus(env);
  const status={state:'running',stage:'mail',startedAt:now.toISOString(),
    enabled:{guestReminders:env.AUTO_GUEST_REMINDERS==='yes',hoaSubmission:env.AUTO_HOA_SUBMIT==='yes'},results:{},
    consecutiveFailures:previous?.consecutiveFailures||0,lastSuccessAt:previous?.lastSuccessAt,
    lastAlertAt:previous?.lastAlertAt,stalled:previous?.stalled,reviewer:env.REVIEW_RELIABILITY==='yes'?previous?.reviewer:undefined};
  // Persist before work so abrupt termination is observable by the next check.
  await save(env,status);
  try {
    for(const stage of ['mail','reminders','submissions','inspect']) {
      status.stage=stage;await save(env,status);
      const result=await jobs[stage]();
      if(stage==='inspect') {
        status.stalled=findStalledWork(result,now);
        if(env.REVIEW_RELIABILITY==='yes') status.reviewer=await reviewBacklog(env,result,now);
      }
      else status.results[stage]=safeCounts(result);
    }
    status.state='completed';status.consecutiveFailures=0;status.lastSuccessAt=now.toISOString();
  } catch {
    // Never store transport error strings, mailbox contents, names or secrets.
    status.state='failed';status.consecutiveFailures++;
  }
  await save(env,status);
  await notifyAutomationFailure(env,status,now,jobs.notify);
  return status;
}
