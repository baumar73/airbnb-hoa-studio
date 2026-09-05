import test from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./loaders/cloudflare-sockets-loader.mjs',import.meta.url);
const {sendViaGmail,buildMime,sendTelegram}=await import('../functions/lib/email.js');

test('Telegram alerts have a bounded timeout even if fetch ignores abort',async()=>{
  const settings={TELEGRAM_BOT_TOKEN:'synthetic',TELEGRAM_CHAT_ID:'123'};let signal;
  assert.equal(await sendTelegram(settings,'test',async(_,options)=>{signal=options.signal;return new Promise(()=>{});},{timeoutMs:10}),false);
  assert.equal(signal.aborted,true);
  assert.equal(await sendTelegram(settings,'test',async()=>({ok:true})),true);
  assert.equal(await sendTelegram(settings,'test',async()=>{throw Error('private provider response');}),false);
  assert.equal(await sendTelegram({},'test',()=>assert.fail('missing credentials must not fetch')),false);
});

function fakeSocket({rejectAuth=false,failQuit=false,fragment=false}={}) {
  let controller,authStep=0,inData=false;
  const encoder=new TextEncoder(),decoder=new TextDecoder();
  const reply=text=>{const value=text+'\r\n';for(const chunk of fragment?[...value]:[value])controller.enqueue(encoder.encode(chunk));};
  const readable=new ReadableStream({start(c){controller=c;reply('220 synthetic SMTP');}});
  const writable=new WritableStream({write(data){
    const command=decoder.decode(data).trim();
    if(command.startsWith('EHLO')){reply('250-synthetic\r\n250 AUTH LOGIN');return;}
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
test('SMTP reads complete lines even when every byte is a separate packet',async()=>{
  assert.equal(await sendViaGmail(env,message,()=>fakeSocket({fragment:true})),true);
});
test('SMTP rejects a truncated final response instead of accepting its prefix',async()=>{
  const socket={readable:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('220 incomplete'));c.close();}}),writable:new WritableStream({write:()=>assert.fail('must not send commands')}),close:async()=>{}};
  await assert.rejects(sendViaGmail(env,message,()=>socket),/Incomplete/);
});
test('attachment filenames cannot inject MIME headers or paths',async()=>{
  for(const filename of ['a.pdf\r\nBcc: x@y','a".pdf','../a.pdf','a\\b.pdf','', 'x'.repeat(256)]) {
    await assert.rejects(sendViaGmail(env,{...message,attachments:[{filename,bytes:new Uint8Array([1])}]},()=>assert.fail('unsafe attachment opened socket')),/attachment/);
  }
  assert.match(buildMime({...message,from:env.GMAIL_USER,attachments:[{filename:'HOA application.pdf',bytes:new Uint8Array([1,2,3])}]}),/filename="HOA application.pdf"/);
});
test('accepted SMTP DATA remains success when QUIT loses the connection',async()=>{
  assert.equal(await sendViaGmail(env,message,()=>fakeSocket({failQuit:true})),true);
});
test('SMTP authentication errors do not expose password or encoded password fragments',async()=>{
  try {await sendViaGmail(env,message,()=>fakeSocket({rejectAuth:true}));assert.fail('must reject');}
  catch(error){assert.match(error.message,/SMTP/);assert.doesNotMatch(error.message,new RegExp(btoa(env.GMAIL_APP_PASSWORD).slice(0,20)));assert.doesNotMatch(error.message,/synthetic-private-password/);}
});
test('MIME preserves exact reply thread headers and rejects injection before opening a socket',async()=>{
  const threading={messageId:'<outbound@example.com>',inReplyTo:'<inbound@airbnb.com>',references:['<older@airbnb.com>','<inbound@airbnb.com>']};
  const mime=buildMime({...message,from:env.GMAIL_USER,...threading});
  assert.match(mime,/\r\nMessage-ID: <outbound@example.com>\r\n/);assert.match(mime,/\r\nIn-Reply-To: <inbound@airbnb.com>\r\n/);
  assert.match(mime,/\r\nReferences: <older@airbnb.com> <inbound@airbnb.com>\r\n/);
  for(const fields of [{messageId:'<ok@example.com>\r\nBcc: evil@example.test'},{inReplyTo:'<one@a> <two@b>'},{references:'<a@b>'},{references:['<a@b>\r\nX: y']}]) {
    await assert.rejects(sendViaGmail(env,{...message,...fields},()=>assert.fail('unsafe headers opened socket')));
  }
});
test('SMTP timeout aborts a stalled connection and never proceeds to DATA',async()=>{
  let closed=0,written=[];
  const socket={readable:new ReadableStream(),writable:new WritableStream({write:bytes=>written.push(new TextDecoder().decode(bytes))}),close:async()=>{closed++;}};
  await assert.rejects(sendViaGmail(env,message,()=>socket,{timeoutMs:10}),/timeout/);
  assert.ok(closed);assert.equal(written.length,0);
});
test('accepted DATA remains successful when QUIT and socket close hang',async()=>{
  const socket=fakeSocket();const writer=socket.writable.getWriter();
  const wrapped={readable:socket.readable,writable:new WritableStream({write:bytes=>new TextDecoder().decode(bytes).startsWith('QUIT')?new Promise(()=>{}):writer.write(bytes)}),close:()=>new Promise(()=>{})};
  assert.equal(await sendViaGmail(env,message,()=>wrapped,{timeoutMs:10}),true);
});
