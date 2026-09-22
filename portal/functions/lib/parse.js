// Text parsers for booking confirmations, cancellations, and HOA replies (framework-free, testable in Node).
const MONTHS = { jan:1, feb:2, mar:3, mär:3, apr:4, may:5, mai:5, jun:6, jul:7, aug:8, sep:9, oct:10, okt:10, nov:11, dec:12, dez:12 };

export function parseCancellation(msg) {
  const subject = String(msg && msg.subject || '');
  const text = String(msg && msg.text || '');
  // Quoted history is evidence of an earlier message, not a new cancellation.
  const body = text.split(/\r?\n/).filter(line => !/^\s*>/.test(line)).join('\n');
  const all = `${subject}\n${body}`;
  const codes = [...new Set((all.match(/\bHM[A-Z0-9]{8,12}\b/gi)||[]).map(code=>code.toUpperCase()))];
  const code = codes.length===1 ? codes[0] : null;
  const canceledWord = /\b(?:canceled|cancelled|storniert|annulliert)\b/i;
  const negated = /\b(?:not|nicht|never|kein(?:e|er|en|em|es)?)\s+(?:be\s+|been\s+|ist\s+|wurde\s+)?(?:canceled|cancelled|storniert|annulliert)\b/i;
  const canceled = canceledWord.test(all) && !negated.test(all) && /\b(?:reservation|buchung)\b/i.test(all);
  return {
    code: code ? code.toUpperCase() : null,
    canceledAt: msg && msg.date || null,
    complete: Boolean(canceled && code),
  };
}
function validISO(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y,m,d] = s.split('-').map(Number), dt = new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m-1 && dt.getUTCDate() === d;
}

export function parseDates(text) {
  // matches "Nov 21, 2026", "21. Nov. 2026", "November 21 2026"
  const out = [];
  const re1 = /\b([A-Za-zÄÖÜäöü]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/g;
  const re2 = /\b(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]{3,9})\.?\s*(\d{4})/g;
  let m;
  while ((m = re1.exec(text))) {
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) {
      const iso = `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
      if (validISO(iso)) out.push(iso);
    }
  }
  while ((m = re2.exec(text))) {
    const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mo) {
      const iso = `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
      if (validISO(iso)) out.push(iso);
    }
  }
  // Preserve message order. Sorting all dates can turn an unrelated booking or
  // cancellation timestamp into the apparent check-in date.
  return [...new Set(out)];
}

// Year-less dates like "Mon, Aug 3" (real Airbnb host-confirmation format):
// bookings are always in the future; checkout follows check-in (may cross new year).
export function parseYearlessRange(text, today) {
  const re = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Mo|Di|Mi|Do|Fr|Sa|So)\.?,\s+([A-Za-zÄÖÜäöü]{3,9})\.?\s+(\d{1,2})\b|\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\.?,\s+(\d{1,2})\.?\s+([A-Za-zÄÖÜäöü]{3,9})/g;
  const found = [];
  let m;
  while ((m = re.exec(text)) && found.length < 2) {
    // An explicit year is authoritative, even for past bookings.
    if (/^[,\s]+\d{4}\b/.test(text.slice(re.lastIndex))) return [];
    const monName = m[1] || m[4], day = m[2] || m[3];
    const mo = MONTHS[(monName || '').slice(0, 3).toLowerCase()];
    if (mo) found.push({ mo, d: parseInt(day, 10) });
  }
  if (found.length < 2) return [];
  const now = today ? new Date(today) : new Date();
  const mk = (y, x) => `${y}-${String(x.mo).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
  let y1 = now.getUTCFullYear();
  if (mk(y1, found[0]) < now.toISOString().slice(0, 10)) y1++;
  let y2 = y1;
  if (mk(y2, found[1]) < mk(y1, found[0])) y2++;
  const out = [mk(y1, found[0]), mk(y2, found[1])];
  return out.every(validISO) ? out : [];
}

function completeName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  const parts = name.split(' ');
  if (name.length > 160 || parts.length < 2 || parts.length > 10) return '';
  const particle = /^(?:de|del|la|las|los|da|das|do|dos|van|von|der|den|di|du|le|al|bin)$/i;
  const word = /^\p{Lu}[\p{L}\p{M}.'’ʼ-]*$/u;
  return parts.every((part, i) => word.test(part) || (i > 0 && particle.test(part))) ? name : '';
}

export function bookingLastName(value) {
  const name = String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+(?:Jr\.?|Sr\.?|II|III|IV)$/i, '').toLowerCase()
    .replace(/['’ʼ]/g, '').replace(/[^\p{L}\p{N} -]/gu, ' ').trim();
  return name.split(/\s+/).at(-1) || '';
}

// Year-less Airbnb arrival form: "…ARRIVES OCT 15…" plus a later bare "Mon Day"
// checkout token, with no labelled Check-in/Checkout block, no weekday prefix and
// no explicit year. Accepted only when ALL hold: an arrival word marker, a distinct
// check-in month-day, and a strictly-later distinct month-day. Never invents a
// checkout; returns [] unless safely derivable from explicit tokens.
export function parseYearlessArrival(text, today) {
  const mk = (y, x) => `${y}-${String(x.mo).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
  const now = today ? new Date(today) : new Date();
  const thisYear = now.getUTCFullYear();
  const todayIso = now.toISOString().slice(0, 10);
  const arr = text.match(/\b(?:arrives|kommt am|checks in)\b[^\n]{0,22}\b([A-Za-zÀ-ÖØ-öø-ÿ]{3,9})\.?\s+(\d{1,2})\b/i);
  if (!arr) return [];
  const arrMon = MONTHS[arr[1].slice(0, 3).toLowerCase()];
  if (!arrMon) return [];
  const d1 = parseInt(arr[2], 10);
  let checkIn = mk(thisYear, { mo: arrMon, d: d1 });
  if (checkIn < todayIso) checkIn = mk(thisYear + 1, { mo: arrMon, d: d1 });
  if (!validISO(checkIn)) return [];
  const tail = text.slice((arr.index || 0) + arr[0].length);
  const tokRe = /\b([A-Za-zÀ-ÖØ-öø-ÿ]{3,9})\.?\s+(\d{1,2})\b/g;
  let found = null;
  for (let m = tokRe.exec(tail); m; m = tokRe.exec(tail)) {
    const mon2 = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (!mon2) continue;
    let cand = mk(thisYear, { mo: mon2, d: parseInt(m[2], 10) });
    if (cand < todayIso) cand = mk(thisYear + 1, { mo: mon2, d: parseInt(m[2], 10) });
    if (validISO(cand) && new Date(`${cand}T00:00:00Z`) > new Date(`${checkIn}T00:00:00Z`)) { found = cand; break; }
  }
  if (!found) return [];
  if ((new Date(`${found}T00:00:00Z`) - new Date(`${checkIn}T00:00:00Z`)) / 86400000 > 120) return [];
  return [checkIn, found];
}

