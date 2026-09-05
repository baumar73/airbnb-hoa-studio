// Owner-approved submission engine. Guest completion only prepares drafts;
// this module is invoked by the authenticated, explicitly confirmed owner action.
import { fillLeaseApplication, fillGuestRegistration, b64ToBytes, splitLeaseApplicationPackage, buildRulesAcknowledgment } from './fill.js';
import { generateLeaseAgreement } from './lease.js';
import { generateFloodDisclosure } from './flood.js';
import { sendViaGmail, sendTelegram } from './email.js';
import { isReadyForOwnerReview as workflowReadyForOwnerReview, submissionRecipients, paperworkState, requiredPackageDocuments, applicationFeeState } from './workflow.js';
import { isAnnualRental } from './compliance.js';
import { getEncryptedSecret, loadStoredCases } from './storage.js';
import { persistDeliveryOutcome } from './delivery.js';
import { loadArchivedPackage } from './package-archive.js';
import {caseReviewDigest,reviewContextHash} from './review.js';
import {validateLiveSubmissionPrerequisites} from './workflow.js';

const PORTAL = 'https://portal.example.test';
const OWNER = 'contact008@example.test';

export function docStates(c, ownerSigOnFile) {
  const state = paperworkState(c, ownerSigOnFile);
  const a = (c.wizard && c.wizard.adults) || [];
  const sigCount = a.slice(0, c.adults).filter(x => x && x.sigPng).length;
  const sent = !!c.submission;
  const confirmed = !!(c.steps || []).find(s => s.id === 'board_approved' && s.done);
  const docs = c.pathType === 'full'
    ? requiredPackageDocuments('full', c.nights).map(doc => ({
        ...doc,
        filled: state.complete,
        signed: doc.key === 'lease-agreement' || doc.key === 'flood-disclosure'
          ? state.allSigned && state.ownerSigOnFile
          : state.allSigned && state.rulesOk,
      }))
    : [{ key: 'guest-registration', label: 'Guest Registration', filled: state.complete, signed: state.allSigned && state.ownerSigOnFile }];
  return { docs, namesOk: state.namesOk, allSigned: state.allSigned, sigCount, sent, confirmed, complete: state.complete, missing: state.missing };
}

export function isReadyForOwnerReview(c, ownerSigOnFile) {
  return workflowReadyForOwnerReview(c, ownerSigOnFile);
}

export async function generatePackage(c, env, source={}) {
  const sigB64 = source.ownerSignature===undefined ? await getEncryptedSecret(env, 'owner-signature-png') : source.ownerSignature;
  const ownerSigPng = sigB64 ? b64ToBytes(sigB64) : null;
  const compliance = source.compliance || JSON.parse((await env.CASES.get('compliance-config')) || '{}');
  const data = { checkIn: c.checkIn, checkOut: c.checkOut, reservationCode: c.reservationCode,
    applicationType: c.applicationType || 'lease', ownerSigPng, todayISO: new Date().toISOString().slice(0, 10),
    reviewHash: c.reviewHash, landlordNoticeAddress: compliance.landlordNoticeAddress,
    floodDamageKnown: compliance.floodDamageKnown, floodClaimFiled: compliance.floodClaimFiled,
    floodAssistanceReceived: compliance.floodAssistanceReceived, ...c.wizard };
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
    if (isAnnualRental(c)) {
      attachments.push({ filename: `05_Florida_Flood_Disclosure_405D_${guest}.pdf`, bytes: new Uint8Array(await generateFloodDisclosure(data)) });
    }
  } else {
    attachments.push({ filename: `Guest_Registration_405D_${guest}.pdf`, bytes: new Uint8Array(await fillGuestRegistration(await tpl('guest-registration'), data)) });
  }
  return attachments;
}

