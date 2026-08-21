import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('portal HTML templates never nest buttons inside links', async () => {
  const source = await readFile(new URL('../functions/[[path]].js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /<a\b[^>]*>\s*<button\b/gi);
});

test('portal shell preserves accessible responsive design landmarks', async () => {
  const source = await readFile(new URL('../functions/[[path]].js', import.meta.url), 'utf8');
  assert.match(source, /class="skip-link" href="#main-content"/);
  assert.match(source, /<main id="main-content" tabindex="-1">/);
  assert.match(source, /class="process-list"/);
  assert.match(source, /class="card lookup-card"/);
  assert.match(source, /for="bookingCode"/);
  assert.match(source, /for="bookingName"/);
  assert.match(source, /@media\(max-width:640px\)/);
  assert.match(source, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(source, /button:hover,a\.btn:hover,button:active,a\.btn:active\{transform:none!important\}/);
  assert.match(source, /\.lookup-card button\{background:var\(--sun-deep\)/);
  assert.match(source, /\.lookup-card button:hover\{background:#933B22\}/);
});
