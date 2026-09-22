import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./loaders/cloudflare-sockets-loader.mjs', import.meta.url);
const { onRequest } = await import('../functions/[[path]].js');
const { loadStoredCases } = await import('../functions/lib/storage.js');

const ORIGIN = 'https://portal.example.test';
function env(store) {
  return {
    CASES: {
      async get(k) { return store.has(k) ? store.get(k) : null; },
      async put(k, v) { store.set(k, v); },
      async delete(k) { store.delete(k); },
    },
    ASSETS: { async fetch() { return new Response('not found', { status: 404 }); } },
    ADMIN_USER: 'markus', ADMIN_PASSWORD: 'board-test-password-32char!!',
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    AUDIT_HASH_SALT: 'test-audit-salt-32-characters-long',
  };
}
function seedCase(store, over = {}) {
  const c = {
    id: 'case-A', token: 'ctokencaseA', guestName: 'Ana Hypothetica',
    checkIn: '2026-11-01', checkOut: '2026-11-30', pathType: 'full', screeningRoute: 'paper',
    status: null, createdAt: new Date().toISOString(),
    steps: [{ id: 'forms_sent', label: 'Formulare', done: true, date: null }],
    wizard: { savedAt: '2026-09-20T10:00:00Z', adults: [{ firstName: 'Ana', lastName: 'Hypothetica', idNumber: 'X-7' }] },
    ...over,
  };
  store.set('cases', JSON.stringify([c]));
  return c;
}
const adminReq = (path, form) => new Request(ORIGIN + path, {
  method: form ? 'POST' : 'GET',
  headers: { Authorization: 'Basic ' + btoa('markus:board-test-password-32char!!'), Origin: ORIGIN,
    'Content-Type': 'application/x-www-form-urlencoded' },
  body: form ? new URLSearchParams(form).toString() : undefined, redirect: 'manual',
});

test('admin can set a photo and cleaning date per tenant, shown on the progress board', async () => {
  const store = new Map(); seedCase(store);
  const e = env(store);
  const set = await onRequest({ env: e, request: adminReq('/admin/board/setup', { id: 'case-A', photo: 'data:image/png;base64,AAAA', cleaning: '2026-12-02' }), waitUntil: () => {} });
  assert.ok([302, 303].includes(set.status), 'redirect after save');
  assert.match(set.headers.get('Location') || '', /\/admin\/board/);
  const c = (await loadStoredCases(e)).find(x => x.id === 'case-A');
  assert.equal(c.photo, 'data:image/png;base64,AAAA');
  assert.equal(c.cleaning, '2026-12-02');
  // The board now renders the photo and the cleaning datum.
  const board = await onRequest({ env: e, request: adminReq('/admin/board'), waitUntil: () => {} });
  const text = await board.text();
  assert.match(text, /data:image\/png;base64,AAAA/);
  assert.match(text, /2026-12-02/);
});

test('invalid photo or cleaning input is rejected without mutating the case', async () => {
  const store = new Map(); seedCase(store);
  const e = env(store);
  const badPhoto = await onRequest({ env: e, request: adminReq('/admin/board/setup', { id: 'case-A', photo: 'javascript:alert(1)', cleaning: '' }), waitUntil: () => {} });
  assert.equal(badPhoto.status, 400);
  const badClean = await onRequest({ env: e, request: adminReq('/admin/board/setup', { id: 'case-A', photo: '', cleaning: 'not-a-date' }), waitUntil: () => {} });
  assert.equal(badClean.status, 400);
  const c = (await loadStoredCases(e)).find(x => x.id === 'case-A');
  assert.equal(c.photo, undefined);
  assert.equal(c.cleaning, undefined);
});