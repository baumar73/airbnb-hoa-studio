import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewHoaEvidence,reportHoaTask} from '../functions/lib/hoa-evidence.js';
import {planGuestJourney,guestReminderMessage} from '../functions/lib/journey.js';

test('online application, partial follow-up, payment evidence, approval and later adverse response',()=>{
  // Synthetic local workflow, not a Tenant Evaluation integration or live acceptance.
  const now=new Date('2026-09-05T12:00:00Z');
  const c={id:'synthetic',guestName:'Jane Doe',reservationCode:'HMTEST000001',checkIn:'2026-10-01',checkOut:'2026-11-01',adults:1,pathType:'full',screeningRoute:'online',createdAt:'2026-09-01',steps:[],hoaMailEvents:[]};
  const plan=()=>planGuestJourney(c,now);
  let source=0;
  const review=input=>{
    const id=(++source).toString(16).padStart(64,'0');
    c.hoaMailEvents.push({id,reviewRequired:true,categories:['other']});
    const result=reviewHoaEvidence(c,id,{attested:true,by:'synthetic owner',...input},now);
    assert.equal(result.ok,true,result.error);return id;
  };
  assert.deepEqual(plan().guestTasks.map(t=>t.id),['external_application']);
  assert.match(guestReminderMessage(plan(),'https://example.com').text,/Do not also send a paper application fee/);
  c.screeningReportedAt=now.toISOString(); // Existing guest completion-report action.
  assert.equal(plan().state,'waiting_for_evidence');assert.equal(c.steps.some(s=>s.done),false);
  review({confirmations:['application_received'],requestedItems:['documents','payment']});
  assert.equal(plan().guestTasks.length,2);
  const [documents,payment]=c.hoaTasks;
  assert.equal(reportHoaTask(c,documents.id,documents.version,now).ok,true);
  assert.deepEqual(plan().guestTasks.map(t=>t.id),['hoa_task:'+payment.id]);
  assert.match(guestReminderMessage(plan(),'https://example.com').text,/Do not pay twice/);
  assert.equal(reportHoaTask(c,payment.id,payment.version,now).ok,true);
  assert.equal(plan().state,'waiting_for_evidence');assert.equal(c.steps.some(s=>s.id==='fee_sent'&&s.done),false);
  review({resolvedItems:[documents.id,payment.id],confirmations:['payment_received','documents_complete','application_complete']});
  assert.equal(plan().state,'waiting_for_hoa');assert.equal(plan().guestTasks.length,0);
  const approval=review({confirmations:['hoa_approved']});
  assert.equal(plan().state,'approved');assert.equal(c.hoaEvidence.hoa_approved.sourceId,approval);
  review({kind:'adverse_response'});
  assert.equal(plan().state,'exception');assert.equal(plan().exception,'hoa_adverse_response');
  assert.equal(c.steps.find(s=>s.id==='board_approved').done,false);
  assert.equal(c.hoaEvidence.hoa_approved.sourceId,approval);assert.ok(c.hoaEvidence.hoa_approved.disputedAt);
  assert.equal(c.submission,undefined);assert.equal(c.preparedPackage,undefined);
  c.status='canceled';assert.equal(plan().state,'canceled');assert.equal(plan().guestTasks.length,0);
});
