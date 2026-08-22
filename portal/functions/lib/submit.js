// Owner-approved submission engine. Guest completion only prepares drafts;
// this module is invoked by the authenticated, explicitly confirmed owner action.
import { fillGuestRegistration, b64ToBytes, buildRulesAcknowledgment } from './fill.js';
import { generateLeaseAgreement } from './lease.js';
import { sendViaGmail, sendTelegram } from './email.js';
import { isReadyForOwnerReview as workflowReadyForOwnerReview, submissionRecipients, paperworkState, requiredPackageDocuments, applicationFeeState, bundleDigest } from './workflow.js';
import { assertNoProhibitedSensitiveData } from './hoa-rules.js';
import { PROPERTY_CONFIG, configuredOwnerEmail, configuredPortalOrigin, liveSubmissionEnabled } from './property-config.js';

export function docStates(c, ownerSigOnFile) {
  const state = paperworkState(c, ownerSigOnFile);
  const a = (c.wizard && c.wizard.adults) || [];
  const sigCount = a.slice(0, c.adults).filter(x => x && x.sigPng).length;
  const sent = !!c.submission;
  const confirmed = !!(c.steps || []).find(s => s.id === 'board_approved' && s.done);
  const docs = c.pathType === 'full'
    ? requiredPackageDocuments('full').map(doc => ({
        ...doc,
        filled: state.complete,
        signed: doc.key === 'lease-agreement'
          ? state.allSigned && state.ownerSigOnFile
          : state.allSigned && state.rulesOk,
      }))
    : [{ key: 'guest-registration', label: 'Guest Registration', filled: state.complete, signed: state.allSigned && state.ownerSigOnFile }];
  return { docs, namesOk: state.namesOk, allSigned: state.allSigned, sigCount, sent, confirmed, complete: state.complete, missing: state.missing };
}

export function isReadyForOwnerReview(c, ownerSigOnFile) {
  return workflowReadyForOwnerReview(c, ownerSigOnFile);
}

