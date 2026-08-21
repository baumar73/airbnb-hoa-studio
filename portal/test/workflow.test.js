import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateCaseInput,
  isReadyForOwnerReview,
  shouldAutoSubmitAfterGuestSave,
  shouldAutoApproveFromEmail,
  shouldAutoEmailFeeReminder,
  purgeExpiredCases,
  validateEmailAddress,
  validatePaperwork,
  submissionRecipients,
  isAllowedMutationOrigin,
  validateAirbnbCaseInput,
  requiredPackageDocuments,
  validateOwnerReviewAttestations,
  validateLiveSubmissionPrerequisites,
  validateSignaturePng,
  isGuestAccessibleCase,
  applicationFeeState,
} from '../functions/lib/workflow.js';
import { applicationTypeMarkX } from '../functions/lib/fill.js';

function validSignaturePng() {
  const bytes = Buffer.alloc(120);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes, 0);
  Buffer.from('IHDR').copy(bytes, 12);
  bytes.writeUInt32BE(640, 16);
  bytes.writeUInt32BE(170, 20);
  return bytes.toString('base64');
}

function completeCase() {
  return {
    checkIn: '2026-10-17', checkOut: '2026-12-20', adults: 1,
    pathType: 'full', submission: null,
    wizard: {
      adults: [{
        firstName: 'DemoGuest', middleName: 'None', lastName: 'DemoNameL', birthDate: '1980-01-01', gender: 'F',
        phone: '+1-555-000-005', email: 'demoGuest@example.com',
        street: '1 Main St', city: 'St Petersburg', state: 'FL', zip: '33715',
        idType: 'drivers_license', idNumber: 'X1234567', idState: 'FL', employer: 'Retired', employerPhone: 'N/A', sigPng: validSignaturePng(), esignConsent: true
      }],
      references: [
        { name: 'Reference One', phone: '+1-555-000-001', address: '1 Ref St, Tampa, FL' },
        { name: 'Reference Two', phone: '+1-555-000-002', address: '2 Ref St, Tampa, FL' },
      ],
      emergency: [
        { name: 'Emergency One', phone: '+1-555-000-003' },
        { name: 'Emergency Two', phone: '+1-555-000-004' },
      ],
      esignConsent: true,
      rulesAcknowledged: true,
    },
  };
}

test('validates a sane future case input', () => {
  assert.deepEqual(validateCaseInput({
    guestName: 'DemoGuest DemoNameL', reservationCode: 'HMDEMO0002',
    checkIn: '2026-10-17', checkOut: '2026-12-20', adults: 1,
  }), { ok: true, nights: 64 });
});

test('rejects invalid dates and missing adult count', () => {
  assert.equal(validateCaseInput({ guestName: 'X', checkIn: '2026-12-20', checkOut: '2026-10-17', adults: 1 }).ok, false);
  assert.equal(validateCaseInput({ guestName: 'X', checkIn: '2026-10-17', checkOut: '2026-12-20', adults: null }).ok, false);
  assert.equal(validateCaseInput({ guestName: 'X', checkIn: '2027-02-31', checkOut: '2027-03-05', adults: 1 }).ok, false);
});

test('Airbnb rentals must use the full HOA path and meet the 30-night minimum', () => {
  assert.equal(validateAirbnbCaseInput({ guestName: 'X', checkIn: '2026-10-17', checkOut: '2026-11-16', adults: 1 }).ok, true);
  assert.equal(validateAirbnbCaseInput({ guestName: 'X', checkIn: '2026-10-17', checkOut: '2026-11-15', adults: 1 }).ok, false);
});

test('Airbnb rentals with more than two adults are routed to a manual HOA package', () => {
  const result = validateAirbnbCaseInput({ guestName: 'X', checkIn: '2026-10-17', checkOut: '2026-11-20', adults: 3 });
  assert.equal(result.ok, false);
  assert.match(result.error, /more than two adults/i);
});

test('a paid Airbnb rental has exactly four HOA document components', () => {
  assert.deepEqual(requiredPackageDocuments('full').map(d => d.key), [
    'lease-application', 'background-authorization', 'rules-and-regulations', 'lease-agreement',
  ]);
  assert.throws(() => requiredPackageDocuments('guest-registration'), /paid Airbnb/i);
});

test('owner release requires a separate review attestation for all four documents', () => {
  const all = Object.fromEntries(requiredPackageDocuments('full').map(d => [d.key, 'yes']));
  assert.equal(validateOwnerReviewAttestations(all).ok, true);
  delete all['rules-and-regulations'];
  assert.equal(validateOwnerReviewAttestations(all).ok, false);
});

test('live HOA submission waits for secure IDs and confirmed fee receipt', () => {
  const c = completeCase();
  c.steps = [
    { id: 'ids_provided', done: false },
    { id: 'fee_sent', done: false },
  ];
  assert.deepEqual(validateLiveSubmissionPrerequisites(c).missing, ['ids_provided', 'fee_sent']);
  c.steps.forEach(step => { step.done = true; });
  assert.equal(validateLiveSubmissionPrerequisites(c).ok, true);
});

