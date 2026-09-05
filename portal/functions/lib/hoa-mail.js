import {parseDates} from './parse.js';
import {encryptPrivateJson,decryptPrivateJson} from './storage.js';

const DAY=86400000;
const clean=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
function senderAddress(from) {
  const value=String(from||'').trim();
  const bracket=value.match(/^[^<>]*<([^<>]+)>$/);
  const address=(bracket?bracket[1]:value).trim().toLowerCase();
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(address)?address:'';
}
export function configuredHoaSenders(env) {
  return [...new Set(String(env.HOA_MAIL_SENDERS||'').split(',').map(s=>s.trim().toLowerCase()).filter(s=>s&&s===senderAddress(s)))];
}
export function currentReply(text) {
  // Classify only the new prose, never quoted approvals or forwarded history.
  // This is a conservative triage aid, NOT an authority/authenticity check.
  return String(text||'').split(/\r?\n/).filter(line=>!/^\s*>/.test(line))
    .join('\n').split(/(?:^|\n)\s*(?:On .{1,300}wrote:|Am .{1,300}schrieb.{0,80}:|-{2,}\s*(?:Original Message|Forwarded message|Ursprüngliche Nachricht)|From:\s|Von:\s)/i)[0].slice(0,12000);
}
export function analyseHoaReply(msg,cases,allowedSenders=[]) {
  const reply=currentReply(msg.replyText??msg.text),text=clean(reply);
  const categories=[];
  if(/\b(?:missing|incomplete|please (?:provide|send|complete|sign)|fehlt|fehlende)\b/.test(text)) categories.push('missing_items');
  if(/\b(?:denied|rejected|not approved|declined|abgelehnt)\b/.test(text)) categories.push('adverse_response');
  if(!/\b(?:not|pending|awaiting|denied|rejected|if|once|until)\b/.test(text)&&/\b(?:approved|genehmigt)\b/.test(text)) categories.push('approval_candidate');
  if(!/\b(?:not|pending|awaiting|if|once|until)\b/.test(text)&&/\b(?:payment|check|cheque|money order|fee)\b/.test(text)&&/\b(?:received|cleared|paid in full)\b/.test(text)) categories.push('payment_receipt');
  if(!/\b(?:not|pending|awaiting|if|once|until)\b/.test(text)&&/\b(?:application|package|documents|paperwork)\b/.test(text)&&/\b(?:received|receipt confirmed)\b/.test(text)) categories.push('package_receipt');
  if(!categories.length) categories.push('other');
  const result={caseId:null,categories,reviewRequired:true,matchReason:'no_unique_reservation'};
  if(!allowedSenders.length) return {...result,matchReason:'sender_not_configured'};
  if(!allowedSenders.includes(senderAddress(msg.from))) return {...result,matchReason:'sender_not_allowlisted'};
  const context=String(msg.subject||'')+'\n'+reply;
  const codes=[...new Set((context.match(/\bHM[A-Z0-9]{8,12}\b/gi)||[]).map(s=>s.toUpperCase()))];
  const dates=[...new Set([...(context.match(/\b\d{4}-\d{2}-\d{2}\b/g)||[]),...parseDates(context)])];
  if(codes.length) {
    if(codes.length!==1) return {...result,matchReason:'multiple_reservations'};
    const matches=cases.filter(c=>String(c.reservationCode||'').toUpperCase()===codes[0]);
    if(matches.length!==1) return {...result,matchReason:'unknown_or_duplicate_code'};
    if(dates.length>=2&&(!dates.includes(matches[0].checkIn)||!dates.includes(matches[0].checkOut))) return {...result,matchReason:'stay_mismatch'};
    return {...result,caseId:matches[0].id,matchReason:'reservation_code'};
  }
  const normalized=' '+clean(context)+' ';
  const matches=cases.filter(c=>clean(c.guestName).split(' ').length>=2&&normalized.includes(' '+clean(c.guestName)+' ')&&dates.includes(c.checkIn)&&dates.includes(c.checkOut));
  return matches.length===1?{...result,caseId:matches[0].id,matchReason:'name_and_stay'}:result;
}

