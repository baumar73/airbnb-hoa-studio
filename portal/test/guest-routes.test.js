// Route-level tests for state-changing guest paths.
// Storage is mocked and Cloudflare sockets are disabled. The tests assert that
// guest saves never create an HOA submission, same-origin mutation checks hold,
// and canceled cases stay closed for both reads and writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./loaders/cloudflare-sockets-loader.mjs', import.meta.url);

const { socketAttempts, resetSocketAttempts } = await import('cloudflare:sockets');
const { onRequest, reviewPayload } = await import('../functions/[[path]].js');
const { shouldAutoSubmitAfterGuestSave, isGuestAccessibleCase } = await import('../functions/lib/workflow.js');
const { containsProhibitedSensitiveData } = await import('../functions/lib/hoa-rules.js');

const ORIGIN = 'https://portal.example.test';
const TOKEN = 'testtoken123';

function mockEnv() {
  const store = new Map();
  const env = {
    CASES: {
      async get(key) { return store.has(key) ? store.get(key) : null; },
      async put(key, value) { store.set(key, value); },
      async delete(key) { store.delete(key); },
    },
    ASSETS: {
      async fetch() { return new Response('not found', { status: 404 }); },
    },
    ADMIN_USER: 'markus',
    ADMIN_PASSWORD: 'unused-in-tests',
  };
  return { env, store };
}

function guestRequest(path, { method = 'POST', form, origin = ORIGIN } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded' });
  if (origin) headers.set('Origin', origin);
  const body = method === 'POST' && form ? new URLSearchParams(form).toString() : undefined;
  return new Request(ORIGIN + path, { method, headers, body, redirect: 'manual' });
}

function adminRequest(path, form = {}) {
  const headers = new Headers({
    'Content-Type': 'application/x-www-form-urlencoded',
    Origin: ORIGIN,
    Authorization: `Basic ${Buffer.from('markus:unused-in-tests').toString('base64')}`,
  });
  return new Request(ORIGIN + path, {
    method: 'POST',
    headers,
    body: new URLSearchParams(form).toString(),
    redirect: 'manual',
  });
}

function seedCase(store) {
  const c = {
    id: 'case-1', token: TOKEN, guestName: 'DemoGuest DemoNameL',
    reservationCode: 'HMDEMO0002', checkIn: '2026-10-17', checkOut: '2026-12-20',
    nights: 64, adults: 2, pathType: 'full', createdAt: new Date().toISOString(),
    notes: '', status: null, hoaOccupancyConfirmedAt: '2026-07-27T12:00:00Z',
    steps: [
      { id: 'forms_sent', label: 'First paperwork draft saved', done: false, date: null },
      { id: 'vendor_handoff_confirmed', label: 'External screening-vendor handoff confirmed', done: false, date: null },
      { id: 'vendor_status_confirmed', label: 'External vendor completion status confirmed', done: false, date: null },
      { id: 'fee_sent', label: '$100 fee confirmed received by association', done: false, date: null },
    ],
  };
  store.set('cases', JSON.stringify([c]));
  return c;
}

function validSignaturePng() {
  const bytes = Buffer.alloc(120);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes, 0);
  Buffer.from('IHDR').copy(bytes, 12);
  bytes.writeUInt32BE(640, 16);
  bytes.writeUInt32BE(170, 20);
  return bytes.toString('base64');
}

function completeGuestForm() {
  return {
    saveMode: 'complete',
    a0_firstName: 'DemoGuest', a0_middleName: 'None', a0_lastName: 'DemoSurname',
    a0_phone: '+1 555 555 1212',
    a0_email: 'guest@example.test', a0_street: '1 Main St', a0_city: 'St Petersburg',
    a0_state: 'FL', a0_zip: '33715', a0_esign_consent: 'yes',
    a0_sig: `data:image/png;base64,${validSignaturePng()}`,
    rules_acknowledged: 'yes',
  };
}

test('guest draft save persists only a draft and performs no outbound HOA submission', async () => {
  resetSocketAttempts();
  const { env, store } = mockEnv();
  seedCase(store);
  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { form: { saveMode: 'draft', a0_firstName: 'DemoGuest' } }),
    env,
    waitUntil: () => {},
  });
  assert.equal(res.status, 303);
  const cases = JSON.parse(store.get('cases'));
  assert.equal(cases[0].submission, undefined);
  assert.equal(cases[0].testSubmission, undefined);
  assert.equal(cases[0].wizard.adults.length, 2); // fixed slots preserved
  assert.equal(shouldAutoSubmitAfterGuestSave(cases[0]), false);
  assert.equal(socketAttempts(), 0);
});

