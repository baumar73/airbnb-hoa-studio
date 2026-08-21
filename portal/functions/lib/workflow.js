// Pure workflow policy shared by Pages and the scheduled worker.
// Guest actions may prepare a package, but only an authenticated owner action
// may submit it or confirm an approval.
import { HOA_RULE_REGISTRY, classifyOccupancy, evaluateApplicationFee, evaluateMinimumRentalTerm, evaluatePetRule } from './hoa-rules.js';

export async function bundleDigest(orderedPdfBytes) {
  const parts = (orderedPdfBytes || []).map(value => value instanceof Uint8Array ? value : new Uint8Array(value));
  const total = 4 + parts.reduce((sum, bytes) => sum + 4 + bytes.byteLength, 0);
  const framed = new Uint8Array(total);
  const view = new DataView(framed.buffer);
  view.setUint32(0, parts.length, false);
  let offset = 4;
  for (const bytes of parts) {
    view.setUint32(offset, bytes.byteLength, false);
    offset += 4;
    framed.set(bytes, offset);
    offset += bytes.byteLength;
  }
  const digest = await crypto.subtle.digest('SHA-256', framed);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function validateSignaturePng(value) {
  try {
    const raw = String(value || '');
    if (raw.length < 100 || raw.length > 400000) return false;
    const binary = atob(raw);
    if (binary.length < 33) return false;
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    const signature = [137,80,78,71,13,10,26,10];
    if (!signature.every((byte, i) => bytes[i] === byte)) return false;
    if (String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') return false;
    const dimension = offset => ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
    const width = dimension(16), height = dimension(20);
    return width >= 120 && width <= 2000 && height >= 40 && height <= 1000;
  } catch (_) { return false; }
}

export function validateEmailAddress(value) {
  const s = String(value || '').trim();
  if (!s || s.length > 254 || /[\r\n\0,;]/.test(s)) return false;
  return /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(s);
}

export function isGuestAccessibleCase(value) {
  return Boolean(value) && value.status !== 'canceled';
}

export function isValidISODate(value) {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function validateCaseInput(input) {
  const guestName = String(input && input.guestName || '').trim();
  const checkIn = String(input && input.checkIn || '');
  const checkOut = String(input && input.checkOut || '');
  const adults = Number(input && input.adults);
  if (!guestName || !isValidISODate(checkIn) || !isValidISODate(checkOut)) {
    return { ok: false, error: 'missing or malformed fields' };
  }
  if (!Number.isInteger(adults) || adults < 1 || adults > 4) {
    return { ok: false, error: 'adult count must be between 1 and 4' };
  }
  const nights = Math.round((new Date(`${checkOut}T12:00:00Z`) - new Date(`${checkIn}T12:00:00Z`)) / 86400000);
  if (!Number.isInteger(nights) || nights < 1 || nights > 366) {
    return { ok: false, error: 'invalid stay range' };
  }
  return { ok: true, nights };
}

export function validateAirbnbCaseInput(input) {
  const result = validateCaseInput(input);
  if (!result.ok) return result;
  const classification = classifyOccupancy({ ownerPresent: false, compensation: true, stayNights: result.nights });
  if (classification.kind !== 'rental') return { ok: false, error: 'occupancy classification requires manual clarification' };
  const minimumTermDecision = evaluateMinimumRentalTerm({
    rentalNights: result.nights,
    maintenanceBlockedNights: input && input.maintenanceBlockedNights,
  });
  if (minimumTermDecision.status === 'invalid') return { ok: false, error: 'maintenance blocked nights must be a whole number between 0 and 366' };
  if (minimumTermDecision.status === 'clarification_required') {
    return { ok: false, error: 'exactly 30 nights requires manual HOA clarification because the source rules conflict' };
  }
  if (Number(input && input.adults) > 2) return { ok: false, error: 'rentals with more than two adults require a separate manual HOA application package' };
  return { ...result, pathType: 'full', occupancyKind: classification.kind,
    ruleVersionId: classification.ruleVersionId, ruleStatus: classification.ruleStatus,
    ruleSourceIds: classification.sourceIds, minimumTermDecision };
}

export function requiredPackageDocuments(pathType) {
  if (pathType !== 'full') throw new Error('Paid Airbnb rentals require the full HOA package');
  return [
    { key: 'rules-and-regulations', label: 'Rules & Regulations and signed acknowledgment' },
    { key: 'lease-agreement', label: 'Short-Term Lease Agreement' },
  ];
}

export function validateOwnerReviewAttestations(values) {
  const missing = requiredPackageDocuments('full')
    .filter(doc => !values || values[doc.key] !== 'yes')
    .map(doc => doc.key);
  return { ok: missing.length === 0, missing };
}

function hasVerifiedFeeAuthority() {
  const rule = HOA_RULE_REGISTRY.rules.find(item => item.id === 'application-fee');
  return rule?.status === 'current' &&
    rule.sourceIds.includes('CINC-364605') &&
    rule.sourceIds.includes('LEGAL-fl-718.112-bylaws-transfer-fees');
}

function hasVerifiedSameLesseeRenewal(c) {
  if (!c || c.sameLesseeRenewal !== true) return false;
  const evidence = c.renewalEvidence;
  if (!evidence || evidence.identityMatchConfirmed !== true) return false;
  if (!String(evidence.priorApprovalReference || '').trim() || !isValidISODate(evidence.priorApprovedAt)) return false;
  if (!isValidISODate(c.checkIn) || evidence.priorApprovedAt > c.checkIn) return false;
  const prior = new Date(`${evidence.priorApprovedAt}T00:00:00Z`);
  const checkIn = new Date(`${c.checkIn}T00:00:00Z`);
  const ageDays = Math.floor((checkIn - prior) / 86400000);
  return ageDays >= 0 && ageDays <= 366;
}

export function applicationFeeState(c) {
  if (!c || c.pathType !== 'full') return 'not_required';
  return evaluateApplicationFee({
    kind: 'rental',
    sameLesseeRenewalClaimed: c.sameLesseeRenewal === true,
    sameLesseeRenewalVerified: hasVerifiedSameLesseeRenewal(c),
    governingAuthorityVerified: hasVerifiedFeeAuthority(),
  }).status;
}

export function validateLiveSubmissionPrerequisites(c) {
  const required = ['vendor_handoff_confirmed', 'vendor_status_confirmed'];
  if (c && c.pathType === 'full') {
    const feeState = applicationFeeState(c);
    if (feeState === 'required') required.push('fee_sent');
    if (feeState === 'clarification_required') required.push('fee_authority_or_renewal_evidence');
  }
  const steps = (c && c.steps) || [];
  const missing = required.filter(id => !steps.some(step => step.id === id && step.done));
  return { ok: missing.length === 0, missing };
}

export function petPolicyState({ occupancyKind = 'rental', accommodationRequested = false } = {}) {
  return evaluatePetRule({ occupancyKind, accommodationRequested });
}

export function validatePaperwork(c) {
  const missing = [];
  const w = c && c.wizard;
  const expected = Number(c && c.adults);
  const adults = (w && w.adults) || [];
  if (!Number.isInteger(expected) || expected < 1 || expected > 4 || adults.length !== expected) {
    missing.push('adult count');
  }
  const common = ['firstName', 'lastName'];
  const contact = ['phone', 'email', 'street', 'city', 'state', 'zip'];
  adults.slice(0, expected).forEach((a, i) => {
    const required = [...common, ...(c.pathType === 'full' || i === 0 ? contact : [])];
    for (const field of required) {
      if (!String(a && a[field] || '').trim()) missing.push(`adult ${i + 1} ${field}`);
    }
    if (a && a.email && !validateEmailAddress(a.email)) missing.push(`adult ${i + 1} email invalid`);
    if (!a || !validateSignaturePng(a.sigPng)) missing.push(`adult ${i + 1} signature`);
    if (!a || !a.esignConsent) missing.push(`adult ${i + 1} e-sign consent`);
  });
  if (c && c.pathType === 'full') {
    const expectedMinors = Number(c.expectedMinors || 0);
    const children = (w && w.children) || [];
    for (let i = 0; i < expectedMinors; i++) {
      if (!String(children[i] && children[i].name || '').trim()) missing.push(`minor ${i + 1} name`);
    }
  }
  if (!w || !w.esignConsent) missing.push('esign consent');
  if (c && c.pathType === 'full' && (!w || !w.rulesAcknowledged)) missing.push('rules acknowledgment');
  return { ok: missing.length === 0, missing };
}

export function paperworkState(c, ownerSigOnFile) {
  const validation = validatePaperwork(c);
  const w = c && c.wizard;
  const adults = (w && w.adults) || [];
  const expected = Number(c && c.adults);
  const requiredAdults = adults.slice(0, expected);
  const namesOk = Number.isInteger(expected) && expected >= 1 && adults.length === expected &&
    requiredAdults.every(a => a && a.firstName && a.lastName);
  const allSigned = namesOk && !!(w && w.esignConsent) && requiredAdults.every(a => a.sigPng);
  const rulesOk = c.pathType !== 'full' || !!(w && w.rulesAcknowledged);
  return { namesOk, allSigned, rulesOk, complete: validation.ok, missing: validation.missing, ownerSigOnFile: !!ownerSigOnFile };
}

export function isReadyForOwnerReview(c, ownerSigOnFile) {
  if (!c || !c.wizard || c.submission) return false;
  const s = paperworkState(c, ownerSigOnFile);
  return s.complete && s.namesOk && s.allSigned && s.rulesOk && s.ownerSigOnFile;
}

export function isAllowedMutationOrigin(origin, expectedOrigin) {
  try {
    return !!origin && origin !== 'null' && new URL(origin).origin === new URL(expectedOrigin).origin;
  } catch (_) {
    return false;
  }
}

export function submissionRecipients() {
  return {
    to: ['contact005@example.test', 'contact006@example.test'],
    cc: ['contact008@example.test'],
  };
}

export function shouldAutoSubmitAfterGuestSave() { return false; }
export function shouldAutoApproveFromEmail() { return false; }
export function shouldAutoEmailFeeReminder() { return false; }

export function purgeExpiredCases(cases, now = new Date(), retentionDays = 90) {
  const cutoff = now.getTime() - retentionDays * 86400000;
  const kept = [], purged = [];
  for (const c of cases || []) {
    const checkout = /^\d{4}-\d{2}-\d{2}$/.test(String(c.checkOut || ''))
      ? new Date(`${c.checkOut}T23:59:59Z`).getTime() : Number.NaN;
    if (Number.isFinite(checkout) && checkout < cutoff) purged.push(c);
    else kept.push(c);
  }
  return { kept, purged };
}