export async function archiveHoaReply(env,msg,analysis,cases,now=new Date()) {
  // Content hash, not IMAP UID or a sender-supplied Message-ID alone. Repeated
  // retrieval is stable even after moving folders/UIDVALIDITY changes.
  const source={messageId:String(msg.messageId||'').slice(0,500),from:String(msg.from||'').slice(0,500),subject:String(msg.subject||'').slice(0,500),date:msg.date||null,text:String(msg.text||'').slice(0,24000),truncated:String(msg.text||'').length>24000};
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(source)));
  const id=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  const key='hoa-mail:'+id;
  const previous=await env.CASES.get(key);
  let stored=previous?JSON.parse(previous):null;
  if(!stored) {
    const c=cases.find(c=>c.id===analysis.caseId);
    const checkout=Date.parse((c?.checkOut||'')+'T23:59:59Z');
    const retentionEnd=Math.max(now.getTime(),Number.isFinite(checkout)?checkout:0)+90*DAY;
    stored={...await encryptPrivateJson(env,key,source),archivedAt:now.toISOString(),expiresAt:c?.legalHold?null:new Date(retentionEnd).toISOString()};
    await saveArchive(env,key,stored,now);
  } else {
    await extendRetention(env,key,stored,cases.find(c=>c.id===analysis.caseId),now);
  }
  return {id,processed:!!stored.processedAt,at:stored.archivedAt,mailDate:source.date,caseId:analysis.caseId,categories:analysis.categories,matchReason:analysis.matchReason,reviewRequired:true,
    // Existing news cards and read-only integrations receive metadata only.
    from:'HOA email',subject:'HOA correspondence: '+analysis.categories.join(', '),excerpt:analysis.caseId?'Linked to a reservation; source verification pending.':'Unassigned; source verification pending.'};
}
async function saveArchive(env,key,stored,now) {
  const options=stored.expiresAt?{expirationTtl:Math.max(60,Math.ceil((Date.parse(stored.expiresAt)-now.getTime())/1000))}:undefined;
  await env.CASES.put(key,JSON.stringify(stored),options);
}
async function extendRetention(env,key,stored,c,now) {
  if(!c||!stored.expiresAt) return; // Releasing an existing hold is never inferred.
  const end=Date.parse((c.checkOut||'')+'T23:59:59Z')+90*DAY;
  if(c.legalHold) stored.expiresAt=null;
  else if(Number.isFinite(end)&&end>Date.parse(stored.expiresAt)) stored.expiresAt=new Date(end).toISOString();
  else return;
  await saveArchive(env,key,stored,now);
}
export async function refreshHoaArchiveRetention(env,cases,now=new Date()) {
  // Include linked messages outside the 90-day mailbox search window too.
  for(const c of cases) for(const event of c.hoaMailEvents||[]) {
    if(!/^[a-f0-9]{64}$/.test(event.id||'')) continue;
    const key='hoa-mail:'+event.id,raw=await env.CASES.get(key);
    if(raw) await extendRetention(env,key,JSON.parse(raw),c,now);
  }
}
export async function markHoaReplyProcessed(env,id,now=new Date()) {
  if(!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid HOA message reference');
  const key='hoa-mail:'+id,raw=await env.CASES.get(key);
  if(!raw) throw new Error('HOA source archive is missing');
  const stored=JSON.parse(raw);
  if(!stored.processedAt) {stored.processedAt=now.toISOString();await saveArchive(env,key,stored,now);}
}
export async function readHoaReply(env,id) {
  if(!/^[a-f0-9]{64}$/.test(String(id||''))) return null;
  const key='hoa-mail:'+id,raw=await env.CASES.get(key);
  return raw?decryptPrivateJson(env,key,JSON.parse(raw)):null;
}
