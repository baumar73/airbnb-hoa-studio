import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./loaders/cloudflare-sockets-loader.mjs',import.meta.url);
const {sendViaGmail}=await import('../functions/lib/email.js');

function fakeSocket({rejectAuth=false,failQuit=false}={}) {
  let controller,authStep=0,inData=false;
  const encoder=new TextEncoder(),decoder=new TextDecoder();
  const reply=text=>controller.enqueue(encoder.encode(text+'\r\n'));
  const readable=new ReadableStream({start(c){controller=c;reply('220 synthetic SMTP');}});
  const writable=new WritableStream({write(data){
    const command=decoder.decode(data).trim();
    if(inData){inData=false;reply('250 message accepted');return;}
    if(command==='AUTH LOGIN'){authStep=1;reply('334 username');return;}
    if(authStep===1){authStep=2;reply('334 password');return;}
    if(authStep===2){authStep=0;reply(rejectAuth?'535 authentication rejected':'235 authenticated');return;}
    if(command==='DATA'){inData=true;reply('354 send content');return;}
    if(command==='QUIT'){if(failQuit) controller.error(new Error('synthetic disconnect after acceptance'));else reply('221 goodbye');return;}
    reply('250 OK');
  }});
  return {readable,writable,close:async()=>{}};
}
const env={GMAIL_USER:'synthetic@example.test',GMAIL_APP_PASSWORD:'synthetic-private-password'};
const message={to:['guest@example.test'],cc:[],subject:'Synthetic test',text:'No real email'};
test('accepted SMTP DATA remains success when QUIT loses the connection',async()=>{
  assert.equal(await sendViaGmail(env,message,()=>fakeSocket({failQuit:true})),true);
});
test('SMTP authentication errors do not expose password or encoded password fragments',async()=>{
  try {await sendViaGmail(env,message,()=>fakeSocket({rejectAuth:true}));assert.fail('must reject');}
  catch(error){assert.match(error.message,/SMTP/);assert.doesNotMatch(error.message,new RegExp(btoa(env.GMAIL_APP_PASSWORD).slice(0,20)));assert.doesNotMatch(error.message,/synthetic-private-password/);}
});
