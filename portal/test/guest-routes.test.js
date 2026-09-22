// Route-level tests for state-changing guest paths.
// Storage is mocked and Cloudflare sockets are disabled. The tests assert that
// guest saves never create an HOA submission, same-origin mutation checks hold,
// and canceled cases stay closed for both reads and writes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./loaders/cloudflare-sockets-loader.mjs', import.meta.url);

const { socketAttempts, resetSocketAttempts } = await import('cloudflare:sockets');
const { onRequest } = await import('../functions/[[path]].js');
const { loadStoredCases } = await import('../functions/lib/storage.js');
const {
  shouldAutoSubmitAfterGuestSave,
  isGuestAccessibleCase,
  applicationFeeState,
  validateLiveSubmissionPrerequisites,
} = await import('../functions/lib/workflow.js');

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
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    AUDIT_HASH_SALT: 'test-audit-salt-32-characters-long',
  };
  return { env, store };
}

async function readCases(env) {
  return loadStoredCases(env);
}

function guestRequest(path, { method = 'POST', form, origin = ORIGIN, fetchSite } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded' });
  if (origin) headers.set('Origin', origin);
  if (fetchSite) headers.set('Sec-Fetch-Site', fetchSite);
  const body = method === 'POST' && form ? new URLSearchParams(form).toString() : undefined;
  return new Request(ORIGIN + path, { method, headers, body, redirect: 'manual' });
}

function seedCase(store) {
  const c = {
    id: 'case-1', token: TOKEN, guestName: 'DemoGuest DemoNameL',
    reservationCode: 'HMDEMO0002', checkIn: '2026-10-17', checkOut: '2026-12-20',
    nights: 64, adults: 2, pathType: 'full', screeningRoute: 'paper', createdAt: new Date().toISOString(),
    notes: '', status: null, hoaOccupancyConfirmedAt: '2026-07-27T12:00:00Z',
    steps: [
      { id: 'forms_sent', label: 'First paperwork draft saved', done: false, date: null },
      { id: 'ids_provided', label: 'Photo ID provided securely for each adult', done: false, date: null },
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

test('public and private pages explain advance notice without asserting approval or making unverified payment demands', async () => {
  resetSocketAttempts();
  const {env,store}=mockEnv(); seedCase(store);
  const home=await onRequest({request:guestRequest('/',{method:'GET'}),env,waitUntil:()=>{}});
  assert.match(await home.text(),/Book at least 7 days ahead/);
  const status=await onRequest({request:guestRequest(`/v/${TOKEN}`,{method:'GET'}),env,waitUntil:()=>{}});
  assert.equal(status.status,200);
  const text=await status.text();
  assert.match(text,/at least 7 days of advance notice/);
  assert.match(text,/HOA approval is required before check-in/);
  assert.match(text,/not a guarantee of HOA approval/);
  assert.match(text,/Do not make an off-platform payment/);
  assert.doesNotMatch(text,/Arrange payment promptly/);
  assert.equal(socketAttempts(),0);
});

function completeGuestForm() {
  return {
    saveMode: 'complete',
    a0_firstName: 'DemoGuest', a0_middleName: 'None', a0_lastName: 'DemoSurname',
    a0_birthDate: '1980-01-01', a0_gender: 'F', a0_phone: '+1 555 555 1212',
    a0_email: 'guest@example.test', a0_street: '1 Main St', a0_city: 'St Petersburg',
    a0_state: 'FL', a0_zip: '33715', a0_idType: 'drivers_license',
    a0_idNumber: 'X1234567', a0_idState: 'FL', a0_employer: 'Retired',
    a0_employerPhone: 'N/A', a0_esign_consent: 'yes',
    a0_sig: `data:image/png;base64,${validSignaturePng()}`,
    ref0_name: 'Reference One', ref0_phone: '+1 555 000 0001', ref0_address: '1 Ref St, Tampa, FL',
    ref1_name: 'Reference Two', ref1_phone: '+1 555 000 0002', ref1_address: '2 Ref St, Tampa, FL',
    em0_name: 'Emergency One', em0_phone: '+1 555 100 0001',
    em1_name: 'Emergency Two', em1_phone: '+1 555 100 0002',
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
  const cases = await readCases(env);
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
  const cases = await readCases(env);
  assert.equal(cases[0].submission, undefined);
  assert.equal(cases[0].ownerApprovedAt, undefined);
  assert.ok(cases[0].ownerReviewReadyAt);
  assert.equal(socketAttempts(), 0);
});

test('complete guest paperwork reaches owner review even when the owner signature is not configured yet', async () => {
  resetSocketAttempts();
  const { env, store } = mockEnv();
  const c = seedCase(store);
  c.adults = 1;
  store.set('cases', JSON.stringify([c]));

  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { form: completeGuestForm() }),
    env,
    waitUntil: () => {},
  });

  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `/w/${TOKEN}?saved=ready`);
  const cases = await readCases(env);
  assert.ok(cases[0].ownerReviewReadyAt);
  assert.equal(cases[0].submission, undefined);
  assert.equal(cases[0].ownerApprovedAt, undefined);
  assert.equal(socketAttempts(), 0);
});

