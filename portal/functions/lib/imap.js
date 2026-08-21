// Minimal IMAP client for Cloudflare Workers (imap.gmail.com:993, implicit TLS).
// Supports Gmail's X-GM-RAW search extension and simple body fetches — enough
// for polling booking confirmations and HOA replies.
import { connect } from 'cloudflare:sockets';

export class Imap {
  constructor() { this.tagN = 0; this.buf = ''; }

  async open(user, pass, host) {
    this.sock = connect((host || 'imap.gmail.com') + ':993', { secureTransport: 'on', allowHalfOpen: false });
    this.w = this.sock.writable.getWriter();
    this.r = this.sock.readable.getReader();
    this.dec = new TextDecoder();
    this.enc = new TextEncoder();
    await this.readUntil(/^\* (OK|PREAUTH)/m);
    await this.cmd(`LOGIN ${JSON.stringify(user)} ${JSON.stringify(pass)}`);
    await this.cmd('SELECT INBOX');
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
    const tag = 'A' + (++this.tagN);
    await this.w.write(this.enc.encode(`${tag} ${c}\r\n`));
    const re = new RegExp(`^${tag} (OK|NO|BAD)([^\\r\\n]*)`, 'm');
    const resp = await this.readUntil(re);
    const m = resp.match(re);
    if (m[1] !== 'OK') throw new Error(`IMAP ${m[1]}${m[2]}: ${c.slice(0, 30)}`);
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
    return this.cmd(`UID FETCH ${uid} (BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)] BODY.PEEK[1])`);
  }

  async close() {
    try { await this.cmd('LOGOUT'); } catch (e) {}
    try { await this.sock.close(); } catch (e) {}
  }
}

// Decode a fetched message blob into { subject, from, text } (best effort).
export function decodeMessage(raw) {
  const subjM = raw.match(/^Subject: ([^\r\n]+(?:\r\n[ \t][^\r\n]+)*)/mi);
  let subject = subjM ? subjM[1].replace(/\r\n[ \t]/g, ' ') : '';
  // RFC2047 encoded words
  subject = subject.replace(/=\?utf-8\?B\?([^?]+)\?=/gi, (_, b) => {
    try { return decodeURIComponent(escape(atob(b))); } catch (e) { return _; }
  }).replace(/=\?utf-8\?Q\?([^?]+)\?=/gi, (_, q) => {
    try { return q.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (__, h) => String.fromCharCode(parseInt(h, 16))); } catch (e) { return _; }
  });
  const fromM = raw.match(/^From: ([^\r\n]+)/mi);
  const dateM = raw.match(/^Date: ([^\r\n]+)/mi);
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
  // strip html
  text = text.replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
             .replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ');
  return { subject, from: fromM ? fromM[1] : '', date, text };
}
