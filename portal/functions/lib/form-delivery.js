// Guest-initiated delivery of the filled application forms to the condo
// association, with the owner in CC. This is an *explicit, separate* guest
// action — it is never a side effect of saving the wizard, it does not mark an
// HOA submission or approval, and the guest is never a recipient. Delivery is
// disabled unless the owner config flag FORM_DELIVERY_ENABLED is 'yes'.
import { generatePackage } from './submit.js';
import { sendViaGmail } from './email.js';
import { validateEmailAddress, submissionRecipients } from './workflow.js';
import { saveStoredCases } from './storage.js';

// Addresses live in configuration (secret store / env), never in Git.
// KEILA_RECIPIENT = the condo association contact; OWNER_CC = the unit owner
// (the operator), so both parties can monitor the flow.
export function deliveryConfig(env) {
  return {
    enabled: env.FORM_DELIVERY_ENABLED === 'yes',
    recipient: env.FORM_DELIVERY_RECIPIENT || '',
    cc: env.FORM_DELIVERY_CC || '',
  };
}

export function deliveryErrors(c, env) {
  const cfg = deliveryConfig(env);
  if (!cfg.enabled) return 'form delivery is not enabled';
  if (!cfg.recipient || !validateEmailAddress(cfg.recipient)) return 'recipient email is not configured';
  if (cfg.cc && !validateEmailAddress(cfg.cc)) return 'owner cc email is invalid';
  if (c.status === 'canceled') return 'reservation is canceled';
  if (!c.wizard || !c.wizard.savedAt) return 'the forms have not been filled in and saved yet';
  if (!c.wizard.adults || c.wizard.adults.length === 0) return 'the forms have no applicant yet';
  return null;
}

// Send the filled forms to the association (recipient) with the owner in CC.
// On success records a delivery receipt on the case. Returns { ok, receipt?, error? }.
export async function sendFilledForms(c, cases, env, { sendMail = sendViaGmail } = {}) {
  const err = deliveryErrors(c, env);
  if (err) return { ok: false, error: err };
  if (c.submission) return { ok: false, error: 'this reservation was already submitted and is locked' };

  const cfg = deliveryConfig(env);
  const attachments = await generatePackage(c, env);
  const stayRef = `${c.guestName} / ${c.checkIn} – ${c.checkOut}${c.reservationCode ? ' / ' + c.reservationCode : ''}`;
  const subject = `Completed ${c.pathType === 'full' ? 'lease application' : 'guest registration'} forms — ${stayRef}`;
  const text = `Dear Example Condominium,\n\nPlease find attached the completed application forms for:\n\n${stayRef}\n\nThese were prepared and signed through the owner's portal. This is a copy for your records and review; it is not a claim of Board approval. Please confirm receipt.\n\nBest regards,\nProperty Owner\nOwner, Unit 405D`;

  // The guest is deliberately never a recipient — only the association and the owner(s).
  const accepted = await sendMail(env, {
    to: [cfg.recipient],
    cc: cfg.cc ? [cfg.cc] : [],
    subject,
    text,
    attachments,
  });
  if (accepted !== true) return { ok: false, error: 'delivery was not accepted by the mail server' };

  const receipt = { sentAt: new Date().toISOString(), recipient: cfg.recipient, cc: cfg.cc, docs: attachments.map(a => a.filename) };
  c.formDelivery = receipt;
  await saveStoredCases(env, cases);
  c.saved = true;
  return { ok: true, receipt };
}