async function generatePackage(c, env) {
  const sigB64 = await env.CASES.get('owner-signature-png');
  const ownerSigPng = sigB64 ? b64ToBytes(sigB64) : null;
  const data = { checkIn: c.checkIn, checkOut: c.checkOut, reservationCode: c.reservationCode,
    applicationType: c.applicationType || 'lease', ownerSigPng, todayISO: new Date().toISOString().slice(0, 10), ...c.wizard };
  const tpl = async (name) => {
    const response = await env.ASSETS.fetch(new Request(`${configuredPortalOrigin(env)}/forms/${name}.pdf`));
    if (!response.ok) throw new Error(`form template unavailable: ${name}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const guest = c.guestName.replace(/[^A-Za-z0-9]+/g, '_');
  const attachments = [];
  if (c.pathType === 'full') {
    attachments.push({ filename: `01_Rules_and_Regulations_Acknowledgment_405D_${guest}.pdf`, bytes: new Uint8Array(await buildRulesAcknowledgment(await tpl('rules-and-regulations'), data)) });
    attachments.push({ filename: `02_Lease_Agreement_405D_${guest}.pdf`, bytes: new Uint8Array(await generateLeaseAgreement(data)) });
  } else {
    attachments.push({ filename: `Guest_Registration_405D_${guest}.pdf`, bytes: new Uint8Array(await fillGuestRegistration(await tpl('guest-registration'), data)) });
  }
  return attachments;
}

export async function submitApprovedPackage(c, cases, env) {
  // Production-state independent: neither environment variables nor stale KV
  // can enable live HOA delivery before a reviewed atomic coordinator exists.
  const live = liveSubmissionEnabled();
  const owner = configuredOwnerEmail(env);
  const portal = configuredPortalOrigin(env);
  const stayRef = `${PROPERTY_CONFIG.unit} / ${c.guestName} / ${c.checkIn} – ${c.checkOut}${c.reservationCode ? ' / Airbnb ' + c.reservationCode : ''}`;
  const renewal = c.sameLesseeRenewal === true;
  const feeState = applicationFeeState(c);
  const feeText = feeState === 'not_required'
    ? 'No association application fee is required for this same-lessee renewal.'
    : 'The $100 application-fee receipt has been confirmed in the owner workflow.';
  try {
    const attachments = await generatePackage(c, env);
    const generatedBundleDigest = await bundleDigest(attachments.map(attachment => attachment.bytes));
    if (!c.aiReview || !/^[0-9a-f]{64}$/.test(String(c.aiReview.bundleDigest || '')) || c.aiReview.bundleDigest !== generatedBundleDigest) {
      throw new Error('generated package differs from the exact PDF bundle reviewed by OpenAI');
    }
    const subject = (live ? '' : '[TEST] ') + (c.pathType === 'full'
      ? `${renewal ? 'Lease renewal package' : 'Lease application package'} — ${stayRef}`
      : `Guest registration — ${stayRef}`);
    const text = c.pathType === 'full'
      ? `Dear ${PROPERTY_CONFIG.managementName} / ${PROPERTY_CONFIG.condominiumName},\n\nPlease find attached the owner-prepared coordination documents for the upcoming ${renewal ? 'lease renewal' : 'rental'}:\n\n${stayRef}\n\nAttached:\n1. Rules & Regulations with signed acknowledgment\n2. Short-Term Residential Lease Agreement (signed by tenant(s) and owner)\n\nAny identity verification or screening is handled directly by the association's external vendor. This portal does not collect, store, or transmit identity documents, dates of birth, screening reports, employment data, or financial data. The owner workflow records only the vendor handoff and completion status. ${feeText}\n\nPlease confirm receipt and provide written Board approval when the association process is complete.\n\nBest regards,\nProperty Owner\nOwner, ${PROPERTY_CONFIG.unit} / ${PROPERTY_CONFIG.streetAddress}${live ? '' : '\n\n[TESTMODUS: Diese Mail ging nur an die konfigurierte Owner-Adresse, nicht an die Verwaltung.]'}`
      : `Dear ${PROPERTY_CONFIG.managementName} / ${PROPERTY_CONFIG.condominiumName},\n\nPlease find attached the completed Guest Registration for:\n\n${stayRef}\n\nSigned by the guest and by me as unit owner. Please confirm receipt.\n\nBest regards,\nProperty Owner\nOwner, ${PROPERTY_CONFIG.unit}${live ? '' : '\n\n[TESTMODUS: Diese Mail ging nur an die konfigurierte Owner-Adresse, nicht an die Verwaltung.]'}`;
    const recipients = submissionRecipients();
    await sendViaGmail(env, {
      to: live ? recipients.to : [owner],
      cc: live ? recipients.cc : [],
      subject, text, attachments,
    });
    if (live) {
      c.submission = { sentAt: new Date().toISOString(), live: true, docs: attachments.map(a => a.filename), reviewHash: c.ownerApprovedReviewHash || null, bundleDigest: generatedBundleDigest };
      delete c.submissionError;
      for (const id of ['rules_ack', 'lease_signed', 'registration', 'owner_reviewed', 'submitted_hoa']) {
        const s = c.steps.find(s => s.id === id);
        if (s && !s.done) { s.done = true; s.date = c.submission.sentAt; }
      }
    } else {
      c.testSubmission = { sentAt: new Date().toISOString(), live: false, docs: attachments.map(a => a.filename), reviewHash: c.ownerApprovedReviewHash || c.reviewHash || null, bundleDigest: generatedBundleDigest };
      delete c.testSubmissionError;
    }
    assertNoProhibitedSensitiveData(cases);
    await env.CASES.put('cases', JSON.stringify(cases));
    const sentDocs = live ? c.submission.docs : c.testSubmission.docs;
    await sendTelegram(env, `📬 ${c.guestName} (${c.checkIn}): Das von dir geprüfte Paket wurde ${live ? 'an die Verwaltung' : 'im TESTMODUS nur an dich'} gesendet (${sentDocs.join(', ')}). Portal: ${portal}/admin`);
    return true;
  } catch (e) {
    c.submissionError = { at: new Date().toISOString(), message: String(e && e.message || e).slice(0, 300) };
    assertNoProhibitedSensitiveData(cases);
    await env.CASES.put('cases', JSON.stringify(cases));
    await sendTelegram(env, `🚨 STÖRUNG bei ${c.guestName} (${c.checkIn}): Der manuell freigegebene Paketversand ist fehlgeschlagen — ${c.submissionError.message}. Es erfolgt kein automatischer Wiederholungsversuch. Bitte im Admin erneut prüfen: ${portal}/admin`);
    return false;
  }
}
