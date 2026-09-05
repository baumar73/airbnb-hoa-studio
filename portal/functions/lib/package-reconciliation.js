import {caseSnapshotVersion,saveStoredCases} from './storage.js';
import {loadArchivedPackage} from './package-archive.js';
import {caseReviewDigest} from './review.js';
import {validMessageId} from './mail-headers.js';
import {applyDeliveryOutcome} from './delivery.js';

const fail=(error,status=409)=>({ok:false,error,status});
// Reconciliation records an owner-verified sent message. It never sends mail,
// clears a release lock, grants HOA approval, or authorizes another attempt.
export async function reconcileAcceptedPackage(env,cases,c,input,now=new Date()) {
  if(!env.CASE_STORE)return fail('Atomic storage required.',503);
  if(!c||String(caseSnapshotVersion(cases,c.id))!==input.caseVersion)return fail('Reservation changed. Reload before saving.');
  if(input.reservation!==(c.reservationCode||c.guestName))return fail('Reservation mismatch.');
  if(!c.reviewLockedAt||c.submission||!c.preparedPackage||c.bookingChange?.pending||c.submissionError?.packageId)return fail('The original package and unchanged stay must be available. Keep this case held for separate reconciliation.');
  if(input.attested!==true||!input.by||!validMessageId(input.messageId))return fail('Verify the original sent message and enter its complete Message-ID.',400);
  const claimedAt=Date.parse(c.reviewLockedAt),sentAt=Date.parse(input.sentAt);
  // Avoid racing a currently active bounded SMTP operation. An old claim alone
  // proves nothing; the explicit original-message attestation is still required.
  if(!Number.isFinite(claimedAt)||now.getTime()-claimedAt<15*60000)return fail('Delivery may still be running. Wait at least 15 minutes after release.');
  if(typeof input.sentAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z$/.test(input.sentAt)||!Number.isFinite(sentAt)||sentAt<claimedAt||sentAt>now.getTime())return fail('Enter a UTC send time between release and now.',400);
  if(input.packageId!==c.preparedPackage.id||input.packageHash!==c.preparedPackage.packageHash)return fail('Package changed. Reopen the case.');
  if(!c.reviewHash||await caseReviewDigest(c,c.wizard)!==c.reviewHash)return fail('Paperwork changed. Keep the original delivery held for separate reconciliation.');
  const archive=await loadArchivedPackage(env,c);
  if(archive.manifest.reviewHash!==c.reviewHash)return fail('Archive does not match the released paperwork.');
  const submission={sentAt:new Date(sentAt).toISOString(),live:true,
    docs:archive.attachments.map(a=>a.filename),reviewHash:c.reviewHash,
    packageId:archive.manifest.id,packageHash:archive.manifest.packageHash,packageManifest:archive.manifest,
    reconciliation:{at:now.toISOString(),by:String(input.by).slice(0,100),messageId:input.messageId,source:'owner-verified-sent-mail'}};
  applyDeliveryOutcome(c,{submission,submissionError:null});
  // Do not retry a stale owner decision against a new version of the case.
  await saveStoredCases(env,cases);
  return {ok:true};
}

export function packageReconciliationView(c,getVersion,esc) {
  if(!c.reviewLockedAt||c.submission)return '';
  const packet=c.preparedPackage;
  if(!packet||c.bookingChange?.pending||c.submissionError?.packageId)return '<p class="pill warn">Prior package delivery needs separate reconciliation. Changed booking details cannot confirm or release the earlier send. Do not resend.</p>';
  let version;
  try {version=getVersion();} catch {return '<p class="pill warn">Package delivery needs reconciliation using atomic storage. Do not resend.</p>';}
  return `<details><summary>Reconcile an uncertain package delivery</summary>
    <p>Only for a package you have verified in Gmail Sent. Wait at least 15 minutes after release. Compare the original recipients, reservation, dates and attachments with this exact archived package. An empty Sent folder is not proof of non-delivery.</p>
    <p>Release: ${esc(c.reviewLockedAt)}<br>Package: ${esc(packet.id)}<br>Documents: ${esc(packet.documents.map(d=>d.filename).join(', '))}</p>
    <form method="post" action="/admin/package-delivery-reconcile">
      <input type="hidden" name="id" value="${esc(c.id)}"><input type="hidden" name="caseVersion" value="${esc(version)}">
      <input type="hidden" name="packageId" value="${esc(packet.id)}"><input type="hidden" name="packageHash" value="${esc(packet.packageHash)}">
      <label>Reservation code (or guest name for non-paying guests)<input name="reservation" required autocomplete="off"></label>
      <label>Original Message-ID (Gmail: Show original)<input name="messageId" required maxlength="250" placeholder="&lt;message-id@example.com&gt;" autocomplete="off"></label>
      <label>Send time in UTC<input name="sentAt" required placeholder="2026-09-05T12:00:00Z" autocomplete="off"></label>
      <label><input type="checkbox" name="attested" value="yes" required> I verified this original sent message, its HOA recipients, reservation, stay dates and exact attachments. This confirms sending only, not HOA receipt or approval.</label>
      <button>Record verified prior send</button>
    </form><p class="muted">Saving sends no email and does not authorize a resend. If anything is uncertain, leave this case held.</p></details>`;
}