test('materially complete guest save reaches owner review but never opens an email socket', async () => {
  resetSocketAttempts();
  const { env, store } = mockEnv();
  const c = seedCase(store);
  c.adults = 1;
  store.set('cases', JSON.stringify([c]));
  store.set('owner-signature-png', validSignaturePng());
  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { form: completeGuestForm() }),
    env,
    waitUntil: () => {},
  });
  assert.equal(res.status, 303);
  const cases = JSON.parse(store.get('cases'));
  assert.equal(cases[0].submission, undefined);
  assert.equal(cases[0].ownerApprovedAt, undefined);
  assert.ok(cases[0].ownerReviewReadyAt);
  assert.equal(socketAttempts(), 0);
});

test('guest POST from a foreign origin is rejected before any state change', async () => {
  const { env, store } = mockEnv();
  seedCase(store);
  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { form: { saveMode: 'draft' }, origin: 'https://evil.example' }),
    env,
    waitUntil: () => {},
  });
  assert.equal(res.status, 403);
  const cases = JSON.parse(store.get('cases'));
  assert.equal(cases[0].wizard, undefined); // nothing was persisted
});

test('cross-origin public lookup is rejected before consuming rate-limit state', async () => {
  const { env, store } = mockEnv();
  const res = await onRequest({
    request: guestRequest('/find', { form: { code: 'HMDEMO0002', name: 'DemoNameL' }, origin: 'https://evil.example' }),
    env,
    waitUntil: () => {},
  });
  assert.equal(res.status, 403);
  assert.deepEqual([...store.keys()], []);
});

test('canceled cases reject guest draft saves and stay closed', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);
  c.status = 'canceled';
  store.set('cases', JSON.stringify([c]));
  assert.equal(isGuestAccessibleCase(c), false);
  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { form: { saveMode: 'draft' } }),
    env,
    waitUntil: () => {},
  });
  assert.equal(res.status, 410);
  const cases = JSON.parse(store.get('cases'));
  assert.equal(cases[0].wizard, undefined);
});

test('canceled cases reject guest wizard views and stay closed', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);
  c.status = 'canceled';
  store.set('cases', JSON.stringify([c]));
  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { method: 'GET' }),
    env,
    waitUntil: () => {},
  });
  assert.equal(res.status, 410);
  assert.match(await res.text(), /reservation is no longer active/i);
});

test('admin mutations recursively purge prohibited sensitive fields before persistence', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);
  c.metadata = {
    screening: {
      birthDate: '2000-01-01',
      idNumber: 'SYNTHETIC-ID',
      financialData: { creditScore: 700 },
      references: [{ name: 'Synthetic Reference', phone: '555' }],
      emergencyContacts: [{ name: 'Synthetic Emergency', phone: '555' }],
    },
  };
  c.wizard = { adults: [{ idType: 'drivers_license', idState: 'FL' }], emergency: [{ name: 'Synthetic Emergency' }] };
  store.set('cases', JSON.stringify([c]));

  const res = await onRequest({
    request: adminRequest('/admin/toggle', { id: c.id, step: 'forms_sent' }),
    env,
    waitUntil: () => {},
  });

  assert.equal(res.status, 303);
  const persisted = JSON.parse(store.get('cases'));
  assert.equal(containsProhibitedSensitiveData(persisted), false);
  assert.equal(persisted[0].metadata.screening, undefined);
  assert.equal(persisted[0].wizard.adults[0].idType, undefined);
  assert.equal(persisted[0].wizard.adults[0].idState, undefined);
  assert.equal(persisted[0].wizard.emergency, undefined);
});

test('SSN-pattern payload is rejected before ingestion and records metadata-only audit evidence', async () => {
  const { env, store } = mockEnv();
  seedCase(store);
  const before = store.get('cases');

  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { form: { saveMode: 'draft', a0_firstName: '123-45-6789' } }),
    env,
    waitUntil: () => {},
  });

  assert.equal(res.status, 400);
  assert.equal(await res.text(), 'prohibited_sensitive_data');
  assert.equal(store.get('cases'), before);
  const auditEntries = [...store.entries()].filter(([key]) => key.startsWith('security-audit:'));
  assert.equal(auditEntries.length, 1);
  assert.doesNotMatch(auditEntries[0][1], /123-45-6789/);
});