export async function submitApprovedPackage(c, cases, env, {sendMail=sendViaGmail,sendNotice=sendTelegram}={}) {
  const live = (await env.CASES.get('submit-live')) === 'yes';
  let mailAttempted=false,mailSent=false;
  const notify=async message=>{try {await sendNotice(env,message);} catch {console.error('delivery notification failed');}};
  const stayRef = `Unit 405D / ${c.guestName} / ${c.checkIn} – ${c.checkOut}${c.reservationCode ? ' / Airbnb ' + c.reservationCode : ''}`;
  const renewal = c.applicationType === 'renewal';
  const feeState = applicationFeeState(c);
  const feeText = feeState === 'prohibited_same_lessee_renewal'
    ? 'No transfer/application fee is included because Florida Statutes section 718.112(2)(k) prohibits charging a fee for a renewal with the same lessee.'
    : 'The $100 application-fee receipt has been confirmed in the owner workflow.';
  try {
    if (c.pathType === 'full' && c.screeningRoute !== 'paper') {
      throw new Error(c.screeningRoute === 'online'
        ? 'online Tenant Evaluation applications must not be emailed as a local paper package'
        : 'the official application route must be selected before a local package is generated');
    }
    const archive=env.CASE_STORE ? await loadArchivedPackage(env,c) : null;
    if(archive && (c.aiReview?.packageId!==archive.manifest.id || c.aiReview?.packageHash!==archive.manifest.packageHash)) throw new Error('The archived package has not passed the current review');
    const attachments = archive ? archive.attachments : await generatePackage(c, env);
    const subject = (live ? '' : '[TEST] ') + (c.pathType === 'full'
      ? `${renewal ? 'Lease renewal package' : 'Lease application package'} — ${stayRef}`
      : `Guest registration — ${stayRef}`);
    const text = c.pathType === 'full'
      ? `Dear Example Property Management / Example Condominium,\n\nPlease find attached the local paper-route documents for the upcoming ${renewal ? 'lease renewal' : 'lease application'}:\n\n${stayRef}\n\nAttached as separately reviewable PDF components:\n1. Application for Lease of Condominium\n2. Background Check Authorization (signed by each adult applicant)\n3. Rules & Regulations with signed acknowledgment\n4. Short-Term Residential Lease Agreement (signed by tenant(s) and owner)${isAnnualRental(c) ? '\n5. Florida Flood Disclosure' : ''}\n\nThe applicants have reviewed the Rules and Regulations and signed the attached acknowledgment. Completion of the association's separate official screening has been confirmed in the owner workflow; sensitive screening data is not included in these attachments. Photo IDs have been provided through the association's secure channel. ${feeText}\n\nPlease confirm receipt and let us know once the file proceeds to Board approval.\n\nBest regards,\nProperty Owner\nOwner, Unit 405D / 6219 Palma Del Mar Blvd S${live ? '' : '\n\n[TESTMODUS: Diese Mail ging nur an Owner, nicht an die Verwaltung.]'}`
      : `Dear Example Property Management / Example Condominium,\n\nPlease find attached the completed Guest Registration for:\n\n${stayRef}\n\nSigned by the guest and by me as unit owner. Please confirm receipt.\n\nBest regards,\nProperty Owner\nOwner, Unit 405D${live ? '' : '\n\n[TESTMODUS: Diese Mail ging nur an Owner, nicht an die Verwaltung.]'}`;
    const recipients = submissionRecipients();
    if(env.CASE_STORE) {
      const fresh=(await loadStoredCases(env)).find(item=>item.id===c.id);
      const signature=await getEncryptedSecret(env,'owner-signature-png');
      const compliance=JSON.parse(await env.CASES.get('compliance-config')||'{}');
      if(!fresh||fresh.status==='canceled'||fresh.reviewLockedAt!==c.reviewLockedAt||fresh.preparedPackage?.id!==archive.manifest.id||await caseReviewDigest(fresh,fresh.wizard)!==c.reviewHash||await reviewContextHash(fresh,signature,compliance)!==archive.manifest.contextHash||(live&&!validateLiveSubmissionPrerequisites(fresh).ok)) throw new Error('Reservation or release prerequisites changed before delivery');
    }
    mailAttempted=true;
    await sendMail(env, {
      to: live ? recipients.to : [OWNER],
      cc: live ? recipients.cc : [],
      subject, text, attachments,
    });
    mailSent=true;
    if (live) {
      c.submission = { sentAt: new Date().toISOString(), live: true, docs: attachments.map(a => a.filename), reviewHash: c.ownerApprovedReviewHash || null };
      if(archive) Object.assign(c.submission,{packageId:archive.manifest.id,packageHash:archive.manifest.packageHash,packageManifest:archive.manifest});
      delete c.submissionError;
      for (const id of ['application', 'background', 'rules_ack', 'lease_signed', 'registration', 'owner_reviewed', 'submitted_hoa']) {
        const s = c.steps.find(s => s.id === id);
        if (s && !s.done) { s.done = true; s.date = c.submission.sentAt; }
      }
    } else {
      c.testSubmission = { sentAt: new Date().toISOString(), live: false, docs: attachments.map(a => a.filename), reviewHash: c.ownerApprovedReviewHash || c.reviewHash || null };
      delete c.testSubmissionError;
    }
    await persistDeliveryOutcome(env,cases,c,live ? {submission:c.submission,submissionError:null} : {testSubmission:c.testSubmission,testSubmissionError:null});
    const sentDocs = live ? c.submission.docs : c.testSubmission.docs;
    if(!c.autoRelease) await notify(`📬 ${c.guestName} (${c.checkIn}): Das von dir geprüfte Paket wurde ${live ? 'an die Verwaltung' : 'im TESTMODUS nur an dich'} gesendet (${sentDocs.join(', ')}). Portal: ${PORTAL}/admin`);
    return true;
  } catch (e) {
    if (mailSent) {
      console.error('delivery accepted but receipt persistence failed; retain delivery lock');
      await notify(`🚨 ${c.guestName}: Die E-Mail wurde vom Mailserver angenommen, der Versandnachweis konnte aber nicht gespeichert werden. NICHT erneut senden. Gesendet-Ordner und Vorgang manuell abgleichen: ${PORTAL}/admin`);
      // Transport acceptance alone is not a durably recorded submission.
      // The persisted release lock still prevents another scheduler run from
      // sending again, while callers must report this as needing reconciliation.
      return false;
    }
    // Provider exceptions can contain addresses, credentials or message bodies.
    // Persist only a fixed, actionable description, never raw transport text.
    const failure={at:new Date().toISOString(),phase:mailAttempted?'delivery_uncertain':'preparation_failed',message:mailAttempted?'Delivery could not be confirmed. Reconcile the sent-mail record before another attempt.':'Package preparation failed. No email was sent; review the package and release prerequisites.'};
    try {await persistDeliveryOutcome(env,cases,c,live?{submissionError:failure}:{testSubmissionError:failure});}
    catch {console.error('delivery failure could not be recorded; retain delivery lock');}
    await notify(`🚨 STÖRUNG bei ${c.guestName} (${c.checkIn}): ${mailAttempted?'Versandstatus unklar. Vor einem weiteren Versuch den Gesendet-Ordner prüfen.':'Paketvorbereitung fehlgeschlagen; keine E-Mail versandt.'} Es erfolgt kein automatischer Wiederholungsversuch. Details: ${PORTAL}/admin`);
    return false;
  }
}
