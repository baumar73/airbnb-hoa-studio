// Compliance policy is deliberately fail-closed. The portal can prepare drafts,
// but live delivery remains blocked until the owner records the source documents
// and operational safeguards that cannot be inferred safely by software.

export const COMPLIANCE_POLICY_VERSION = 'fl-2026.09.02';

export const HOA_SOURCE_PACKET = Object.freeze({
  title: 'Palma Del Mar Condominium No. 2 - Tenant Evaluation Lease packet',
  portalDocumentId: '220785',
  downloadedAt: '2026-08-21',
  sha256: 'b521b4cb20a54f19801e24b600603a5436e9d0e95a7980b4f71dc7717b23d6fb',
  findings: Object.freeze({
    minimumLeaseMonths: 1,
    adultApplicationAge: 18,
    tenantPetsAllowed: false,
    paperApplicationFeeUsd: 100,
    boardApprovalBeforePossession: true,
  }),
});

export function isAnnualRental(c) {
  return Number(c && c.nights) >= 365;
}

export function isSameLesseeRenewal(c) {
  return Boolean(c && c.applicationType === 'renewal' && c.sameLesseesConfirmed === true);
}

export function hasValidEncryptionKey(env) {
  try {
    const raw = String(env && env.DATA_ENCRYPTION_KEY || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = raw + '='.repeat((4 - raw.length % 4) % 4);
    return atob(padded).length === 32;
  } catch (_) {
    return false;
  }
}

export function liveComplianceState(c, config, env) {
  const cfg = config || {};
  const missing = [];
  if (cfg.policyVersion !== COMPLIANCE_POLICY_VERSION) missing.push(`compliance attestation for policy ${COMPLIANCE_POLICY_VERSION}`);
  if (!hasValidEncryptionKey(env)) missing.push('32-byte DATA_ENCRYPTION_KEY');
  if (String(env && env.AUDIT_HASH_SALT || '').length < 16) missing.push('AUDIT_HASH_SALT (at least 16 characters)');
  if (!String(cfg.landlordNoticeAddress || '').trim()) missing.push('landlord notice address');
  if (!String(cfg.governingDocumentsVerifiedAt || '').trim()) missing.push('governing documents verification date');
  if (!String(cfg.approvalAuthorityCitation || '').trim()) missing.push('recorded HOA approval-authority citation');
  if (!String(cfg.rulesVersion || '').trim()) missing.push('current HOA rules version/date');
  if (!String(cfg.hoaESignAcceptedAt || '').trim()) missing.push('HOA e-signature acceptance confirmation');
  if (!String(cfg.privacySecurityReviewedAt || '').trim()) missing.push('privacy/security and breach-plan review date');
  if (!String(cfg.fairHousingReviewedAt || '').trim()) missing.push('fair-housing process review date');
  if (!isSameLesseeRenewal(c) && !String(cfg.feeAuthorityCitation || '').trim()) {
    missing.push('recorded HOA fee-authority citation');
  }
  if (!isSameLesseeRenewal(c) && !String(cfg.airbnbFeeDisclosureVerifiedAt || '').trim()) {
    missing.push('Airbnb price-breakdown/fee-field verification date');
  }
  if (isAnnualRental(c)) {
    for (const field of ['floodDamageKnown', 'floodClaimFiled', 'floodAssistanceReceived']) {
      if (!['yes', 'no'].includes(cfg[field])) missing.push(`flood disclosure answer: ${field}`);
    }
  }
  return { ok: missing.length === 0, missing, policyVersion: COMPLIANCE_POLICY_VERSION };
}

export function adverseActionNotice(data) {
  const d = data || {};
  const action = String(d.action || 'application denied');
  const cra = String(d.craName || '').trim();
  const address = String(d.craAddress || '').trim();
  const phone = String(d.craPhone || '').trim();
  if (!cra || !address || !phone) throw new Error('consumer-reporting agency name, address, and phone are required');
  return `ADVERSE ACTION NOTICE\n\nDate: ${String(d.date || '')}\nApplicant: ${String(d.applicantName || '')}\nProperty: ${String(d.property || '')}\n\nAction taken: ${action}.\n\nThis action was based in whole or in part on information in a consumer report supplied by:\n${cra}\n${address}\n${phone}\n\nThe consumer-reporting agency did not make this decision and cannot explain why the action was taken. You have the right to dispute the accuracy or completeness of information in the report and to obtain a free copy of the report from the agency if you request it within 60 days.\n\nFor a reasonable accommodation or to correct information unrelated to the consumer report, contact the housing provider through the existing Airbnb conversation.`;
}
