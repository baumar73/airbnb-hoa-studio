// isla-cron — daily watchdog for the HOA approval portal.
// Runs on Cloudflare (cron 13:00 UTC = 08:00 Panama), reads the shared CASES KV,
// sends actionable reminders to Owner via Telegram, and remembers what it
// already nudged in case.notify to avoid spam.

const DAY = 86400000;
const PORTAL = 'https://portal.example.test';

function daysUntil(dateStr, now) {
  return Math.ceil((new Date(dateStr + 'T12:00:00Z') - now) / DAY);
}
function ageDays(iso, now) {
  return iso ? (now - new Date(iso)) / DAY : Infinity;
}
function stepDone(c, id) {
  return c.steps.find(s => s.id === id && s.done);
}

export function computeAlerts(cases, now) {
  const alerts = [];
  for (const c of cases) {
    c.notify = c.notify || {};
    const n = c.notify;
    const days = daysUntil(c.checkIn, now);
    const approved = stepDone(c, 'board_approved');
    const released = stepDone(c, 'checkin_released');
    if (days < -1 || (approved && released)) continue; // done or past

    const link = `${PORTAL}/admin`;
    const who = `${c.guestName} (${c.checkIn} → ${c.checkOut})`;

    if (!c.wizard && ageDays(c.createdAt, now) >= 3 && ageDays(n.wizardNudge, now) >= 3) {
      alerts.push({ c, key: 'wizardNudge', text: `📝 ${who}: Gast hat den Formular-Wizard noch nicht ausgefüllt. Erinnerung über den Airbnb-Chat senden? Magic-Link: ${PORTAL}/v/${c.token}` });
    }
    if (c.wizard && !stepDone(c, 'submitted_hoa') && ageDays(c.wizard.savedAt, now) >= 2 && ageDays(n.submitNudge, now) >= 3) {
      alerts.push({ c, key: 'submitNudge', text: `📤 ${who}: Wizard-Daten liegen seit ${Math.floor(ageDays(c.wizard.savedAt, now))} Tagen vor, aber das Paket ist noch nicht bei der HOA eingereicht. ${link}` });
    }
    const submitted = c.steps.find(s => s.id === 'submitted_hoa');
    if (submitted && submitted.done && !approved && ageDays(submitted.date, now) >= 5 && ageDays(n.hoaNudge, now) >= 3) {
      alerts.push({ c, key: 'hoaNudge', text: `🏛️ ${who}: HOA-Einreichung liegt ${Math.floor(ageDays(submitted.date, now))} Tage zurück ohne Board-Approval. Bei Example Property Management nachfassen (info@ / kruiz@, +1-555-000-001).` });
    }
    // fee tracking applies only when the association fee is actually required.
    if (applicationFeeState(c) === 'required') {
      const feeConfirmed = stepDone(c, 'fee_sent');
      if (c.wizard && !c.feeMailed && !feeConfirmed && ageDays(c.wizard.savedAt, now) >= 4 && ageDays(n.feeGuestNudge, now) >= 3) {
        alerts.push({ c, key: 'feeGuestNudge', text: `💵 ${who}: Gast hat den $100-Scheck noch nicht als "mailed" gemeldet (Formulare seit ${Math.floor(ageDays(c.wizard.savedAt, now))} Tagen fertig). Erinnerung senden → ${link} („Gast: Gebühr erinnern").` });
      }
      if (c.feeMailed && !feeConfirmed && ageDays(c.feeMailed, now) >= 7 && ageDays(n.feeHoaNudge, now) >= 3) {
        alerts.push({ c, key: 'feeHoaNudge', text: `🏦 ${who}: Scheck laut Gast seit ${Math.floor(ageDays(c.feeMailed, now))} Tagen unterwegs, Empfang von der Verwaltung noch nicht bestätigt. Nachfragen → ${link} („HOA: Empfang bestätigen").` });
      }
    }
    if (days <= 30 && days >= 0 && !stepDone(c, 'submitted_hoa') && ageDays(n.deadlineRisk, now) >= 3) {
      alerts.push({ c, key: 'deadlineRisk', text: `⚠️ ${who}: Noch ${days} Tage bis Check-in, aber das vollständige Paket ist noch nicht bei der HOA. Die Verwaltung nennt bis zu 15 Tage Bearbeitungszeit; Scheck und Ausweise müssen vorher vollständig sein.` });
    }
    if (days <= 16 && days >= 0 && !approved && ageDays(n.escalation, now) >= 1) {
      alerts.push({ c, key: 'escalation', text: `🚨 ${who}: Nur noch ${days} Tage bis Check-in und KEIN Board-Approval. Die offizielle Bearbeitungszeit von bis zu 15 Tagen ist erreicht. Verwaltung sofort anrufen und Alternativen prüfen.` });
    }
  }
  return alerts;
}

