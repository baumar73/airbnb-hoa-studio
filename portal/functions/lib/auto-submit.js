import {getEncryptedSecret,loadStoredCases,saveStoredCases} from './storage.js';
import {caseReviewDigest,reviewContextHash,validateReviewReport} from './review.js';
import {validateSignaturePng,isReadyForOwnerReview,validateLiveSubmissionPrerequisites,validateAirbnbCaseInput} from './workflow.js';
import {liveComplianceState} from './compliance.js';
import {loadArchivedPackage} from './package-archive.js';
import {submitApprovedPackage} from './submit.js';

export async function automaticReleaseState(c,env,ownerSignature,compliance) {
  const missing=[];
  if(env.AUTO_HOA_SUBMIT!=='yes') missing.push('automation_disabled');
  if(env.OWNER_SIGNATURE_AUTHORIZATION!=='hoa-paperwork-v1'||!env.OWNER_AUTHORIZATION_REFERENCE) missing.push('standing_owner_authorization');
  if(!env.CASE_STORE||env.REQUIRE_ATOMIC_CASES!=='yes') missing.push('atomic_storage');
  if(c.status==='canceled'||c.submission||c.reviewLockedAt) missing.push('case_not_available');
  if(c.reservationCode && (!validateAirbnbCaseInput(c).ok||c.pathType!=='full')) missing.push('paid_rental_policy');
  if(c.pathType==='full' && c.screeningRoute!=='paper') missing.push('external_or_unselected_route');
  if(!isReadyForOwnerReview(c,validateSignaturePng(ownerSignature))) missing.push('incomplete_paperwork');
  missing.push(...validateLiveSubmissionPrerequisites(c).missing);
  if(!liveComplianceState(c,compliance,env).ok) missing.push('compliance_configuration');
  const contextHash=await reviewContextHash(c,ownerSignature,compliance);
  const review=c.aiReview,prepared=c.preparedPackage;
  if(!review||!validateReviewReport(review)||review.status!=='green'||review.reviewHash!==c.reviewHash||review.reviewContextHash!==contextHash||await caseReviewDigest(c,c.wizard)!==c.reviewHash) missing.push('current_green_review');
  if(!prepared||prepared.reviewHash!==c.reviewHash||prepared.contextHash!==contextHash||review?.packageId!==prepared.id||review?.packageHash!==prepared.packageHash) missing.push('reviewed_immutable_package');
  return {ok:missing.length===0,missing};
}

export async function runAutomaticSubmissions(env,now=new Date(),submit=submitApprovedPackage) {
  const summary={sent:0,blocked:0,conflicts:0,failed:0};
  if(env.AUTO_HOA_SUBMIT!=='yes'||await env.CASES.get('submit-live')!=='yes') return {...summary,disabled:true};
  const ids=(await loadStoredCases(env)).map(c=>c.id);
  for(const id of ids) {
    const cases=await loadStoredCases(env),c=cases.find(c=>c.id===id);
    if(!c||new Date(c.checkOut+'T23:59:59Z')<now) continue;
    const ownerSignature=await getEncryptedSecret(env,'owner-signature-png');
    const compliance=JSON.parse(await env.CASES.get('compliance-config')||'{}');
    const state=await automaticReleaseState(c,env,ownerSignature,compliance);
    if(!state.ok){summary.blocked++;continue;}
    // Integrity validation is before the irreversible delivery claim.
    try {await loadArchivedPackage(env,c);} catch {summary.failed++;continue;}
    c.ownerApprovedAt=now.toISOString();c.ownerApprovedBy='standing-owner-authorization';
    c.ownerApprovedReviewHash=c.reviewHash;c.reviewLockedAt=now.toISOString();
    c.autoRelease={authorization:env.OWNER_AUTHORIZATION_REFERENCE,scope:'hoa-paperwork-v1',at:now.toISOString(),packageId:c.preparedPackage.id,packageHash:c.preparedPackage.packageHash};
    try {await saveStoredCases(env,cases);}
    catch(error){if(error.code==='CASE_CONFLICT'){summary.conflicts++;continue;}throw error;}
    // Dispatch only the claimed immutable package. SMTP uncertainty never
    // clears the claim, so another scheduler run cannot blindly resend it.
    if(await submit(c,cases,env)) summary.sent++; else summary.failed++;
  }
  return summary;
}
