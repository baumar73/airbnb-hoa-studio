import test from 'node:test';
import assert from 'node:assert/strict';
import {previewRequest,previewEnvironment} from '../preview/guard.js';
const host='acceptance.example.pages.dev',password='synthetic-preview-password-000000000000';
const env=()=>({PREVIEW_ONLY:'yes',PREVIEW_HOST:host,PREVIEW_USER:'test-owner',PREVIEW_PASSWORD:password,PREVIEW_CASES:{},PREVIEW_CASE_STORE:{},PREVIEW_DATA_ENCRYPTION_KEY:'test-key',PREVIEW_AUDIT_SALT:'test-salt',ASSETS:{}});
const request=(path='/',method='GET',extra={})=>new Request('https://'+host+path,{method,headers:{Authorization:'Basic '+btoa('test-owner:'+password),...(method==='POST'?{Origin:'https://'+host}:{}),...extra}});
test('preview requires explicit mode, exact test host and authentication before dispatch',async()=>{
  let calls=0; const run=async()=>{calls++;return new Response('ok');};
  assert.equal((await previewRequest(new Request('https://'+host),env(),run)).status,401);
  assert.equal((await previewRequest(request(),{...env(),PREVIEW_ONLY:'no'},run)).status,503);
  assert.equal((await previewRequest(request(),{...env(),PREVIEW_HOST:'production.example.com'},run)).status,403);
  assert.equal(calls,0);
});
test('production bindings and real transport credentials never reach the application',()=>{
  const original={...env(),CASES:{production:true},CASE_STORE:{production:true},GMAIL_APP_PASSWORD:'secret',TELEGRAM_BOT_TOKEN:'secret',AUTO_HOA_SUBMIT:'yes',AUTO_GUEST_REMINDERS:'yes',ALLOW_CASE_IMPORT:'yes'};
  const safe=previewEnvironment(original);
  assert.equal(safe.CASES,original.PREVIEW_CASES);assert.equal(safe.CASE_STORE,original.PREVIEW_CASE_STORE);
  assert.equal(safe.AUTO_HOA_SUBMIT,'no');assert.equal(safe.AUTO_GUEST_REMINDERS,'no');
  assert.equal(safe.GMAIL_APP_PASSWORD,undefined);assert.equal(safe.TELEGRAM_BOT_TOKEN,undefined);assert.equal(safe.ALLOW_CASE_IMPORT,undefined);
  assert.throws(()=>previewEnvironment({...original,PREVIEW_CASES:null}));
});
test('dangerous and unknown actions cannot be enabled from preview UI or crafted requests',async()=>{
  const run=()=>assert.fail('must not dispatch');
  for(const path of ['/admin/submit','/admin/submit-live','/admin/receipts/export','/admin/case-store/initialize','/run-poll','/future-send'])
    assert.equal((await previewRequest(request(path,'POST'),env(),run)).status,403);
  assert.equal((await previewRequest(request('/admin/create','POST',{Origin:'https://other.test'}),env(),run)).status,403);
});
test('synthetic guest saves dispatch with isolated settings and non-cacheable headers',async()=>{
  const r=await previewRequest(request('/w/syntheticToken','POST'),env(),async(req,safe)=>{
    assert.equal(safe.REQUIRE_ATOMIC_CASES,'yes');return new Response('saved');
  });
  assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'private, no-store');
  assert.equal(r.headers.get('X-Robots-Tag'),'noindex, nofollow, noarchive');
});
test('all preview HTML is visibly labeled and external navigation is disabled',async()=>{
  const r=await previewRequest(request(),env(),async()=>new Response('<html><body><a href="https://vendor.example.com/pay">Pay</a></body></html>',{headers:{'Content-Type':'text/html'}}));
  const body=await r.text();assert.match(body,/TEST ONLY/);assert.doesNotMatch(body,/href="https:\/\//);assert.match(body,/#preview-external-disabled/);
});
test('unexpected application errors are redacted and external redirects are blocked',async()=>{
  const a=await previewRequest(request(),env(),async()=>{throw Error('sensitive raw detail');});
  assert.equal(a.status,503);assert.doesNotMatch(await a.text(),/sensitive/);
  const b=await previewRequest(request(),env(),async()=>Response.redirect('https://production.example.com',303));
  assert.equal(b.status,403);
});
