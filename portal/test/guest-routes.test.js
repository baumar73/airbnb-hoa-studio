// Route-level tests for state-changing guest POST paths.
// Storage and outbound integrations are mocked; the tests assert that a guest
// draft save never triggers an outbound HOA submission or any outbound email,
// that same-origin mutation checks hold, and that canceled cases stay closed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./loaders/cloudflare-sockets-loader.mjs', import.meta.url);

const { onRequest } = await import('../functions/[[path]].js');
const { shouldAutoSubmitAfterGuestSave, isGuestAccessibleCase } = await import('../functions/lib/workflow.js');

const ORIGIN = 'https://portal.example.test';
const TOKEN = 'testtoken123';

function mockEnv() {
  const store = new Map();
  const outbound = { gmailCalls: [], telegramCalls: [], socketAttempts: 0 };
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
    // Outbound integrations are mocked: every send is recorded, never performed.
    async __recordGmail(call) { outbound.gmailCalls.push(call); return true; },
    __outbound: outbound,
  };
  return { env, store, outbound };
}

function guestRequest(path, { method = 'POST', form, origin = ORIGIN } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded' });
  if (origin) headers.set('Origin', origin);
  const body = method === 'POST' && form ? new URLSearchParams(form).toString() : undefined;
  return new Request(ORIGIN + path, { method, headers, body, redirect: 'manual' });
}

function seedCase(store) {
  const c = {
    id: 'case-1', token: TOKEN, guestName: 'DemoGuest DemoNameL',
    reservationCode: 'HMDEMO0002', checkIn: '2026-10-17', checkOut: '2026-12-20',
    nights: 64, adults: 2, pathType: 'full', createdAt: new Date().toISOString(),
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

test('guest draft save persists only a draft and performs no outbound HOA submission or email', async () => {
  const { env, store, outbound } = mockEnv();
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
  // No outbound email or HOA submission occurred from the guest save path.
  assert.deepEqual(outbound.gmailCalls, []);
  assert.equal(shouldAutoSubmitAfterGuestSave(cases[0]), false);
});

test('guest complete-mode save still only prepares a package for owner review (no submission, no email)', async () => {
  const { env, store, outbound } = mockEnv();
  seedCase(store);
  const res = await onRequest({
    request: guestRequest(`/w/${TOKEN}`, { form: { saveMode: 'complete', a0_firstName: 'DemoGuest' } }),
    env,
    waitUntil: () => {},
  });
  assert.equal(res.status, 303);
  const cases = JSON.parse(store.get('cases'));
  assert.equal(cases[0].submission, undefined);
  assert.equal(cases[0].ownerApprovedAt, undefined);
  assert.deepEqual(outbound.gmailCalls, []);
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
