import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./loaders/cloudflare-sockets-loader.mjs',import.meta.url);
const {pollMail}=await import('../functions/lib/mailpoll.js');
const raw=text=>`* 1 FETCH (BODY[HEADER.FIELDS (SUBJECT FROM DATE MESSAGE-ID)] {100}\r\nSubject: Reservation confirmed\r\nFrom: Airbnb <automated@airbnb.com>\r\nDate: Sat, 05 Sep 2026 10:00:00 +0000\r\nMessage-ID: <synthetic@airbnb.com>\r\n\r\n BODY[1] {${text.length}}\r\n${text}\r\n)\r\nA4 OK done\r\n`;
function setup(text) {
  const c={id:'a',reservationCode:'HMTEST000001',guestName:'Synthetic Guest',checkIn:'2026-11-01',checkOut:'2026-12-01',adults:1,nights:30,steps:[]};
  const values=new Map([['cases',JSON.stringify([c])]]);let writes=0,notifications=0;
  const env={CASES:{get:async k=>values.get(k)||null,put:async(k,v)=>{if(k==='cases')writes++;values.set(k,v);}}};
  const deps={imap:{open:async()=>{},close:async()=>{},searchRaw:async q=>q.includes('reservation confirmed')?[1]:[],fetchMessage:async()=>raw(text)},notify:async()=>{notifications++;return true;}};
  return {env,deps,values,c,counts:()=>({writes,notifications})};
}
const body='Guest: Synthetic Guest\nHMTEST000001\nCheck-in Nov 1, 2026\nCheckout Dec 1, 2026\n1 adult';
test('duplicate confirmation neither rewrites a case nor increments booking changes',async()=>{
  const {env,deps,counts}=setup(body);const result=await pollMail(env,deps);
  assert.equal(result.bookingChanges||0,0);assert.equal(counts().writes,0);
});
test('incomplete update to an existing reservation stays in triage without overwriting the stay',async()=>{
  const {env,deps,values,c,counts}=setup(body.replace('1 adult',''));
  assert.equal((await pollMail(env,deps)).alerts,1);
  assert.deepEqual(JSON.parse(values.get('cases')),[c]);
  assert.ok(JSON.parse(values.get('mail-seen')).ambiguous['1']);
  assert.ok(!JSON.parse(values.get('mail-seen')).uids.includes('b1'));
  await pollMail(env,deps);assert.equal(counts().notifications,1);assert.equal(counts().writes,0);
});
test('complete changed confirmation updates the existing case once',async()=>{
  const {env,deps,values}=setup(body.replace('Nov 1','Nov 8').replace('Dec 1','Dec 8'));
  assert.equal((await pollMail(env,deps)).bookingChanges,1);
  assert.equal(JSON.parse(values.get('cases'))[0].checkIn,'2026-11-08');
  assert.equal((await pollMail(env,deps)).bookingChanges||0,0);
});
