import {externalFeeRequestAuthorized} from './compliance.js';
import {applicationFeeState} from './workflow.js';

// Shared guest-facing copy, not a new eligibility, cancellation or fee rule.
// Only static text is rendered here; no untrusted case fields enter the HTML.
export function bookingApprovalNotice(c, compliance = {}) {
  const done = id => Boolean(c?.steps?.find(step => step.id === id)?.done);
  const approved = done('board_approved');
  let payment = 'Follow the authorized payment instructions for your chosen application route as soon as they are available. Do not pay twice or send payment through an unconfirmed method.';
  if (c) {
    const fee = applicationFeeState(c);
    if (approved) payment = 'Board approval is recorded. No new payment is requested by this notice.';
    else if (fee === 'prohibited_same_lessee_renewal') payment = 'No application fee is requested for this confirmed same-lessee renewal.';
    else if (c.pathType !== 'full') payment = 'Follow the outstanding registration steps shown on this page. This notice does not request a tenant application fee.';
    else if (done('fee_sent') || c.feeMailed || (c.screeningRoute === 'online' && (c.screeningReportedAt || done('screening_complete')))) payment = 'Your payment or application completion has been reported or recorded. Do not pay again. A guest report is not confirmation that the association has received payment or approved the stay.';
    else if (!externalFeeRequestAuthorized(c, compliance)) payment = 'Payment instructions are being verified. Do not make an off-platform payment until the authorized instructions are released. You can complete the other available steps now.';
    else if (c.screeningRoute === 'online') payment = 'Arrange payment promptly through your chosen online application when its authorized instructions are available. Do not also send a paper-route payment.';
    else if (c.screeningRoute === 'paper') payment = 'Arrange payment promptly using the authorized paper-route instructions below. Mailing a payment is not confirmation of receipt; allow time for delivery and processing.';
    else payment = 'Choose one application route first, then follow its authorized payment instructions. Do not pay both routes.';
  }
  return `<section class="card" aria-label="Booking and HOA approval">
    <h2>${approved ? 'HOA approval recorded' : 'Start your HOA application promptly'}</h2>
    <p>New Airbnb bookings require <b>at least 7 days of advance notice</b>. Your Airbnb booking may be confirmed before the condominium association (HOA) approves the stay. <b>HOA approval is required before check-in.</b></p>
    <p>Seven days is a booking minimum, <b>not a guarantee of HOA approval within a week</b>. Allow up to 15 days after the association receives every required application, screening, document and payment item.</p>
    ${approved ? '' : '<p>Please start immediately after booking and complete any outstanding steps promptly. If an instruction or payment method is unavailable, contact the host through your existing Airbnb conversation right away.</p>'}
    <p>${payment}</p>
    <p class="muted">Missing requirements can prevent check-in. This portal does not automatically cancel a booking or determine who is responsible. Any cancellation or refund must be handled through Airbnb under its applicable policies.</p>
  </section>`;
}
