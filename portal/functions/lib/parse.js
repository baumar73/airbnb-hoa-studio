// Text parsers for booking confirmations, cancellations, and HOA replies (framework-free, testable in Node).
const MONTHS = { jan:1, feb:2, mar:3, mär:3, apr:4, may:5, mai:5, jun:6, jul:7, aug:8, sep:9, oct:10, okt:10, nov:11, dec:12, dez:12 };

export function parseCancellation(msg) {
  const subject = String(msg && msg.subject || '');
  const text = String(msg && msg.text || '');
  const all = `${subject}\n${text}`;
  const code = (all.match(/\b(HM[A-Z0-9]{8,12})\b/i) || [])[1];
  const canceled = /\b(?:canceled|cancelled|storniert|annulliert)\b/i.test(all) && /\b(?:reservation|buchung)\b/i.test(all);
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

export function parseBooking({ subject, text }, today) {
  const all = subject + '\n' + text;
  const code = (all.match(/\b(HM[A-Z0-9]{8,12})\b/) || [])[1] || '';
  // Airbnb's labelled Check-in/Checkout block is authoritative. Parse that
  // before scanning the rest of the message, which may contain booking dates,
  // cancellation deadlines or forwarded-message timestamps.
  const stayLabel = all.search(/\bCheck-?in\b/i);
  const stayWindow = stayLabel >= 0 ? all.slice(stayLabel, stayLabel + 500) : all;
  let dates = parseYearlessRange(stayWindow, today);
  if (dates.length < 2) dates = parseDates(stayWindow);
  if (dates.length < 2 && stayWindow !== all) dates = parseDates(all);
  // guest name heuristics (confirmation mails usually carry the guest's full name)
  const nameM =
    all.match(/(?:Reservation confirmed|Buchung bestätigt)[^\n]{0,40}?[-–—:]\s*([A-ZÄÖÜ][\p{L}'-]+ [A-ZÄÖÜ][\p{L}'-]+)/u) ||
    all.match(/\b([A-ZÄÖÜ][\p{L}'-]+ [A-ZÄÖÜ][\p{L}'-]+)\s+(?:arrives|kommt am|checkt)/u) ||
    all.match(/Guest:\s*([A-ZÄÖÜ][\p{L}'-]+ [A-ZÄÖÜ][\p{L}'-]+)/u);
  const guestName = nameM ? nameM[1] : '';
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

