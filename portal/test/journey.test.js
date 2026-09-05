import test from 'node:test';
import assert from 'node:assert/strict';
import {planGuestJourney} from '../functions/lib/journey.js';

const now=new Date('2026-09-05T12:00:00Z');
const booking=()=>({id:'synthetic',pathType:'full',screeningRoute:'paper',checkIn:'2026-11-01',checkOut:'2026-12-01',createdAt:'2026-09-01T12:00:00Z',adults:1,steps:[]});
test('guest receives concrete missing tasks, not owner reminders to chase the guest',()=>{
  const c=booking();c.wizard={adults:[{firstName:'Jane'}]};
  const p=planGuestJourney(c,now);
  assert.equal(p.state,'waiting_for_guest');
  assert.ok(p.guestTasks.find(t=>t.id==='paperwork').missing.includes('adult 1 lastName'));
  assert.ok(p.guestTasks.find(t=>t.id==='payment'));
  assert.ok(p.guestTasks.find(t=>t.id==='secure_ids'));
  assert.equal(p.nextReminderAt,now.toISOString());
});
test('external route never demands duplicate local paperwork or a paper check',()=>{
  const c=booking();c.screeningRoute='online';
  const p=planGuestJourney(c,now);
  assert.deepEqual(p.guestTasks.map(t=>t.id),['external_application']);
  assert.equal(p.guestTasks[0].includesPayment,true);
});
test('guest reports are not treated as payment receipt or external completion',()=>{
  const c=booking();c.feeMailed='2026-09-04T00:00:00Z';
  const p=planGuestJourney(c,now);
  assert.equal(p.guestTasks.some(t=>t.id==='payment'),false);
  assert.ok(p.waitingForEvidence.includes('association_payment_receipt'));
  c.screeningRoute='online';c.screeningReportedAt='2026-09-04T00:00:00Z';
  const external=planGuestJourney(c,now);
  assert.equal(external.state,'waiting_for_evidence');
  assert.deepEqual(external.waitingForEvidence,['external_application_completion']);
  assert.equal(external.nextReminderAt,null);
});
test('canceled and completed stays stop guest follow-up',()=>{
  for (const c of [{...booking(),status:'canceled'},{...booking(),checkOut:'2026-09-01'}]) {
    const p=planGuestJourney(c,now);
    assert.equal(p.guestTasks.length,0);assert.equal(p.nextReminderAt,null);
  }
});
test('late or partial responses recompute tasks while reminders respect cooldown',()=>{
  const c=booking();c.automation={lastGuestReminderAt:'2026-09-04T12:00:00Z'};
  c.steps=[{id:'ids_provided',done:true},{id:'fee_sent',done:true},{id:'screening_complete',done:true}];
  const p=planGuestJourney(c,now);
  assert.deepEqual(p.guestTasks.map(t=>t.id),['paperwork']);
  assert.equal(p.nextReminderAt,'2026-09-07T12:00:00.000Z');
});
test('submission waits for HOA and cannot be confused with approval',()=>{
  const c=booking();c.submission={sentAt:'2026-09-01T00:00:00Z'};
  assert.equal(planGuestJourney(c,now).state,'waiting_for_hoa');
  c.steps=[{id:'board_approved',done:true}];
  assert.equal(planGuestJourney(c,now).state,'approved');
});
test('uncertain delivery is an exception, never an automatic resend',()=>{
  const c=booking();c.reviewLockedAt='2026-09-04T00:00:00Z';c.submissionError={phase:'delivery_uncertain'};
  const p=planGuestJourney(c,now);
  assert.equal(p.state,'exception');assert.equal(p.exception,'delivery_reconciliation');
  assert.equal(p.nextReminderAt,null);
});
