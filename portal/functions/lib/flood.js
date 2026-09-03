import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { b64ToBytes, UNIT } from './fill.js';

const mark = value => value === 'yes' ? 'X' : ' ';

export async function generateFloodDisclosure(data) {
  const doc = await PDFDocument.create();
  doc.setTitle('Florida Flood Disclosure - Unit 405D');
  doc.setSubject('Flood disclosure for a residential rental term of at least one year');
  doc.setProducer('Unit 405D HOA Approval Portal');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([612, 792]);
  const x = 54;
  let y = 730;
  const line = (text, opts = {}) => {
    page.drawText(text, { x, y, size: opts.size || 10, font: opts.bold ? bold : font, color: opts.color || rgb(0, 0, 0) });
    y -= opts.gap || 17;
  };
  const wrap = text => {
    const words = String(text).split(/\s+/); let current = '';
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, 10) > 504) { line(current); current = word; } else current = next;
    }
    if (current) line(current);
    y -= 5;
  };
  line('FLOOD DISCLOSURE', { bold: true, size: 15, gap: 28 });
  line(`Property: Unit ${UNIT.number}, 6219 Palma Del Mar Blvd S, St. Petersburg, FL 33715`, { gap: 24 });
  wrap("Flood Insurance: Renters' insurance policies do not include coverage for damage resulting from floods. Tenant is encouraged to discuss the need to purchase separate flood insurance coverage with Tenant's insurance agent.");
  wrap(`1. Landlord has [${mark(data.floodDamageKnown)}] or has no [${mark(data.floodDamageKnown === 'no' ? 'yes' : 'no')}] knowledge of any flooding that has damaged the dwelling unit during Landlord's ownership of the dwelling unit.`);
  wrap(`2. Landlord has [${mark(data.floodClaimFiled)}] or has not [${mark(data.floodClaimFiled === 'no' ? 'yes' : 'no')}] filed a claim with an insurance provider relating to flood damage in the dwelling unit, including, but not limited to, a claim with the National Flood Insurance Program.`);
  wrap(`3. Landlord has [${mark(data.floodAssistanceReceived)}] or has not [${mark(data.floodAssistanceReceived === 'no' ? 'yes' : 'no')}] received assistance for flood damage to the dwelling unit, including, but not limited to, assistance from the Federal Emergency Management Agency.`);
  wrap('For purposes of this disclosure, the term "flooding" means a general or temporary condition of partial or complete inundation of the dwelling unit caused by the overflow of inland or tidal waters; the unusual and rapid accumulation of runoff or surface waters from any established water source; or sustained periods of standing water resulting from rainfall.');
  line('Provided pursuant to Florida Statutes section 83.512.', { gap: 30 });
  line(`Landlord: ${UNIT.owner}`);
  line(`Notice address: ${String(data.landlordNoticeAddress || '')}`);
  line(`Date provided: ${String(data.todayISO || '')}`, { gap: 26 });

  const drawSignature = async (label, name, signature) => {
    line(`${label}: ${String(name || '')}`, { bold: true, gap: 17 });
    if (signature) {
      try {
        const image = await doc.embedPng(typeof signature === 'string' ? b64ToBytes(signature) : signature);
        const scale = Math.min(175 / image.width, 32 / image.height);
        page.drawImage(image, { x: 165, y: y - 5, width: image.width * scale, height: image.height * scale });
      } catch (_) { /* malformed images are rejected before final generation */ }
    }
    page.drawLine({ start: { x: 160, y: y }, end: { x: 390, y }, thickness: 0.6, color: rgb(0.2, 0.2, 0.2) });
    page.drawText(String(data.todayISO || ''), { x: 420, y: y - 4, size: 9, font });
    y -= 42;
  };
  await drawSignature('Landlord', UNIT.owner, data.ownerSigPng);
  for (const adult of (data.adults || [])) {
    await drawSignature('Tenant acknowledgment', `${adult.firstName || ''} ${adult.lastName || ''}`.trim(), adult.sigPng);
  }
  if (data.preview) page.drawText('DRAFT - OWNER REVIEW REQUIRED', { x: 150, y: 760, size: 17, font: bold, color: rgb(0.75, 0.1, 0.1), opacity: 0.55 });
  return doc.save();
}
