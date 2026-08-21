import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fillGuestRegistration, buildRulesAcknowledgment } from '../functions/lib/fill.js';
import { generateLeaseAgreement } from '../functions/lib/lease.js';
import { validatePaperwork, validateSignaturePng, bundleDigest } from '../functions/lib/workflow.js';
import { stripProhibitedSensitiveData, assertNoProhibitedSensitiveData } from '../functions/lib/hoa-rules.js';

const [casePath, ownerSigPath, outDir] = process.argv.slice(2);
if (!casePath || !ownerSigPath || !outDir) {
  console.error('usage: node scripts/generate_review_bundle.mjs CASE_JSON OWNER_SIG OUT_DIR');
  process.exit(2);
}
const c = stripProhibitedSensitiveData(JSON.parse(fs.readFileSync(casePath, 'utf8')));
assertNoProhibitedSensitiveData(c);
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
  checkIn: c.checkIn,
  checkOut: c.checkOut,
  reservationCode: c.reservationCode,
  ownerSigPng,
  preview: false,
  todayISO: new Date().toISOString().slice(0, 10),
  ...c.wizard,
};
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const formsRoot = process.env.ISLA_FORMS_ROOT ? path.resolve(process.env.ISLA_FORMS_ROOT) : path.join(root, 'public/forms');
const files = [];
const artifacts = [];
const write = (name, bytes) => {
  const artifact = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const target = path.join(outDir, name);
  fs.writeFileSync(target, artifact, { mode: 0o600 });
  files.push(target);
  artifacts.push(artifact);
};
if (c.pathType === 'full') {
  write('01-rules-and-acknowledgment.pdf', await buildRulesAcknowledgment(fs.readFileSync(path.join(formsRoot, 'rules-and-regulations.pdf')), data));
  write('02-short-term-lease.pdf', await generateLeaseAgreement(data));
} else {
  write('01-guest-registration.pdf', await fillGuestRegistration(fs.readFileSync(path.join(formsRoot, 'guest-registration.pdf')), data));
}
console.log(JSON.stringify({ ok: true, reviewHash: c.reviewHash, bundleDigest: await bundleDigest(artifacts), pathType: c.pathType, files }));
