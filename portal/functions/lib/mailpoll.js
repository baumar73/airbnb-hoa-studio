// Mail polling: turn Airbnb booking confirmations into cases and HOA approval
// replies into ticked steps. Anything ambiguous becomes a Telegram alert
// instead of a guess.
import { Imap, decodeMessage } from './imap.js';
import { parseBooking, parseCancellation, looksLikeApproval } from './parse.js';
import { sendTelegram } from './email.js';
import { validateAirbnbCaseInput, shouldAutoApproveFromEmail } from './workflow.js';

const PORTAL = 'https://portal.example.test';

function newCaseFrom(b) {
  const validation = validateAirbnbCaseInput({ guestName: b.guestName, checkIn: b.checkIn, checkOut: b.checkOut, adults: b.adults });
  if (!validation.ok) throw new Error(`invalid booking: ${validation.error}`);
  const nights = validation.nights;
  const pathType = validation.pathType;
  const STEPS = pathType === 'full'
    ? [['forms_sent','Guest portal opened and paperwork started'],['application','1. Lease Application — completed & signed'],['background','2. Background Check Authorization — completed & signed by each adult'],['rules_ack','3. Rules & Regulations — reviewed & signed acknowledgment'],['lease_signed','4. Lease Agreement — signed by guest(s) and owner'],['ids_provided','Photo ID provided securely for each adult'],['fee_sent','$100 fee confirmed received by association'],['owner_reviewed','Owner confirmed the green quality report and released the package'],['submitted_hoa','Complete file submitted to Example Property Management'],['board_approved','HOA Board approval received'],['checkin_released','Check-in instructions released']]
    : [['forms_sent','Guest Registration Form sent to guest'],['registration','Guest Registration Form — completed & signed'],['ids_provided','Photo ID copy provided for each adult'],['submitted_hoa','Registration submitted to Example Property Management'],['board_approved','HOA confirmation received'],['checkin_released','Check-in instructions released']];
  const tokenBytes = new Uint8Array(16);
  crypto.getRandomValues(tokenBytes);
  return {
    id: crypto.randomUUID(),
    token: btoa(String.fromCharCode(...tokenBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    guestName: b.guestName, reservationCode: b.code,
    checkIn: b.checkIn, checkOut: b.checkOut, nights, adults: b.adults,
    pathType,
    steps: STEPS.map(([id, label]) => ({ id, label, done: false, date: null })),
    createdAt: new Date().toISOString(),
    notes: 'auto-created from Airbnb confirmation email',
  };
}

export async function pollMail(env) {
  const seenRaw = await env.CASES.get('mail-seen');
  const seen = seenRaw ? JSON.parse(seenRaw) : { uids: [] };
  const seenSet = new Set(seen.uids);
  const imap = new Imap();
  const summary = { bookings: 0, cancellations: 0, approvals: 0, alerts: 0 };
  try {
    await imap.open(env.GMAIL_USER || 'contact008@example.test', env.GMAIL_APP_PASSWORD);

    // NOTE: query must stay ASCII-only — non-ASCII breaks IMAP quoted strings ("buchung" also matches "Buchung bestätigt")
    const bookingUids = await imap.searchRaw('from:airbnb.com subject:("reservation confirmed" OR buchung) newer_than:30d');
    const cancellationUids = await imap.searchRaw('from:airbnb.com subject:(canceled OR cancelled OR storniert) newer_than:30d');
    const hoaUids = await imap.searchRaw('from:condominiumassociates.com newer_than:14d');
    const raw = await env.CASES.get('cases');
    const cases = raw ? JSON.parse(raw) : [];
    let dirty = false;

    const ambiguous = seen.ambiguous || {};
    for (const uid of bookingUids) {
      if (seenSet.has('b' + uid)) continue;
      const msg = decodeMessage(await imap.fetchMessage(uid));
      const b = parseBooking(msg, msg.date);
      const dup = b.code && cases.some(c => c.reservationCode === b.code);
      if (dup) { seenSet.add('b' + uid); delete ambiguous[uid]; continue; }
      if (b.complete) {
        try {
          const c = newCaseFrom(b);
          cases.push(c); dirty = true; summary.bookings++;
          seenSet.add('b' + uid); delete ambiguous[uid];
          await sendTelegram(env, `🆕 Buchung erkannt & Vorgang angelegt: ${b.guestName}, ${b.checkIn} → ${b.checkOut} (${c.nights} Nächte, ${c.pathType}, ${b.code}, ${b.adults} Erwachsene).\n\n➡️ Bitte Daten im Admin prüfen und den Portalzugang per Airbnb-Chat senden:\n${PORTAL}/admin`);
        } catch (e) {
          summary.alerts++;
          if (!ambiguous[uid]) {
            ambiguous[uid] = { firstSeenAt: new Date().toISOString(), subject: msg.subject.slice(0, 160), reason: String(e && e.message || e).slice(0, 200) };
            await sendTelegram(env, `📥 Airbnb-Buchung braucht manuelle Bearbeitung: ${b.guestName || msg.subject.slice(0, 80)} — ${String(e && e.message || e).slice(0, 160)}. Kein unvollständiger Vorgang wurde angelegt. ${PORTAL}/admin`);
          }
        }
      } else {
        summary.alerts++;
        if (!ambiguous[uid]) {
          ambiguous[uid] = { firstSeenAt: new Date().toISOString(), subject: msg.subject.slice(0, 160) };
          await sendTelegram(env, `📥 Airbnb-Mail erkannt, aber nicht sicher parsebar („${msg.subject.slice(0, 80)}"). Kein Vorgang wurde geraten oder angelegt. Bitte im Admin prüfen: ${PORTAL}/admin`);
        }
      }
    }
    seen.ambiguous = ambiguous;

    for (const uid of cancellationUids) {
      if (seenSet.has('c' + uid)) continue;
      const msg = decodeMessage(await imap.fetchMessage(uid));
      const cancellation = parseCancellation(msg);
      const hit = cancellation.complete
        ? cases.find(c => c.reservationCode === cancellation.code)
        : null;
      if (!hit) {
        summary.alerts++;
        await sendTelegram(env, `⚠️ Airbnb-Stornierung erkannt, aber keinem Vorgang sicher zugeordnet: „${msg.subject.slice(0, 100)}“. Kein Fall wurde automatisch verändert.`);
      } else if (hit.status !== 'canceled') {
        hit.status = 'canceled';
        hit.cancellation = {
          source: 'airbnb-email',
          detectedAt: new Date().toISOString(),
          mailDate: cancellation.canceledAt,
          subject: msg.subject.slice(0, 160),
        };
        delete hit.aiReview;
        delete hit.reviewLockedAt;
        dirty = true;
        summary.cancellations++;
        await sendTelegram(env, `🚫 Airbnb-Stornierung verarbeitet: ${hit.guestName} (${hit.reservationCode}). Der Portalzugang ist gesperrt; es wurde keine Gast- oder HOA-Nachricht gesendet.`);
      }
      seenSet.add('c' + uid);
    }

    // every association mail becomes a news item for the admin dashboard
    const newsRaw = await env.CASES.get('hoa-news');
    const news = newsRaw ? JSON.parse(newsRaw) : [];
    let newsDirty = false;

    for (const uid of hoaUids) {
      if (seenSet.has('h' + uid)) continue;
      seenSet.add('h' + uid);
      const msg = decodeMessage(await imap.fetchMessage(uid));
      const day = (msg.date || new Date().toISOString()).slice(0, 10);
      if (!news.some(n => n.subject === msg.subject && (n.at || '').slice(0, 10) === day)) {
        news.unshift({
          at: msg.date || new Date().toISOString(),
          from: msg.from.replace(/<[^>]*>/g, '').replace(/"/g, '').trim() || 'Example Property Management',
          subject: msg.subject,
          excerpt: msg.text.replace(/\s+/g, ' ').trim().slice(0, 400),
        });
        newsDirty = true;
        summary.news = (summary.news || 0) + 1;
      }
      if (!looksLikeApproval(msg.subject)) continue;
      const active = cases.filter(c => c.status !== 'canceled' && !c.steps.find(s => s.id === 'board_approved')?.done);
      const hit = active.find(c => {
        const last = (c.guestName || '').trim().split(/\s+/).pop();
        return last && (msg.subject + msg.text.slice(0, 2000)).toLowerCase().includes(last.toLowerCase());
      });
      if (hit) {
        hit.approvalCandidate = {
          detectedAt: new Date().toISOString(),
          mailDate: msg.date,
          subject: msg.subject.slice(0, 160),
          autoApproved: shouldAutoApproveFromEmail(),
        };
        dirty = true; summary.approvals++;
        await sendTelegram(env, `🏛️ Mögliche Board-Freigabe für ${hit.guestName} (${hit.checkIn}) erkannt: „${msg.subject.slice(0, 70)}“. Aus Sicherheitsgründen wurde nichts automatisch bestätigt und keine Gastmail gesendet. Bitte im Admin prüfen: ${PORTAL}/admin/cases`);
      } else {
        summary.alerts++;
        await sendTelegram(env, `🏛️ Mail der Verwaltung sieht nach Approval aus, passt aber zu keinem offenen Vorgang: „${msg.subject.slice(0, 80)}" — bitte selbst prüfen.`);
      }
    }

    if (newsDirty) {
      news.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
      await env.CASES.put('hoa-news', JSON.stringify(news.slice(0, 100)));
    }
    if (dirty) await env.CASES.put('cases', JSON.stringify(cases));
    seen.uids = [...seenSet].slice(-2000);
    await env.CASES.put('mail-seen', JSON.stringify(seen));
  } finally {
    await imap.close();
  }
  return summary;
}