test('new prohibited form fields are rejected instead of silently ignored', async () => {
  const { env, store } = mockEnv();
  seedCase(store);
  const before = store.get('cases');

  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { form: { saveMode: 'draft', a0_firstName: 'Synthetic', a0_idType: 'passport' } }),
    env,
    waitUntil: () => {},
  });

  assert.equal(res.status, 400);
  assert.equal(await res.text(), 'prohibited_sensitive_data');
  assert.equal(store.get('cases'), before);
});

test('admin cannot release check-in before documented Board Approval', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);

  const res = await onRequest({
    request: adminRequest('/admin/toggle', { id: c.id, step: 'checkin_released' }),
    env,
    waitUntil: () => {},
  });

  assert.equal(res.status, 409);
  const persisted = JSON.parse(store.get('cases'));
  const release = persisted[0].steps.find(step => step.id === 'checkin_released');
  assert.equal(release?.done ?? false, false);
});

test('removing Board Approval also revokes an existing check-in release', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);
  c.steps.push(
    { id: 'board_approved', label: 'HOA Board approval received', done: true, date: '2026-08-21T12:00:00Z' },
    { id: 'checkin_released', label: 'Check-in instructions released', done: true, date: '2026-08-21T12:05:00Z' },
  );
  c.boardApprovalEvidence = {
    authority: 'Board',
    date: '2026-08-21',
    referenceId: 'minutes-demo-1',
    namedParty: c.guestName,
  };
  store.set('cases', JSON.stringify([c]));

  const res = await onRequest({
    request: adminRequest('/admin/toggle', { id: c.id, step: 'board_approved' }),
    env,
    waitUntil: () => {},
  });

  assert.equal(res.status, 303);
  const persisted = JSON.parse(store.get('cases'));
  assert.equal(persisted[0].steps.find(step => step.id === 'board_approved').done, false);
  assert.equal(persisted[0].steps.find(step => step.id === 'checkin_released').done, false);
});

test('Board Approval requires substantive evidence and preserves the mail candidate only as a hint', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);
  c.approvalCandidate = { mailDate: '2026-08-21T11:00:00Z', subject: 'Written approval for synthetic case' };
  store.set('cases', JSON.stringify([c]));

  const candidateOnly = await onRequest({
    request: adminRequest('/admin/toggle', { id: c.id, step: 'board_approved', approvalDate: '', approvalReferenceId: '' }),
    env,
    waitUntil: () => {},
  });
  assert.equal(candidateOnly.status, 409);

  const approved = await onRequest({
    request: adminRequest('/admin/toggle', {
      id: c.id,
      step: 'board_approved',
      approvalAuthority: 'Board',
      approvalDate: '2026-08-21',
      approvalReferenceId: 'signed-consent-demo-1',
      approvalNamedParty: c.guestName,
    }),
    env,
    waitUntil: () => {},
  });
  assert.equal(approved.status, 303);
  const persisted = JSON.parse(store.get('cases'))[0];
  assert.deepEqual(persisted.boardApprovalEvidence, {
    authority: 'Board',
    date: '2026-08-21',
    referenceId: 'signed-consent-demo-1',
    namedParty: c.guestName,
  });
  assert.equal(persisted.approvalCandidate.subject, 'Written approval for synthetic case');
});

test('future-dated Board Approval evidence is rejected', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);
  const res = await onRequest({
    request: adminRequest('/admin/toggle', {
      id: c.id,
      step: 'board_approved',
      approvalAuthority: 'Board',
      approvalDate: '2099-01-01',
      approvalReferenceId: 'minutes-demo-future',
      approvalNamedParty: c.guestName,
    }),
    env,
    waitUntil: () => {},
  });
  assert.equal(res.status, 409);
  assert.equal(JSON.parse(store.get('cases'))[0].boardApprovalEvidence, undefined);
});

test('Board Approval without a candidate or explicit evidence is rejected', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);
  const res = await onRequest({
    request: adminRequest('/admin/toggle', { id: c.id, step: 'board_approved' }),
    env,
    waitUntil: () => {},
  });
  assert.equal(res.status, 409);
  assert.equal(JSON.parse(store.get('cases'))[0].boardApprovalEvidence, undefined);
});

