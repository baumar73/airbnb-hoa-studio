// Route-level tests that admin basic-auth authenticates only with the correct
// credential, via both the stored-hash path and the plaintext env fallback.
// The comparison must use the constant-time tolerantCompare (see separate unit
// test); these tests pin the auth behaviour end-to-end through onRequest.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import crypto from 'node:crypto';

register('./loaders/cloudflare-sockets-loader.mjs', import.meta.url);

const { onRequest } = await import('../functions/[[path]].js');

const ORIGIN = 'https://portal.example.test';
const ADMIN_USER = 'markus';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';

function mockEnv({ storeHash = false } = {}) {
  const store = new Map();
  const env = {
    CASES: {
      async get(key) { return store.has(key) ? store.get(key) : null; },
      async put(key, value) { store.set(key, value); },
      async delete(key) { store.delete(key); },
    },
    ASSETS: { async fetch() { return new Response('not found', { status: 404 }); } },
    ADMIN_USER,
    ADMIN_PASSWORD: storeHash ? undefined : ADMIN_PASSWORD,
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    AUDIT_HASH_SALT: 'test-audit-salt-32-characters-long',
  };
  if (storeHash) {
    const digest = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest('hex');
    store.set('admin-password-hash', digest);
  }
  return env;
}

function adminRequest(credentials) {
  const headers = new Headers();
  if (credentials) {
    const token = Buffer.from(`${ADMIN_USER}:${credentials}`).toString('base64');
    headers.set('Authorization', `Basic ${token}`);
  }
  return new Request(`${ORIGIN}/admin/cases`, { method: 'GET', headers, redirect: 'manual' });
}

test('admin route without credentials returns 401', async () => {
  const env = mockEnv();
  const res = await onRequest({ request: adminRequest(null), env, waitUntil: () => {} });
  assert.equal(res.status, 401);
});

test('admin route with wrong password returns 401', async () => {
  const env = mockEnv();
  const res = await onRequest({ request: adminRequest('wrong-password'), env, waitUntil: () => {} });
  assert.equal(res.status, 401);
});

test('admin route with correct plaintext password is authenticated (not 401)', async () => {
  const env = mockEnv();
  const res = await onRequest({ request: adminRequest(ADMIN_PASSWORD), env, waitUntil: () => {} });
  assert.notEqual(res.status, 401);
});

test('admin route with correct stored-hash password is authenticated (not 401)', async () => {
  const env = mockEnv({ storeHash: true });
  const res = await onRequest({ request: adminRequest(ADMIN_PASSWORD), env, waitUntil: () => {} });
  assert.notEqual(res.status, 401);
});

test('admin route with wrong stored-hash password returns 401', async () => {
  const env = mockEnv({ storeHash: true });
  const res = await onRequest({ request: adminRequest('wrong-password'), env, waitUntil: () => {} });
  assert.equal(res.status, 401);
});