export function parseBooking({ subject, text }, today) {
  const all = subject + '\n' + text;
  const code = (all.match(/\b(HM[A-Z0-9]{8,12})\b/) || [])[1] || '';
  // Airbnb's labelled Check-in/Checkout block is authoritative. Parse that
  // before scanning the rest of the message, which may contain booking dates,
  // cancellation deadlines or forwarded-message timestamps.
  const stayLabel = all.search(/\bCheck-?in\b/i);
  const stayWindow = stayLabel >= 0 ? all.slice(stayLabel, stayLabel + 500) : all;
  let dates = parseDates(stayWindow);
  if (dates.length < 2) {
    const yearless = parseYearlessRange(stayWindow, today);
    if (yearless.length===2) dates=yearless;
  }
  if (dates.length < 2 && stayWindow !== all) dates = parseDates(all);
  // Year-less arrival shorthand (real Airbnb host-confirmation letters). Used only
  // when nothing authoritative was derived — otherwise it could shift or blend
  // explicit years. Derives a range only when an arrival marker plus a
  // strictly-later explicit date exist (never invents a checkout).
  if (dates.length === 0) dates = parseYearlessArrival(all, today);
  // Capture the whole name up to a known boundary, never just two words.
  // A labelled body value is stronger evidence than a shortened subject.
  const labelled = text.match(/^(?:Guest|Gast):[ \t]*([^\n\r]+)$/mi);
  const subjectName = subject.match(/(?:Reservation confirmed|Buchung bestätigt)[^\n]{0,40}?[-–—:][ \t]*(.+?)(?=\s+(?:arrives|kommt am|checkt)\b|$)/i);
  const arrivalName = all.match(/^([^\n]+?)\s+(?:arrives|kommt am|checkt)\b/m);
  const guestName = labelled ? completeName(labelled[1])
    : completeName(subjectName?.[1]) || completeName(arrivalName?.[1]);
  const adultsM = all.match(/\b(\d{1,2})\s+adult(?:s)?\b/i) || all.match(/\b(\d{1,2})\s+Erwachsene(?:n)?\b/i);
  const adults = adultsM ? parseInt(adultsM[1], 10) : null;
  const checkIn = dates[0] || '', checkOut = dates[1] || '';
  const validRange = !!(validISO(checkIn) && validISO(checkOut) && new Date(`${checkOut}T00:00:00Z`) > new Date(`${checkIn}T00:00:00Z`));
  return {
    code, guestName,
    checkIn, checkOut,
    adults,
    complete: !!(code && guestName && validRange && Number.isInteger(adults) && adults >= 1 && adults <= 4),
  };
}

export function looksLikeApproval(subject) {
  return /approv/i.test(subject) || /genehmig/i.test(subject);
}
