// Safe PDF helpers for owner-reviewed coordination documents.
// Screening and identity data are deliberately outside this portal.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PROPERTY_CONFIG } from './property-config.js';

const SCALE = 612 / 1275;
const px = (x, y) => ({ x: x * SCALE, y: 792 - y * SCALE });
const INK = rgb(0.05, 0.1, 0.4);

function draw(page, font, x, y, text, size) {
  if (!text) return;
  const p = px(x, y);
  page.drawText(String(text), { x: p.x, y: p.y, size: size || 10, font, color: INK });
}

function cleanMiddleName(value) {
  const text = String(value || '').trim();
  return /^(none|n\/a|no middle name)$/i.test(text) ? '' : text;
}

function drawDraft(page, font) {
  page.drawText('DRAFT — OWNER REVIEW REQUIRED', {
    x: 145, y: 760, size: 18, font, color: rgb(0.75, 0.1, 0.1), opacity: 0.55,
  });
}

export const UNIT = {
  address: `${PROPERTY_CONFIG.streetAddress}, ${PROPERTY_CONFIG.city}, ${PROPERTY_CONFIG.state} ${PROPERTY_CONFIG.postalCode}`,
  number: PROPERTY_CONFIG.unit.replace(/^Unit\s+/i, ''),
  owner: PROPERTY_CONFIG.ownerName,
};

const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}/${d}/${y}`;
};

export const b64ToBytes = (b64) => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));

async function drawSig(doc, page, b64, x, y, hPt) {
  if (!b64) return false;
  try {
    const img = await doc.embedPng(typeof b64 === 'string' ? b64ToBytes(b64) : b64);
    const w = Math.min(img.width * (hPt / img.height), 165);
    const p = px(x, y);
    page.drawImage(img, { x: p.x, y: p.y + 1, width: w, height: hPt });
    return true;
  } catch (_) {
    return false;
  }
}

export function coordinationOccupantNames(data) {
  const adults = (data && data.adults) || [];
  const extraAdults = adults.slice(2).map(ap =>
    `${ap.firstName || ''} ${cleanMiddleName(ap.middleName || ap.middleInitial)} ${ap.lastName || ''}`.replace(/\s+/g, ' ').trim());
  const minors = ((data && data.children) || []).filter(ch => ch && ch.name).map(ch => String(ch.name).trim());
  return [...extraAdults, ...minors].filter(Boolean).slice(0, 4);
}

export async function buildRulesAcknowledgment(templateBytes, data) {
  const doc = await PDFDocument.load(templateBytes, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  page.drawText('Rules & Regulations Acknowledgment', { x: 54, y: 730, size: 20, font: bold, color: INK });
  page.drawText('Palma del Mar No. 2 · Unit 405D', { x: 54, y: 702, size: 12, font, color: INK });
  page.drawText(`Stay: ${data.checkIn || ''} through ${data.checkOut || ''}`, { x: 54, y: 680, size: 11, font, color: INK });
  page.drawText('Each adult below confirms that they received, reviewed, and agree to comply with the attached Rules & Regulations.', {
    x: 54, y: 646, size: 10, font, color: INK, maxWidth: 500, lineHeight: 14,
  });
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
      } catch (_) {
        throw new Error(`invalid tenant signature PNG for adult ${i + 1}`);
      }
    }
    page.drawLine({ start: { x: 170, y: y - 2 }, end: { x: 420, y: y - 2 }, thickness: 0.7, color: INK });
  }
  page.drawText(`Acknowledgment prepared: ${data.todayISO || ''}`, { x: 54, y: 54, size: 9, font, color: INK });
  if (data.preview) for (const p of doc.getPages()) drawDraft(p, font);
  return doc.save();
}

export async function fillGuestRegistration(templateBytes, data) {
  const doc = await PDFDocument.load(templateBytes, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const [page] = doc.getPages();
  const adults = data.adults || [];
  draw(page, font, 398, 447, UNIT.number);
  draw(page, font, 305, 495, UNIT.owner);
  const ci = (data.checkIn || '').split('-');
  const co = (data.checkOut || '').split('-');
  if (ci.length === 3) { draw(page, font, 634, 549, ci[1], 9); draw(page, font, 683, 549, ci[2], 9); draw(page, font, 730, 549, ci[0], 9); }
  if (co.length === 3) { draw(page, font, 812, 549, co[1], 9); draw(page, font, 861, 549, co[2], 9); draw(page, font, 908, 549, co[0], 9); }
  adults.slice(0, 3).forEach((adult, i) => {
    draw(page, font, 545, 608 + i * 54, `${adult.firstName} ${cleanMiddleName(adult.middleName || adult.middleInitial)} ${adult.lastName}`.replace(/\s+/g, ' '), 11);
  });
  if (data.esignConsent) {
    const gy = [1328, 1383];
    for (let i = 0; i < 2; i++) {
      const adult = adults[i];
      if (!adult || !adult.sigPng) continue;
      if (await drawSig(doc, page, adult.sigPng, 300, gy[i], 22)) draw(page, font, 990, gy[i] - 4, fmtDate(data.todayISO));
    }
  }
  (data.children || []).slice(0, 3).forEach((child, i) => {
    if (child && child.name) draw(page, font, 545, 770 + i * 53, child.name);
  });
  const main = adults[0] || {};
  draw(page, font, 385, 920, main.phone);
  draw(page, font, 340, 970, main.street);
  draw(page, font, 140, 1023, main.city);
  draw(page, font, 608, 1023, main.state);
  draw(page, font, 795, 1023, main.zip);
  if (data.ownerSigPng) {
    try {
      const sig = await doc.embedPng(data.ownerSigPng);
      const h = 26;
      const w = Math.min(sig.width * (h / sig.height), 170);
      const pos = px(430, 1442);
      page.drawImage(sig, { x: pos.x, y: pos.y + 1, width: w, height: h });
      if (data.todayISO) draw(page, font, 985, 1438, fmtDate(data.todayISO));
    } catch (_) {
      throw new Error('invalid owner signature PNG');
    }
  }
  if (data.preview) drawDraft(page, font);
  return doc.save();
}
