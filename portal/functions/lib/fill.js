// PDF prefill via coordinate overlay (templates are flat PDFs without AcroForm).
// Coordinates below are in IMAGE PIXELS of the 1275x1650 reference renders
// (templates/png/*.png); px() converts to PDF points (612x792, origin bottom-left).
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const SCALE = 612 / 1275;
const px = (x, y) => ({ x: x * SCALE, y: 792 - y * SCALE });

const INK = rgb(0.05, 0.1, 0.4); // dark blue, distinguishable from print

function draw(page, font, x, y, text, size) {
  if (!text) return;
  const p = px(x, y);
  page.drawText(String(text), { x: p.x, y: p.y, size: size || 10, font, color: INK });
}

function cleanMiddleName(value) {
  const text = String(value || '').trim();
  return /^(none|n\/a|no middle name)$/i.test(text) ? '' : text;
}

export function leaseApplicationAdditionalOccupants(data) {
  const adults = (data && data.adults) || [];
  const extraAdults = adults.slice(2).map(ap => ({
    name: `${ap.firstName || ''} ${cleanMiddleName(ap.middleName || ap.middleInitial)} ${ap.lastName || ''}`.replace(/\s+/g, ' ').trim(),
    birthDate: ap.birthDate || '',
  }));
  const minors = ((data && data.children) || []).filter(ch => ch && (ch.name || ch.birthDate)).map(ch => ({
    name: ch.name || '',
    birthDate: ch.birthDate || '',
  }));
  return [...extraAdults, ...minors].slice(0, 2);
}

function markIdType(page, font, applicantIndex, type) {
  const y = applicantIndex === 0 ? 338 : 146;
  if (type === 'drivers_license') page.drawText('X', { x: 31, y, size: 11, font, color: INK });
  if (type === 'us_photo_id') page.drawText('X', { x: 147, y, size: 11, font, color: INK });
}

function drawDraft(page, font) {
  page.drawText('DRAFT — OWNER REVIEW REQUIRED', {
    x: 145, y: 760, size: 18, font, color: rgb(0.75, 0.1, 0.1), opacity: 0.55,
  });
}

export const UNIT = {
  address: '100 Example Avenue, Example City, FL 00000',
  number: '405D',
  owner: 'Owner Oliver DemoNameB',
};

const fmtDate = (iso) => { // YYYY-MM-DD -> MM/DD/YYYY
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
};

export const b64ToBytes = (b64) => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));

// Embed a signature PNG with its bottom-left at image-pixel (x, y); height in pt.
async function drawSig(doc, page, b64, x, y, hPt) {
  if (!b64) return false;
  try {
    const img = await doc.embedPng(typeof b64 === 'string' ? b64ToBytes(b64) : b64);
    const w = Math.min(img.width * (hPt / img.height), 165);
    const p = px(x, y);
    page.drawImage(img, { x: p.x, y: p.y + 1, width: w, height: hPt });
    return true;
  } catch (e) { return false; }
}

export const applicationTypeMarkX = type => type === 'renewal' ? 480 : 342;

