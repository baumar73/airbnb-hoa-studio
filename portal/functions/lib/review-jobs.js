import {needsReview,reviewContextHash} from './review.js';
import {getEncryptedSecret} from './storage.js';
import {isValidISODate} from './workflow.js';

const MINUTE=60000;
const HEARTBEAT='reviewer-heartbeat-v1';
const time=value=>Date.parse(value||'')||0;
const attempts=value=>Number.isSafeInteger(value)&&value>=0?Math.min(100000,value):0;
const delay=attempt=>Math.min(360,5*2**Math.min(7,Math.max(0,attempts(attempt)-1)))*MINUTE;
const same=(c,context)=>c.reviewJob?.reviewHash===c.reviewHash&&c.reviewJob?.contextHash===context;

async function readReviewerHeartbeat(env,now) {
  // Diagnostic data must not prevent the reviewer from reporting recovery.
  // Storage/network failures still propagate; only malformed contents become
  // absent. Keep an explicit allowlist so arbitrary persisted text stays private.
  const raw=await env.CASES.get(HEARTBEAT);
  let value;
  try {value=JSON.parse(raw||'null');} catch {return null;}
  if(!value||Array.isArray(value)||typeof value!=='object'||!['started','completed','failed'].includes(value.state))return null;
  const stamp=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(s)&&Number.isFinite(Date.parse(s))&&Date.parse(s)<=now.getTime()+5*MINUTE?new Date(s).toISOString():undefined;
  const seenAt=stamp(value.seenAt),completed=stamp(value.lastCompletedAt);
  if(!seenAt)return null;
  return {state:value.state,seenAt,lastCompletedAt:completed&&Date.parse(completed)<=Date.parse(seenAt)?completed:undefined};
}

export function completedReview(c,context) {
  return !!c.preparedPackage && c.aiReview?.reviewHash===c.reviewHash &&
    c.aiReview?.reviewContextHash===context && c.aiReview?.packageId===c.preparedPackage.id &&
    c.aiReview?.packageHash===c.preparedPackage.packageHash;
}
export function reviewAvailable(c,context,now=new Date()) {
  return !!needsReview(c)&&!completedReview(c,context)&&
    (!same(c,context)||time(c.reviewJob.nextAttemptAt)<=now.getTime());
}
export function claimReview(c,context,now=new Date()) {
  if(!reviewAvailable(c,context,now)) return null;
  const attempt=same(c,context)?Math.min(100000,attempts(c.reviewJob.attempt)+1):1;
  const leaseUntil=new Date(now.getTime()+15*MINUTE).toISOString();
  c.reviewJob={state:'claimed',token:crypto.randomUUID(),reviewHash:c.reviewHash,contextHash:context,attempt,
    claimedAt:now.toISOString(),leaseUntil,nextAttemptAt:new Date(time(leaseUntil)+delay(attempt)).toISOString()};
  return c.reviewJob;
}
export function ownsReview(c,context,token,now=new Date()) {
  return !!needsReview(c)&&same(c,context)&&typeof token==='string'&&token===c.reviewJob.token&&
    c.reviewJob.state==='claimed'&&time(c.reviewJob.leaseUntil)>now.getTime();
}
export function failReview(c,now=new Date()) {
  c.reviewJob={...c.reviewJob,state:'waiting',failedAt:now.toISOString(),nextAttemptAt:new Date(now.getTime()+delay(c.reviewJob.attempt)).toISOString()};
}
export async function recordReviewerHeartbeat(env,state,now=new Date()) {
  if(!['started','completed','failed'].includes(state)) throw new Error('invalid reviewer state');
  const previous=await readReviewerHeartbeat(env,now);
  const status={state,seenAt:now.toISOString(),lastCompletedAt:state==='completed'?now.toISOString():previous?.lastCompletedAt};
  // Diagnostics only, never a lease or delivery authorization.
  await env.CASES.put(HEARTBEAT,JSON.stringify(status));
  return status;
}
export async function reviewBacklog(env,cases,now=new Date()) {
  const heartbeat=await readReviewerHeartbeat(env,now);
  const owner=await getEncryptedSecret(env,'owner-signature-png');
  const compliance=JSON.parse(await env.CASES.get('compliance-config')||'{}');
  let pending=0,urgent=0,stalled=0;
  for(const c of cases) {
    if(!needsReview(c)) continue;
    if(isValidISODate(c.checkOut)&&c.checkOut<now.toISOString().slice(0,10)) continue;
    const context=await reviewContextHash(c,owner,compliance);
    if(completedReview(c,context)) continue;
    pending++;
    // Operational warning horizon, NOT an assertion of an HOA/legal deadline.
    if(time(c.checkIn+'T12:00:00Z')>0&&time(c.checkIn+'T12:00:00Z')<=now.getTime()+7*24*60*MINUTE) urgent++;
    if((same(c,context)&&c.reviewJob.attempt>=3)||now.getTime()-time(c.ownerReviewReadyAt)>24*60*MINUTE) stalled++;
  }
  const offline=now.getTime()-time(heartbeat?.seenAt)>90*MINUTE;
  const noProgress=now.getTime()-time(heartbeat?.lastCompletedAt)>90*MINUTE;
  return {pending,urgent,stalled,offline,noProgress,unhealthy:offline||noProgress||stalled>0,
    lastSeenAt:heartbeat?.seenAt,lastCompletedAt:heartbeat?.lastCompletedAt};
}
