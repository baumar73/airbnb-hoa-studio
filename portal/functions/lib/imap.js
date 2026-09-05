// Minimal IMAP client for Cloudflare Workers (imap.gmail.com:993, implicit TLS).
// Supports Gmail's X-GM-RAW search extension and simple body fetches — enough
// for polling booking confirmations and HOA replies.
import { connect } from 'cloudflare:sockets';

export class Imap {
  constructor({timeoutMs=15000}={}) { this.tagN = 0; this.buf = '';this.timeoutMs=timeoutMs;this.closed=false; }

  async bounded(operation) {
    let timer;
    try {return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>{
      this.closed=true;
      try {Promise.resolve(this.sock?.close()).catch(()=>{});} catch { /* best effort transport abort */ }
      reject(new Error('IMAP transport timeout'));
    },this.timeoutMs);})]);} finally {clearTimeout(timer);}
  }

  async open(user, pass, host) {
    this.sock = connect((host || 'imap.gmail.com') + ':993', { secureTransport: 'on', allowHalfOpen: false });
    this.w = this.sock.writable.getWriter();
    this.r = this.sock.readable.getReader();
    this.dec = new TextDecoder();
    this.enc = new TextEncoder();
    await this.bounded(this.readUntil(/^\* (OK|PREAUTH)/m));
    await this.cmd(`LOGIN ${JSON.stringify(user)} ${JSON.stringify(pass)}`);
    await this.selectMailbox('INBOX');
  }

  async selectMailbox(name) {
    // Read-only mailbox access. Non-ASCII names need verified IMAP encoding.
    if(!/^[\x20-\x7e]{1,200}$/.test(String(name||''))) throw new Error('Invalid IMAP mailbox name');
    await this.cmd('EXAMINE '+JSON.stringify(name));
  }

  async readMore() {
    const { value, done } = await this.r.read();
    if (done) throw new Error('IMAP connection closed');
    this.buf += this.dec.decode(value, { stream: true });
  }

  async readUntil(re) {
    for (let i = 0; i < 300; i++) {
      const m = this.buf.match(re);
      if (m) { const out = this.buf; this.buf = ''; return out; }
      await this.readMore();
    }
    throw new Error('IMAP read timeout');
  }

  async cmd(c) {
    if(this.closed) throw new Error('IMAP connection closed');
    const tag = 'A' + (++this.tagN);
    const re = new RegExp(`^${tag} (OK|NO|BAD)([^\\r\\n]*)`, 'm');
    const resp = await this.bounded((async()=>{
      await this.w.write(this.enc.encode(`${tag} ${c}\r\n`));
      return this.readUntil(re);
    })());
    const m = resp.match(re);
    if (m[1] !== 'OK') throw new Error(`IMAP command rejected (${m[1]})`);
    return resp;
  }

  // Gmail search syntax, returns UIDs (ascending)
  async searchRaw(query) {
    const resp = await this.cmd(`UID SEARCH X-GM-RAW ${JSON.stringify(query)}`);
    const m = resp.match(/\* SEARCH((?: \d+)*)/);
    return m ? m[1].trim().split(/\s+/).filter(Boolean).map(Number) : [];
  }

  // returns raw response containing headers + first MIME part text
  async fetchMessage(uid) {
    return this.cmd(`UID FETCH ${uid} (BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE MESSAGE-ID REPLY-TO REFERENCES)] BODY.PEEK[1])`);
  }

  async fetchFullMessage(uid) {
    if(!/^\d+$/.test(String(uid))) throw new Error('Invalid IMAP UID');
    const raw=await this.cmd(`UID FETCH ${uid} (BODY.PEEK[]<0.131073>)`);
    const marker=raw.match(/BODY\[\](?:<0>)?\s*\{(\d+)\}\r\n/i);
    if(!marker) throw new Error('Incomplete IMAP message');
    const start=(marker.index||0)+marker[0].length,close=raw.match(/(\r?\n?)\)\r\nA\d+ (?:OK|NO|BAD)/i);
    const end=close&&close.index>=start?close.index+close[1].length: -1;
    if(end<start) throw new Error('Incomplete IMAP message');
    const size=Number(marker[1]),body=raw.slice(start,end);
    if(!Number.isSafeInteger(size)||size!==new TextEncoder().encode(body).length||size>131072) throw new Error('Incomplete IMAP message');
    return body;
  }

  async close() {
    try { await this.cmd('LOGOUT'); } catch (e) {}
    try { await this.bounded(this.sock.close()); } catch (e) {}
    this.closed=true;
  }
}

// Decode a fetched message blob into { subject, from, text } (best effort).
export function decodeMessage(raw) {
  const header=raw.split(/BODY\[1\]/i)[0];
  const subjM = header.match(/^Subject: ([^\r\n]+(?:\r\n[ \t][^\r\n]+)*)/mi);
  let subject = subjM ? subjM[1].replace(/\r\n[ \t]/g, ' ') : '';
  // RFC2047 encoded words
  subject = subject.replace(/=\?utf-8\?B\?([^?]+)\?=/gi, (_, b) => {
    try { return decodeURIComponent(escape(atob(b))); } catch (e) { return _; }
  }).replace(/=\?utf-8\?Q\?([^?]+)\?=/gi, (_, q) => {
    try { return q.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))); } catch (e) { return _; }
  });
  const fromM = header.match(/^From: ([^\r\n]+)/mi);
  const dateM = header.match(/^Date: ([^\r\n]+)/mi);
  const messageIdM=header.match(/^Message-ID:[ \t]*([^\r\n]*(?:\r\n[ \t]+[^\r\n]*)*)/mi);
  const replyTo=header.match(/^Reply-To:[ \t]*([^\r\n]*(?:\r\n[ \t]+[^\r\n]*)*)/mi)?.[1]?.replace(/\r\n[ \t]+/g,' ')||'';
  const replyToCount=[...header.matchAll(/^Reply-To:/gmi)].length;
  const messageIdCount=[...header.matchAll(/^Message-ID:/gmi)].length;
  let date = null;
  if (dateM) { const d = new Date(dateM[1]); if (!isNaN(d)) date = d.toISOString(); }

  const bodyM = raw.match(/BODY\[1\][^{]*\{\d+\}\r?\n([\s\S]*?)(?=\r?\n\)?\r?\nA\d+ (?:OK|NO|BAD))/i);
  let text = bodyM ? bodyM[1] : raw.replace(/[\s\S]*?\r?\n\r?\n/, '');
  // quoted-printable artifacts
  text = text.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  // long base64 blocks -> try decode
  text = text.replace(/(?:[A-Za-z0-9+/]{60,}\r?\n)+[A-Za-z0-9+/=]*/g, (blk) => {
    try { return decodeURIComponent(escape(atob(blk.replace(/\s+/g, '')))); } catch (e) { return blk; }
  });
  const replyText=text.replace(/<blockquote\b[\s\S]*?<\/blockquote>/gi,'').replace(/<(?:br|\/p|\/div)\b[^>]*>/gi,'\n').replace(/<[^>]+>/g,' ');
  // strip html
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ');
  return { subject, from: fromM ? fromM[1] : '', date, text,replyText,messageId:messageIdM?.[1]?.replace(/\r\n[ \t]+/g,' ').trim()||null,replyTo,replyToCount,messageIdCount };
}
