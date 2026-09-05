// Minimal SMTP client for Cloudflare Workers (smtp.gmail.com:465, implicit TLS)
// plus a small MIME builder with attachment support.
import { connect } from 'cloudflare:sockets';
import { validateEmailAddress } from './workflow.js';

function b64(str) { return btoa(unescape(encodeURIComponent(str))); }
function bytesToB64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}
const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');

export function buildMime({ fromName, from, to, cc, subject, text, attachments }) {
  const boundary = 'ISLA' + crypto.randomUUID().replace(/-/g, '');
  const headers = [
    `From: ${fromName ? `"${fromName}" ` : ''}<${from}>`,
    `To: ${to.join(', ')}`,
    cc && cc.length ? `Cc: ${cc.join(', ')}` : null,
    `Subject: =?UTF-8?B?${b64(subject)}?=`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].filter(Boolean).join('\r\n');
  let body = `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${wrap76(b64(text))}\r\n`;
  for (const att of attachments || []) {
    body += `--${boundary}\r\nContent-Type: application/pdf; name="${att.filename}"\r\n` +
      `Content-Disposition: attachment; filename="${att.filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
      wrap76(bytesToB64(att.bytes)) + '\r\n';
  }
  body += `--${boundary}--\r\n`;
  return headers + '\r\n\r\n' + body;
}

export async function sendViaGmail(env, { to, cc, subject, text, attachments, fromName }, openSocket=connect) {
  const user = env.GMAIL_USER || 'contact008@example.test';
  const pass = env.GMAIL_APP_PASSWORD;
  const recipients = [...(to || []), ...(cc || [])];
  if (!validateEmailAddress(user) || !recipients.length || recipients.some(r => !validateEmailAddress(r))) {
    throw new Error('invalid email address');
  }
  if (/[\r\n\0]/.test(String(subject || '')) || /[\r\n\0]/.test(String(fromName || ''))) {
    throw new Error('invalid email header');
  }
  if (!pass) throw new Error('GMAIL_APP_PASSWORD not configured');
  const rcpts = recipients;
  const mime = buildMime({ fromName: fromName || 'Property Owner', from: user, to, cc, subject, text, attachments });

  const sock = openSocket('smtp.gmail.com:465', { secureTransport: 'on', allowHalfOpen: false });
  const writer = sock.writable.getWriter();
  const reader = sock.readable.getReader();
  const dec = new TextDecoder(), enc = new TextEncoder();
  let buf = '';
  async function readReply() {
    // collect until final line "NNN " (space after code)
    for (let i = 0; i < 50; i++) {
      const lines = buf.split('\r\n');
      for (const ln of lines) if (/^\d{3} /.test(ln)) { const out = buf; buf = ''; return out; }
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
    }
    const out = buf; buf = ''; return out;
  }
  async function cmd(line, expect) {
    if (line !== null) await writer.write(enc.encode(line + '\r\n'));
    const reply = await readReply();
    if (expect && !reply.trim().split('\r\n').pop().startsWith(String(expect))) {
      // AUTH commands contain encoded credentials. Never include the command
      // or untrusted server text in an error stored on a guest case.
      throw new Error(`SMTP response did not match expected status ${expect}`);
    }
    return reply;
  }
  try {
    await cmd(null, 220);
    await cmd('EHLO portal.example.test', 250);
    await cmd('AUTH LOGIN', 334);
    await cmd(btoa(user), 334);
    await cmd(btoa(pass), 235);
    await cmd(`MAIL FROM:<${user}>`, 250);
    for (const r of rcpts) await cmd(`RCPT TO:<${r}>`, 250);
    await cmd('DATA', 354);
    const dotStuffed = mime.replace(/\r\n\./g, '\r\n..');
    await writer.write(enc.encode(dotStuffed + '\r\n.\r\n'));
    await cmd(null, 250);
    // The final DATA 250 is acceptance. A lost QUIT response cannot undo it
    // and must not convert an accepted message into a retryable failure.
    try {await cmd('QUIT', 221);} catch { /* message already accepted */ }
  } finally {
    try { await sock.close(); } catch (e) {}
  }
  return true;
}

export async function sendTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  return resp.ok;
}
