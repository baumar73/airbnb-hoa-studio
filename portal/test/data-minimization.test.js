import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAdultFormSlots } from '../functions/lib/guest-form.js';
import { requiredPackageDocuments, validateLiveSubmissionPrerequisites, validatePaperwork } from '../functions/lib/workflow.js';

function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function signature() {
  const bytes = Buffer.alloc(120);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes, 0);
  Buffer.from('IHDR').copy(bytes, 12);
  bytes.writeUInt32BE(640, 16);
  bytes.writeUInt32BE(170, 20);
  return bytes.toString('base64');
}

test('guest form parser never retains screening or identity fields', () => {
  const parsed = parseAdultFormSlots(form({
    a0_firstName: 'Synthetic', a0_lastName: 'Applicant', a0_email: 'synthetic@example.test',
    a0_birthDate: '2000-01-01', a0_gender: 'X', a0_idType: 'drivers_license',
    a0_idNumber: 'SYNTHETIC-ID', a0_idState: 'FL', a0_employer: 'Synthetic Employer',
    a0_employerPhone: '555-0100', a0_esign_consent: 'yes',
  }), 1);
  const adult = parsed.adults[0];
  for (const prohibited of ['birthDate', 'gender', 'idType', 'idNumber', 'idState', 'employer', 'employerPhone']) {
    assert.equal(Object.hasOwn(adult, prohibited), false, prohibited);
  }
  assert.equal(adult.firstName, 'Synthetic');
  assert.equal(adult.email, 'synthetic@example.test');
});

test('rental candidate uses vendor handoff and never generates sensitive application/background documents', () => {
  assert.deepEqual(requiredPackageDocuments('full').map(d => d.key), [
    'rules-and-regulations', 'lease-agreement',
  ]);
});

test('live rental readiness requires vendor handoff but never IDs or reports', () => {
  const c = {
    pathType: 'full', applicationType: 'lease', feeStatus: 'required',
    steps: [{ id: 'vendor_handoff_confirmed', done: false }, { id: 'vendor_status_confirmed', done: false }, { id: 'fee_sent', done: false }],
  };
  assert.deepEqual(validateLiveSubmissionPrerequisites(c).missing, ['vendor_handoff_confirmed', 'vendor_status_confirmed', 'fee_sent']);
  c.steps.forEach(step => { step.done = true; });
  assert.equal(validateLiveSubmissionPrerequisites(c).ok, true);
});

test('minimal rental coordination data is sufficient without DOB IDs employers references or reports', () => {
  const c = {
    adults: 1, expectedMinors: 1, pathType: 'full',
    wizard: {
      adults: [{
        firstName: 'Synthetic', lastName: 'Applicant', phone: '+1 555 0100',
        email: 'synthetic@example.test', street: 'Synthetic address', city: 'St Petersburg',
        state: 'FL', zip: '33715', sigPng: signature(), esignConsent: true,
      }],
      children: [{ name: 'Synthetic Minor' }],
      esignConsent: true,
      rulesAcknowledged: true,
    },
  };
  assert.deepEqual(validatePaperwork(c), { ok: true, missing: [] });
});