test('complete guest paperwork updates the guest-owned progress steps accurately', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);
  c.adults = 1;
  store.set('cases', JSON.stringify([c]));

  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { form: completeGuestForm() }),
    env,
    waitUntil: () => {},
  });

  assert.equal(res.status, 303);
  const [saved] = await readCases(env);
  for (const id of ['forms_sent', 'application', 'background', 'rules_ack']) {
    const step = saved.steps.find(candidate => candidate.id === id);
    assert.equal(step.done, true, `${id} should be complete`);
    assert.ok(step.date, `${id} should have a completion date`);
  }
  assert.equal(saved.steps.find(step => step.id === 'lease_signed').done, false);
  assert.equal(saved.steps.filter(step => step.done).length, 4);
});

test('the returning guest status page says the forms are complete after a successful save', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);
  c.adults = 1;
  store.set('cases', JSON.stringify([c]));
  await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { form: completeGuestForm() }),
    env,
    waitUntil: () => {},
  });

  const res = await onRequest({
    request: guestRequest(`/v/${TOKEN}`, { method: 'GET', origin: null }),
    env,
    waitUntil: () => {},
  });
  const body = await res.text();
  assert.equal(res.status, 200);
  assert.match(body, /Your forms are complete/i);
  assert.doesNotMatch(body, /<h2>Complete your forms online<\/h2>/i);
});

test('fee instructions require HOA authority, Airbnb disclosure and external-payment authorization', async () => {
  const { env, store } = mockEnv();
  seedCase(store);
  let res = await onRequest({ request: guestRequest(`/v/${TOKEN}`, { method: 'GET', origin: null }), env, waitUntil: () => {} });
  let body = await res.text();
  assert.match(body, /Payment instructions are not released/i);
  assert.doesNotMatch(body, /I've mailed the check/i);

  store.set('compliance-config', JSON.stringify({ feeAuthorityCitation: 'Declaration Article X', airbnbFeeDisclosureVerifiedAt: '2026-09-02' }));
  res = await onRequest({ request: guestRequest(`/v/${TOKEN}`, { method: 'GET', origin: null }), env, waitUntil: () => {} });
  assert.doesNotMatch(await res.text(), /I've mailed the check/i);
  store.set('compliance-config', JSON.stringify({ feeAuthorityCitation: 'Declaration Article X', airbnbFeeDisclosureVerifiedAt: '2026-09-02', airbnbExternalFeeAuthorizationReference:'synthetic documented exception' }));
  res = await onRequest({ request: guestRequest(`/v/${TOKEN}`, { method: 'GET', origin: null }), env, waitUntil: () => {} });
  body = await res.text();
  assert.match(body, /I've mailed the check/i);
});

test('public fair-housing page treats assistance animals separately from pets and protects demographic privacy', async () => {
  const { env } = mockEnv();
  const res = await onRequest({ request: guestRequest('/fair-housing', { method: 'GET', origin: null }), env, waitUntil: () => {} });
  const body = await res.text();
  assert.match(body, /Service animals and other assistance animals are not pets/i);
  assert.match(body, /does not disclose or discuss the race/i);
  assert.match(body, /No pet fee or animal deposit/i);
  assert.match(body, /No particular certificate or registration is required/i);
  assert.match(body, /breed, size, or weight alone is not a reason for denial/i);
});

test('a full rental chooses the official application route before showing local paper forms', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);
  delete c.screeningRoute;
  store.set('cases', JSON.stringify([c]));

  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { method: 'GET', origin: null }),
    env,
    waitUntil: () => {},
  });
  const body = await res.text();

  assert.equal(res.status, 200);
  assert.match(body, /Choose how to complete the HOA application/i);
  assert.match(body, /Tenant Evaluation/i);
  assert.doesNotMatch(body, /name="a0_firstName"/i);
});

