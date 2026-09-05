// Poll the mailbox for bookings and HOA correspondence. Email interpretation
// creates evidence/triage events only, never approval or payment confirmation.
import { Imap, decodeMessage } from './imap.js';
import { parseBooking, parseCancellation } from './parse.js';
import { sendTelegram } from './email.js';
import { validateAirbnbCaseInput } from './workflow.js';
import { loadStoredCases, saveStoredCases } from './storage.js';
import {configuredHoaSenders,analyseHoaReply,archiveHoaReply,markHoaReplyProcessed,refreshHoaArchiveRetention} from './hoa-mail.js';
import {captureAirbnbRelay} from './airbnb-relay.js';
import {pollReminderDelivery} from './reminder-delivery.js';
import {reconcileBookingUpdate} from './booking-reconcile.js';

const PORTAL = 'https://portal.example.test';
async function safeNotify(notify, text) {
  try { await notify(text); } catch { /* A notification outage must not lose a durable case change. */ }
}

function newCaseFrom(b) {
  const validation = validateAirbnbCaseInput({ guestName: b.guestName, checkIn: b.checkIn, checkOut: b.checkOut, adults: b.adults });
  if (!validation.ok) throw new Error(`invalid booking: ${validation.error}`);
  const nights = validation.nights;
  const pathType = validation.pathType;
  const STEPS = pathType === 'full'
    ? [['route_selected','Official application route selected'],['forms_sent','Guest portal opened and paperwork started'],['application','1. Lease Application — completed & signed'],['background','2. Background Check Authorization — completed & signed by each adult'],['rules_ack','3. Rules & Regulations — reviewed & signed acknowledgment'],['lease_signed','4. Lease Agreement — signed by guest(s) and owner'],['screening_complete','Official HOA screening/application confirmed complete'],['ids_provided','Photo ID provided securely for each adult'],['fee_sent','$100 fee confirmed received by association'],['owner_reviewed','Owner confirmed the green quality report and released the package'],['submitted_hoa','Complete file submitted to Example Property Management'],['board_approved','HOA Board approval received'],['checkin_released','Check-in instructions released']]
    : [['forms_sent','Guest Registration Form sent to guest'],['registration','Guest Registration Form — completed & signed'],['ids_provided','Photo ID copy provided for each adult'],['submitted_hoa','Registration submitted to Example Property Management'],['board_approved','HOA confirmation received'],['checkin_released','Check-in instructions released']];
  const tokenBytes = new Uint8Array(16);
  crypto.getRandomValues(tokenBytes);
  return {
    id: crypto.randomUUID(),
    token: btoa(String.fromCharCode(...tokenBytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    guestName: b.guestName, reservationCode: b.code,
    checkIn: b.checkIn, checkOut: b.checkOut, nights, adults: b.adults,
    pathType, screeningRoute: pathType === 'full' ? 'undecided' : undefined,
    steps: STEPS.map(([id, label]) => ({ id, label, done: false, date: null })),
    createdAt: new Date().toISOString(),
    notes: 'auto-created from Airbnb confirmation email',
  };
}

export async function pollMail(env,{imap=new Imap(),notify=text=>sendTelegram(env,text)}={}) {
  const seenRaw = await env.CASES.get('mail-seen');
  const seen = seenRaw ? JSON.parse(seenRaw) : { uids: [] };
  const seenSet = new Set(seen.uids);
  const summary = { bookings: 0, cancellations: 0, approvals: 0, alerts: 0,hoaLinked:0,hoaUnassigned:0 };
  try {
    await imap.open(env.GMAIL_USER || 'contact008@example.test', env.GMAIL_APP_PASSWORD);

    // NOTE: query must stay ASCII-only — non-ASCII breaks IMAP quoted strings ("buchung" also matches "Buchung bestätigt")
    const bookingUids = await imap.searchRaw('from:airbnb.com subject:("reservation confirmed" OR buchung) newer_than:30d');
    const cancellationUids = await imap.searchRaw('from:airbnb.com subject:(canceled OR cancelled OR storniert) newer_than:30d');
    const senders=configuredHoaSenders(env);
    const cases = await loadStoredCases(env);
    await refreshHoaArchiveRetention(env,cases);
    let dirty = false;

    const ambiguous = seen.ambiguous || {};
    for (const uid of bookingUids) {
      if (seenSet.has('b' + uid)) continue;
      const msg = decodeMessage(await imap.fetchMessage(uid));
      const b = parseBooking(msg, msg.date);
      const existing = b.code && cases.find(c => c.reservationCode === b.code);
      if (existing) {
        if(b.complete&&reconcileBookingUpdate(existing,b)) { dirty=true;summary.bookingChanges=(summary.bookingChanges||0)+1; }
        seenSet.add('b' + uid); delete ambiguous[uid]; continue;
      }
      if (b.complete) {
        try {
          const c = newCaseFrom(b);
          cases.push(c); dirty = true; summary.bookings++;
          seenSet.add('b' + uid); delete ambiguous[uid];
          await safeNotify(notify, `🆕 Buchung erkannt & Vorgang angelegt: ${b.guestName}, ${b.checkIn} → ${b.checkOut} (${c.nights} Nächte, ${c.pathType}, ${b.code}, ${b.adults} Erwachsene).\n\n➡️ Bitte Daten im Admin prüfen und den Portalzugang per Airbnb-Chat senden:\n${PORTAL}/admin`);
        } catch (e) {
          summary.alerts++;
          if (!ambiguous[uid]) {
            ambiguous[uid] = { firstSeenAt: new Date().toISOString(), subject: msg.subject.slice(0, 160), reason: String(e && e.message || e).slice(0, 200) };
            await safeNotify(notify, `📥 Airbnb-Buchung braucht manuelle Bearbeitung: ${b.guestName || msg.subject.slice(0, 80)} — ${String(e && e.message || e).slice(0, 160)}. Kein unvollständiger Vorgang wurde angelegt. ${PORTAL}/admin`);
          }
        }
      } else {
        summary.alerts++;
        if (!ambiguous[uid]) {
          ambiguous[uid] = { firstSeenAt: new Date().toISOString(), subject: msg.subject.slice(0, 160) };
          await safeNotify(notify, `📥 Airbnb-Mail erkannt, aber nicht sicher parsebar („${msg.subject.slice(0, 80)}"). Kein Vorgang wurde geraten oder angelegt. Bitte im Admin prüfen: ${PORTAL}/admin`);
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
        await safeNotify(notify, `⚠️ Airbnb-Stornierung erkannt, aber keinem Vorgang sicher zugeordnet: „${msg.subject.slice(0, 100)}“. Kein Fall wurde automatisch verändert.`);
      } else if (hit.status !== 'canceled') {
        hit.status = 'canceled';
        hit.cancellation = {
          source: 'airbnb-email',
          detectedAt: new Date().toISOString(),
          mailDate: cancellation.canceledAt,
          subject: msg.subject.slice(0, 160),
        };
        delete hit.aiReview;
        // Retain any delivery claim: cancellation must not erase evidence of
        // an in-flight/uncertain send or permit a duplicate submission.
        dirty = true;
        summary.cancellations++;
        await safeNotify(notify, `🚫 Airbnb-Stornierung verarbeitet: ${hit.guestName} (${hit.reservationCode}). Der Portalzugang ist gesperrt; es wurde keine Gast- oder HOA-Nachricht gesendet.`);
      }
      seenSet.add('c' + uid);
    }

    // No message text/header alone authorizes this destination. The owner
    // verifies a candidate against the original Airbnb conversation first.
    if(env.AIRBNB_RELAY_CAPTURE==='yes'||env.AIRBNB_RELAY_REMINDERS==='yes') {
      if(!env.CASE_STORE||env.REQUIRE_ATOMIC_CASES!=='yes')throw Error('Relay capture requires mandatory atomic storage');
      if(env.AIRBNB_RELAY_MAILBOX)await imap.selectMailbox(env.AIRBNB_RELAY_MAILBOX);
      const relayUids=await imap.searchRaw('from:airbnb.com newer_than:30d');
      if(relayUids.length>200)throw Error('Airbnb relay scan exceeds safe batch limit');
      for(const uid of relayUids) {
        if(await captureAirbnbRelay(decodeMessage(await imap.fetchMessage(uid)),cases)) {
          dirty=true;summary.relayCandidates=(summary.relayCandidates||0)+1;
        }
      }
    }

    if(env.REMINDER_DELIVERY_MONITOR==='yes') {
      summary.deliveryNotices=await pollReminderDelivery(env,imap,cases);
      if(summary.deliveryNotices>0) dirty=true;
      if(env.HOA_MAILBOX) await imap.selectMailbox(env.HOA_MAILBOX);
      else await imap.selectMailbox('INBOX');
    }

    // Every distinct reply becomes an encrypted source plus a metadata-only
    // event. Do not deduplicate by subject/day: multiple replies can differ.
    // The folder must be verified on the actual account (e.g. its All Mail
    // folder). Never guess localized Gmail names or mutate mailbox filters.
    if(env.HOA_MAILBOX) await imap.selectMailbox(env.HOA_MAILBOX);
    else if(env.AIRBNB_RELAY_MAILBOX&&(env.AIRBNB_RELAY_CAPTURE==='yes'||env.AIRBNB_RELAY_REMINDERS==='yes')) await imap.selectMailbox('INBOX');
    const hoaUids = await imap.searchRaw((senders.length?'from:('+senders.join(' OR ')+')':'from:condominiumassociates.com')+' newer_than:90d');
    const newsRaw = await env.CASES.get('hoa-news');
    const news = newsRaw ? JSON.parse(newsRaw) : [];
    let newsDirty = false;
    const hoaNotifications=[];
    const hoaProcessed=[];

    for (const uid of hoaUids) {
      const msg = decodeMessage(await imap.fetchMessage(uid));
      const analysis=analyseHoaReply(msg,cases,senders);
      const {processed,...event}=await archiveHoaReply(env,msg,analysis,cases);
      // A source explicitly reviewed by the owner keeps that assignment on
      // later polls; automatic matching must not undo a manual reconciliation.
      const verified=cases.filter(c=>(c.hoaMailEvents||[]).some(e=>e.id===event.id&&e.review));
      if(verified.length===1) {
        const reviewed=verified[0].hoaMailEvents.find(e=>e.id===event.id);
        event.caseId=verified[0].id;event.matchReason=reviewed.matchReason||'owner_verified';
        event.reviewRequired=reviewed.reviewRequired;
      }
      const hit=cases.find(c=>c.id===event.caseId);
      const existing=news.find(n=>n.id===event.id);
      if(hit && !(hit.hoaMailEvents||[]).some(e=>e.id===event.id)) {
        hit.hoaMailEvents=[...(hit.hoaMailEvents||[]),{id:event.id,at:event.at,mailDate:event.mailDate,categories:event.categories,matchReason:event.matchReason,reviewRequired:true}];
        dirty=true;summary.hoaLinked++;
      }
      if(!existing && !processed) {
        news.unshift(event);newsDirty=true;summary.news=(summary.news||0)+1;
        if(!hit) summary.hoaUnassigned++;
        // No private body, guest name or sender-provided instructions in alerts.
        hoaNotifications.push('🏛️ Neue HOA-E-Mail erfasst. '+(hit?'Dem Mietvorgang zugeordnet.':'Zuordnung unklar.')+' Zahlungs- und Freigabestatus wurden nicht verändert. Quelle unter '+PORTAL+'/admin/hoa-mail/'+event.id+' prüfen.');
      } else if(existing && (existing.caseId!==event.caseId||existing.reviewRequired!==event.reviewRequired)) {
        Object.assign(existing,event);newsDirty=true;
      }
      if(!processed) hoaProcessed.push(event.id);
    }

    // Persist case events before cursors/indexes. Failed atomic updates must be
    // retried on the next poll; archived evidence alone is not a processed event.
    if (dirty) await saveStoredCases(env, cases);
    if (newsDirty) {
      news.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
      await env.CASES.put('hoa-news', JSON.stringify(news.slice(0, 100)));
    }
    seen.uids = [...seenSet].slice(-2000);
    await env.CASES.put('mail-seen', JSON.stringify(seen));
    for(const id of hoaProcessed) await markHoaReplyProcessed(env,id);
    for(const text of hoaNotifications) {try {await notify(text);} catch { /* Source and pending event remain visible in the portal. */ }}
  } finally {
    await imap.close();
  }
  return summary;
}
