import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('portal HTML templates never nest buttons inside links', async () => {
  const source = await readFile(new URL('../functions/[[path]].js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /<a\b[^>]*>\s*<button\b/gi);
});