test('Tenant Evaluation is recommended for new applications without switching existing paper cases', async () => {
  resetSocketAttempts();
  const { env, store } = mockEnv();
  const c = seedCase(store);
  const read = async path => {
    const response = await onRequest({request: guestRequest(path, {method: 'GET'}), env, waitUntil: () => {}});
    assert.equal(response.status, 200);
    return response.text();
  };
  const home = await read('/');
  assert.match(home, /Recommended for new applications/);
  assert.match(home, /Tenant Evaluation: apply and pay online/);
  assert.match(home, /Already submitted a paper application/);
  const paper = await read(`/v/${TOKEN}`);
  assert.doesNotMatch(paper, /Open Tenant Evaluation/);
  assert.equal((await readCases(env))[0].screeningRoute, 'paper');

  delete c.screeningRoute;
  store.set('cases', JSON.stringify([c]));
  const choice = await read(`/w/${TOKEN}`);
  assert.match(choice, /Recommended for new applications/);
  assert.match(choice, /Already submitted a paper application/);
  assert.match(choice, /confirm with Owner or the HOA before starting again/);
  assert.match(choice, /Review the total and available payment methods before paying/);
  assert.match(choice, /Choose the paper route/);
  assert.equal((await readCases(env))[0].screeningRoute, undefined);
  assert.equal(socketAttempts(), 0);
});

test('choosing the online route persists the choice without collecting screening data locally', async () => {
  resetSocketAttempts();
  const { env, store } = mockEnv();
  const c = seedCase(store);
  delete c.screeningRoute;
  store.set('cases', JSON.stringify([c]));

  const choose = await onRequest({
    request: guestRequest(`/w/${TOKEN}/route`, { form: { route: 'online' } }),
    env,
    waitUntil: () => {},
  });
  assert.equal(choose.status, 303);
  assert.equal(choose.headers.get('location'), `/v/${TOKEN}`);
  const [saved] = await readCases(env);
  assert.equal(saved.screeningRoute, 'online');
  assert.equal(saved.wizard, undefined);

  const status = await onRequest({
    request: guestRequest(`/v/${TOKEN}`, { method: 'GET', origin: null }),
    env,
    waitUntil: () => {},
  });
  const body = await status.text();
  assert.match(body, /Complete the official online application/i);
  assert.match(body, /tenantev\.com/i);
  assert.match(body, /class="btn" href="https:\/\/tenantev\.com\/"[^>]*>Open Tenant Evaluation/);
  assert.match(body, /Application, documents and online payment in one place/);
  assert.match(body, /Review the total and available payment methods before paying/);
  assert.match(body, /not a payment-only link for an existing paper application/);
  assert.match(body, /Social Security number.*only.*Tenant Evaluation/i);
  assert.doesNotMatch(body, /I've mailed the check/i);
  assert.doesNotMatch(body, /name="a0_firstName"/i);
  assert.equal(socketAttempts(), 0);
});

test('online completion can be reported but only the owner can confirm the official screening step', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);
  c.screeningRoute = 'online';
  store.set('cases', JSON.stringify([c]));

  const report = await onRequest({
    request: guestRequest(`/v/${TOKEN}/screening-reported`, { form: { confirmed: 'yes' } }),
    env,
    waitUntil: () => {},
  });
  assert.equal(report.status, 303);
  const [saved] = await readCases(env);
  assert.ok(saved.screeningReportedAt);
  assert.equal(saved.steps.find(step => step.id === 'screening_complete').done, false);
});

