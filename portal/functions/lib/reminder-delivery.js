import {singleMailAddress,validMessageId} from './mail-headers.js';
const DAY=86400000;
export const REMINDER_HISTORY_LIMIT=100;
const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
export const recipientDigest=address=>digest(String(address).trim().toLowerCase());

function fields(raw) {
  const result=new Map();
  for(const line of raw.replace(/\r\n[ \t]+/g,' ').split('\r\n')) {
    if(!line)continue;
    const m=line.match(/^([A-Za-z0-9-]+):[ \t]*(.*)$/);if(!m)return null;
    const key=m[1].toLowerCase();result.set(key,[...(result.get(key)||[]),m[2].trim()]);
  }
  return result;
}
const one=(headers,key)=>headers?.get(key)?.length===1?headers.get(key)[0]:null;
function entity(raw) {
  const split=raw.indexOf('\r\n\r\n');if(split<0||split>16000)return null;
  const headers=fields(raw.slice(0,split));if(!headers)return null;
  return {headers,body:raw.slice(split+4)};
}
function parameter(type,name) {
  const matches=[...type.matchAll(new RegExp(';\\s*'+name+'\\s*=\\s*(?:"([^"\\r\\n]+)"|([^;\\s]+))','gi'))];
  return matches.length===1?(matches[0][1]||matches[0][2]):null;
}

// Conservative RFC 3464 subset, not a general mail parser. Only structured
// delivery-status plus returned original headers can match a sent reminder.
// Unsupported/ambiguous MIME is not guessed from prose or subject keywords.
export function parseDeliveryReport(raw) {
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>131072)return null;
  const outer=entity(raw);if(!outer)return null;
  const type=one(outer.headers,'content-type')||'';
  if(!/^multipart\/report\s*;/i.test(type)||parameter(type,'report-type')?.toLowerCase()!=='delivery-status')return null;
  const boundary=parameter(type,'boundary');if(!boundary||! /^[A-Za-z0-9'()+_,./:=? -]{1,70}$/.test(boundary)||boundary.endsWith(' '))return null;
  const escaped=boundary.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const segments=outer.body.split(new RegExp('(?:^|\\r\\n)--'+escaped+'(--)?[ \\t]*(?:\\r\\n|$)'));
  // Three report parts, with a mandatory closing boundary. Reject nesting,
  // missing terminators and extra report parts rather than partial matching.
  if(segments.length!==9||segments[1]||segments[3]||segments[5]||segments[7]!=='--')return null;
  const parts=[segments[2],segments[4],segments[6]].map(entity);if(parts.some(p=>!p))return null;
  const kind=p=>(one(p.headers,'content-type')||'').split(';')[0].trim().toLowerCase();
  if(kind(parts[1])!=='message/delivery-status'||!['message/rfc822','text/rfc822-headers'].includes(kind(parts[2])))return null;
  for(const p of [outer,parts[1],parts[2]]) {
    const encoding=one(p.headers,'content-transfer-encoding');
    if(p.headers.has('content-transfer-encoding')&&(!encoding||!['7bit','8bit','binary'].includes(encoding.toLowerCase())))return null;
  }
  const original=fields(parts[2].body.split('\r\n\r\n')[0]),messageId=one(original,'message-id');
  if(!validMessageId(messageId))return null;
  const blocks=parts[1].body.trim().split('\r\n\r\n').map(fields);
  if(blocks.length<2||blocks.length>21||!one(blocks[0],'reporting-mta'))return null;
  const recipients=[];
  for(const block of blocks.slice(1)) {
    const final=one(block,'final-recipient'),action=one(block,'action')?.toLowerCase(),status=one(block,'status');
    const recipient=final?.match(/^rfc822;\s*(.+)$/i)?.[1];
    if(!recipient||singleMailAddress(recipient)!==recipient||!['failed','delayed'].includes(action)||! /^[45]\.\d{1,3}\.\d{1,3}$/.test(status||'')||status[0]!==({failed:'5',delayed:'4'})[action])return null;
    recipients.push({recipient,action,status});
  }
  const from=singleMailAddress(one(outer.headers,'from')),date=one(outer.headers,'date');
  if(!from||!date||!Number.isFinite(Date.parse(date)))return null;
  return {from,date,messageId,recipients};
}

export function pendingDeliveryNotices(c) {
  return (c.automation?.reminderAttempts||[]).flatMap(attempt=>Object.values(attempt.deliveryNotices||{}).filter(n=>!n.reviewedAt).map(n=>({...n,messageId:attempt.messageId})));
}
export async function applyDeliveryReport(raw,cases,senders,now=new Date()) {
  const report=parseDeliveryReport(raw);
  if(!report||!senders.includes(report.from.toLowerCase())||Date.parse(report.date)>+now+300000||+now-Date.parse(report.date)>90*DAY)return 0;
  const matches=cases.flatMap(c=>(c.automation?.reminderAttempts||[]).filter(a=>a.messageId===report.messageId).map(attempt=>({c,attempt})));
  if(matches.length!==1)return 0;
  const {attempt}=matches[0];
  if(!['claimed','sent','uncertain'].includes(attempt.state)||!Number.isFinite(Date.parse(attempt.claimedAt))||Date.parse(report.date)<Date.parse(attempt.claimedAt)-300000)return 0;
  let changed=0;
  for(const recipient of report.recipients) {
    if(await recipientDigest(recipient.recipient)!==attempt.recipientHash||attempt.deliveryNotices?.[recipient.action])continue;
    // A header allowlist is not cryptographic sender authentication. This is a
    // review hold, never a confirmed bounce, successful delivery or retry grant.
    attempt.deliveryNotices={...attempt.deliveryNotices,[recipient.action]:{action:recipient.action,status:recipient.status,sourceHash:await digest(raw),receivedAt:now.toISOString()}};
    changed++;
  }
  return changed;
}

export function reviewDeliveryNotice(c,messageId,sourceHash,by,now=new Date()) {
  const attempt=c.automation?.reminderAttempts?.find(a=>a.messageId===messageId);
  const notice=Object.values(attempt?.deliveryNotices||{}).find(n=>n.sourceHash===sourceHash&&!n.reviewedAt);
  if(!notice||!by)return false;
  notice.reviewedAt=now.toISOString();notice.reviewedBy=by;
  // Do not release an uncertain SMTP claim or requeue the original message.
  return true;
}

export async function pollReminderDelivery(env,imap,cases) {
  if(env.REMINDER_DELIVERY_MONITOR!=='yes')return 0;
  const senders=String(env.REMINDER_DELIVERY_SENDERS||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
  if(!env.CASE_STORE||env.REQUIRE_ATOMIC_CASES!=='yes'||!env.REMINDER_DELIVERY_MAILBOX||!senders.length||senders.length>10||senders.some(s=>singleMailAddress(s)!==s))throw Error('Delivery monitor configuration incomplete');
  await imap.selectMailbox(env.REMINDER_DELIVERY_MAILBOX);
  const uids=await imap.searchRaw('from:('+senders.join(' OR ')+') newer_than:90d');
  if(uids.length>200)throw Error('Delivery monitor safe batch limit exceeded');
  let count=0;
  for(const uid of uids)count+=await applyDeliveryReport(await imap.fetchFullMessage(uid),cases,senders);
  return count;
}
