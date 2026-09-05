import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileBookingUpdate,acknowledgeBookingChange} from '../functions/lib/booking-reconcile.js';
import {planGuestJourney} from '../functions/lib/journey.js';
import {findStalledWork} from '../functions/lib/automation-health.js';

const base=()=>({id:'case-a',reservationCode:'HMTEST000001',guestName:'Synthetic Guest',checkIn:'2026-10-01',checkOut:'2026-11-01',adults:1,nights:31,
  steps:[{id:'forms_sent',done:true,date:'2026-09-01'},{id:'fee_sent',done:true,date:'2026-09-02'},{id:'board_approved',done:true,date:'2026-09-03'}],
  submission:{sentAt:'2026-09-03T00:00:00Z',packageId:'old'},workflowRevision:2});
test('unchanged duplicate booking confirmation is idempotent',()=>{const c=base();assert.deepEqual(reconcileBookingUpdate(c,{code:c.reservationCode,guestName:c.guestName,checkIn:c.checkIn,checkOut:c.checkOut,adults:c.adults}),{changed:false});assert.equal(c.workflowRevision,2);});
test('changed booking confirmation invalidates stale work without cancellation or approval',()=>{
  const c=base(),result=reconcileBookingUpdate(c,{code:c.reservationCode,guestName:'Synthetic Guest',checkIn:'2026-10-08',checkOut:'2026-11-08',adults:2},new Date('2026-09-05T12:00:00Z'));
  assert.equal(result.changed,true);assert.equal(c.status,undefined);assert.equal(c.submission,undefined);assert.equal(c.supersededSubmission.packageId,'old');assert.equal(c.bookingChange.pending,true);
  assert.equal(c.checkIn,'2026-10-08');assert.equal(c.adults,2);assert.equal(c.nights,31);assert.equal(c.workflowRevision,3);assert.equal(c.steps.every(s=>!s.done),true);assert.equal(c.steps[1].supersededAt,'2026-09-05T12:00:00.000Z');
  assert.equal(acknowledgeBookingChange(c,new Date('2026-09-05T13:00:00Z')),true);assert.equal(c.bookingChange.pending,false);assert.ok(c.bookingChange.acknowledgedAt);
});
test('pending booking changes halt guest reminders until owner acknowledgement',()=>{const c=base();reconcileBookingUpdate(c,{code:c.reservationCode,guestName:c.guestName,checkIn:'2026-10-08',checkOut:'2026-11-08',adults:1});assert.equal(planGuestJourney(c,new Date('2026-09-05')).exception,'booking_changed');});
test('malformed or unrelated confirmation never mutates a case',()=>{const c=base(),snapshot=structuredClone(c);assert.equal(reconcileBookingUpdate(c,{code:'HMOTHER000002',guestName:'Other',checkIn:'2026-10-08',checkOut:'2026-11-08',adults:2}).changed,false);assert.deepEqual(c,snapshot);});

test('booking changes preserve unresolved delivery locks and package references after acknowledgement',()=>{
  for(const phase of [undefined,'preparation_failed','delivery_uncertain']) {
    const c=base();delete c.submission;
    c.reviewLockedAt='2026-09-05T11:00:00Z';
    c.preparedPackage={id:'original-package',packageHash:'original-bytes'};
    if(phase)c.submissionError={phase,at:'2026-09-05T11:01:00Z',message:'synthetic error'};
    const update={code:c.reservationCode,guestName:c.guestName,checkIn:'2026-10-08',checkOut:'2026-11-08',adults:2};
    assert.equal(reconcileBookingUpdate(c,update,new Date('2026-09-05T11:02:00Z')).changed,true);
    assert.equal(c.reviewLockedAt,'2026-09-05T11:00:00Z');
    assert.equal(c.submissionError.phase,'delivery_uncertain');
    assert.equal(c.submissionError.packageId,'original-package');
    assert.equal(c.submissionError.packageHash,'original-bytes');
    assert.equal(c.preparedPackage,undefined);
    acknowledgeBookingChange(c);
    assert.equal(planGuestJourney(c,new Date('2026-09-05')).exception,'delivery_reconciliation');
    assert.equal(findStalledWork([c],new Date('2026-09-05T11:03:00Z')).hoaDelivery,1);
    reconcileBookingUpdate(c,{...update,adults:1});
    assert.equal(c.submissionError.packageId,'original-package');
    assert.equal(c.reviewLockedAt,'2026-09-05T11:00:00Z');
  }
});

test('a confirmed delivery can be superseded without leaving an unresolved lock',()=>{
  const c=base();c.reviewLockedAt='2026-09-03T00:00:00Z';
  reconcileBookingUpdate(c,{code:c.reservationCode,guestName:c.guestName,checkIn:'2026-10-08',checkOut:'2026-11-08',adults:1});
  assert.equal(c.reviewLockedAt,undefined);assert.equal(c.submissionError,undefined);
  assert.equal(c.supersededSubmission.packageId,'old');
});