test('renewal suppresses payment requests while the discretionary fee waiver is pending', () => {
  const c = completeCase();
  c.applicationType = 'renewal';
  c.feeStatus = 'waiver_pending';
  c.steps = [{ id: 'ids_provided', done: true }, { id: 'fee_sent', done: false }];
  assert.equal(applicationFeeState(c), 'waiver_pending');
  assert.deepEqual(validateLiveSubmissionPrerequisites(c).missing, ['fee_waiver_confirmation']);
});

test('confirmed renewal fee waiver removes the fee receipt prerequisite', () => {
  const c = completeCase();
  c.applicationType = 'renewal';
  c.feeStatus = 'waived';
  c.steps = [{ id: 'ids_provided', done: true }, { id: 'fee_sent', done: false }];
  assert.equal(applicationFeeState(c), 'waived');
  assert.equal(validateLiveSubmissionPrerequisites(c).ok, true);
});

test('renewal applications mark the renewal box instead of the lease box', () => {
  assert.equal(applicationTypeMarkX('lease'), 342);
  assert.equal(applicationTypeMarkX('renewal'), 480);
});

test('accepts only plausibly sized PNG signature payloads', () => {
  assert.equal(validateSignaturePng(validSignaturePng()), true);
  assert.equal(validateSignaturePng('abc'), false);
});

test('validates guest email addresses and blocks SMTP/header injection', () => {
  assert.equal(validateEmailAddress('demoGuest@example.com'), true);
  assert.equal(validateEmailAddress('victim@example.com\r\nBcc: attacker@example.com'), false);
  assert.equal(validateEmailAddress('a@example.com,b@example.com'), false);
  assert.equal(validateEmailAddress('not-an-address'), false);
});

test('requires materially complete applicant data before owner review', () => {
  const c = completeCase();
  assert.equal(validatePaperwork(c).ok, true);
  delete c.wizard.adults[0].birthDate;
  const invalid = validatePaperwork(c);
  assert.equal(invalid.ok, false);
  assert.ok(invalid.missing.includes('adult 1 birthDate'));
  assert.equal(isReadyForOwnerReview(c, true), false);
});

test('requires both references and emergency contacts to avoid HOA follow-up', () => {
  const c = completeCase();
  c.wizard.references[1].phone = '';
  c.wizard.emergency.pop();
  const result = validatePaperwork(c);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('reference 2 phone'));
  assert.ok(result.missing.includes('emergency contact 2 name'));
});

test('requires confirmed minor occupants to have a name and valid birth date', () => {
  const c = completeCase();
  c.expectedMinors = 1;
  c.wizard.children = [{ name: '', birthDate: '' }];
  let result = validatePaperwork(c);
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('minor 1 name'));
  assert.ok(result.missing.includes('minor 1 birthDate'));
  c.wizard.children[0] = { name: 'DemoNameR Guest', birthDate: '2009-01-01' };
  result = validatePaperwork(c);
  assert.equal(result.ok, true);
});

test('complete signed paperwork becomes ready for owner review', () => {
  assert.equal(isReadyForOwnerReview(completeCase(), true), true);
});

test('rules must be explicitly acknowledged before owner review', () => {
  const c = completeCase(); c.wizard.rulesAcknowledged = false;
  assert.equal(isReadyForOwnerReview(c, true), false);
});

test('guest save never triggers submission to the HOA', () => {
  assert.equal(shouldAutoSubmitAfterGuestSave(completeCase()), false);
});

test('HOA package recipients never include the guest automatically', () => {
  const recipients = submissionRecipients('guest@example.com');
  assert.deepEqual(recipients.to, ['contact005@example.test', 'contact006@example.test']);
  assert.deepEqual(recipients.cc, ['contact008@example.test']);
  assert.equal([...recipients.to, ...recipients.cc].includes('guest@example.com'), false);
});

test('canceled cases are closed to guest access', () => {
  assert.equal(isGuestAccessibleCase({ status: 'canceled' }), false);
  assert.equal(isGuestAccessibleCase({ status: null }), true);
  assert.equal(isGuestAccessibleCase(null), false);
});

test('state-changing requests require the exact same origin', () => {
  assert.equal(isAllowedMutationOrigin('https://portal.example.test', 'https://portal.example.test'), true);
  assert.equal(isAllowedMutationOrigin('https://evil.example', 'https://portal.example.test'), false);
  assert.equal(isAllowedMutationOrigin('', 'https://portal.example.test'), false);
  assert.equal(isAllowedMutationOrigin('null', 'https://portal.example.test'), false);
});

test('an approval-looking email never auto-approves a case', () => {
  assert.equal(shouldAutoApproveFromEmail(), false);
});

test('the daily worker never emails a guest fee reminder automatically', () => {
  assert.equal(shouldAutoEmailFeeReminder(), false);
});

test('purges guest cases 90 days after checkout while retaining current cases', () => {
  const cases = [
    { id: 'old', checkOut: '2026-01-01' },
    { id: 'current', checkOut: '2026-12-20' },
  ];
  const result = purgeExpiredCases(cases, new Date('2026-07-17T12:00:00Z'), 90);
  assert.deepEqual(result.kept.map(c => c.id), ['current']);
  assert.deepEqual(result.purged.map(c => c.id), ['old']);
});
