import {hoaCaseContext} from './hoa-evidence.js';
import {singleMailAddress,validMessageId} from './mail-headers.js';
const DAY=86400000;
const hash=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
const fresh=(date,now)=>Number.isFinite(Date.parse(date))&&Date.parse(date)<=+now+300000&&+now-Date.parse(date)<=30*DAY;
const relayAddress=value=>{const address=singleMailAddress(value);return address.endsWith('@reply.airbnb.com')?address:'';};

// This is candidate discovery, NOT sender authentication or send authority.
// Booking codes in guest-controlled prose cannot authorize outbound delivery.
export async function captureAirbnbRelay(msg,cases,now=new Date()) {
  const from=singleMailAddress(msg.from),to=relayAddress(msg.replyTo);
  if(!/@(?:[A-Za-z0-9-]+\.)*airbnb\.com$/.test(from)||!to||msg.replyToCount!==1||msg.messageIdCount!==1||!validMessageId(msg.messageId)||!fresh(msg.date,now))return false;
  const subject=String(msg.subject||'');
  if(!subject||subject.length>400||/[\r\n\0]/.test(subject)||/reservation confirmed|buchung bestätigt|canceled|cancelled|storniert/i.test(subject))return false;
  const codes=[...new Set(((subject+'\n'+String(msg.text||'')).match(/\bHM[A-Z0-9]{8,12}\b/gi)||[]).map(v=>v.toUpperCase()))];
  if(codes.length!==1)return false;
  const matches=cases.filter(c=>c.reservationCode===codes[0]&&c.status!=='canceled');
  if(matches.length!==1)return false;
  const c=matches[0],context=hoaCaseContext(c);
  const source={to,from,subject,messageId:msg.messageId,date:msg.date,context};
  const sourceHash=await hash(JSON.stringify(source)),recipientHash=await hash(to.toLowerCase());
  const previous=c.airbnbRelay?.candidate;
  if(previous?.sourceHash===sourceHash||previous&&Date.parse(previous.date)>Date.parse(source.date))return false;
  c.airbnbRelay={...c.airbnbRelay,candidate:{...source,sourceHash,recipientHash,observedAt:now.toISOString()}};
  // Changed destination/context can never inherit an older verification.
  const verified=c.airbnbRelay.verified;
  if(verified&&(verified.to!==to||verified.context!==context)) {delete c.airbnbRelay.verified;delete c.airbnbRelayKey;}
  return true;
}

export function verifyAirbnbRelay(c,sourceHash,{attested,by}={},now=new Date()) {
  const candidate=c.airbnbRelay?.candidate;
  if(c.status==='canceled'||attested!==true||!by||!candidate||candidate.sourceHash!==sourceHash||candidate.context!==hoaCaseContext(c)||!fresh(candidate.date,now)||!relayAddress(candidate.to)||!validMessageId(candidate.messageId))return false;
  c.airbnbRelay.verified={...candidate,verifiedAt:now.toISOString(),verifiedBy:by};
  c.airbnbRelayKey=candidate.recipientHash;
  return true;
}

export function usableAirbnbRelay(c,now=new Date()) {
  const v=c?.airbnbRelay?.verified;
  if(!v||c.status==='canceled'||v.context!==hoaCaseContext(c)||!fresh(v.date,now)||!v.verifiedAt||v.recipientHash!==c.airbnbRelayKey||!relayAddress(v.to)||!validMessageId(v.messageId))return null;
  return v;
}