test('manual Airbnb creation rejects exact 30 nights and creates only a validated full rental', async () => {
  const { env, store } = mockEnv();
  store.set('cases', '[]');
  const exact = await onRequest({
    request: adminRequest('/admin/create', {
      guestName: 'Synthetic Guest', reservationCode: 'HMTEST0030',
      checkIn: '2026-10-17', checkOut: '2026-11-16', adults: '1',
    }),
    env,
    waitUntil: () => {},
  });
  assert.equal(exact.status, 400);
  assert.deepEqual(JSON.parse(store.get('cases')), []);

  const valid = await onRequest({
    request: adminRequest('/admin/create', {
      guestName: 'Synthetic Guest', reservationCode: 'HMTEST0031',
      checkIn: '2026-10-17', checkOut: '2026-11-17', adults: '1',
    }),
    env,
    waitUntil: () => {},
  });
  assert.equal(valid.status, 303);
  const created = JSON.parse(store.get('cases'))[0];
  assert.equal(created.nights, 31);
  assert.equal(created.pathType, 'full');
  assert.equal(created.occupancyDecision.kind, 'rental');
  assert.equal(created.occupancyDecision.ruleStatus, 'current');
  assert.match(created.occupancyDecision.ruleVersionId, /^2026-08-21-corpus-review:/);
  assert.ok(created.occupancyDecision.sourceIds.includes('CINC-364605'));
});

test('manual short paid rental is created transparently without counting maintenance blocks as rental nights', async () => {
  const { env, store } = mockEnv();
  store.set('cases', '[]');
  const response = await onRequest({
    request: adminRequest('/admin/create', {
      guestName: 'Synthetic Short Stay', reservationCode: 'HMTEST0027',
      checkIn: '2026-10-17', checkOut: '2026-11-13', adults: '1', maintenanceBlockedNights: '3',
    }),
    env,
    waitUntil: () => {},
  });
  assert.equal(response.status, 303);
  const created = JSON.parse(store.get('cases'))[0];
  assert.equal(created.nights, 27);
  assert.equal(created.pathType, 'full');
  assert.equal(created.minimumTermDecision.status, 'owner_review_required');
  assert.equal(created.minimumTermDecision.rentalNights, 27);
  assert.equal(created.minimumTermDecision.maintenanceBlockedNights, 3);
  assert.equal(created.minimumTermDecision.maintenanceCountsTowardRentalTerm, false);
  assert.equal(created.minimumTermDecision.checkInLocked, true);
});

test('review payload binds the transparent minimum-term decision without counting maintenance', () => {
  const payload = reviewPayload({
    id: 'short-1', reservationCode: 'SHORTSAFE', checkIn: '2026-10-17', checkOut: '2026-11-13',
    nights: 27, adults: 1, pathType: 'full',
    minimumTermDecision: {
      status: 'satisfied_above_conflict', rentalNights: 30, maintenanceBlockedNights: 3,
      maintenanceCountsTowardRentalTerm: true, checkInLocked: false,
      policyVersionId: 'tampered-policy', ruleVersionId: 'tampered-rule',
      ruleStatus: 'current', sourceIds: ['tampered-source'],
    },
  }, { adults: [], children: [] }, false);
  assert.deepEqual(payload.case.minimumTermDecision, {
    status: 'owner_review_required', rentalNights: 27, maintenanceBlockedNights: 3,
    maintenanceCountsTowardRentalTerm: false, checkInLocked: true,
    policyVersionId: 'transparent-short-rental-review-v1',
    ruleVersionId: '2026-08-21-corpus-review:minimum-term-boundary',
    ruleStatus: 'unresolved', sourceIds: ['CINC-363471', 'CINC-364605'],
  });
});

test('live submission mode cannot be enabled without an atomic coordinator', async () => {
  const { env, store } = mockEnv();
  const res = await onRequest({
    request: adminRequest('/admin/submit-live', { mode: 'yes', confirm: 'LIVE' }),
    env,
    waitUntil: () => {},
  });
  assert.equal(res.status, 409);
  assert.equal(store.has('submit-live'), false);
});

test('binary uploads fail closed until content-level DLP is configured', async () => {
  for (const path of ['/admin/library/upload', '/admin/receipts/upload']) {
    const { env, store } = mockEnv();
    const res = await onRequest({
      request: adminRequest(path),
      env,
      waitUntil: () => {},
    });
    assert.equal(res.status, 409);
    assert.deepEqual([...store.keys()], []);
  }
});
