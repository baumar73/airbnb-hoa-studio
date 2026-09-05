import test from 'node:test';
import assert from 'node:assert/strict';
import {archivePackage} from '../functions/lib/package-archive.js';

test('invalid package inputs fail before encryption or a durable storage request',async()=>{
  const valid={filename:'application.pdf',bytes:new Uint8Array([1])};
  const env={CASE_STORE:{get:()=>assert.fail('must not access storage')}};
  for(const attachments of [undefined,{},[],Array(6).fill(valid),[null],[{...valid,bytes:[]}],[{...valid,bytes:new Uint8Array()}],[{...valid,bytes:new Uint8Array(8_000_001)}],[valid,valid],...['../a.pdf','a\r\nb.pdf','a".pdf','document.txt'].map(filename=>[{...valid,filename}])]) {
    await assert.rejects(archivePackage(env,[],{},attachments,'context'),/invalid package/);
  }
});