export function buildDigest(cases, now) {
  const active = cases.filter(c => daysUntil(c.checkIn, now) >= -1 && !(stepDone(c, 'board_approved') && stepDone(c, 'checkin_released')));
  if (!active.length) return '🌴 Demo Unit Wochen-Digest: keine offenen Vorgänge.';
  const lines = active.map(c => {
    const done = c.steps.filter(s => s.done).length;
    return `• ${c.guestName} ${c.checkIn}→${c.checkOut}: ${done}/${c.steps.length} Schritte${c.wizard ? ', Wizard ✓' : ', Wizard ✗'}${stepDone(c, 'board_approved') ? ', Approved ✓' : ''}`;
  });
  return `🌴 Demo Unit Wochen-Digest (${active.length} offen):\n` + lines.join('\n') + `\n${PORTAL}/admin`;
}

async function sendTelegram(env, text) {
  const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true }),
  });
  if (!resp.ok) console.log('telegram error', resp.status, await resp.text());
  return resp.ok;
}

import { purgeExpiredCases, applicationFeeState } from '../../functions/lib/workflow.js';
import { pollMail } from '../../functions/lib/mailpoll.js';

export default {
  async scheduled(event, env, ctx) {
    const now = new Date();

    // half-hourly runs: mail polling only
    if (event.cron === '*/30 * * * *') {
      try {
        const s = await pollMail(env);
        console.log('mailpoll:', JSON.stringify(s));
      } catch (e) {
        console.log('mailpoll error:', String(e && e.message || e));
        // alert at most the daily run handles persistent errors; one-off IMAP hiccups stay silent
      }
      return;
    }
    const raw = await env.CASES.get('cases');
    const loadedCases = raw ? JSON.parse(raw) : [];
    const { kept: cases, purged } = purgeExpiredCases(loadedCases, now, 90);
    if (purged.length) {
      await env.CASES.put('cases', JSON.stringify(cases));
      await sendTelegram(env, `🧹 Datenschutz: ${purged.length} abgeschlossene Gastvorgänge wurden 90 Tage nach Check-out aus dem Portal gelöscht.`);
    }

    const alerts = computeAlerts(cases, now);
    for (const a of alerts) {
      if (await sendTelegram(env, a.text)) a.c.notify[a.key] = now.toISOString();
    }
    if (now.getUTCDay() === 0) await sendTelegram(env, buildDigest(cases, now));
    if (alerts.length) await env.CASES.put('cases', JSON.stringify(cases));
    console.log(`isla-cron: ${alerts.length} alert(s), ${cases.length} case(s)`);
  },

  // manual trigger for verification: GET /run-poll?key=<POLL_TEST_KEY>
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/run-poll' && env.POLL_TEST_KEY && url.searchParams.get('key') === env.POLL_TEST_KEY) {
      try {
        const s = await pollMail(env);
        return new Response(JSON.stringify(s), { headers: { 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response('isla-cron', { status: 200 });
  },
};
