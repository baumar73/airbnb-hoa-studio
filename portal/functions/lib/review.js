export function needsReview(c) {
  return c.status!=='canceled' && c.wizard && c.reviewHash && c.ownerReviewReadyAt && !c.submission && !c.reviewLockedAt &&
    (c.pathType!=='full' || c.screeningRoute==='paper');
}

export async function caseReviewDigest(c,wizard,includeSignatures=true) {
  const adults=((wizard&&wizard.adults)||[]).map(a=>{
    const copy={...a};if(!includeSignatures){delete copy.sigPng;delete copy.signatureAudit;}return copy;
  });
  const payload={case:{id:c.id,guestName:c.guestName,reservationCode:c.reservationCode,checkIn:c.checkIn,checkOut:c.checkOut,adults:c.adults,expectedMinors:c.expectedMinors||0,screeningRoute:c.screeningRoute||null,pathType:c.pathType,applicationType:c.applicationType||'lease',sameLesseesConfirmed:c.sameLesseesConfirmed===true},
    wizard:{adults,esignConsent:!!wizard?.esignConsent,rulesAcknowledged:!!wizard?.rulesAcknowledged,auto:wizard?.auto||{},references:wizard?.references||[],emergency:wizard?.emergency||[],children:wizard?.children||[]}};
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export async function reviewContextHash(c, ownerSignature, compliance) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([c.reviewHash,ownerSignature||null,compliance])));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export function validateReviewReport(report) {
  if (typeof report!=='object'||Array.isArray(report)||!report) return false;
  if (![report.summary,report.model].every(s=>typeof s==='string'&&s.trim().length>0) || !Array.isArray(report.findings) || !report.findings.every(s=>typeof s==='string'&&s.trim().length>0)) return false;
  if (!report || !['green','yellow','red'].includes(report.status) || !Number.isFinite(report.confidence) || report.confidence<0 || report.confidence>1 || !Array.isArray(report.findings) || report.findings.length>20 || !report.findings.every(s=>typeof s==='string' && s.length<=1000) || typeof report.summary!=='string' || report.summary.length>2000 || typeof report.model!=='string' || report.model.length>160) return false;
  if (report.status==='green' && (report.confidence<.75 || report.findings.length)) return false;
  return true;
}

export function reviewCaseData(c) {
  // Deliberate allowlist: no access tokens, private notes or infrastructure data.
  return Object.fromEntries(['id','guestName','reservationCode','checkIn','checkOut','nights','adults','expectedMinors','pathType','screeningRoute','applicationType','sameLesseesConfirmed','reviewHash'].map(k=>[k,c[k]]));
}