test('submission prerequisites follow the selected official route', () => {
  const online = {
    pathType: 'full', screeningRoute: 'online',
    steps: [{ id: 'screening_complete', done: false }],
  };
  assert.equal(applicationFeeState(online), 'handled_online');
  assert.deepEqual(validateLiveSubmissionPrerequisites(online).missing, ['screening_complete']);
  online.steps[0].done = true;
  assert.equal(validateLiveSubmissionPrerequisites(online).ok, true);

  const paper = {
    pathType: 'full', screeningRoute: 'paper',
    steps: [
      { id: 'screening_complete', done: false },
      { id: 'ids_provided', done: true },
      { id: 'fee_sent', done: true },
    ],
  };
  assert.deepEqual(validateLiveSubmissionPrerequisites(paper).missing, ['screening_complete']);
});

test('paper-route PDF files are clearly read-only previews shown after the editable form', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);
  c.adults = 1;
  c.screeningRoute = 'paper';
  c.wizard = {
    adults: [{}], references: [{}, {}], emergency: [{}, {}], children: [],
    auto: {}, savedAt: '2026-09-02T12:00:00Z',
  };
  store.set('cases', JSON.stringify([c]));

  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { method: 'GET', origin: null }),
    env,
    waitUntil: () => {},
  });
  const body = await res.text();
  assert.match(body, /Read-only PDF previews/i);
  assert.ok(body.indexOf(`<form method="post" action="/w/${TOKEN}">`) < body.indexOf('Read-only PDF previews'));
});

test('removing a stored signature invalidates the stale owner-review-ready state', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);
  c.adults = 1;
  store.set('cases', JSON.stringify([c]));
  await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { form: completeGuestForm() }),
    env,
    waitUntil: () => {},
  });

  const withoutSignature = completeGuestForm();
  delete withoutSignature.a0_sig;
  withoutSignature.a0_remove_sig = 'yes';
  withoutSignature.saveMode = 'draft';
  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { form: withoutSignature }),
    env,
    waitUntil: () => {},
  });

  assert.equal(res.status, 303);
  const [saved] = await readCases(env);
  assert.equal(saved.wizard.adults[0].sigPng, null);
  assert.equal(saved.ownerReviewReadyAt, undefined);
  assert.equal(saved.steps.find(step => step.id === 'application').done, false);
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
  const cases = await readCases(env);
  assert.equal(cases[0].wizard, undefined); // nothing was persisted
});

test('same-origin browser metadata permits an in-app browser POST with a null Origin', async () => {
  const { env, store } = mockEnv();
  seedCase(store);
  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, {
      form: { saveMode: 'draft', a0_firstName: 'DemoGuest' },
      origin: 'null',
      fetchSite: 'same-origin',
    }),
    env,
    waitUntil: () => {},
  });
  assert.equal(res.status, 303);
  const cases = await readCases(env);
  assert.equal(cases[0].wizard.adults[0].firstName, 'DemoGuest');
});

test('cross-site browser metadata never permits a POST with a null Origin', async () => {
  const { env, store } = mockEnv();
  seedCase(store);
  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, {
      form: { saveMode: 'draft', a0_firstName: 'DemoGuest' },
      origin: 'null',
      fetchSite: 'cross-site',
    }),
    env,
    waitUntil: () => {},
  });
  assert.equal(res.status, 403);
  const cases = await readCases(env);
  assert.equal(cases[0].wizard, undefined);
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
  const cases = await readCases(env);
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

