import test from 'node:test';
import assert from 'node:assert/strict';
import {claimReview,reviewAvailable,ownsReview,failReview,completedReview,reviewBacklog,recordReviewerHeartbeat} from '../functions/lib/review-jobs.js';
const now=new Date('2026-09-05T12:00:00Z');
const fixture=()=>({id:'synthetic',wizard:{},reviewHash:'content',ownerReviewReadyAt:'2026-09-04',pathType:'guest-registration',checkIn:'2026-09-06'});
test('review leases survive restart, expire with backoff and fence the old worker',()=>{
  const c=fixture();assert.equal(reviewAvailable(c,'context',now),true);
  const first=claimReview(c,'context',now);
  assert.equal(reviewAvailable(structuredClone(c),'context',now),false);
  assert.equal(ownsReview(c,'context',first.token,now),true);
  assert.equal(ownsReview(c,'context',first.token,new Date('2026-09-05T12:16Z')),false);
  assert.equal(reviewAvailable(c,'context',new Date('2026-09-05T12:19Z')),false);
  const second=claimReview(c,'context',new Date('2026-09-05T12:21Z'));
  assert.equal(second.attempt,2);assert.notEqual(second.token,first.token);
  assert.equal(ownsReview(c,'context',first.token,new Date('2026-09-05T12:22Z')),false);
});
test('failures back off but a changed revision can proceed; cancellation cannot',()=>{
  const c=fixture();claimReview(c,'old',now);failReview(c,now);
  assert.equal(c.reviewJob.state,'waiting');assert.equal(reviewAvailable(c,'old',now),false);
  assert.equal(reviewAvailable(c,'new',now),true);
  assert.equal(claimReview(c,'new',now).attempt,1);
  c.status='canceled';assert.equal(reviewAvailable(c,'new',new Date('2027-01-01')),false);
});
test('completed reviews include exact package hash and are not queued again',()=>{
  const c=fixture();c.preparedPackage={id:'p',packageHash:'bytes'};
  c.aiReview={reviewHash:'content',reviewContextHash:'context',packageId:'p',packageHash:'bytes'};
  assert.equal(completedReview(c,'context'),true);assert.equal(reviewAvailable(c,'context',now),false);
  c.preparedPackage.packageHash='changed';assert.equal(completedReview(c,'context'),false);
});
test('backlog detects stalled progress and near arrivals without retaining guest details',async()=>{
  const c=fixture();c.guestName='private guest';
  const env={CASES:{get:async()=>null}};
  const status=await reviewBacklog(env,[c],now);
  assert.equal(status.pending,1);assert.equal(status.urgent,1);assert.equal(status.unhealthy,true);
  assert.doesNotMatch(JSON.stringify(status),/private guest|synthetic/);
  assert.equal((await reviewBacklog(env,[],now)).unhealthy,true);
});
test('past stays do not inflate review backlog, while missing dates remain visible',async()=>{
  const env={CASES:{get:async()=>null}};
  const past={...fixture(),checkOut:'2026-09-04'};
  assert.equal((await reviewBacklog(env,[past],now)).pending,0);
  for(const checkOut of [undefined,'invalid','2026-09-05','2026-09-06']) {
    assert.equal((await reviewBacklog(env,[{...past,checkOut}],now)).pending,1);
  }
});
test('a reachable reviewer is not healthy if it never completes a scan',async()=>{
  const values=new Map();const env={CASES:{get:async k=>values.get(k)||null,put:async(k,v)=>values.set(k,v)}};
  await recordReviewerHeartbeat(env,'failed',now);
  assert.equal((await reviewBacklog(env,[],now)).unhealthy,true);
  await recordReviewerHeartbeat(env,'completed',now);
  assert.equal((await reviewBacklog(env,[],now)).unhealthy,false);
  assert.equal((await reviewBacklog(env,[],new Date('2026-09-05T14:00Z'))).unhealthy,true);
  await assert.rejects(()=>recordReviewerHeartbeat(env,'private data',now));
});
test('corrupt or invalid reviewer heartbeat remains unhealthy and recovers on a completed scan',async()=>{
  for(const corrupt of ['{','[]','true','null',JSON.stringify({state:'unknown',seenAt:now.toISOString()}),JSON.stringify({state:'completed',seenAt:'2999-01-01T00:00:00Z',lastCompletedAt:'2999-01-01T00:00:00Z'}),JSON.stringify({state:'completed',seenAt:{secret:'private'}})]) {
    const values=new Map([['reviewer-heartbeat-v1',corrupt]]);
    const env={CASES:{get:async k=>values.get(k)||null,put:async(k,v)=>values.set(k,v)}};
    const before=await reviewBacklog(env,[],now);
    assert.equal(before.offline,true);assert.equal(before.unhealthy,true);
    await recordReviewerHeartbeat(env,'started',now);
    assert.equal((await reviewBacklog(env,[],now)).noProgress,true);
    await recordReviewerHeartbeat(env,'completed',now);
    assert.equal((await reviewBacklog(env,[],now)).unhealthy,false);
    assert.doesNotMatch(values.get('reviewer-heartbeat-v1'),/private|secret|2999/);
  }
});
test('malformed completion times cannot confer progress or escape into status diagnostics',async()=>{
  for(const completed of [{private:'never-publish'},'not-a-date','2999-01-01T00:00:00Z','2026-09-05T12:01:00Z']) {
    const values=new Map([['reviewer-heartbeat-v1',JSON.stringify({state:'completed',seenAt:now.toISOString(),lastCompletedAt:completed,extra:'never-publish'})]]);
    const env={CASES:{get:async k=>values.get(k)||null,put:async(k,v)=>values.set(k,v)}};
    const status=await reviewBacklog(env,[],now);
    assert.equal(status.offline,false);assert.equal(status.noProgress,true);assert.equal(status.unhealthy,true);
    assert.doesNotMatch(JSON.stringify(status),/never-publish|2999/);
    await recordReviewerHeartbeat(env,'failed',now);
    assert.equal(JSON.parse(values.get('reviewer-heartbeat-v1')).lastCompletedAt,undefined);
  }
});
test('reviewer storage failure stays observable rather than becoming a healthy heartbeat',async()=>{
  const env={CASES:{get:async()=>{throw Error('synthetic store outage');},put:async()=>assert.fail('must not write through a failed read')}};
  await assert.rejects(reviewBacklog(env,[],now),/synthetic store outage/);
  await assert.rejects(recordReviewerHeartbeat(env,'completed',now),/synthetic store outage/);
});
test('valid last completion survives start/failure updates without extending its timestamp',async()=>{
  const values=new Map();const env={CASES:{get:async k=>values.get(k)||null,put:async(k,v)=>values.set(k,v)}};
  await recordReviewerHeartbeat(env,'completed',now);
  await recordReviewerHeartbeat(env,'started',new Date(+now+30*60000));
  await recordReviewerHeartbeat(env,'failed',new Date(+now+60*60000));
  assert.equal(JSON.parse(values.get('reviewer-heartbeat-v1')).lastCompletedAt,now.toISOString());
  assert.equal((await reviewBacklog(env,[],new Date(+now+91*60000))).noProgress,true);
});
