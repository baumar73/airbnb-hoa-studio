// Verify the strict CSP on every HTML route: no 'unsafe-inline', a per-response
// nonce in the header, and that nonce present on every <script>/<style> element.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { register } from 'node:module';

register('./loaders/cloudflare-sockets-loader.mjs', import.meta.url);

const { onRequest } = await import('../functions/[[path]].js');

const ORIGIN = 'https://portal.example.test';
const ADMIN_USER = 'markus';
const ADMIN_PASSWORD = 'correct-horse-battery-staple';

function mockEnv() {
  return {
    CASES: {
      async get() { return null; },
      async put() {},
      async delete() {},
      async list() { return { keys: [], list_complete: true }; },
    },
    ASSETS: { async fetch() { return new Response('not found', { status: 404 }); } },
    ADMIN_USER,
    ADMIN_PASSWORD,
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    AUDIT_HASH_SALT: 'test-audit-salt-32-characters-long',
  };
}

function req(path, { auth = false } = {}) {
  const headers = new Headers();
  if (auth) headers.set('Authorization', 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'));
  return new Request(`${ORIGIN}${path}`, { method: 'GET', headers, redirect: 'manual' });
}

const HTML_ROUTES = [
  ['/ (public landing)', '/'],
  ['/privacy', '/privacy'],
  ['/fair-housing', '/fair-housing'],
  ['/admin (authenticated)', '/admin', true],
];

function parseCsp(header) {
  const directives = {};
  for (const part of header.split(';')) {
    const t = part.trim();
    if (!t) continue;
    const [name, ...rest] = t.split(/\s+/);
    directives[name] = rest;
  }
  return directives;
}

test('CSP: script-src and style-src have no unsafe-inline and both carry a per-response nonce', async () => {
  for (const [label, path, auth] of HTML_ROUTES) {
    const env = mockEnv();
    const res = await onRequest({ request: req(path, { auth }), env, waitUntil: () => {} });
    assert.ok(res.status < 400, `${label}: reachable (status ${res.status})`);
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp, `${label}: CSP header present`);
    const d = parseCsp(csp);
    assert.ok(d['script-src'], `${label}: script-src present`);
    assert.ok(d['script-src'].every(s => s !== "'unsafe-inline'"), `${label}: script-src has no unsafe-inline`);
    assert.ok(d['script-src'].some(s => s.startsWith("'nonce-")), `${label}: script-src has a nonce`);
    assert.ok(d['style-src'].some(s => s.startsWith("'nonce-")), `${label}: style-src has a nonce`);
    const nonce = d['script-src'].find(s => s.startsWith("'nonce-")).slice(7, -1);
    assert.ok(nonce && nonce.length >= 20, `${label}: nonce is non-trivial`);

    const body = await res.text();
    const tags = [...body.matchAll(/<(script|style)\b[^>]*/g)].map(m => m[0]);
    assert.ok(tags.length >= 1, `${label}: page has at least one script/style element`);
    for (const t of tags) {
      assert.ok(t.includes(`nonce="${nonce}"`), `${label}: ${t.slice(0, 32)} carries the matching nonce`);
    }
    assert.ok(!body.includes('unsafe-inline'), `${label}: body never mentions unsafe-inline`);
  }
});

test('CSP: every injected nonce attribute equals the header nonce (rewrite path is real)', async () => {
  const env = mockEnv();
  const res = await onRequest({ request: req('/admin', { auth: true }), env, waitUntil: () => {} });
  const body = await res.text();
  const nonce = parseCsp(res.headers.get('content-security-policy'))['script-src']
    .find(s => s.startsWith("'nonce-")).slice(7, -1);
  const segments = body.split('nonce="').slice(1);
  assert.ok(segments.length >= 1, 'at least one nonce attribute injected');
  assert.ok(segments.every(seg => seg.startsWith(nonce + '"')), 'every injected nonce equals the header nonce');
});

test('source: CSP constant no longer hard-codes unsafe-inline and html() applies a nonce', async () => {
  const source = await readFile(new URL('../functions/[[path]].js', import.meta.url), 'utf8');
  assert.match(source, /script-src 'self' 'nonce-/);
  assert.doesNotMatch(source, /script-src 'self' 'unsafe-inline'/);
  assert.match(source, /function randNonce\(\)/);
});