test('guest downloads the filled lease-application PDF containing their own entered data', async () => {
  const { env, store } = mockEnv();
  const c = seedCase(store);
  // Simulate a guest who filled and saved the wizard: savedAt is set, so the
  // downloads block and the /w/[token]/pdf endpoints are reachable.
  c.wizard = {
    savedAt: '2026-09-20T10:00:00Z',
    adults: [
      { firstName: 'Ana', middleName: 'Maria', lastName: 'Hypothetica',
        street: '123 Main St', city: 'St. Petersburg', state: 'FL', zip: '33701',
        phone: '5551234567', birthDate: '1985-06-15', gender: 'F',
        idType: 'drivers_license', idNumber: 'H1234567', idState: 'FL',
        email: 'ana@example.test', employer: 'Spark Co', employerPhone: '5551112222', sigPng: null },
    ],
    references: [{ name: 'Ref One', phone: '5550001111', address: '9 Elm St' }],
    emergency: [{ name: 'Em One', phone: '5552223333' }],
    auto: { make: 'Honda', year: '2020', plate: 'ABC123' },
    checkIn: '2026-10-17', checkOut: '2026-12-20',
    applicationType: 'lease', esignConsent: true,
  };
  store.set('cases', JSON.stringify([c]));

  // Real templates from public/forms, served exactly as the production ASSETS binding does.
  const { readFileSync } = await import('node:fs');
  const formBytes = (name) => new Uint8Array(readFileSync(new URL(`../public/forms/${name}.pdf`, import.meta.url)));
  env.ASSETS = { async fetch(u) {
    const file = new URL(u).pathname.split('/').pop(); // lease-application.pdf (endpoint appends .pdf)
    const stem = file.replace(/\.pdf$/, '');
    if (stem === 'lease-application') return new Response(formBytes('lease-application'), { status: 200 });
    return new Response('not found', { status: 404 });
  } };

  const res = await onRequest({ request: guestRequest(`/w/${TOKEN}/pdf/lease-application`, { method: 'GET' }), env, waitUntil: () => {} });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Content-Type') || '', /application\/pdf/);
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), '%PDF-');

  // Decompress every FlateDecode content stream (stream...endstream blocks) and
  // confirm the guest's entered values are actually drawn into the form.
  const { inflateSync } = await import('node:zlib');
  const latin = new TextDecoder('latin1');
  const rawStr = latin.decode(bytes);
  let decompressed = '';
  let from = 0;
  while (true) {
    let s = rawStr.indexOf('stream\r\n', from);
    if (s < 0) s = rawStr.indexOf('stream\n', from);
    if (s < 0) break;
    const dataStart = rawStr.indexOf('\n', s) + 1;
    const e = rawStr.indexOf('endstream', dataStart);
    if (e < 0) break;
    let dataEnd = e;
    if (rawStr[dataEnd - 1] === '\n') dataEnd--;
    if (rawStr[dataEnd - 1] === '\r') dataEnd--;
    const payload = bytes.subarray(dataStart, dataEnd);
    if (payload.length >= 2 && payload[0] === 0x78 && payload[1] === 0x9c) {
      try { decompressed += latin.decode(inflateSync(payload)); } catch { /* per-stream tolerant */ }
    }
    from = e + 9;
  }
  // pdf-lib writes text as hex string operands <…> Tj; decode them to prove the
  // guest's own entered values are actually drawn into the form.
  const hexOperands = [...decompressed.matchAll(/<([0-9A-Fa-f]+)>/g)];
  let text = '';
  for (const m of hexOperands) {
    const h = m[1]; let s = '';
    for (let i = 0; i + 1 < h.length; i += 2) s += String.fromCharCode(parseInt(h.substr(i, 2), 16));
    text += s;
  }
  assert.match(text, /Hypothetica/);
});
