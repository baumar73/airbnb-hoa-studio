// Pure workflow policy shared by Pages and the scheduled worker.
// Guest actions may prepare a package, but only an authenticated owner action
// may submit it or confirm an approval.
import { isAnnualRental, isSameLesseeRenewal } from './compliance.js';

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
  if (result.nights < 30) return { ok: false, error: 'paid Airbnb rentals require at least 30 nights and the full HOA path' };
  if (Number(input && input.adults) > 2) return { ok: false, error: 'rentals with more than two adults require a separate manual HOA application package' };
  return { ...result, pathType: 'full' };
}

export function requiredPackageDocuments(pathType, nights = 0) {
  if (pathType !== 'full') throw new Error('Paid Airbnb rentals require the full HOA package');
  const documents = [
    { key: 'lease-application', label: 'Lease Application' },
    { key: 'background-authorization', label: 'Background Check Authorization' },
    { key: 'rules-and-regulations', label: 'Rules & Regulations and signed acknowledgment' },
    { key: 'lease-agreement', label: 'Short-Term Lease Agreement' },
  ];
  if (Number(nights) >= 365) documents.push({ key: 'flood-disclosure', label: 'Florida Flood Disclosure' });
  return documents;
}

export function validateOwnerReviewAttestations(values, nights = 0) {
  const missing = requiredPackageDocuments('full', nights)
    .filter(doc => !values || values[doc.key] !== 'yes')
    .map(doc => doc.key);
  return { ok: missing.length === 0, missing };
}

export function applicationFeeState(c) {
  if (!c || c.pathType !== 'full') return 'not_required';
  // Fla. Stat. 718.112(2)(k): an association may not charge a fee for a
  // renewal with the same lessee. This is a statutory rule, not a waiver.
  if (isSameLesseeRenewal(c)) return 'prohibited_same_lessee_renewal';
  if (c.screeningRoute === 'online') return 'handled_online';
  if (c.screeningRoute === 'undecided') return 'route_required';
  return 'required';
}

export function validateLiveSubmissionPrerequisites(c) {
  const required = [];
  if (c && c.pathType === 'full' && c.screeningRoute === 'undecided') {
    required.push('screening_route');
  } else if (c && c.pathType === 'full' && c.screeningRoute === 'online') {
    required.push('screening_complete');
  } else {
    required.push('ids_provided');
  }
  if (c && c.pathType === 'full' && c.screeningRoute !== 'online' && c.screeningRoute !== 'undecided') {
    if (c.screeningRoute === 'paper') required.unshift('screening_complete');
    const feeState = applicationFeeState(c);
    if (feeState === 'required') required.push('fee_sent');
  }
  const steps = (c && c.steps) || [];
  const missing = required.filter(id => !steps.some(step => step.id === id && step.done));
  return { ok: missing.length === 0, missing };
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
  const fullOnly = ['middleName', 'birthDate', 'gender', 'idType', 'idNumber', 'idState', 'employer', 'employerPhone'];
  adults.slice(0, expected).forEach((a, i) => {
    const required = [...common, ...(c.pathType === 'full' || i === 0 ? contact : []), ...(c.pathType === 'full' ? fullOnly : [])];
    for (const field of required) {
      if (!String(a && a[field] || '').trim()) missing.push(`adult ${i + 1} ${field}`);
    }
    if (a && a.email && !validateEmailAddress(a.email)) missing.push(`adult ${i + 1} email invalid`);
    if (a && a.birthDate && !isValidISODate(a.birthDate)) missing.push(`adult ${i + 1} birthDate invalid`);
    if (!a || !validateSignaturePng(a.sigPng)) missing.push(`adult ${i + 1} signature`);
    if (!a || !a.esignConsent) missing.push(`adult ${i + 1} e-sign consent`);
    if (!a || !a.signatureAudit || !a.signatureAudit.signedAt || !a.signatureAudit.contentHash) {
      missing.push(`adult ${i + 1} signature audit`);
    }
  });
  if (c && c.pathType === 'full') {
    const references = (w && w.references) || [];
    for (let i = 0; i < 2; i++) {
      for (const field of ['name', 'phone', 'address']) {
        if (!String(references[i] && references[i][field] || '').trim()) missing.push(`reference ${i + 1} ${field}`);
      }
    }
    const emergency = (w && w.emergency) || [];
    for (let i = 0; i < 2; i++) {
      for (const field of ['name', 'phone']) {
        if (!String(emergency[i] && emergency[i][field] || '').trim()) missing.push(`emergency contact ${i + 1} ${field}`);
      }
    }
    const expectedMinors = Number(c.expectedMinors || 0);
    const children = (w && w.children) || [];
    for (let i = 0; i < expectedMinors; i++) {
      if (!String(children[i] && children[i].name || '').trim()) missing.push(`minor ${i + 1} name`);
      const birthDate = String(children[i] && children[i].birthDate || '').trim();
      if (!birthDate) missing.push(`minor ${i + 1} birthDate`);
      else if (!isValidISODate(birthDate)) missing.push(`minor ${i + 1} birthDate invalid`);
    }
  }
  if (!w || !w.esignConsent) missing.push('esign consent');
  if (!w || w.esignConsentVersion !== 'fl-2026.09.02') missing.push('current e-sign consent version');
  if (c && c.pathType === 'full' && (!w || !w.rulesAcknowledged)) missing.push('rules acknowledgment');
  if (isAnnualRental(c) && (!w || !w.floodDisclosureAcknowledged)) missing.push('flood disclosure acknowledgment');
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

export function isGuestPaperworkComplete(c) {
  if (!c || !c.wizard || c.submission) return false;
  const s = paperworkState(c, false);
  return s.complete && s.namesOk && s.allSigned && s.rulesOk;
}

export function isReadyForOwnerReview(c, ownerSigOnFile) {
  return isGuestPaperworkComplete(c) && !!ownerSigOnFile;
}

export function isAllowedMutationOrigin(origin, expectedOrigin, fetchSite) {
  if ((!origin || origin === 'null') && fetchSite === 'same-origin') return true;
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
    if(c.legalHold) {kept.push(c);continue;}
    const checkout = /^\d{4}-\d{2}-\d{2}$/.test(String(c.checkOut || ''))
      ? new Date(`${c.checkOut}T23:59:59Z`).getTime() : Number.NaN;
    if (Number.isFinite(checkout) && checkout < cutoff) purged.push(c);
    else kept.push(c);
  }
  return { kept, purged };
}
