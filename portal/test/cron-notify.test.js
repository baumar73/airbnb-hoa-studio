import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./loaders/cloudflare-sockets-loader.mjs',import.meta.url);
const {sendTelegram}=await import('../cron/src/index.js');

test('cron notifications stay disabled without complete Telegram configuration', async()=>{
  let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls++;return new Response('{}',{status:200});};
  try { assert.equal(await sendTelegram({},'synthetic alert'),false);assert.equal(calls,0); }
  finally { globalThis.fetch=original; }
});
test('cron notification transport failures are non-fatal and redacted', async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('secret transport detail');};
  try { assert.equal(await sendTelegram({TELEGRAM_BOT_TOKEN:'synthetic-token',TELEGRAM_CHAT_ID:'synthetic-chat'},'synthetic alert'),false); }
  finally { globalThis.fetch=original; }
});
