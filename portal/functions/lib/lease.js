// Short-Term Residential Lease Agreement — generated from scratch (owner's own document).
// Reproduces the wording of the version used for the DemoSurnameA/DemoSurnameD HOA files.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { UNIT } from './fill.js';

const fmtLong = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

// Occupancy clause for section 7. Minors are named as approved occupants but are
// never added to the signing-tenant list (tests: test/lease-occupancy.test.js).
export function occupancyClause(data) {
  const minors = ((data && data.children) || [])
    .map((ch) => String((ch && ch.name) || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (!minors.length) {
    return 'Occupancy is limited to the registered Airbnb guest(s) and approved adult occupants. Subletting or assignment is prohibited.';
  }
  return `Occupancy is limited to the registered Airbnb guest(s), approved adult occupants, and the following approved minor occupant(s): ${minors.join(', ')}. Subletting or assignment is prohibited.`;
}

export async function generateLeaseAgreement(data) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const adults = (data.adults || []).filter(a => a.firstName || a.lastName);
  const tenants = adults.map(a => {
    const middle = /^(none|n\/a|no middle name)$/i.test(String(a.middleName || '')) ? '' : (a.middleName || a.middleInitial || '');
    return `${a.firstName} ${middle} ${a.lastName}`.replace(/\s+/g, ' ').trim();
  });
  const start = fmtLong(data.checkIn), end = fmtLong(data.checkOut);
  const res = data.reservationCode ? ` ${data.reservationCode}` : '';

  const M = 54; // margin
  const W = 612 - 2 * M;
  let page = doc.addPage([612, 792]);
  let y = 792 - 64;

  const wrap = (text, f, size) => {
    const words = text.split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
      const probe = line ? line + ' ' + w : w;
      if (f.widthOfTextAtSize(probe, size) > W && line) { lines.push(line); line = w; }
      else line = probe;
    }
    if (line) lines.push(line);
    return lines;
  };
  const ensure = (need) => {
    if (y - need < 56) { page = doc.addPage([612, 792]); y = 792 - 64; }
  };
  const para = (text, f = font, size = 10, lh = 13, gap = 6) => {
    const lines = wrap(text, f, size);
    ensure(lines.length * lh + gap);
    for (const ln of lines) { page.drawText(ln, { x: M, y, size, font: f }); y -= lh; }
    y -= gap;
  };
  const heading = (t) => { ensure(32); para(t, bold, 10.5, 13, 2); };

  para('SHORT-TERM RESIDENTIAL LEASE AGREEMENT', bold, 14, 18, 2);
  para('(Airbnb-Based / HOA Compliance)', bold, 11.5, 15, 8);

  para('This Short-Term Residential Lease Agreement ("Agreement") is entered into between:', font, 10, 13, 4);
  para(`Landlord: ${UNIT.owner}`, font, 10, 13, 0);
  para(`Tenant${tenants.length > 1 ? 's' : ''}: ${tenants.join(', ')}`, font, 10, 13, 6);

  heading('1. Property');
  para(`Unit ${UNIT.number}`, font, 10, 13, 0);
  para('6219 Palma Del Mar Blvd S', font, 10, 13, 0);
  para('St. Petersburg, Florida 33715', font, 10, 13, 6);

  heading('2. Term');
  para(`This lease shall commence on ${start} and shall terminate on ${end}. The lease term corresponds exactly to the confirmed Airbnb reservation${res} and shall automatically terminate on ${end} without further notice.`);

  heading('3. Governing Reservation');
  para('This Agreement is ancillary to and governed by the Airbnb reservation between the parties. All payment terms, cancellation policies, fees, and booking conditions are exclusively governed by the Airbnb platform agreement. No additional rent or payment is due under this Agreement.');

  heading('4. Rent');
  para('Rent has been agreed and processed exclusively via Airbnb. No separate financial obligation arises under this lease.');

  heading('5. Condominium Association Compliance');
  para('Tenant agrees to comply fully with all Condominium Association declarations, bylaws, rules, and regulations applicable to the Property. Violation of Association rules shall constitute a material breach of this Agreement.');

  heading('6. No Renewal or Holdover');
  para(`This Agreement does not create any renewal rights or holdover tenancy. Tenant shall vacate the premises on or before ${end} unless a new written agreement is executed.`);

  heading('7. Occupancy');
  para(occupancyClause(data));

  y -= 8;
  const b64ToBytes = (b64) => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
  const embedSig = async (src, role) => {
    try {
      return await doc.embedPng(typeof src === 'string' ? b64ToBytes(src) : src);
    } catch (_) {
      throw new Error(`invalid ${role} signature PNG`);
    }
  };
  const ownerSig = data.ownerSigPng ? await embedSig(data.ownerSigPng, 'owner') : null;
  const fmtToday = data.todayISO ? (([yy, mm, dd]) => `${mm}/${dd}/${yy}`)(data.todayISO.split('-')) : '';
  const sigBlock = (role, name, sigImg) => {
    ensure(sigImg ? 64 : 54);
    page.drawText(`${role}: ${name}`, { x: M, y, size: 10, font });
    y -= 24;
    if (sigImg) {
      const h = 26, w = sigImg.width * (h / sigImg.height);
      page.drawImage(sigImg, { x: M + 58, y: y - 2, width: Math.min(w, 190), height: h });
      page.drawText(fmtToday, { x: M + 365, y: y + 2, size: 10, font });
    }
    page.drawText('Signature: ____________________________________', { x: M, y, size: 10, font });
    page.drawText(`Date: ${sigImg ? '' : '____________________'}`, { x: M + 330, y, size: 10, font });
    if (sigImg) page.drawText('____________________', { x: M + 360, y, size: 10, font });
    y -= 28;
  };
  sigBlock('Landlord', UNIT.owner, ownerSig);
  for (let i = 0; i < tenants.length; i++) {
    const ap = adults[i];
    const tSig = (data.esignConsent && ap && ap.sigPng) ? await embedSig(ap.sigPng, `tenant ${i + 1}`) : null;
    sigBlock('Tenant', tenants[i], tSig);
  }

  if (data.preview) {
    for (const p of doc.getPages()) p.drawText('DRAFT — OWNER REVIEW REQUIRED', {
      x: 145, y: 760, size: 18, font: bold, color: rgb(0.75, 0.1, 0.1), opacity: 0.55,
    });
  }
  return doc.save();
}
