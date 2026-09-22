import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { register } from 'node:module';
register('./loaders/cloudflare-sockets-loader.mjs', import.meta.url);
const { sendFilledForms, deliveryErrors } = await import('../functions/lib/form-delivery.js');

function baseCase(over = {}) {
  return {
    id: 'case-1', token: 'testtoken123', guestName: 'Ana Hypothetica',
    reservationCode: 'HMDEMO0002', checkIn: '2026-10-17', checkOut: '2026-11-10',
    nights: 24, adults: 2, pathType: 'guest-registration', screeningRoute: 'paper', createdAt: new Date().toISOString(),
    notes: '', status: null, hoaOccupancyConfirmedAt: '2026-07-27T12:00:00Z',
    steps: [
      { id: 'forms_sent', label: 'First paperwork draft saved', done: false, date: null },
    ],
    wizard: {
      savedAt: '2026-09-20T10:00:00Z',
      adults: [{ firstName: 'Ana', lastName: 'Hypothetica', esignConsent: true, email: 'ana@example.test' }],
    },
    ...over,
  };
}

function env(over = {}) {
  const store = new Map();
  const { readFileSync } = require('node:fs');
  const formBytes = (name) => new Uint8Array(readFileSync(new URL(`../public/forms/${name}.pdf`, import.meta.url)));
  return {
    CASES: {
      async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); },
    },
    ASSETS: {
      async fetch(u) {
        const target = typeof u === 'string' ? u : u.url;
        const file = new URL(target).pathname.split('/').pop();
        const stem = file.replace(/\.pdf$/, '');
        if (['lease-application','guest-registration','rules-and-regulations'].includes(stem)) {
          return new Response(formBytes(stem), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      },
    },
    FORM_DELIVERY_ENABLED: 'yes',
    FORM_DELIVERY_RECIPIENT: 'keila@condo.example.test',   // -> condo association (recipient)
    FORM_DELIVERY_CC: 'owner@example.test',                 // -> owner in CC
    GMAIL_USER: 'owner@example.test',
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    ...over,
  };
}

test('guest forms are delivered to the association with the owner in CC, never to the guest', async () => {
  const e = env();
  const c = baseCase();
  let sent = null;
  const stub = async (envArg, msg) => { sent = msg; return true; };
  const cases = [c];
  const result = await sendFilledForms(c, cases, e, { sendMail: stub });
  assert.equal(result.ok, true, result.error);
  assert.ok(sent, 'a mail must be composed');
  assert.ok(sent.to.includes('keila@condo.example.test'), 'association must be the recipient');
  assert.ok(sent.cc.includes('owner@example.test'), 'owner must be in CC');
  const all = [...sent.to, ...sent.cc].map(String);
  assert.ok(!all.some(x => x === c.wizard.adults[0].email || x === 'ana@example.test'), 'guest must never be a recipient');
  assert.ok(sent.attachments && sent.attachments.length >= 1, 'filled forms must be attached');
  // Receipt persisted on the case
  assert.ok(c.formDelivery && c.formDelivery.recipient === 'keila@condo.example.test');
});

test('delivery is blocked when the feature flag is off (fail-closed)', async () => {
  const e = env({ FORM_DELIVERY_ENABLED: 'no' });
  const c = baseCase();
  let sent = false;
  const r = await sendFilledForms(c, [c], e, { sendMail: async () => { sent = true; return true; } });
  assert.equal(r.ok, false);
  assert.match(r.error, /not enabled/);
  assert.equal(sent, false, 'no mail when disabled');
});

test('delivery is blocked for a canceled reservation', async () => {
  const c = baseCase({ status: 'canceled' });
  const r = await sendFilledForms(c, [c], env(), { sendMail: async () => true });
  assert.equal(r.ok, false);
  assert.match(r.error, /canceled/);
});

test('delivery is blocked without saved wizard data', async () => {
  const c = baseCase({ wizard: { adults: [{ firstName: 'Ana', lastName: 'Hypothetica', esignConsent: true }] } }); // no savedAt
  const r = await sendFilledForms(c, [c], env(), { sendMail: async () => true });
  assert.equal(r.ok, false);
  assert.match(r.error, /filled in and saved/);
});

test('delivery is blocked when recipient email is not configured', async () => {
  const e = env({ FORM_DELIVERY_RECIPIENT: '' });
  const c = baseCase();
  const r = await sendFilledForms(c, [c], e, { sendMail: async () => true });
  assert.equal(r.ok, false);
  assert.match(r.error, /not configured/);
});