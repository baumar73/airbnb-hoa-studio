import test from 'node:test';
import assert from 'node:assert/strict';
import {bookingApprovalNotice} from '../functions/lib/booking-notice.js';

const authorized = {feeAuthorityCitation:'synthetic rule',airbnbFeeDisclosureVerifiedAt:'2026-09-05',airbnbExternalFeeAuthorizationReference:'synthetic exception'};
const pending = () => ({pathType:'full',screeningRoute:'paper',steps:[]});

test('notice distinguishes seven-day booking notice from HOA approval time', () => {
  const html=bookingApprovalNotice();
  assert.match(html,/at least 7 days/);
  assert.match(html,/up to 15 days/);
  assert.match(html,/not a guarantee/);
  assert.match(html,/before check-in/);
  assert.match(html,/not automatically cancel/);
});
test('unverified fees do not become immediate external payment demands', () => {
  const html=bookingApprovalNotice(pending());
  assert.match(html,/Do not make an off-platform payment/);
  assert.doesNotMatch(html,/Arrange payment promptly/);
});
test('authorized missing payment prompts action but reports and receipts prevent duplicate demands', () => {
  assert.match(bookingApprovalNotice(pending(),authorized),/Arrange payment promptly/);
  for(const c of [{...pending(),feeMailed:'2026-09-05'}, {...pending(),steps:[{id:'fee_sent',done:true}]}]) {
    const html=bookingApprovalNotice(c,authorized);
    assert.doesNotMatch(html,/Arrange payment promptly/);
    assert.match(html,/Do not pay again/);
  }
});
test('online applicants and same-lessee renewals never receive a duplicate paper-fee demand', () => {
  assert.match(bookingApprovalNotice({...pending(),screeningRoute:'online'},authorized),/chosen online application/);
  const renewal=bookingApprovalNotice({...pending(),applicationType:'renewal',sameLesseesConfirmed:true},authorized);
  assert.match(renewal,/No application fee/);
  assert.doesNotMatch(renewal,/Arrange payment promptly/);
});
test('approved and non-paying guests are not told to pay for tenant approval', () => {
  for(const c of [{...pending(),steps:[{id:'board_approved',done:true}]},{pathType:'guest',steps:[]}]) {
    assert.doesNotMatch(bookingApprovalNotice(c,authorized),/Arrange payment promptly/);
  }
});
test('paper screening completion alone does not imply payment', () => {
  assert.match(bookingApprovalNotice({...pending(),steps:[{id:'screening_complete',done:true}]},authorized),/Arrange payment promptly/);
});