// ---- Lease Application (template: lease-application.pdf, 3 pages) ----
// Page 1: applicants 1+2 · Page 2: occupants/auto/refs/emergency · Page 3: background auth names
export async function fillLeaseApplication(templateBytes, data) {
  const doc = await PDFDocument.load(templateBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const [p1, p2, p3] = doc.getPages();
  const a = data.adults || [];
  let p4 = null;
  if (a[3]) {
    [p4] = await doc.copyPages(doc, [2]);
    doc.addPage(p4);
  }

  // page 1 — header
  draw(p1, font, applicationTypeMarkX(data.applicationType), 505, 'X', 12); // Application Type: LEASE or RENEWAL
  draw(p1, font, 285, 535, UNIT.address);
  draw(p1, font, 1085, 535, UNIT.number);
  draw(p1, font, 440, 573, UNIT.owner);
  // This is an owner-direct rental. Leaving these association-form fields blank
  // caused applicants to ask whether their package was incomplete.
  draw(p1, font, 190, 612, 'N/A'); // Realtor
  draw(p1, font, 805, 612, 'N/A'); // Realtor phone
  draw(p1, font, 500, 650, fmtDate(data.checkIn));
  draw(p1, font, 890, 650, fmtDate(data.checkOut));

  // applicants 1 + 2 blocks (block 2 offset measured separately)
  const blocks = [
    { name: 727, addr: 780, phone: 832, gen: 880, lic: 936, mail: 994, emp: 1048 },
    { name: 1127, addr: 1180, phone: 1233, gen: 1281, lic: 1338, mail: 1396, emp: 1449 },
  ];
  blocks.forEach((B, i) => {
    const ap = a[i]; if (!ap) return;
    draw(p1, font, 350, B.name, ap.firstName);
    draw(p1, font, 680, B.name, cleanMiddleName(ap.middleName || ap.middleInitial).slice(0, 1));
    draw(p1, font, 950, B.name, ap.lastName);
    draw(p1, font, 330, B.addr, ap.street);
    draw(p1, font, 630, B.addr, ap.city);
    draw(p1, font, 855, B.addr, ap.state);
    draw(p1, font, 1055, B.addr, ap.zip);
    const ph = splitPhone(ap.phone);
    draw(p1, font, 208, B.phone, ph.area);
    draw(p1, font, 300, B.phone, ph.rest);
    const alt = splitPhone(ap.altPhone);
    draw(p1, font, 805, B.phone, alt.area);
    draw(p1, font, 895, B.phone, alt.rest);
    draw(p1, font, 505, B.gen, ap.gender);
    const bd = (ap.birthDate || '').split('-'); // YYYY-MM-DD
    if (bd.length === 3) {
      draw(p1, font, 845, B.gen, bd[1]);
      draw(p1, font, 985, B.gen, bd[2]);
      draw(p1, font, 1095, B.gen, bd[0]);
    }
    draw(p1, font, 515, B.lic, ap.idNumber);
    draw(p1, font, 1035, B.lic, ap.idState);
    markIdType(p1, font, i, ap.idType);
    draw(p1, font, 295, B.mail, ap.email);
    draw(p1, font, 240, B.emp, ap.employer);
    draw(p1, font, 950, B.emp, ap.employerPhone);
  });

  // page 2 — additional occupants, including minors who do not complete background authorization
  leaseApplicationAdditionalOccupants(data).forEach((ap, i) => {
    const y = 112 + i * 40;
    draw(p2, font, 155, y, ap.name);
    draw(p2, font, 940, y, fmtDate(ap.birthDate));
  });
  if (data.auto && (data.auto.make || data.auto.plate)) {
    draw(p2, font, 385, 212, data.auto.make);
    draw(p2, font, 700, 212, data.auto.year);
    draw(p2, font, 970, 212, data.auto.plate);
  }
  (data.references || []).slice(0, 2).forEach((r, i) => {
    if (!r || !r.name) return;
    draw(p2, font, 185, 318 + i * 78, r.name);
    draw(p2, font, 945, 318 + i * 78, r.phone);
    draw(p2, font, 215, 358 + i * 78, r.address);
  });
  (data.emergency || []).slice(0, 2).forEach((e, i) => {
    if (!e || !e.name) return;
    draw(p2, font, 185, 530 + i * 40, e.name);
    draw(p2, font, 905, 530 + i * 40, e.phone);
  });

  // page 3 — background authorization printed names
  [538, 818, 1098].forEach((y, i) => {
    const ap = a[i]; if (!ap) return;
    draw(p3, font, 165, y - 8, `${ap.firstName} ${cleanMiddleName(ap.middleName || ap.middleInitial)} ${ap.lastName}`.replace(/\s+/g, ' '), 11);
  });
  if (p4 && a[3]) {
    const ap = a[3];
    draw(p4, font, 165, 530, `${ap.firstName} ${cleanMiddleName(ap.middleName || ap.middleInitial)} ${ap.lastName}`.replace(/\s+/g, ' '), 11);
  }

  // e-signatures (only with explicit consent)
  if (data.esignConsent) {
    const today = fmtDate(data.todayISO);
    // p2 — rules acknowledgment box (two signature/date pairs)
    for (let i = 0; i < 2; i++) {
      const ap = a[i]; if (!ap || !ap.sigPng) continue;
      const xSig = i === 0 ? 120 : 660, xDate = i === 0 ? 420 : 965;
      if (await drawSig(doc, p2, ap.sigPng, xSig, 860, 22)) draw(p2, font, xDate, 852, today);
      // p2 — disclosure agreement box
      if (await drawSig(doc, p2, ap.sigPng, xSig, 1181, 22)) draw(p2, font, xDate, 1173, today);
    }
    // p3 — background authorization signature + date per applicant
    const blocksY = [{ sig: 608, date: 682 }, { sig: 888, date: 962 }, { sig: 1168, date: 1242 }];
    for (let i = 0; i < 3; i++) {
      const ap = a[i]; if (!ap || !ap.sigPng) continue;
      if (await drawSig(doc, p3, ap.sigPng, 165, blocksY[i].sig, 24)) draw(p3, font, 165, blocksY[i].date, today);
    }
    if (p4 && a[3] && a[3].sigPng) {
      if (await drawSig(doc, p4, a[3].sigPng, 165, blocksY[0].sig, 24)) draw(p4, font, 165, blocksY[0].date, today);
    }
  }

  if (data.preview) for (const page of [p1, p2, p3, p4].filter(Boolean)) drawDraft(page, font);
  return doc.save();
}

export async function splitLeaseApplicationPackage(filledBytes) {
  const source = await PDFDocument.load(filledBytes);
  const application = await PDFDocument.create();
  const background = await PDFDocument.create();
  const applicationPages = await application.copyPages(source, [0, 1]);
  applicationPages.forEach(page => application.addPage(page));
  const backgroundIndexes = source.getPages().map((_, index) => index).slice(2);
  const backgroundPages = await background.copyPages(source, backgroundIndexes);
  backgroundPages.forEach(page => background.addPage(page));
  return { application: await application.save(), background: await background.save() };
}

export async function buildRulesAcknowledgment(templateBytes, data) {
  const doc = await PDFDocument.load(templateBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  page.drawText('Rules & Regulations Acknowledgment', { x: 54, y: 730, size: 20, font: bold, color: INK });
  page.drawText('Example Condominium · Unit 405D', { x: 54, y: 702, size: 12, font, color: INK });
  page.drawText(`Stay: ${data.checkIn || ''} through ${data.checkOut || ''}`, { x: 54, y: 680, size: 11, font, color: INK });
  const statement = 'Each adult below confirms that they received, reviewed, and agree to comply with the attached Rules & Regulations.';
  page.drawText(statement, { x: 54, y: 646, size: 10, font, color: INK, maxWidth: 500, lineHeight: 14 });
  const adults = (data.adults || []).slice(0, 4);
  for (let i = 0; i < adults.length; i++) {
    const adult = adults[i] || {};
    const y = 575 - i * 120;
    page.drawText(`${i + 1}. ${adult.firstName || ''} ${adult.lastName || ''}`.trim(), { x: 54, y: y + 45, size: 11, font: bold, color: INK });
    page.drawText('Electronic signature:', { x: 54, y: y + 22, size: 9, font, color: INK });
    if (adult.sigPng) {
      try {
        const image = await doc.embedPng(typeof adult.sigPng === 'string' ? b64ToBytes(adult.sigPng) : adult.sigPng);
        const height = 38;
        const width = Math.min(image.width * (height / image.height), 220);
        page.drawImage(image, { x: 170, y, width, height });
      } catch (_) {}
    }
    page.drawLine({ start: { x: 170, y: y - 2 }, end: { x: 420, y: y - 2 }, thickness: 0.7, color: INK });
  }
  page.drawText(`Acknowledgment prepared: ${data.todayISO || ''}`, { x: 54, y: 54, size: 9, font, color: INK });
  if (data.preview) for (const p of doc.getPages()) drawDraft(p, font);
  return doc.save();
}

// ---- Guest Registration (template: guest-registration.pdf, 1 page, version 3/28/2025) ----
export async function fillGuestRegistration(templateBytes, data) {
  const doc = await PDFDocument.load(templateBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const [p] = doc.getPages();
  const a = data.adults || [];

  draw(p, font, 398, 447, UNIT.number);                    // Unit #
  draw(p, font, 305, 495, UNIT.owner);                     // Name of Unit Owner(s)
  const ci = (data.checkIn || '').split('-'), co = (data.checkOut || '').split('-');
  if (ci.length === 3) { draw(p, font, 634, 549, ci[1], 9); draw(p, font, 683, 549, ci[2], 9); draw(p, font, 730, 549, ci[0], 9); }
  if (co.length === 3) { draw(p, font, 812, 549, co[1], 9); draw(p, font, 861, 549, co[2], 9); draw(p, font, 908, 549, co[0], 9); }
  a.slice(0, 3).forEach((ap, i) => {
    draw(p, font, 545, 608 + i * 54, `${ap.firstName} ${cleanMiddleName(ap.middleName || ap.middleInitial)} ${ap.lastName}`.replace(/\s+/g, ' '), 11);
  });
  // guest e-signatures ("SIGNATURE OF GUEST" lines) — only with explicit consent
  if (data.esignConsent) {
    const gy = [1328, 1383];
    for (let i = 0; i < 2; i++) {
      const ap = a[i]; if (!ap || !ap.sigPng) continue;
      if (await drawSig(doc, p, ap.sigPng, 300, gy[i], 22)) draw(p, font, 990, gy[i] - 4, fmtDate(data.todayISO));
    }
  }
  (data.children || []).slice(0, 3).forEach((ch, i) => {
    if (!ch || !ch.name) return;
    draw(p, font, 545, 770 + i * 53, ch.name);
    draw(p, font, 985, 770 + i * 53, fmtDate(ch.birthDate));
  });
  const main = a[0] || {};
  draw(p, font, 385, 920, main.phone);
  draw(p, font, 340, 970, main.street);
  draw(p, font, 140, 1023, main.city);
  draw(p, font, 608, 1023, main.state);
  draw(p, font, 795, 1023, main.zip);

  // owner/agent signature (first "SIGNATURE OF UNIT OWNER/AGENT" line) + date
  if (data.ownerSigPng) {
    try {
      const sig = await doc.embedPng(data.ownerSigPng);
      const h = 26, w = Math.min(sig.width * (h / sig.height), 170);
      const pos = px(430, 1442);
      p.drawImage(sig, { x: pos.x, y: pos.y + 1, width: w, height: h });
      if (data.todayISO) draw(p, font, 985, 1438, fmtDate(data.todayISO));
    } catch (e) {}
  }
  if (data.preview) drawDraft(p, font);
  return doc.save();
}

function splitPhone(s) {
  const digits = String(s || '').replace(/\D/g, '');
  if (digits.length >= 10) return { area: digits.slice(0, 3), rest: digits.slice(3, 6) + '-' + digits.slice(6, 10) };
  return { area: '', rest: s || '' };
}
