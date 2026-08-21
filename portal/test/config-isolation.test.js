// Configuration regression tests: preview must stay isolated from live data.
// The cron worker intentionally shares the live namespace because it polls and
// updates the same reservation cases as the production portal.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('preview environment never binds production KV namespaces', async () => {
  const source = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  const preview = source.split('[env.preview]')[1];
  assert.ok(preview, 'wrangler.toml must declare an [env.preview] section');
  const ids = [...preview.matchAll(/id\s*=\s*"([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids.length > 0, 'preview must bind its own KV namespace(s)');
  const prodIds = [...source.split('[env.preview]')[0].matchAll(/id\s*=\s*"([^"]+)"/g)].map(m => m[1]);
  for (const id of ids) {
    assert.equal(prodIds.includes(id), false, `preview reuses production namespace id ${id}`);
  }
});

test('cron worker binds the production KV namespace intentionally', async () => {
  const [portal, cron] = await Promise.all([
    readFile(new URL('../wrangler.toml', import.meta.url), 'utf8'),
    readFile(new URL('../cron/wrangler.toml', import.meta.url), 'utf8'),
  ]);
  const portalProdIds = [...portal.split('[env.preview]')[0].matchAll(/id\s*=\s*"([^"]+)"/g)].map(m => m[1]);
  const cronIds = [...cron.matchAll(/id\s*=\s*"([^"]+)"/g)].map(m => m[1]);
  assert.ok(cronIds.length > 0);
  assert.deepEqual(cronIds, portalProdIds, 'cron must operate on the production reservation cases');
});
