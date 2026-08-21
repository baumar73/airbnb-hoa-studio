// Owner-approved submission engine. Guest completion only prepares drafts;
// this module is invoked by the authenticated, explicitly confirmed owner action.
import { fillLeaseApplication, fillGuestRegistration, b64ToBytes, splitLeaseApplicationPackage, buildRulesAcknowledgment } from './fill.js';
import { generateLeaseAgreement } from './lease.js';
import { sendViaGmail, sendTelegram } from './email.js';
import { isReadyForOwnerReview as workflowReadyForOwnerReview, submissionRecipients, paperworkState, requiredPackageDocuments, applicationFeeState } from './workflow.js';

const PORTAL = 'https://portal.example.test';
const OWNER = 'contact008@example.test';

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
    const response = await env.ASSETS.fetch(new Request(`${PORTAL}/forms/${name}.pdf`));
    if (!response.ok) throw new Error(`form template unavailable: ${name}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const guest = c.guestName.replace(/[^A-Za-z0-9]+/g, '_');
  const attachments = [];
  if (c.pathType === 'full') {
    const filled = await fillLeaseApplication(await tpl('lease-application'), data);
    const split = await splitLeaseApplicationPackage(filled);
    attachments.push({ filename: `01_Lease_Application_405D_${guest}.pdf`, bytes: new Uint8Array(split.application) });
    attachments.push({ filename: `02_Background_Authorization_405D_${guest}.pdf`, bytes: new Uint8Array(split.background) });
    attachments.push({ filename: `03_Rules_and_Regulations_Acknowledgment_405D_${guest}.pdf`, bytes: new Uint8Array(await buildRulesAcknowledgment(await tpl('rules-and-regulations'), data)) });
    attachments.push({ filename: `04_Lease_Agreement_405D_${guest}.pdf`, bytes: new Uint8Array(await generateLeaseAgreement(data)) });
  } else {
    attachments.push({ filename: `Guest_Registration_405D_${guest}.pdf`, bytes: new Uint8Array(await fillGuestRegistration(await tpl('guest-registration'), data)) });
  }
  return attachments;
}

export async function submitApprovedPackage(c, cases, env) {
  const live = (await env.CASES.get('submit-live')) === 'yes';
  const stayRef = `Unit 405D / ${c.guestName} / ${c.checkIn} – ${c.checkOut}${c.reservationCode ? ' / Airbnb ' + c.reservationCode : ''}`;
  const renewal = c.applicationType === 'renewal';
  const feeState = applicationFeeState(c);
  const feeText = feeState === 'waived'
    ? 'The association has confirmed that the $100 application fee is waived for these returning tenants.'
    : 'The $100 application-fee receipt has been confirmed in the owner workflow.';
  try {
    const attachments = await generatePackage(c, env);
    const subject = (live ? '' : '[TEST] ') + (c.pathType === 'full'
      ? `${renewal ? 'Lease renewal package' : 'Lease application package'} — ${stayRef}`
      : `Guest registration — ${stayRef}`);
    const text = c.pathType === 'full'
      ? `Dear Example Property Management / Example Condominium,\n\nPlease find attached the complete ${renewal ? 'lease renewal' : 'lease application'} package for the upcoming rental:\n\n${stayRef}\n\nAttached as four separately reviewable PDF components:\n1. Application for Lease of Condominium\n2. Background Check Authorization (signed by each adult applicant)\n3. Rules & Regulations with signed acknowledgment\n4. Short-Term Residential Lease Agreement (signed by tenant(s) and owner)\n\nThe applicants have reviewed the Rules and Regulations and signed the attached acknowledgment. Photo IDs have been provided through the association's secure channel. ${feeText}\n\nPlease confirm receipt and let us know once the file proceeds to Board approval.\n\nBest regards,\nProperty Owner\nOwner, Unit 405D / 6219 Palma Del Mar Blvd S${live ? '' : '\n\n[TESTMODUS: Diese Mail ging nur an Owner, nicht an die Verwaltung.]'}`
      : `Dear Example Property Management / Example Condominium,\n\nPlease find attached the completed Guest Registration for:\n\n${stayRef}\n\nSigned by the guest and by me as unit owner. Please confirm receipt.\n\nBest regards,\nProperty Owner\nOwner, Unit 405D${live ? '' : '\n\n[TESTMODUS: Diese Mail ging nur an Owner, nicht an die Verwaltung.]'}`;
    const recipients = submissionRecipients();
    await sendViaGmail(env, {
      to: live ? recipients.to : [OWNER],
      cc: live ? recipients.cc : [],
      subject, text, attachments,
    });
    if (live) {
      c.submission = { sentAt: new Date().toISOString(), live: true, docs: attachments.map(a => a.filename), reviewHash: c.ownerApprovedReviewHash || null };
      delete c.submissionError;
      for (const id of ['application', 'background', 'rules_ack', 'lease_signed', 'registration', 'owner_reviewed', 'submitted_hoa']) {
        const s = c.steps.find(s => s.id === id);
        if (s && !s.done) { s.done = true; s.date = c.submission.sentAt; }
      }
    } else {
      c.testSubmission = { sentAt: new Date().toISOString(), live: false, docs: attachments.map(a => a.filename), reviewHash: c.ownerApprovedReviewHash || c.reviewHash || null };
      delete c.testSubmissionError;
    }
    await env.CASES.put('cases', JSON.stringify(cases));
    const sentDocs = live ? c.submission.docs : c.testSubmission.docs;
    await sendTelegram(env, `📬 ${c.guestName} (${c.checkIn}): Das von dir geprüfte Paket wurde ${live ? 'an die Verwaltung' : 'im TESTMODUS nur an dich'} gesendet (${sentDocs.join(', ')}). Portal: ${PORTAL}/admin`);
    return true;
  } catch (e) {
    c.submissionError = { at: new Date().toISOString(), message: String(e && e.message || e).slice(0, 300) };
    await env.CASES.put('cases', JSON.stringify(cases));
    await sendTelegram(env, `🚨 STÖRUNG bei ${c.guestName} (${c.checkIn}): Der manuell freigegebene Paketversand ist fehlgeschlagen — ${c.submissionError.message}. Es erfolgt kein automatischer Wiederholungsversuch. Bitte im Admin erneut prüfen: ${PORTAL}/admin`);
    return false;
  }
}
