import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillLeaseApplication, fillGuestRegistration, splitLeaseApplicationPackage, buildRulesAcknowledgment } from '../functions/lib/fill.js';
import { generateLeaseAgreement } from '../functions/lib/lease.js';
import { generateFloodDisclosure } from '../functions/lib/flood.js';
import { validatePaperwork, validateSignaturePng } from '../functions/lib/workflow.js';

const [casePath, ownerSigPath, outDir, compliancePath] = process.argv.slice(2);
if (!casePath || !ownerSigPath || !outDir) {
  console.error('usage: node scripts/generate_review_bundle.mjs CASE_JSON OWNER_SIG OUT_DIR');
  process.exit(2);
}
const c = JSON.parse(fs.readFileSync(casePath, 'utf8'));
const ownerSigPng = fs.readFileSync(ownerSigPath, 'utf8').trim();
const validation = validatePaperwork(c);
if (!validation.ok) {
  console.log(JSON.stringify({ ok: false, missing: validation.missing }));
  process.exit(3);
}
if (!validateSignaturePng(ownerSigPng)) {
  console.log(JSON.stringify({ ok: false, missing: ['valid owner signature'] }));
  process.exit(4);
}
fs.mkdirSync(outDir, { recursive: true, mode: 0o700 });
const data = {
  ...(compliancePath ? JSON.parse(fs.readFileSync(compliancePath,'utf8')) : {}),
  checkIn: c.checkIn,
  checkOut: c.checkOut,
  reservationCode: c.reservationCode,
  applicationType: c.applicationType || 'lease',
  reviewHash: c.reviewHash,
  ownerSigPng,
  preview: false,
  todayISO: new Date().toISOString().slice(0, 10),
  ...c.wizard,
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
const write = (name, bytes) => {
  const target = path.join(outDir, name);
  fs.writeFileSync(target, bytes, { mode: 0o600 });
  files.push(target);
};
if (c.pathType === 'full') {
  const combined = await fillLeaseApplication(fs.readFileSync(path.join(root, 'public/forms/lease-application.pdf')), data);
  const split = await splitLeaseApplicationPackage(combined);
  write('01-lease-application.pdf', split.application);
  write('02-background-authorization.pdf', split.background);
  write('03-rules-and-acknowledgment.pdf', await buildRulesAcknowledgment(fs.readFileSync(path.join(root, 'public/forms/rules-and-regulations.pdf')), data));
  write('04-short-term-lease.pdf', await generateLeaseAgreement(data));
  if (c.nights>=365) write('05-flood-disclosure.pdf', await generateFloodDisclosure(data));
} else {
  write('01-guest-registration.pdf', await fillGuestRegistration(fs.readFileSync(path.join(root, 'public/forms/guest-registration.pdf')), data));
}
console.log(JSON.stringify({ ok: true, reviewHash: c.reviewHash, pathType: c.pathType, files }));
