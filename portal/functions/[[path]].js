// Demo Unit — HOA Approval Portal (Cloudflare Pages Functions)
// Storage: Workers KV (binding CASES, key "cases" = JSON array).
// Admin: HTTP Basic Auth (env ADMIN_USER / ADMIN_PASSWORD).
import { fillLeaseApplication, fillGuestRegistration, splitLeaseApplicationPackage, buildRulesAcknowledgment } from './lib/fill.js';
import { generateLeaseAgreement } from './lib/lease.js';
import { generateFloodDisclosure } from './lib/flood.js';
import { submitApprovedPackage, isReadyForOwnerReview, docStates, generatePackage } from './lib/submit.js';
import { validateCaseInput, isAllowedMutationOrigin, validateLiveSubmissionPrerequisites, validateSignaturePng, isGuestAccessibleCase, applicationFeeState, isGuestPaperworkComplete } from './lib/workflow.js';
import { COMPLIANCE_POLICY_VERSION, HOA_SOURCE_PACKET, adverseActionNotice, isAnnualRental, isSameLesseeRenewal, liveComplianceState, externalFeeRequestAuthorized } from './lib/compliance.js';
import { getEncryptedSecret, loadStoredCases, putEncryptedSecret, saveStoredCases, inheritCaseSnapshot, caseSnapshotVersion } from './lib/storage.js';
import { sendViaGmail, sendTelegram } from './lib/email.js';
import { confirmHoaOccupancy, parseAdultFormSlots } from './lib/guest-form.js';
import { bookingLastName } from './lib/parse.js';
import { tolerantCompare } from './lib/secure-compare.js';
import { needsReview, reviewContextHash, validateReviewReport, reviewCaseData, caseReviewDigest } from './lib/review.js';
import { archivePackage, loadArchivedPackage, reviewPackagePayload } from './lib/package-archive.js';
import {planGuestJourney} from './lib/journey.js';
import {contactPreference,guestReminderEmail} from './lib/guest-contact.js';
import {verifyAirbnbRelay,usableAirbnbRelay} from './lib/airbnb-relay.js';
import {reviewDeliveryNotice,pendingDeliveryNotices} from './lib/reminder-delivery.js';
import {acknowledgeBookingChange} from './lib/booking-reconcile.js';
import {readAutomationStatus,automationHealth} from './lib/automation-health.js';
import {readHoaReply,refreshHoaArchiveRetention} from './lib/hoa-mail.js';
import {HOA_ITEMS,HOA_CONFIRMATIONS,hoaEvidenceState,hoaTaskText,reviewHoaEvidence,reportHoaTask} from './lib/hoa-evidence.js';
import {completedReview,reviewAvailable,claimReview,ownsReview,failReview,recordReviewerHeartbeat} from './lib/review-jobs.js';
import {knowledgeExportResponse} from './lib/knowledge-export.js';
import {bookingApprovalNotice} from './lib/booking-notice.js';
import {reconcileAcceptedPackage,packageReconciliationView} from './lib/package-reconciliation.js';

// ---------- domain ----------
const STEP_TEMPLATES = {
  full: [
    ['route_selected',   'Official application route selected'],
    ['forms_sent',      'First paperwork draft saved'],
    ['application',     '1. Lease Application — completed & signed'],
    ['background',      '2. Background Check Authorization — completed & signed by each adult'],
    ['rules_ack',       '3. Rules & Regulations — reviewed & signed acknowledgment'],
    ['lease_signed',    '4. Lease Agreement — signed by guest(s) and owner'],
    ['screening_complete','Official HOA screening/application confirmed complete'],
    ['ids_provided',    'Photo ID provided securely for each adult'],
    ['fee_sent',        '$100 fee confirmed received by association'],
    ['owner_reviewed',  'Owner confirmed the green quality report and released the package'],
    ['submitted_hoa',   'Complete file submitted to Example Property Management'],
    ['board_approved',  'HOA Board approval received'],
    ['checkin_released','Check-in instructions released'],
  ],
  'guest-registration': [
    ['forms_sent',      'Guest Registration Form sent to guest'],
    ['registration',    'Guest Registration Form — completed & signed'],
    ['ids_provided',    'Photo ID copy provided for each adult'],
    ['submitted_hoa',   'Registration submitted to Example Property Management'],
    ['board_approved',  'HOA confirmation received'],
    ['checkin_released','Check-in instructions released'],
  ],
};

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function newCase(input) {
  const pathType = (input.nights >= 30) ? 'full' : 'guest-registration';
  const tokenBytes = new Uint8Array(16);
  crypto.getRandomValues(tokenBytes);
  return {
    id: crypto.randomUUID(),
    token: b64url(tokenBytes),
    guestName: input.guestName,
    reservationCode: input.reservationCode || '',
    checkIn: input.checkIn, checkOut: input.checkOut,
    nights: input.nights, adults: input.adults,
    pathType, screeningRoute: pathType === 'full' ? 'undecided' : undefined,
    steps: STEP_TEMPLATES[pathType].map(([id, label]) => ({ id, label, done: false, date: null })),
    createdAt: new Date().toISOString(),
    notes: '',
  };
}

// ---------- storage ----------
async function loadCases(env) {
  const cases = await loadStoredCases(env);
  return inheritCaseSnapshot(cases, cases.map(c => {
    const template = STEP_TEMPLATES[c.pathType] || STEP_TEMPLATES.full;
    const previous = new Map((c.steps || []).map(step => [step.id, step]));
    const known = new Set(template.map(([id]) => id));
    const normalized = template.map(([id, label]) => {
      const old = previous.get(id) || {};
      return { ...old, id, label, done: !!old.done, date: old.date || null };
    });
    normalized.push(...(c.steps || []).filter(step => !known.has(step.id)));
    return {
      ...c,
      screeningRoute: c.pathType === 'full' ? (c.screeningRoute || 'undecided') : c.screeningRoute,
      steps: normalized,
    };
  }), true);
}
async function saveCases(env, cases) {
  await saveStoredCases(env, cases);
}

async function loadComplianceConfig(env) {
  return JSON.parse((await env.CASES.get('compliance-config')) || '{}');
}

// ---------- helpers ----------
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr + 'T12:00:00Z') - new Date()) / 86400000);
}
// security headers applied to every response we control
const SEC_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self'; " +
    "img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; " +
    "form-action 'self'; frame-ancestors 'none'",
};

// Central HTML responder: rotates a per-response CSP nonce so inline
// <script>/<style> elements are allowed WITHOUT 'unsafe-inline'. The same
// nonce is injected into the CSP header and into every script/style tag, so
// the rewritten body must be returned (not the original).
function html(body, code, indexable) {
  const nonce = randNonce();
  const out = body.replace(/<(script|style)\b/gi, `<$1 nonce="${nonce}"`);
  const csp = "default-src 'self'; script-src 'self' 'nonce-" + nonce + "'; style-src 'self' 'nonce-" + nonce + "'; " +
    "img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; " +
    "form-action 'self'; frame-ancestors 'none'";
  const headers = { 'Content-Type': 'text/html; charset=utf-8', ...SEC_HEADERS,
    'Content-Security-Policy': csp,
    'Cache-Control': indexable ? 'public, max-age=300' : 'private, no-store, max-age=0' };
  if (!indexable) headers['X-Robots-Tag'] = 'noindex';
  return new Response(out, { status: code || 200, headers });
}
function randNonce() {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function redirect(loc) {
  return new Response(null, { status: 303, headers: { Location: loc, ...SEC_HEADERS, 'Cache-Control': 'private, no-store, max-age=0' } });
}
async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function reviewPayload(c, wizard, includeSignatures) {
  const cleanAdults = ((wizard && wizard.adults) || []).map(a => {
    const copy = { ...a };
    if (!includeSignatures) {
      delete copy.sigPng;
      delete copy.signatureAudit;
    }
    return copy;
  });
  return {
    case: { id: c.id, reservationCode: c.reservationCode, checkIn: c.checkIn, checkOut: c.checkOut, adults: c.adults, pathType: c.pathType,
      applicationType: c.applicationType || 'lease', sameLesseesConfirmed: c.sameLesseesConfirmed === true },
    wizard: {
      adults: cleanAdults,
      esignConsent: !!(wizard && wizard.esignConsent),
      rulesAcknowledged: !!(wizard && wizard.rulesAcknowledged),
      auto: (wizard && wizard.auto) || {},
      references: (wizard && wizard.references) || [],
      emergency: (wizard && wizard.emergency) || [],
      children: (wizard && wizard.children) || [],
    },
  };
}
async function reviewDigest(c, wizard, includeSignatures = true) {
  return caseReviewDigest(c,wizard,includeSignatures);
}
function normalizedLastName(s) {
  return bookingLastName(s);
}
async function findRateAllowed(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = 'find-rate:' + (await sha256hex(ip + ':' + (env.FIND_RATE_SALT || 'isla'))).slice(0, 24);
  const count = Number(await env.CASES.get(key) || 0);
  if (count >= 20) return false;
  await env.CASES.put(key, String(count + 1), { expirationTtl: 900 });
  return true;
}
async function checkAdmin(request, env) {
  const hdr = request.headers.get('Authorization') || '';
  if (hdr.startsWith('Basic ')) {
    let decoded = '';
    try { decoded = atob(hdr.slice(6)); } catch (_) { decoded = ''; }
    const sep = decoded.indexOf(':');
    const u = sep >= 0 ? decoded.slice(0, sep) : '';
    const p = sep >= 0 ? decoded.slice(sep + 1) : '';
    if (await tolerantCompare(u, env.ADMIN_USER || 'markus')) {
      const kvHash = await env.CASES.get('admin-password-hash');
      if (kvHash) { if (await tolerantCompare(await sha256hex(p), kvHash)) return null; }
      else if (env.ADMIN_PASSWORD && await tolerantCompare(p, env.ADMIN_PASSWORD)) return null;
    }
  }
  return new Response('Authentication required', { status: 401, headers: {
    'WWW-Authenticate': 'Basic realm="Demo Unit Admin"', ...SEC_HEADERS,
    'Cache-Control': 'private, no-store, max-age=0', 'X-Robots-Tag': 'noindex'
  } });
}

// ---------- styles (coastal identity: warm sand ground, Boca Ciega bay teal, sunset coral accent, serif display) ----------
const CSS = `
:root{
 --paper:#EFEDE4;--card:#FCFBF6;--ink:#182826;--soft:#465350;
 --faint:#6C736F;--line:#E0DDCE;--line-strong:#CBC7B2;
 --accent:#1E6F6B;--accent-deep:#155450;--accent-wash:#DCEBE7;
 --sun:#D9663D;--sun-deep:#B84E29;--sun-wash:#F7E6DC;
 --ok:#3F7A5B;--ok-wash:#E2EEE5;--warn:#9A6A12;--warn-wash:#F5EAD2;--crit:#A33D2E;--crit-wash:#F6E2DC;
 --serif:'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif;
 --sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;
 --mono:ui-monospace,'SF Mono',Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--sans);line-height:1.65;font-size:16.5px;
 -webkit-font-smoothing:antialiased}
header{padding:52px 22px 34px;border-bottom:1px solid var(--line)}
.wrap{max-width:720px;margin:0 auto}
.brand{font-family:var(--serif);font-size:15px;letter-spacing:.02em;color:var(--soft);margin:0 0 22px}
.brand b{color:var(--accent-deep);font-weight:600}
h1{font-family:var(--serif);font-weight:600;font-size:clamp(30px,5.4vw,42px);line-height:1.12;margin:0 0 12px;
 letter-spacing:-.01em;text-wrap:balance}
header p{color:var(--soft);margin:0;max-width:58ch;font-size:17.5px}
.chip{display:inline-block;font-family:var(--mono);font-size:12px;color:var(--accent-deep);background:var(--accent-wash);
 padding:5px 12px;border-radius:99px;margin-top:16px}
main{max-width:720px;margin:0 auto;padding:30px 22px 70px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px 26px;margin:18px 0;
 box-shadow:0 1px 2px rgba(60,50,30,.04)}
h2{font-family:var(--serif);font-weight:600;font-size:22px;margin:0 0 10px;letter-spacing:-.005em}
.pill{display:inline-block;font-family:var(--mono);font-size:11.5px;padding:4px 12px;border-radius:99px;vertical-align:middle}
.pill.ok{background:var(--ok-wash);color:var(--ok)}.pill.warn{background:var(--warn-wash);color:var(--warn)}
.pill.teal{background:var(--accent-wash);color:var(--accent-deep)}
ul.steps{list-style:none;padding:0;margin:0}
ul.steps li{display:flex;gap:14px;align-items:flex-start;padding:11px 0;border-bottom:1px solid var(--line)}
ul.steps li:last-child{border-bottom:none}
.dot{flex:0 0 24px;height:24px;border-radius:50%;border:2px solid var(--line-strong);margin-top:2px;text-align:center;
 line-height:21px;font-size:13px;color:#fff;background:transparent;transition:background .3s}
li.done .dot{background:var(--ok);border-color:var(--ok)}
li.done span.lbl{color:var(--faint);text-decoration:line-through;text-decoration-color:var(--line-strong)}
li.next .dot{border-color:var(--sun)}
.bar{height:8px;background:var(--line);border-radius:99px;overflow:hidden;margin:14px 0 6px}
.bar>div{height:100%;background:linear-gradient(90deg,var(--accent),var(--sun));border-radius:99px;
 transition:width .6s ease}
.muted{color:var(--faint);font-size:14.5px}
table{width:100%;border-collapse:collapse;font-size:14.5px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)}
input,select,textarea{font:inherit;padding:10px 12px;border:1px solid var(--line-strong);border-radius:9px;width:100%;
 background:#fff;color:var(--ink)}
input:focus,textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
input[type="checkbox"],input[type="radio"]{width:auto;min-width:18px;min-height:18px;vertical-align:middle}
.review-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px 14px;margin:8px 0 12px}.review-grid label{margin:0;font-size:13px}
label{font-size:13.5px;color:var(--soft);display:block;margin:12px 0 5px;font-weight:500}
button,a.btn{font:inherit;font-weight:600;background:var(--accent);color:#FDFCF8;border:0;border-radius:10px;
 padding:11px 20px;cursor:pointer;transition:background .15s;display:inline-block;text-decoration:none}
button:hover,a.btn:hover{background:var(--accent-deep)}
button.small,a.btn.small{padding:10px 14px;min-height:44px;font-size:13px;font-weight:500}
button.ghost,a.btn.ghost{background:transparent;color:var(--accent-deep);border:1.5px solid var(--accent)}
button.ghost:hover,a.btn.ghost:hover{background:var(--accent-wash)}
button:focus-visible,a.btn:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
a{color:var(--accent-deep)}
.addr{font-family:var(--mono);font-size:13px;background:var(--sun-wash);color:var(--ink);padding:14px 16px;
 border-radius:10px;white-space:pre-line;border:1px solid #EAD3C4}
.sigpad{border:1.5px dashed var(--line-strong);border-radius:12px;width:100%;touch-action:none;background:#fff;display:block}
.sigrow{display:flex;gap:10px;align-items:center;margin-top:8px;flex-wrap:wrap}
.anav{display:flex;gap:6px;flex-wrap:wrap;margin-top:20px}
.anav a{font-family:var(--mono);font-size:12.5px;text-decoration:none;color:var(--soft);padding:6px 13px;
 border:1px solid var(--line);border-radius:99px;background:var(--card)}
.anav a:hover{border-color:var(--accent);color:var(--accent-deep)}
.anav a.on{background:var(--accent);border-color:var(--accent);color:#FDFCF8}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:18px 0}
a.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;text-align:center;
 text-decoration:none;color:var(--ink);box-shadow:0 1px 2px rgba(60,50,30,.04)}
a.kpi:hover{border-color:var(--accent)}
a.kpi b{font-family:var(--serif);font-size:26px;display:block;line-height:1.2}
a.kpi span{font-size:12.5px;color:var(--faint)}
details.sect{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:2px 26px;margin:14px 0;
 box-shadow:0 1px 2px rgba(60,50,30,.04)}
details.sect>summary{cursor:pointer;font-family:var(--serif);font-weight:600;font-size:20px;padding:16px 0;
 list-style:none;display:flex;justify-content:space-between;align-items:center;gap:10px}
details.sect>summary::-webkit-details-marker{display:none}
details.sect>summary::after{content:'+';color:var(--accent);font-size:22px;font-family:var(--sans)}
details.sect[open]>summary::after{content:'–'}
details.sect>*:last-child{margin-bottom:18px}
.attn{border-left:4px solid var(--warn);padding:10px 14px;background:var(--warn-wash);border-radius:8px;margin:8px 0;font-size:15px}
.attn.crit{border-left-color:var(--crit);background:var(--crit-wash)}
.attn.okk{border-left-color:var(--ok);background:var(--ok-wash)}
footer{text-align:center;color:var(--faint);font-size:13px;padding:26px 22px;border-top:1px solid var(--line);margin-top:20px}

/* --- auto-generated utility classes (CSP: no inline style attributes) --- */
.ue90617ff{background:var(--crit-wash);color:var(--crit)}
.u41e4e7c4{border:1.5px dashed var(--line);border-radius:8px;width:100%;max-width:700px;touch-action:none;background:#fff}
.uca265730{color:var(--sun-deep);font-size:14.5px;font-weight:500}
.u2a1b75c9{display:block}
.ua605c51e{display:block;margin-top:10px}
.u60901360{display:flex;gap:10px;align-items:flex-start;font-weight:400}
.u6002dd78{display:flex;gap:10px;flex-wrap:wrap}
.u593718ea{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.uee52adba{display:flex;gap:6px;flex-direction:column}
.u472ec391{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px}
.u4e330d89{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.u059faac0{display:grid;grid-template-columns:1fr 2fr 1fr;gap:10px}
.ua8ddc3e4{display:grid;grid-template-columns:1fr 2fr;gap:10px}
.udcefdb35{display:grid;grid-template-columns:2fr 1.5fr 2fr;gap:10px}
.u8c47274e{display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px}
.uaadb3cb7{display:grid;grid-template-columns:2fr 1fr;gap:10px}
.ucccfa456{display:inline}
.uc3c8d100{display:inline-flex;gap:7px;align-items:center;margin:0 8px}
.u41e578a4{display:inline-flex;gap:7px;align-items:center;margin:0;font-weight:400}
.u97445a8d{flex:1}
.u53f8a2fa{font-family:var(--mono);font-size:11.5px}
.ue1e124fa{font-family:var(--mono);font-size:12px}
.ue785b9bd{font-size:13.5px}
.u5e0faad2{font-size:13px}
.u433de30b{font-size:14px}
.ude00808e{font-size:15px}
.u1444c6ea{font-size:16px}
.uef0b7a11{margin-bottom:0}
.u78fa54ea{margin-left:10px}
.u5dd2a678{margin-left:8px}
.ud2c171b1{margin-top:10px}
.u575c0429{margin-top:10px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.ud6f2af6e{margin-top:14px}
.uc42fdd48{margin:0;font-weight:400}
.u82460327{margin:10px 0 0}
.u2d724d0f{margin:14px 0 0}
.ua548ea71{white-space:pre-wrap}
.u8d2e5f36{white-space:pre-wrap;overflow-wrap:anywhere}
.u0466783d{width:100%}
.u581be415{width:90px}
.u30e741d9{width:auto}
.u495e8c7d{width:auto;margin-top:4px}
.barfill{height:100%;border-radius:8px;background:var(--accent)}
@media(prefers-reduced-motion:reduce){*{transition:none!important}}
@media(max-width:640px){
 header{padding:34px 18px 24px}
 main{padding:22px 16px 60px}
 .card{padding:20px 18px}
 .review-grid{grid-template-columns:1fr}
 details.sect{padding:2px 18px}
 h1{font-size:clamp(26px,7vw,34px)}
 main .u472ec391 ,main .u4e330d89 ,main .u059faac0 ,main .ua8ddc3e4 ,main .udcefdb35 ,main .u8c47274e ,main .uaadb3cb7{grid-template-columns:1fr!important;gap:8px!important}
 table,thead,tbody,th,td,tr{display:block}
 thead{position:absolute;left:-9999px}
 td{border-bottom:none;padding:3px 0}
 tr{border-bottom:1px solid var(--line);padding:10px 0}
}
`;

function page(title, headerHtml, bodyHtml, opts) {
  const o = opts || {};
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0f4c5c">${o.index ? '' : '<meta name="robots" content="noindex">'}
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="manifest" href="/manifest.webmanifest">
<title>${esc(title)}</title>${o.extraHead || ''}<style>${CSS}</style></head><body>
<header><div class="wrap"><p class="brand">Example Island <b>· Unit 405D</b> — Guest Approval</p>${headerHtml}</div></header><main>${bodyHtml}</main>
<footer>Example Island · Unit 405D · 6219 Palma Del Mar Blvd S, St. Petersburg FL — private guest-approval portal · <a href="/privacy">Privacy</a> · <a href="/fair-housing">Fair housing &amp; accommodations</a></footer>
<script>
document.querySelectorAll('form[data-confirm]').forEach(function(f){f.addEventListener('submit',function(e){if(!window.confirm(f.getAttribute('data-confirm')))e.preventDefault();});});
document.querySelectorAll('.barfill[data-pct]').forEach(function(b){b.style.width=b.getAttribute('data-pct')+'%';});
</script>
</body></html>`;
}

// ---------- admin chrome ----------
const ANAV = [
  ['/admin', 'Übersicht'],
  ['/admin/cases', 'Vorgänge'],
  ['/admin/news', 'Neuigkeiten'],
  ['/admin/board', 'Board'],
  ['/admin/contacts', 'Kontakte'],
  ['/admin/library', 'Bibliothek'],
  ['/admin/receipts', 'Quittungen'],
  ['/admin/settings', 'Einstellungen'],
];
function adminPage(title, active, headerHtml, bodyHtml) {
  const nav = `<nav class="anav">${ANAV.map(([href, label]) =>
    `<a href="${href}"${href === active ? ' class="on"' : ''}>${label}</a>`).join('')}</nav>`;
  return page(title, headerHtml + nav, bodyHtml);
}

// ---------- views ----------
const HOME_DESC = 'Quiet one-bedroom condo with sweeping water views over Boca Ciega Bay at Example Island, St. Petersburg, Florida. Fully furnished for monthly stays (30+ nights): in-unit washer & dryer, dishwasher, full kitchen, fast internet up to 700 Mbps, community pool, smart-lock self-check-in. Minutes from St. Pete Beach, Fort De Soto Park and downtown St. Petersburg. Booking exclusively via Airbnb.';
const HOME_FAQ = [
  ['Can I book the condo on this website?',
   'No — booking runs exclusively through Airbnb (airbnb.com/rooms/DEMOID0002). This site is the official companion portal that handles the condominium association\'s approval paperwork after you book.'],
  ['What is the minimum stay?',
   'The condominium association requires a lease term of at least 30 nights, so bookings are monthly. That makes the home ideal for snowbirds, travel professionals and remote workers.'],
  ['Why does my rental need approval?',
   'Example Condominium is a condominium association, and its rules require board approval for every rental in the building — it applies to all owners, not just this one. After booking, your private page guides you through either the association’s Tenant Evaluation route or its paper route.'],
  ['How long does the approval take?',
   'The association asks applicants to allow up to 15 days after every required application, screening, document and payment item arrives. Complete your chosen route early; your personal status page shows live progress.'],
  ['What is the $100 fee?',
   'The current association application packet lists a non-refundable $100 paper-application fee. It is shown only when the governing documents authorize it; Florida law prohibits an application or transfer fee for a renewal with the same lessee. Online-route applicants follow Tenant Evaluation.'],
  ['Are pets allowed?',
   'The association does not permit pets for renters, and the home is non-smoking. Service animals and other approved assistance animals are not pets and are handled under applicable fair-housing law and Airbnb policy.'],
  ['Can my AI assistant help me with the paperwork?',
   'Yes. Your personal page has a "Copy briefing for your AI assistant" button that hands ChatGPT, Claude or any other assistant everything it needs — only the signature must remain yours.'],
];
const FAQ_JSONLD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: HOME_FAQ.map(([q, a]) => ({ '@type': 'Question', name: q,
    acceptedAnswer: { '@type': 'Answer', text: a } })),
});
const HOME_JSONLD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Apartment',
  name: 'Example Island Bay-View Condo — Unit 405D, Example Condominium',
  description: HOME_DESC,
  address: { '@type': 'PostalAddress', streetAddress: '6219 Palma Del Mar Blvd S, Unit 405D',
    addressLocality: 'St. Petersburg', addressRegion: 'FL', postalCode: '33715', addressCountry: 'US' },
  numberOfBedrooms: 1,
  petsAllowed: false,
  occupancy: { '@type': 'QuantitativeValue', maxValue: 4 },
  amenityFeature: ['Water view (Boca Ciega Bay)', 'In-unit washer & dryer', 'Dishwasher', 'Full kitchen',
    '700 Mbit internet (Spectrum)', 'Community pool', 'Smart-lock self-check-in', 'Air conditioning']
    .map(n => ({ '@type': 'LocationFeatureSpecification', name: n, value: true })),
  tourBookingPage: 'https://www.airbnb.com/rooms/DEMOID0002',
  sameAs: ['https://www.airbnb.com/rooms/DEMOID0002'],
  url: 'https://portal.example.test/',
});

function landingView() {
  return page('Example Island Bay-View Condo, St. Petersburg FL — Unit 405D Guest Portal',
    `<h1>Example Island — your bay-view home at Unit 405D</h1>
     <p>A fully furnished one-bedroom condo above Boca Ciega Bay in St. Petersburg, Florida, for monthly stays. Booked through Airbnb — and this is your private portal for the condominium association's rental approval, step by step.</p>
     <span class="chip">Example Island · St. Petersburg, Florida</span>`,
    `<div class="card"><h2>How it works</h2>
      <ol>
        <li><b>Book on Airbnb.</b> After your booking is confirmed, you receive a personal link to this portal via Airbnb chat.</li>
        <li><b>Choose one application route.</b> For a new application, we recommend Tenant Evaluation: complete the application, upload documents and pay online in one place. The paper route remains available.</li>
        <li><b>Book at least 7 days ahead.</b> Start the HOA application immediately after booking. HOA approval is required before check-in; seven days is not an approval guarantee.</li>
        <li><b>HOA board approval.</b> Allow up to 15 days after every required application, screening, document and payment item arrives. Follow the authorized payment instructions promptly once available.</li>
        <li><b>Check-in released.</b> Once approved, you receive the door codes and arrival guide.</li>
      </ol>
      <p class="muted">Paid rentals must be at least 30 nights and require association approval. Sensitive background-screening information is entered only in the association's approved process, never on this public site. Simplified guest registration is reserved for confirmed, non-paying guests.</p>
     </div>
     <div class="card"><h2>Already booked? Find your page</h2>
      <p>Enter your Airbnb confirmation code (looks like <span class="pill teal">HMDEMO0003</span>, in your booking confirmation) and your last name:</p>
      <form method="post" action="/find" autocomplete="off">
        <div class="u4e330d89">
          <div><label>Confirmation code</label><input name="code" placeholder="HM…" required></div>
          <div><label>Last name</label><input name="name" required></div>
        </div>
        <p><button>Open my paperwork page</button></p>
      </form>
      <p class="muted">Your page is created within about an hour of booking. Can't find it? Just message Owner on Airbnb.</p>
     </div>
     <section class="card" aria-labelledby="online-application-heading">
       <p><span class="pill teal">Recommended for new applications</span></p>
       <h2 id="online-application-heading">Tenant Evaluation: apply and pay online</h2>
       <p>The association's online service brings your application, requested documents, screening and online payment together. No paper check or money order is needed for this route. You pay through the service, not to the property owner.</p>
       <p>Start from your personal paperwork page after booking so you receive the correct association instructions. Written HOA approval is still required before check-in.</p>
       <p class="muted"><b>Already submitted a paper application?</b> Please confirm with Owner or the HOA before starting again. Tenant Evaluation is a complete application process, not a payment-only link for an existing paper application. Do not apply or pay twice.</p>
     </section>
     <div class="card"><h2>The home</h2>
      <p>A quiet one-bedroom condo on the fourth floor of Example Condominium at <b>Example Island</b> — a small island neighborhood at the southern tip of St. Petersburg, wrapped in water, palms and the fairways of the Example Island Yacht &amp; Country Club, with sweeping views over Boca Ciega Bay.</p>
      <ul class="steps ude00808e">
        <li><div><b>Made for monthly stays</b><br><span class="muted">Fully furnished for genuine stays of at least 30 nights — ideal for snowbirds, travel professionals and remote workers. The condo remains available to the guest for the full reserved term.</span></div></li>
        <li><div><b>Everything in the unit</b><br><span class="muted">Full kitchen with dishwasher, in-unit washer &amp; dryer, air conditioning, fast internet up to 700 Mbps, smart-lock self-check-in, community pool.</span></div></li>
        <li><div><b>The location</b><br><span class="muted">10–15 minutes to St. Pete Beach, Fort De Soto Park, downtown St. Petersburg and the Bayfront / Johns Hopkins All Children's hospitals; about 30 minutes to Tampa International Airport.</span></div></li>
        <li><div><b>Good to know</b><br><span class="muted">No pets (association rule) and no smoking. Every rental needs the association's approval — that's exactly what this portal takes care of.</span></div></li>
      </ul>
      <p><a class="btn" href="https://www.airbnb.com/rooms/DEMOID0002" rel="noopener">Book on Airbnb — Example Island, Unit 405D</a><br>
      <span class="muted ue785b9bd">Booking runs exclusively through Airbnb. This site is the official companion portal for the home's approval paperwork.</span></p>
     </div>
     <div class="card"><h2>Frequently asked questions</h2>
      <ul class="steps ude00808e">${HOME_FAQ.map(([q, a]) => `
        <li><div><b>${esc(q)}</b><br><span class="muted">${esc(a)}</span></div></li>`).join('')}
      </ul>
     </div>`,
    { index: true, extraHead: `<meta name="description" content="${esc(HOME_DESC)}"><link rel="canonical" href="https://portal.example.test/">
<meta property="og:type" content="website"><meta property="og:site_name" content="Example Island · Unit 405D">
<meta property="og:title" content="Example Island Bay-View Condo, St. Petersburg FL — monthly stays">
<meta property="og:description" content="${esc(HOME_DESC)}"><meta property="og:url" content="https://portal.example.test/">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${HOME_JSONLD}</script>
<script type="application/ld+json">${FAQ_JSONLD}</script>` });
}

function guestProgressSteps(c) {
  if (c.pathType !== 'full' || c.screeningRoute === 'paper') return c.steps;
  const visible = c.screeningRoute === 'online'
    ? new Set(['route_selected', 'screening_complete', 'board_approved', 'checkin_released'])
    : new Set(['route_selected', 'screening_complete', 'board_approved', 'checkin_released']);
  return c.steps.filter(step => visible.has(step.id));
}

function feeRequestReleased(c, compliance) {
  return applicationFeeState(c) !== 'required' || externalFeeRequestAuthorized(c,compliance);
}

function hoaGuestFollowUp(c,compliance) {
  const state=hoaEvidenceState(c),proofs=Object.entries(c.hoaEvidence||{}).filter(([,e])=>!e.disputedAt&&!e.supersededAt);
  const evidence=proofs.length?`<div class="card"><h2>Verified association updates</h2><ul>${proofs.map(([key,e])=>`<li>${esc(HOA_CONFIRMATIONS[key]||'Association update')}${state.exception?' — under review':''} (${esc(e.at.slice(0,10))})</li>`).join('')}</ul><p class="muted">Receipt, payment, application completion and approval are separate confirmations.</p></div>`:'';
  if(state.exception) return `<div class="card"><h2>Association response under review</h2><p>The latest correspondence or changed reservation details need to be checked. This is not a cancellation or a new payment request. Do not pay again or make new travel assumptions based on an earlier status.</p></div>`+evidence;
  if(!state.tasks.length) return evidence;
  const paymentAllowed=externalFeeRequestAuthorized(c,compliance);
  return `<div class="card"><h2>Additional items requested</h2><p>The association needs these items for your existing application. Reporting them done here does not confirm their acceptance.</p>${c.screeningRoute==='online'?'<p><a class="btn" href="https://tenantev.com/" target="_blank" rel="noopener">Open your existing Tenant Evaluation application</a></p>':`<p><a class="btn ghost" href="/w/${c.token}">Review your saved forms</a></p>`}<ul>${state.tasks.map(t=>`<li><b>${esc(HOA_ITEMS[t.code]||'Association item')}</b><p>${esc(t.code==='payment'&&!paymentAllowed?'Payment instructions are being verified. Do not make another payment.':hoaTaskText(c,t.code))}</p>${t.status==='reported'?'<p class="pill warn">Reported complete — waiting for source verification</p>':t.code==='payment'&&!paymentAllowed?'':`<form method="post" action="/v/${c.token}/hoa-task-reported"><input type="hidden" name="taskId" value="${esc(t.id)}"><input type="hidden" name="taskVersion" value="${t.version}"><label><input type="checkbox" name="confirmed" value="yes" required> I have completed this requested item through the official process.</label><button class="small">Report this item complete</button></form>`}</li>`).join('')}</ul></div>`+evidence;
}

function hoaSourceReviewForm(c,cases,id,env) {
  if(!env.CASE_STORE) return '<div class="card"><p>Beleggebundene Bearbeitung ist vorbereitet, aber erst mit aktiviertem atomarem Fallspeicher verfügbar. Es wurde kein Status geändert.</p></div>';
  if(!c) return `<div class="card"><h2>Quelle einem Vorgang zuordnen</h2><p>Nur nach Prüfung des Originals zuordnen. Name und Mietzeitraum müssen eindeutig passen.</p><ul>${cases.filter(c=>c.status!=='canceled').map(c=>`<li><a href="/admin/hoa-mail/${id}?case=${encodeURIComponent(c.id)}">${esc(c.guestName)} · ${esc(c.checkIn)} – ${esc(c.checkOut)}</a></li>`).join('')}</ul></div>`;
  const event=(c.hoaMailEvents||[]).find(e=>e.id===id);
  if(event?.review) return `<div class="card"><h2>Quelle bereits bearbeitet</h2><p>${esc(event.review.kind)} · ${esc(event.review.at)} · ${esc(event.review.by)}</p><p>Bestätigt: ${esc(event.review.confirmations.join(', ')||'keine Fakten bestätigt')}<br>Nachgefordert: ${esc(event.review.requestedItems.join(', ')||'keine')}<br>Erledigte Aufgaben: ${event.review.resolvedItems.length}</p><p>Ein neuer Beleg ist für eine weitere Entscheidung erforderlich.</p></div>`;
  const checks=(name,options)=>Object.entries(options).map(([value,label])=>`<label class="u2a1b75c9"><input type="checkbox" name="${name}" value="${esc(value)}"> ${esc(label)}</label>`).join('');
  return `<div class="card"><h2>Geprüften Beleg bearbeiten</h2><p>${esc(c.guestName)} · ${esc(c.checkIn)} – ${esc(c.checkOut)}</p><p>Keine automatische Bestätigung: Originalnachricht und gegebenenfalls Anhänge im Postfach prüfen. Tenant Evaluation darf nicht mit einer Board-Genehmigung verwechselt werden. Keine zusätzlichen Gebühren erfinden.</p><form method="post" action="/admin/hoa-mail/${id}/review"><input type="hidden" name="id" value="${esc(c.id)}"><input type="hidden" name="caseVersion" value="${caseSnapshotVersion(cases,c.id)}"><label>Buchungscode (bei Gastregistrierung vollständigen Gastnamen) zur Bestätigung eingeben<input name="reservation" required autocomplete="off"></label><label>Ergebnis<select name="kind"><option value="confirmed">Einzelne Fakten / Aufgaben anhand des Originals geprüft</option><option value="needs_review">Unklar oder widersprüchlich — Prüfung offenhalten</option><option value="adverse_response">Negative Rückmeldung — gesonderte Prüfung, keine Stornierung</option><option value="no_action">Keine fallbezogene Aktion erforderlich</option></select></label><h3>Nur ausdrücklich belegte Fakten</h3>${checks('confirmations',HOA_CONFIRMATIONS)}<h3>Konkrete Nachforderungen an den Gast</h3>${checks('requestedItems',HOA_ITEMS)}<h3>Nachweislich erledigte Nachforderungen</h3>${checks('resolvedItems',Object.fromEntries(hoaEvidenceState(c).tasks.map(t=>[t.id,(HOA_ITEMS[t.code]||t.code)+' — '+t.status+' — '+t.openedAt])))}${hoaEvidenceState(c).exception==='hoa_evidence_stale'?'<label><input type="checkbox" name="reconcileContext" value="yes"> Ich habe den neuen Mietzeitraum und die Belegzuordnung geprüft. Frühere Fakten und Aufgaben gelten nicht automatisch für den geänderten Aufenthalt. Nur ausdrücklich bestätigte Fakten und neu ausgewählte Aufgaben werden übernommen.</label>':''}${c.hoaReviewHold?'<label><input type="checkbox" name="clearHold" value="yes"> Der aktuelle Beleg klärt die bisherige Prüfsperre ausdrücklich.</label>':''}<label><input type="checkbox" name="attested" value="yes" required> Ich habe Original, Absenderberechtigung, Buchung und Mietzeitraum geprüft. Jede Auswahl wird ausdrücklich durch diesen Beleg gestützt; der Textauszug oder die automatische Kategorie allein genügt nicht.</label><p><button>Beleggebunden speichern</button></p><p class="muted">Kein Versand durch diesen Klick. Gast-Erinnerungen bleiben separat freizuschalten.</p></form></div>`;
}

function reminderContactForm(c,version,enabled) {
  if(version===null) return '';
  const hidden=`<input type="hidden" name="contactVersion" value="${version}">`;
  const action=`/v/${c.token}/reminder-contact`;
  return `<div class="card"><h2>Optional email reminders</h2><p>You can request emails about missing HOA paperwork for this booked stay. This is optional, separate from your application, and not a condition of approval. You can continue using Airbnb messages.</p>${!enabled?'<p class="pill warn">Reminder delivery is not active yet. You may save your preference for later.</p>':''}${c.guestContact?.requested?`<p>Requested address: <b>${esc(c.guestContact.email)}</b>. Please check the spelling; mailbox ownership has not been verified.</p>`:c.guestContact?'<p>Email reminders are turned off for this stay.</p>':''}<details><summary>Request or change email reminders</summary><form method="post" action="${action}">${hidden}<input type="hidden" name="preference" value="email"><label for="reminder-email">Your email address</label><input id="reminder-email" name="email" type="email" maxlength="254" autocomplete="email" required><label for="reminder-email-again">Enter it again to check for typing errors</label><input id="reminder-email-again" name="emailAgain" type="email" maxlength="254" autocomplete="off" required><label><input name="requested" type="checkbox" value="yes" required> I request HOA-paperwork reminders at my email address for this stay.</label><p><button>Save my email request</button></p></form></details><form method="post" action="${action}">${hidden}<input type="hidden" name="preference" value="airbnb"><p><button class="small ghost">Turn off email reminders</button></p></form><p class="muted">Used only for this stay's HOA reminders, never marketing. The address is stored encrypted and follows the case's retention policy. Saving sends no message, submits no paperwork and does not confirm payment or approval. Turning emails off does not stop HOA reminders through your existing Airbnb conversation if that channel is enabled. A message already being sent may still arrive.</p></div>`;
}

function statusView(c, compliance, contactVersion=null, remindersEnabled=false) {
  const followUp=hoaEvidenceState(c);
  const followUpCard=hoaGuestFollowUp(c,compliance);
  const progressSteps = guestProgressSteps(c).map(s=>(followUp.exception||followUp.tasks.length)&&['board_approved','checkin_released'].includes(s.id)?{...s,done:false,date:null}:s);
  const total = progressSteps.length, done = progressSteps.filter(s => s.done).length;
  const pct = Math.round(done / total * 100);
  const days = daysUntil(c.checkIn);
  const approved = !followUp.exception&&!followUp.tasks.length&&c.steps.find(s => s.id === 'board_approved')?.done;
  const nextIdx = progressSteps.findIndex(s => !s.done);
  const banner = (approved
    ? `<span class="pill ok">Approved — you're all set</span>`
    : (days <= 10 ? `<span class="pill warn">${days} days to check-in — let's finish the paperwork</span>`
                  : `<span class="pill teal">${days} days until check-in</span>`))
    + (c.submission ? ` <span class="pill ok">paperwork submitted to the association ${esc(c.submission.sentAt.slice(0,10))}</span>` : '');
  const feeState = applicationFeeState(c);
  const feeBlock = feeState === 'prohibited_same_lessee_renewal' ? `
    <div class="card"><h2>Renewal fee</h2>
      <p><span class="pill ok">No application fee for this same-lessee renewal</span></p>
      <p>Florida Statutes section 718.112(2)(k) prohibits an association transfer/application fee for a renewal with the same lessee. This is not a discretionary waiver. No $100 payment is requested for this renewal.</p>
    </div>` : feeState === 'required' && c.steps.some(s=>s.id==='fee_sent'&&s.done) ? '<div class="card"><h2>Association fee received</h2><p>Receipt of the required fee has been confirmed. Do not send another payment.</p></div>' : feeState === 'required' && !feeRequestReleased(c, compliance) ? `
    <div class="card"><h2>Association application fee</h2><p><span class="pill warn">Payment instructions are not released</span></p><p>Owner is verifying both the association's recorded authority and Airbnb's mandatory-fee disclosure requirements. Do not mail a check or make an off-platform payment unless the instructions later appear here and match the Airbnb price breakdown.</p></div>` : feeState === 'required' ? `
    <div class="card"><h2>The $100 association fee</h2>
      <p>This <b>non-refundable $100 application fee</b> consists of a $50 community fee and a $50 document-processing fee. Pay by <b>check or money order only</b> (no cards), made out to <b>"Example Condominium"</b>. Mail it with a short note (unit 405D, your name, rental dates${c.reservationCode ? ', reservation ' + esc(c.reservationCode) : ''}) to:</p>
      <div class="addr">Example Condominium Association, Inc.
c/o Example Property Management, Inc.
570 Carillon Parkway, Suite 210
St. Petersburg, FL 33716</div>
      ${c.feeMailed
        ? `<p class="ud6f2af6e"><span class="pill ok">check mailed ${esc(c.feeMailed.slice(0, 10))}</span> <span class="muted">Thank you — we are tracking receipt with the association.</span></p>
           <form method="post" action="/v/${c.token}/fee-unmailed" data-confirm="Remove the mailed status because the envelope was not actually sent?"><button class="small ghost">I have not mailed it</button></form>`
        : `<form class="ud6f2af6e" method="post" action="/v/${c.token}/fee-mailed" data-confirm="Confirm that the envelope with the $100 check or money order is actually in the mail?">
             <button>I've mailed the check ✓</button>
             <span class="muted u78fa54ea">Tap this once your envelope is in the mail — it helps us confirm receipt.</span>
           </form>`}
    </div>` : '';
  const route = c.pathType === 'full' ? (c.screeningRoute || 'undecided') : 'paper';
  const screeningConfirmed = c.steps.find(s => s.id === 'screening_complete')?.done;
  const wizardCard = approved ? '' : route === 'undecided' ? `
    <div class="card"><h2>Choose the official application route</h2>
      <p>For a new application, we recommend Tenant Evaluation: application, documents and online payment in one place. The paper route remains available. Choose first so this page gives you the correct instructions.</p>
      <p><a class="btn" href="/w/${c.token}">View application options</a></p>
    </div>` : route === 'online' ? `
    <div class="card"><h2>Complete the official online application</h2>
      <p><span class="pill teal">Online route · Tenant Evaluation</span></p>
      <p><b>Application, documents and online payment in one place.</b> No paper check or money order is needed for this route. The association's application code or invitation must come from Owner or the HOA.</p>
      <p><a class="btn" href="https://tenantev.com/" target="_blank" rel="noopener">Open Tenant Evaluation ↗</a></p>
      <p>Complete your application and requested uploads there. Follow the verified fee instructions for your case. Review the total and available payment methods before paying; do not assume the paper-route fee is the online total. Payment goes through the service, not to the property owner.</p>
      <p class="muted">This is a complete application process, not a payment-only link for an existing paper application. If you already submitted paper documents or paid a fee, confirm with Owner or the HOA before starting again. Do not apply or pay twice.</p>
      <div class="attn"><b>Privacy boundary:</b> enter any Social Security number or other sensitive screening answers only in Tenant Evaluation. This portal never asks for or receives that information.</div>
      ${screeningConfirmed
        ? '<p><span class="pill ok">Official application confirmed complete</span></p>'
        : c.screeningReportedAt
          ? `<p><span class="pill warn">Completion reported ${esc(c.screeningReportedAt.slice(0, 10))}</span> <span class="muted">Owner is confirming it with the association.</span></p>`
          : `<form method="post" action="/v/${c.token}/screening-reported" data-confirm="Confirm that you completed and submitted the official Tenant Evaluation application?">
               <input type="hidden" name="confirmed" value="yes"><button>I've completed Tenant Evaluation ✓</button>
               <p class="muted">This reports completion to Owner; it does not copy screening data into this portal.</p>
             </form>`}
      <p class="muted">If you have not received the association code or invitation, message Owner through Airbnb. Do not fill out the separate local paper forms as well.</p>
    </div>` : c.ownerReviewReadyAt ? `
    <div class="card"><h2>Your forms are complete for the paper route</h2>
      <p><span class="pill ok">Ready for Owner review</span></p>
      <p>Your local paper documents and signatures are saved. The association's separate screening, secure photo-ID handoff and fee are tracked separately. You do not need to fill out these forms again.</p>
      <p><a class="btn ghost" href="/w/${c.token}">Review / edit your details</a>
      <span class="pill ok u78fa54ea">completed ${esc((c.ownerReviewReadyAt || '').slice(0, 10))}</span></p>
      <p class="muted">If you change personal details, the affected signatures must be provided again before the forms return to Owner review.</p>
    </div>` : `
    <div class="card"><h2>Complete the local paper-route forms online</h2>
      <p>Enter your details once and sign online. You can save an unfinished draft and return later. We prepare four local PDFs for Owner to review. The association's separate official screening is not performed on this site.</p>
      <p><a class="btn" href="/w/${c.token}">${c.wizard ? 'Review / edit your details' : 'Start the paperwork'}</a>
      ${c.wizard ? `<span class="pill ok u78fa54ea">details saved ${esc((c.wizard.savedAt || '').slice(0, 10))}</span>` : ''}</p>
    </div>`;
  return page(`Your stay ${esc(c.checkIn)} — approval status`,
    `<h1>Hi ${esc(c.guestName.split(' ')[0])}, here's where your approval stands</h1>
     <p>Stay: <b>${esc(c.checkIn)} → ${esc(c.checkOut)}</b> (${c.nights} nights, ${c.adults} ${c.adults === 1 ? 'adult' : 'adults'} age 18+${Number(c.expectedMinors || 0) ? `, ${Number(c.expectedMinors)} minor${Number(c.expectedMinors) === 1 ? '' : 's'}` : ''})${c.reservationCode ? ' · Reservation ' + esc(c.reservationCode) : ''}</p>
     ${banner}`,
    bookingApprovalNotice(c, compliance) + followUpCard + (followUp.exception||followUp.tasks.length?'':wizardCard) + reminderContactForm(c,contactVersion,remindersEnabled) + `<div class="card">
       <h2>Progress</h2>
       <div class="bar"><div data-pct="${pct}" class="barfill"></div></div>
       <p class="muted">${done} of ${total} steps complete</p>
       <ul class="steps">${progressSteps.map((s, i) => `
         <li class="${s.done ? 'done' : ''} ${i === nextIdx ? 'next' : ''}">
           <div class="dot">${s.done ? '✓' : ''}</div>
           <div><span class="lbl">${esc(s.label)}</span>
           ${s.done && s.date ? `<div class="muted">done ${esc(s.date.slice(0,10))}</div>` : ''}
           ${i === nextIdx ? `<div class="uca265730">← next step</div>` : ''}</div>
         </li>`).join('')}
       </ul>
     </div>
     ${followUp.exception||followUp.tasks.some(t=>t.code==='payment')?'':feeBlock}
     ${c.submission && !approved && !followUp.exception && !followUp.tasks.length ? `
     <div class="card"><h2>What happens now</h2>
       <p>Your paperwork is with the association — nothing to do on your end${feeState === 'required' && !c.feeMailed ? ' except mailing the $100 fee' : ''}. The association asks applicants to allow up to 15 days after every required part reaches it. The moment it's approved, you'll get an email from us and your check-in details will follow. This page always shows the live status.</p>
     </div>` : ''}
     ${approved ? `
     <div class="card"><h2>You're all set 🎉</h2>
       <p>The board has approved your stay. Your check-in details (door codes, arrival guide) will reach you well before arrival — usually via Airbnb chat. Safe travels, and see you at Example Island!</p>
     </div>` : ''}
     ${c.submission ? `<div class="card"><h2>Your executed documents</h2><p><a class="btn ghost" href="/v/${c.token}/executed-lease.pdf">Download the final signed lease</a>${isAnnualRental(c) ? ` <a class="btn ghost" href="/v/${c.token}/executed-flood-disclosure.pdf">Download the flood disclosure</a>` : ''}</p><p class="muted">Keep copies for your records. The lease includes the required radon notice and the electronic-signature audit reference.</p></div>` : ''}
     <div class="card"><h2>Good to know</h2>
       <ul class="steps ude00808e">
         <li><div><b>Why all this paperwork?</b><br><span class="muted">The condominium association (HOA) requires board approval for every rental — it applies to all owners in the building, not just this one. We've made it as painless as we can.</span></div></li>
         <li><div><b>Is my data safe?</b><br><span class="muted">Your details are used solely for the association's approval file and its automated quality check, transmitted encrypted, and never sold. Processing is limited to the association and the service providers identified in the privacy notice. We never ask for your Social Security number or ID uploads on this site.</span></div></li>
         <li><div><b>How long does approval take?</b><br><span class="muted">Allow up to 15 days after the association has every required application, screening, document and payment item. Please complete everything early. This page and our emails keep you posted.</span></div></li>
         <li><div><b>Need to add or change an occupant?</b><br><span class="muted">Message Owner through Airbnb before arrival. Occupancy changes can require an updated association approval; do not simply add a person to a completed application.</span></div></li>
         <li><div><b>Questions or stuck?</b><br><span class="muted">Message Owner anytime via Airbnb chat — replies usually within a few hours.</span></div></li>
       </ul>
     </div>`);
}

// ---------- AI-assistant briefing (guests may share this with their own assistant) ----------
function guestBrief(c, compliance = {}) {
  const isFull = c.pathType === 'full';
  const route = isFull ? (c.screeningRoute || 'undecided') : 'paper';
  const progress = guestProgressSteps(c);
  const done = progress.filter(s => s.done).length;
  const fields = isFull && route === 'paper'
    ? `- For EACH adult (${c.adults} total): first name, full middle name (or “None”), last name, birth date, gender,
  current street address (street, city, state, ZIP), phone, email,
  ID type (driver's license or US photo ID), ID number + issuing state, employer name, employer phone.
- Once per application: automobile make & year & license plate,
  two personal references (non-relatives: name, phone, address),
  one or two emergency contacts (name, phone).`
    : isFull && route === 'online'
      ? `- Use the association's external Tenant Evaluation application.
- Obtain the association code or invitation from Owner or the HOA.
- Complete requested uploads and payment only in Tenant Evaluation.`
    : isFull
      ? '- Choose Online or Paper before preparing any form data.'
    : `- For EACH adult (${c.adults} total): first name, full middle name (or “None”), last name, birth date, gender, phone, email.
- Names and birth dates of any children staying.`;
  return `# HOA approval briefing — Example Island, Unit 405D (Example Condominium)

This is a summary of a guest's rental-approval paperwork, intended for the guest's
own AI assistant. You may help the guest prepare and understand their form data.
IMPORTANT: the e-sign consent checkbox and the drawn signature MUST be completed by
the guest personally — never sign or consent on their behalf.

## Stay
- Guest: ${c.guestName} (${c.adults} adult(s))
- Stay: ${c.checkIn} to ${c.checkOut} (${c.nights} nights)
- Airbnb reservation: ${c.reservationCode || 'n/a'}
- Process: ${isFull ? (route === 'online' ? 'official online application through Tenant Evaluation' : route === 'paper' ? 'local paper-route lease package plus separate official screening' : 'application route not chosen yet') : 'simplified guest registration (stays under 30 nights)'}
- Days until check-in: ${daysUntil(c.checkIn)}

## Current status: ${done} of ${progress.length} steps complete
${progress.map(s => `- [${s.done ? 'x' : ' '}] ${s.label}${s.done && s.date ? ` (done ${s.date.slice(0, 10)})` : ''}`).join('\n')}
${c.submission ? `- The paperwork package was submitted to the association on ${c.submission.sentAt.slice(0, 10)}.` : ''}
${route === 'online'
  ? (c.screeningReportedAt ? `- Tenant Evaluation completion was reported on ${c.screeningReportedAt.slice(0, 10)} and awaits Owner/HOA confirmation.` : '- The official Tenant Evaluation application has not yet been reported complete.')
  : route === 'undecided'
    ? '- The official application route has not been chosen yet.'
    : c.wizard
      ? `- The local paper-route form was last saved on ${(c.wizard.savedAt || '').slice(0, 10)} and can be edited anytime.`
      : '- The local paper-route form has NOT been filled in yet — that is the next step.'}

## What the guest should have ready
Private status link (do not publish): https://portal.example.test/v/${c.token}
${route === 'paper' ? `Private local-form link (do not publish): https://portal.example.test/w/${c.token}` : ''}
${fields}
- ${route === 'paper' ? 'E-sign consent and drawn signature must be completed personally on the local form page. Drafts can be saved and continued later.' : route === 'online' ? 'Report completion on the private status page after submitting Tenant Evaluation.' : 'Choose Online or Paper on the private route page before starting.'}
- This site never asks for Social Security numbers or photo-ID uploads. Any sensitive official-screening data belongs only in the association's approved external process.
${isFull && route === 'paper' && !isSameLesseeRenewal(c) && feeRequestReleased(c, compliance) ? `
## The non-refundable $100 association fee (paid by the guest)
- $50 community fee plus $50 document-processing fee.
- For the paper route: check or money order (online-route applicants pay in Tenant Evaluation instead).
- Payable to: "Example Condominium"
- Enclose a note: Unit 405D / ${c.guestName} / ${c.checkIn} – ${c.checkOut}${c.reservationCode ? ' / ' + c.reservationCode : ''}
- Mail to: Example Condominium Association, Inc.,
  c/o Example Property Management, Inc., 200 Management Road, Example City, FL 00000
- ${c.feeMailed ? `The guest reported the check as mailed on ${c.feeMailed.slice(0, 10)}; receipt is being tracked.` : 'Once the envelope is in the mail, the guest should tap "I\'ve mailed the check" on the status page.'}
` : isSameLesseeRenewal(c) ? '\n## Application fee\n- This is recorded as a renewal with exactly the same lessee(s); no transfer/application fee may be charged under Florida Statutes section 718.112(2)(k).\n' : isFull && route === 'paper' ? '\n## Application fee\n- Payment instructions are not released while Owner verifies the association authority and Airbnb price-breakdown requirements. Do not make an off-platform payment.\n' : ''}
## Timeline & contact
- Allow up to 15 days after every required application, screening, document and payment item arrives. Complete everything early.
- Live status page (private): https://portal.example.test/v/${c.token}
- Questions: message Owner (the host) via Airbnb chat — replies usually within hours.
`;
}
function aiHelperCard(token) {
  return `<div class="card"><h2>Using an AI assistant?</h2>
    <p class="muted">If ChatGPT, Claude or another assistant helps you with paperwork, hand it everything in one go — your live status, the exact fields to prepare and the fee instructions. Only the signature must remain yours.</p>
    <p class="sigrow">
      <button type="button" class="small ghost" id="aibrief">Copy briefing for your AI assistant</button>
      <a class="muted ue785b9bd" href="/v/${token}/brief.txt" target="_blank">open as plain text →</a>
      <span id="aimsg" class="muted"></span>
    </p>
   </div>
   <script>
   document.getElementById('aibrief').onclick = async () => {
     try {
       const r = await fetch('/v/${token}/brief.txt');
       await navigator.clipboard.writeText(await r.text());
       document.getElementById('aimsg').textContent = 'Copied ✓ — paste it into your assistant.';
     } catch (e) { window.open('/v/${token}/brief.txt', '_blank'); }
   };
   </script>`;
}

function occupancyView(c, error) {
  const sourceCount = Number(c.airbnbAdults || c.adults || 1);
  return page('Confirm who is staying — Demo Unit',
    `<h1>One quick age check before the HOA forms</h1>
     <p>Airbnb lists ${sourceCount} ${sourceCount === 1 ? '“adult” guest' : '“adult” guests'}, but its age categories are different from the association's.</p>`,
    `<div class="card"><h2>Who completes an adult application?</h2>
      <div class="attn">Airbnb counts guests aged 13–17 as adults. <b>Palma del Mar uses age 18+</b> for adult applications, background authorization, photo ID and signatures. A 17-year-old is therefore listed as a minor occupant and does not complete or sign an adult application.</div>
      ${error ? `<div class="attn crit">${esc(error)}</div>` : ''}
      <form method="post" action="/w/${c.token}/occupancy">
        <label>How many occupants will be 18 or older at check-in? *</label>
        <select name="hoaAdults" required>
          <option value="">Choose…</option>
          <option value="1">1 adult (age 18+)</option>
          <option value="2">2 adults (age 18+)</option>
        </select>
        <label>How many occupants will be under 18 at check-in? *</label>
        <select name="minors" required>
          <option value="">Choose…</option>
          <option value="0">0 minors</option>
          <option value="1">1 minor</option>
          <option value="2">2 minors</option>
        </select>
        <p class="muted">The automated form supports up to two adults age 18+, up to two minors and four occupants total. If your group is different, save nothing and message Owner through Airbnb.</p>
        <p><button type="submit">Confirm occupancy and continue</button></p>
      </form>
    </div>`);
}

function applicationRouteView(c, error) {
  return page('Choose the HOA application route — Demo Unit',
    `<h1>Choose how to complete the HOA application</h1>
     <p>Both routes go to the same condominium association, but the forms and payment method are different.</p>`,
    `${error ? `<div class="attn crit">${esc(error)}</div>` : ''}
     <div class="card"><p><span class="pill teal">Recommended for new applications</span></p>
       <h2>Online — Tenant Evaluation</h2>
       <p><b>Application, documents and online payment in one place.</b> Use the association's external service for your application, requested uploads and screening. No paper check or money order is needed for this route. Completing the application can take up to about 45 minutes; this is not the HOA approval time.</p>
       <p>Review the total and available payment methods before paying. The online total may differ from the paper-route fee. You pay through the service, not to the property owner.</p>
       <div class="attn"><b>Sensitive information stays there.</b> Any Social Security number, screening answers and identity uploads belong only in Tenant Evaluation, never in this portal.</div>
       <form method="post" action="/w/${c.token}/route">
         <button name="route" value="online">Choose Tenant Evaluation online</button>
       </form>
     </div>
     <div class="card"><h2>Paper package — prepared in this portal</h2>
       <p>Fill and sign the four local documents here. Owner reviews them before any release. The separate official tenant-screening form and sensitive data are handled directly with the association, outside this portal. The $100 fee for this route is paid by check or money order.</p>
       <form method="post" action="/w/${c.token}/route">
         <button class="ghost" name="route" value="paper">Choose the paper route</button>
       </form>
     </div>
     <div class="card"><p><b>Already submitted a paper application or paid a fee?</b> Please confirm with Owner or the HOA before starting again. Tenant Evaluation is a complete application process, not a payment-only link for an existing paper application. Do not apply or pay twice.</p>
       <p class="muted">Choose only one route. For a new application, use the association's Tenant Evaluation invitation if you received one. If you are unsure, message Owner through Airbnb before choosing.</p></div>`);
}

function wizardView(c, saved, draftVersion = null) {
  const w = c.wizard || {};
  const adults = w.adults || [];
  const A = (i, f) => {
    const adult = adults[i] || {};
    return esc(adult[f] || (f === 'middleName' ? adult.middleInitial : '') || '');
  };
  const isFull = c.pathType === 'full';
  const adultBlock = (i) => `
    <div class="card"><h2>Adult ${i + 1}${i === 0 ? ' (main guest)' : ''}</h2>
      <div class="udcefdb35">
        <div><label>First name *</label><input name="a${i}_firstName" value="${A(i,'firstName')}" autocomplete="section-adult${i} given-name" maxlength="60" required></div>
        <div><label>Full middle name(s), or “None” *</label><input name="a${i}_middleName" value="${A(i,'middleName')}" maxlength="80" required></div>
        <div><label>Last name *</label><input name="a${i}_lastName" value="${A(i,'lastName')}" autocomplete="section-adult${i} family-name" maxlength="60" required></div>
      </div>
      <div class="u4e330d89">
        <div><label>Birth date${isFull ? ' *' : ''}</label><input name="a${i}_birthDate" type="date" value="${A(i,'birthDate')}" autocomplete="bday" ${isFull ? 'required' : ''}></div>
        <div><label>Gender${isFull ? ' (as requested by the HOA) *' : ''}</label><input name="a${i}_gender" value="${A(i,'gender')}" placeholder="As shown on ID" ${isFull ? 'required' : ''}></div>
      </div>
      ${isFull ? `
      <label>Current street address *</label><input name="a${i}_street" value="${A(i,'street')}" autocomplete="section-adult${i} street-address" maxlength="120" required>
      <div class="u8c47274e">
        <div><label>City *</label><input name="a${i}_city" value="${A(i,'city')}" autocomplete="section-adult${i} address-level2" maxlength="60" required></div>
        <div><label>State *</label><input name="a${i}_state" value="${A(i,'state')}" autocomplete="section-adult${i} address-level1" maxlength="30" required></div>
        <div><label>ZIP *</label><input name="a${i}_zip" value="${A(i,'zip')}" autocomplete="section-adult${i} postal-code" maxlength="16" required></div>
      </div>
      <div class="u472ec391">
        <div><label>Phone *</label><input name="a${i}_phone" type="tel" inputmode="tel" value="${A(i,'phone')}" autocomplete="section-adult${i} tel" maxlength="32" required></div>
        <div><label>Alternate phone</label><input name="a${i}_altPhone" type="tel" inputmode="tel" value="${A(i,'altPhone')}" maxlength="32"></div>
        <div><label>Email *</label><input name="a${i}_email" type="email" value="${A(i,'email')}" autocomplete="section-adult${i} email" maxlength="254" required></div>
      </div>
      <div class="u059faac0">
        <div><label>ID type *</label><select name="a${i}_idType" required><option value="">Choose…</option><option value="drivers_license" ${A(i,'idType') === 'drivers_license' ? 'selected' : ''}>Driver's license</option><option value="us_photo_id" ${A(i,'idType') === 'us_photo_id' ? 'selected' : ''}>US photo ID</option></select></div>
        <div><label>ID number *</label><input name="a${i}_idNumber" value="${A(i,'idNumber')}" maxlength="40" required></div>
        <div><label>Issuing state *</label><input name="a${i}_idState" value="${A(i,'idState')}" maxlength="30" required></div>
      </div>
      <p class="muted">If you do not have a US driver's license or US photo ID, save a draft and message Owner through Airbnb before continuing.</p>
      <div class="uaadb3cb7">
        <div><label>Employer / occupation status *</label><input name="a${i}_employer" value="${A(i,'employer')}" placeholder="Employer, self-employed, or retired" maxlength="80" required></div>
        <div><label>Employer phone *</label><input name="a${i}_employerPhone" type="tel" value="${A(i,'employerPhone')}" placeholder="N/A if retired" maxlength="32" required></div>
      </div>` : (i === 0 ? `
      <div class="u4e330d89">
        <div><label>Phone *</label><input name="a${i}_phone" type="tel" inputmode="tel" value="${A(i,'phone')}" autocomplete="tel" required></div>
        <div><label>Email *</label><input name="a${i}_email" type="email" value="${A(i,'email')}" autocomplete="email" required></div>
      </div>
      <label>Home street address *</label><input name="a${i}_street" value="${A(i,'street')}" autocomplete="street-address" required>
      <div class="u8c47274e">
        <div><label>City *</label><input name="a${i}_city" value="${A(i,'city')}" autocomplete="address-level2" required></div>
        <div><label>State *</label><input name="a${i}_state" value="${A(i,'state')}" autocomplete="address-level1" required></div>
        <div><label>ZIP *</label><input name="a${i}_zip" value="${A(i,'zip')}" autocomplete="postal-code" required></div>
      </div>` : '')}
    </div>`;
  const extras = isFull ? `
    ${Number(c.expectedMinors || 0) > 0 ? `<div class="card"><h2>Minor occupants (under 18)</h2>
      <p class="muted">Minors are listed as occupants on the lease application. They do not complete a background authorization, provide photo ID here or sign the adult forms.</p>
      ${Array.from({ length: Number(c.expectedMinors || 0) }, (_, i) => `
      <div class="uaadb3cb7">
        <div><label>Minor ${i + 1} name *</label><input name="ch${i}_name" value="${esc(((w.children||[])[i]||{}).name||'')}" maxlength="120" required></div>
        <div><label>Minor ${i + 1} birth date *</label><input name="ch${i}_birthDate" type="date" value="${esc(((w.children||[])[i]||{}).birthDate||'')}" required></div>
      </div>`).join('')}
    </div>` : ''}
    <div class="card"><h2>Vehicle (optional)</h2>
      <div class="u8c47274e">
        <div><label>Make / model</label><input name="auto_make" value="${esc((w.auto||{}).make||'')}"></div>
        <div><label>Year</label><input name="auto_year" value="${esc((w.auto||{}).year||'')}"></div>
        <div><label>License plate</label><input name="auto_plate" value="${esc((w.auto||{}).plate||'')}"></div>
      </div>
    </div>
    <div class="card"><h2>References (non-relatives)</h2>
      ${[0,1].map(i => `
      <div class="uaadb3cb7">
        <div><label>Name ${i+1} *</label><input name="ref${i}_name" value="${esc(((w.references||[])[i]||{}).name||'')}" required></div>
        <div><label>Phone *</label><input name="ref${i}_phone" type="tel" value="${esc(((w.references||[])[i]||{}).phone||'')}" required></div>
      </div>
      <label>Address *</label><input name="ref${i}_address" value="${esc(((w.references||[])[i]||{}).address||'')}" required>`).join('')}
    </div>
    <div class="card"><h2>Emergency contacts</h2>
      ${[0,1].map(i => `
      <div class="uaadb3cb7">
        <div><label>Name ${i+1} *</label><input name="em${i}_name" value="${esc(((w.emergency||[])[i]||{}).name||'')}" required></div>
        <div><label>Phone *</label><input name="em${i}_phone" type="tel" value="${esc(((w.emergency||[])[i]||{}).phone||'')}" required></div>
      </div>`).join('')}
    </div>` : `
    <div class="card"><h2>Children staying (if any)</h2>
      ${[0,1,2].map(i => `
      <div class="uaadb3cb7">
        <div><label>Child ${i+1} name</label><input name="ch${i}_name" value="${esc(((w.children||[])[i]||{}).name||'')}"></div>
        <div><label>Birth date</label><input name="ch${i}_birthDate" type="date" value="${esc(((w.children||[])[i]||{}).birthDate||'')}"></div>
      </div>`).join('')}
    </div>`;
  const rulesSection = isFull ? `
    <div class="card"><h2>Rules &amp; Regulations</h2>
      <p>Please open and review the association's <a href="/forms/rules-and-regulations.pdf" target="_blank" rel="noopener">current Rules &amp; Regulations (PDF)</a> before signing. The owner workflow records the exact rules version used for this application.</p>
      <label class="u60901360">
        <input class="u495e8c7d" type="checkbox" name="rules_acknowledged" value="yes" ${w.rulesAcknowledged ? 'checked' : ''} required>
        <span>I have reviewed the Rules &amp; Regulations and agree to comply with them during the stay.</span>
      </label>
    </div>
    ${isAnnualRental(c) ? `<div class="card"><h2>Florida flood disclosure</h2>
      <p>This stay is at least one year, so Florida law requires a separate flood disclosure. Open the read-only preview after saving and keep the executed copy provided after Owner release.</p>
      <label class="u60901360">
        <input class="u495e8c7d" type="checkbox" name="flood_disclosure_acknowledged" value="yes" ${w.floodDisclosureAcknowledged ? 'checked' : ''} required>
        <span>I understand that a separate Florida flood disclosure will be part of the agreement package.</span>
      </label>
    </div>` : ''}` : '';
  const signedCount = adults.filter(x => x && x.sigPng).length;
  const downloads = w.savedAt ? `
    <div class="card"><h2>Read-only PDF previews — not editable</h2>
      <p>${signedCount ? 'Signed online by ' + signedCount + ' guest(s) and prepared for automated quality review. ' : ''}These downloads are snapshots of the fields above. To correct anything, edit the web form above and save again${isFull ? '. The SS# field stays blank on purpose; official screening and ID handling remain outside this portal' : ''}.</p>
      <p>
      ${isFull
        ? `<a class="btn" href="/w/${c.token}/pdf/lease-application">1. Lease Application</a>
           <a class="btn ghost" href="/w/${c.token}/pdf/background-authorization">2. Background Authorization</a>
           <a class="btn ghost" href="/w/${c.token}/pdf/rules-and-regulations">3. Rules &amp; acknowledgment</a>
           <a class="btn ghost" href="/w/${c.token}/pdf/lease-agreement">4. Lease Agreement</a>
           ${isAnnualRental(c) ? `<a class="btn ghost" href="/w/${c.token}/pdf/flood-disclosure">5. Flood Disclosure</a>` : ''}`
        : `<a class="btn" href="/w/${c.token}/pdf/guest-registration">Guest Registration (PDF)</a>`}
      </p>
    </div>` : '';
  const sigSection = `
    <div class="card"><h2>Sign online</h2>
      <p class="muted">Draw each adult's signature below — finger on a phone works best. Each adult must personally provide their own signature. The signatures are placed on the association's forms; an automated quality review checks the complete package, and Owner explicitly authorizes any external submission.</p>
      ${Array.from({ length: c.adults }, (_, i) => `
      <label>Signature — Adult ${i + 1}${adults[i] && adults[i].sigPng ? ' <span class="pill ok">stored</span>' : ''}</label>
      <canvas class="sigpad" data-i="${i}" width="640" height="170" role="img" aria-label="Signature pad for adult ${i + 1}" tabindex="0"></canvas>
      <div class="sigrow"><button type="button" class="small ghost" data-clear="${i}">Clear new drawing</button>
        ${adults[i] && adults[i].sigPng ? `<label class="u41e578a4"><input type="checkbox" name="a${i}_remove_sig" value="yes"> Remove stored signature</label>` : ''}
      </div>
      <input type="hidden" name="a${i}_sig" value="">
      <label class="u60901360">
        <input type="checkbox" name="a${i}_esign_consent" value="yes" ${adults[i] && adults[i].esignConsent ? 'checked' : ''} required>
        <span>Adult ${i + 1} confirms this is their own signature, consents to transact electronically, intends the signature to have the same legal effect as a handwritten signature, and authorizes it for the listed HOA and lease documents. Copies can be downloaded and printed. A paper alternative may be requested through Airbnb before signing.</span>
      </label>`).join('')}
    </div>`;
  const sigScript = `
    <script>
    const pads = [...document.querySelectorAll('canvas.sigpad')].map(cv => {
      const ctx = cv.getContext('2d');
      ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1a2a6b';
      let drawing = false, drawn = false;
      const pos = e => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
      cv.addEventListener('pointerdown', e => { drawing = true; drawn = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); });
      cv.addEventListener('pointermove', e => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); });
      ['pointerup','pointerleave'].forEach(ev => cv.addEventListener(ev, () => drawing = false));
      return { cv, isDrawn: () => drawn, reset: () => { ctx.clearRect(0,0,cv.width,cv.height); drawn = false; } };
    });
    document.querySelectorAll('[data-clear]').forEach(btn => btn.onclick = () => pads[+btn.dataset.clear].reset());
    let saving = false;
    document.querySelector('form').addEventListener('submit', async (event) => {
      pads.forEach((p, i) => {
        if (p.isDrawn()) document.querySelector('[name=a' + i + '_sig]').value = p.cv.toDataURL('image/png');
      });
      const form = event.currentTarget;
      if (!form.elements.draftVersion) return;
      event.preventDefault();
      if (saving) return;
      saving = true;
      const notice = document.getElementById('save-notice');
      notice.textContent = 'Saving your paperwork…';
      const data = new FormData(form);
      if (event.submitter?.name) data.set(event.submitter.name, event.submitter.value);
      try {
        const response = await fetch(form.action, { method: 'POST', body: data, credentials: 'same-origin' });
        if (response.ok && response.redirected) { location.assign(response.url); return; }
        notice.textContent = response.status === 409
          ? 'Not saved: this reservation or draft changed in another window. Your entries are still here. Open the latest saved form below in a new tab and compare before continuing.'
          : 'We could not confirm your save. Keep this page open and check the latest saved form below before trying again.';
      } catch {
        notice.textContent = 'The connection was interrupted. Keep this page open and check the latest saved form below before trying again. Your entries are still here.';
      } finally { saving = false; }
    });
    </script>`;
  return page('Your paperwork — Demo Unit',
    `<h1>Your paperwork, filled &amp; signed online</h1>
     <p>Stay ${esc(c.checkIn)} → ${esc(c.checkOut)} · ${c.adults} adult${c.adults === 1 ? '' : 's'} age 18+${Number(c.expectedMinors || 0) ? ` · ${Number(c.expectedMinors)} minor${Number(c.expectedMinors) === 1 ? '' : 's'}` : ''} · ${isFull ? 'full HOA application package' : 'guest registration'}</p>
     ${saved === 'ready' ? '<span class="pill ok">Complete — ready for Owner to review</span>' : saved === 'draft' ? '<span class="pill warn">Draft saved — some required details or signatures are still missing below</span>' : ''}`,
    `<form method="post" action="/w/${c.token}">
       ${draftVersion === null ? '' : `<input type="hidden" name="draftVersion" value="${draftVersion}"><div class="card"><p id="save-notice" role="status" aria-live="polite"></p><a href="/w/${c.token}" target="_blank" rel="noopener">Open latest saved form in a new tab</a></div>`}
       ${Array.from({ length: c.adults }, (_, i) => adultBlock(i)).join('')}
       ${extras}
       ${rulesSection}
       ${sigSection}
       <div class="card">
         <p class="muted">We never ask for your Social Security number online. Where the association's form requires it, the field stays blank. Photo IDs are not uploaded here either. After your forms are complete, Owner will confirm the secure handoff through your existing Airbnb chat. The HOA package cannot be sent until the required ID copies have been received securely.</p>
         <p class="u6002dd78">
           <button type="submit" name="saveMode" value="draft" formnovalidate class="ghost">Save draft and continue later</button>
           <button type="submit" name="saveMode" value="complete">Check completeness &amp; prepare quality review</button>
         </p>
       </div>
     </form>
     ${downloads}
     ${sigScript}`);
}

function settingsView(hasSig, liveMode, msg, compliance, complianceState) {
  const cfg = compliance || {};
  return adminPage('Einstellungen — Demo Unit Admin', '/admin/settings',
    `<h1>Einstellungen</h1><p>Automatik, Unterschrift und Zugänge — alles, was das System am Laufen hält.${msg ? ' — ' + esc(msg) : ''}</p>`,
    `<div class="card"><h2>Versandmodus nach deiner Freigabe</h2>
      <p class="u593718ea">
        ${liveMode
          ? '<span class="pill ok">LIVE — nach deiner Prüfung gehen Pakete an die Verwaltung</span>'
          : '<span class="pill warn">TESTMODUS — nach deiner Prüfung gehen Pakete nur an dich (contact008@example.test)</span>'}
        <form class="ucccfa456" method="post" action="/admin/submit-live" data-confirm="${liveMode ? 'Wirklich auf TESTMODUS zurückschalten?' : 'LIVE-Versand wirklich aktivieren? Empfänger: Example Property Management und Keila; CC Owner.'}">
          <input type="hidden" name="mode" value="${liveMode ? 'off' : 'yes'}">
          ${liveMode ? '' : '<label class="uc3c8d100"><span>Zum Aktivieren LIVE eingeben:</span><input class="u581be415" name="confirm" pattern="LIVE" required></label>'}
          <button class="small ${liveMode ? 'ghost' : ''}">${liveMode ? 'Auf Testmodus zurückschalten' : 'LIVE-Versand aktivieren'}</button>
        </form>
      </p>
      <p class="muted">Der Gast kann Daten und Signaturen nur vorbereiten. Die automatisierte Qualitätsprüfung kontrolliert das aktuelle Paket (bei Jahresmieten einschließlich separater Hochwasser-Offenlegung); danach bestätigst du den grünen Bericht und löst den Versand mit einem eigenen Bestätigungsklick aus. Ohne diese Owner-Freigabe wird niemals an die Verwaltung gesendet. LIVE darf erst aktiviert werden, wenn der sichere Übermittlungsweg für die Ausweiskopien verbindlich bestätigt und im jeweiligen Vorgang belegt ist. Du bekommst je Versand eine Telegram-Nachricht — und einen 🚨-Alarm, wenn etwas hakt.</p>
    </div>
    <div class="card"><h2>Florida-/HOA-Compliance-Sperre</h2>
      ${complianceState.ok ? '<p><span class="pill ok">Pflichtangaben vollständig</span></p>' : `<div class="attn crit"><b>LIVE gesperrt.</b> Es fehlen: ${esc(complianceState.missing.join(', '))}.</div>`}
      <p class="muted">Referenzpaket: ${esc(HOA_SOURCE_PACKET.title)}, Portal-Dokument ${HOA_SOURCE_PACKET.portalDocumentId}, Download ${HOA_SOURCE_PACKET.downloadedAt}, SHA-256 ${HOA_SOURCE_PACKET.sha256}. Bestätigt daraus: 1 Monat Mindestdauer, Antrag ab 18, keine Mieter-Haustiere, $100 Papiergebühr und Board-Freigabe vor Besitzübernahme. Das Antragsformular ersetzt nicht den Nachweis in Declaration/Articles/Bylaws.</p>
      <form method="post" action="/admin/compliance">
        <label>Vermieter-/Zustellanschrift für Mitteilungen nach Fla. Stat. §83.50 *</label><textarea name="landlordNoticeAddress" rows="2" required>${esc(cfg.landlordNoticeAddress || '')}</textarea>
        <label>Verifizierungsdatum der aktuellen Declaration, Articles, Bylaws und Amendments *</label><input type="date" name="governingDocumentsVerifiedAt" value="${esc(cfg.governingDocumentsVerifiedAt || '')}" required>
        <label>Fundstelle der eingetragenen Genehmigungsbefugnis *</label><input name="approvalAuthorityCitation" value="${esc(cfg.approvalAuthorityCitation || '')}" placeholder="z. B. Declaration Art. …, OR Book/Page …" required>
        <label>Fundstelle der eingetragenen Gebührenbefugnis *</label><input name="feeAuthorityCitation" value="${esc(cfg.feeAuthorityCitation || '')}" placeholder="Declaration/Articles/Bylaws + OR Book/Page">
        <label>Airbnb-Preisaufschlüsselung/Gebührenfeld für die verpflichtende HOA-Gebühr geprüft am *</label><input type="date" name="airbnbFeeDisclosureVerifiedAt" value="${esc(cfg.airbnbFeeDisclosureVerifiedAt || '')}" required>
        <label>Nachweis der Airbnb-Erlaubnis/Ausnahme für externe Gebührenzahlung *</label><input name="airbnbExternalFeeAuthorizationReference" value="${esc(cfg.airbnbExternalFeeAuthorizationReference || '')}" placeholder="Konkrete Airbnb-Bestätigung oder nachgewiesene Ausnahme; HOA-Akzeptanz allein reicht nicht">
        <p class="muted">Ein Hinweis nur in Beschreibung oder Hausregeln genügt nach Airbnbs aktueller Fee-Transparency-Policy nicht. Die Pflichtgebühr muss im passenden Gebührenfeld bzw. im Übernachtungspreis enthalten sein; eine externe Einziehung ist nur zulässig, wenn Airbnb den Host dafür ausdrücklich autorisiert.</p>
        <label>Aktuelle Rules-Version / Beschlussdatum *</label><input name="rulesVersion" value="${esc(cfg.rulesVersion || '')}" required>
        <h3>Consumer-Report-Auskunft (nur falls eine Entscheidung auf einem Screeningbericht beruht)</h3>
        <label>Name der Consumer Reporting Agency</label><input name="craName" value="${esc(cfg.craName || '')}" placeholder="z. B. Tenant Evaluation / ausführende CRA">
        <label>Anschrift der Consumer Reporting Agency</label><textarea name="craAddress" rows="2">${esc(cfg.craAddress || '')}</textarea>
        <label>Telefon der Consumer Reporting Agency</label><input name="craPhone" value="${esc(cfg.craPhone || '')}">
        <div class="u472ec391">
          <div><label>HOA bestätigt Portal-E-Signaturen am *</label><input type="date" name="hoaESignAcceptedAt" value="${esc(cfg.hoaESignAcceptedAt || '')}" required></div>
          <div><label>Datenschutz-/Breach-Plan geprüft am *</label><input type="date" name="privacySecurityReviewedAt" value="${esc(cfg.privacySecurityReviewedAt || '')}" required></div>
          <div><label>Fair-Housing-Prozess geprüft am *</label><input type="date" name="fairHousingReviewedAt" value="${esc(cfg.fairHousingReviewedAt || '')}" required></div>
        </div>
        <h3>Nur für Mietverträge ab einem Jahr: Angaben für Fla. Stat. §83.512</h3>
        ${[['floodDamageKnown','Kenntnis von schädigendem Hochwasser während Eigentumszeit'],['floodClaimFiled','Versicherungsclaim wegen Hochwasserschaden gestellt'],['floodAssistanceReceived','Hochwasserhilfe einschließlich FEMA erhalten']].map(([name,label]) => `<label>${label}</label><select name="${name}"><option value="">Nicht festgelegt</option><option value="yes" ${cfg[name] === 'yes' ? 'selected' : ''}>Ja</option><option value="no" ${cfg[name] === 'no' ? 'selected' : ''}>Nein</option></select>`).join('')}
        <label class="u60901360"><input type="checkbox" name="attest" value="yes" required><span>Ich bestätige, dass die Fundstellen anhand der aktuellen Originalunterlagen geprüft wurden. Das $100-Antragsformular allein ist kein Nachweis der satzungsmäßigen Gebührenbefugnis.</span></label>
        <p><button>Compliance-Angaben speichern</button></p>
      </form>
    </div>
    <div class="card"><h2>Einheitliche Antworten auf Fair-Housing-Anfragen</h2>
      <p class="muted">Immer wortgleich und nur über Airbnb antworten; keine Vermutung über Motive, keine Angaben zur ethnischen Zusammensetzung von Gästen oder Nachbarschaft und keine medizinischen Unterlagen im Portal speichern.</p>
      <label>Frage nach Hautfarbe, Herkunft oder „vermietest du an …?“</label>
      <textarea id="race-response" rows="5" readonly>I welcome qualified guests without regard to race, color, national origin, religion, sex, familial status, disability, or any other characteristic protected by law. Availability and applications are handled under the same neutral booking, occupancy, and condominium-association requirements for every guest. I do not provide information about the race or other protected characteristics of past, current, or prospective guests or neighbors.</textarea>
      <button type="button" class="small ghost copy-template" data-copy="race-response">Antwort kopieren</button>
      <label>Service Animal / Assistance Animal / Emotional Support Animal</label>
      <textarea id="animal-response" rows="8" readonly>Service animals and other assistance animals are not treated as pets. I handle reasonable-accommodation requests under applicable fair-housing law and Airbnb policy even though the condominium otherwise has a no-pets rule. Please state that you are requesting a reasonable accommodation and describe the accommodation requested; do not send a diagnosis or medical records in this chat or portal. No particular certificate or registration is required, and breed, size, or weight alone is not a reason for denial. If the disability and disability-related need are not apparent, I may request only reliable information permitted by law. No pet fee or animal deposit will be charged for an approved assistance animal. Any direct-threat or property-damage issue is evaluated individually, based on the specific animal and whether another accommodation can reduce the risk.</textarea>
      <button type="button" class="small ghost copy-template" data-copy="animal-response">Antwort kopieren</button>
    </div>
    <div class="card"><h2>Deine Unterschrift</h2>
      ${hasSig
        ? '<p><span class="pill ok">Unterschrift hinterlegt</span> <span class="muted">— wird ausschließlich beim von dir geprüften und ausdrücklich freigegebenen finalen Paket eingesetzt. Neu zeichnen und speichern überschreibt sie.</span></p>'
        : '<p><span class="pill warn">noch keine Unterschrift hinterlegt</span> <span class="muted">— ohne sie kann kein finales Paket freigegeben werden.</span></p>'}
      <p class="muted">Mit Finger (Handy) oder Trackpad/Maus im Feld unterschreiben. Groß und mittig — sie wird automatisch passend skaliert.</p>
      <canvas class="u41e4e7c4" id="pad" width="700" height="220"></canvas>
      <p>
        <button id="save">Unterschrift speichern</button>
        <button id="clear" class="ghost u5dd2a678" type="button">Neu zeichnen</button>
        <span id="msg" class="muted u78fa54ea"></span>
      </p>
    </div>
    <div class="card"><h2>Zugänge & Anbindung</h2>
      <ul class="steps">
        <li><div><b>Admin-Login</b><br><span class="muted">Benutzer <b>markus</b>; das Passwort liegt in Bitwarden (hermes). Gilt für alle /admin-Seiten.</span></div></li>
        <li><div><b>Read-only-API für Hermes/GBrain</b><br><span class="muted">GET /api/ro/summary · /cases · /contacts · /library · /receipts — Token im Header X-RO-Token (Bitwarden: ISLA_PORTAL_READONLY_TOKEN). Nur Lesen, Änderungen sind technisch ausgeschlossen.</span></div></li>
        <li><div><b>Wächter im Hintergrund</b><br><span class="muted">Cloudflare-Worker „isla-cron": alle 30 Minuten Gmail-Abruf (neue Airbnb-Buchung → Vorgang wird angelegt, Verwaltungs-Mail → Approval wird erkannt), täglich 08:00 Panama-Zeit Erinnerungs-Check mit Telegram-Nachricht.</span></div></li>
      </ul>
    </div>
    <script>
    const cv = document.getElementById('pad'), ctx = cv.getContext('2d');
    ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1a2a6b';
    let drawing = false, drawn = false;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
    cv.addEventListener('pointerdown', e => { drawing = true; drawn = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); });
    cv.addEventListener('pointermove', e => { if (!drawing) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); });
    ['pointerup','pointerleave'].forEach(ev => cv.addEventListener(ev, () => drawing = false));
    document.getElementById('clear').onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); drawn = false; };
    document.getElementById('save').onclick = async () => {
      if (!drawn) { document.getElementById('msg').textContent = 'Bitte erst unterschreiben.'; return; }
      const resp = await fetch('/admin/signature', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: cv.toDataURL('image/png') });
      document.getElementById('msg').textContent = resp.ok ? 'Gespeichert ✓ — wird ab sofort eingesetzt.' : 'Fehler beim Speichern.';
    };
    document.querySelectorAll('.copy-template').forEach(button => button.addEventListener('click', async () => {
      const field = document.getElementById(button.dataset.copy);
      await navigator.clipboard.writeText(field.value);
      button.textContent = 'Kopiert ✓';
    }));
    </script>`);
}

function adverseActionView(c, compliance, msg) {
  const prepared = c.adverseAction;
  return adminPage('Adverse Action — Demo Unit Admin', '/admin/cases',
    `<h1>Adverse-Action-Hinweis</h1><p>${esc(c.guestName)} · ${esc(c.checkIn)} bis ${esc(c.checkOut)}${msg ? ' — ' + esc(msg) : ''}</p>`,
    `<div class="attn crit"><b>Nicht automatisch versenden.</b> Dieses Werkzeug erstellt nur einen Entwurf, wenn eine nachteilige Entscheidung ganz oder teilweise auf einem Consumer Report beruht. Die konkrete Entscheidung muss sachlich, einzelfallbezogen und fair-housing-konform geprüft werden.</div>
     <div class="card"><h2>Entwurf erstellen</h2>
       <form method="post" action="/admin/adverse-action">
         <input type="hidden" name="id" value="${esc(c.id)}">
         <label>Maßnahme</label><select name="action"><option value="rental application denied">Antrag abgelehnt</option><option value="additional condition imposed">Zusätzliche Bedingung verlangt</option></select>
         <label>CRA-Name</label><input name="craName" value="${esc(compliance.craName || '')}" required>
         <label>CRA-Anschrift</label><textarea name="craAddress" rows="2" required>${esc(compliance.craAddress || '')}</textarea>
         <label>CRA-Telefon</label><input name="craPhone" value="${esc(compliance.craPhone || '')}" required>
         <label class="u60901360"><input type="checkbox" name="reportBased" value="yes" required><span>Die Maßnahme beruht ganz oder teilweise auf diesem Consumer Report.</span></label>
         <label class="u60901360"><input type="checkbox" name="fairHousingReviewed" value="yes" required><span>Ich habe die Entscheidung auf konsistente Kriterien, Fair Housing und mögliche Reasonable Accommodations geprüft.</span></label>
         <p><button>Entwurf erstellen</button></p>
       </form>
     </div>
     ${prepared ? `<div class="card"><h2>Vorbereiteter Hinweis</h2><p class="muted">Erstellt ${esc(prepared.preparedAt)} von ${esc(prepared.preparedBy)}. Manuelle rechtliche/inhaltliche Prüfung und Zustellung erforderlich.</p><pre class="u8d2e5f36">${esc(prepared.notice)}</pre></div>` : ''}`);
}

// ---------- library ----------
const LIB_CATS = [
  ['hoa-formulare', 'HOA — Formulare & Regeln'],
  ['hoa-protokolle', 'HOA — Protokolle & Meetings'],
  ['hoa-finanzen', 'HOA — Finanzen & Budgets'],
  ['hoa-mitteilungen', 'HOA — Mitteilungen & Notices'],
  ['hoa-sonstiges', 'HOA — Sonstiges'],
  ['faelle', 'Vergangene Vermietungen (Fälle)'],
  ['versicherung', 'Versicherung'],
  ['grundbuch', 'Grundbuch & Kauf'],
  ['steuer', 'Steuer (US)'],
  ['vermietung', 'Vermietung'],
  ['dienstleister', 'Dienstleister & Handwerker'],
];
function libDisplayName(key) {
  let n = key.split('/').pop();
  n = n.replace(/^\d{4}-\d{2}-\d{2}-\d+-669-/, '').replace(/^\d{4}-\d{2}-\d{2}-\d+-/, '')
       .replace(/--[0-9a-f]{12}(\.pdf)$/i, '$1').replace(/gmail-attachment-/, '');
  return n;
}
async function libList(env) {
  const out = [];
  let cursor;
  do {
    const r = await env.CASES.list({ prefix: 'lib:', cursor, limit: 1000 });
    out.push(...r.keys.map(k => k.name));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}
function libraryView(keys, msg) {
  const groups = LIB_CATS.map(([cat, label]) => {
    const files = keys.filter(k => k.startsWith(`lib:${cat}/`)).sort((a, b) => libDisplayName(a).localeCompare(libDisplayName(b)));
    if (!files.length) return '';
    return `<details class="sect libcat" data-cat="${cat}"><summary>${esc(label)} <span class="muted u433de30b">(${files.length})</span></summary>
      <ul class="steps">${files.map(k => `
        <li class="libfile" data-name="${esc(libDisplayName(k).toLowerCase())}">
          <div class="u97445a8d"><a href="/admin/library/f/${encodeURIComponent(k.slice(4))}" target="_blank">${esc(libDisplayName(k))}</a></div>
          <form method="post" action="/admin/library/delete" data-confirm="Datei löschen?">
            <input type="hidden" name="key" value="${esc(k)}"><button class="small ghost">×</button>
          </form>
        </li>`).join('')}
      </ul></details>`;
  }).join('');
  return adminPage('Bibliothek — Demo Unit Admin', '/admin/library',
    `<h1>Bibliothek</h1><p>Alle Unterlagen zur Wohnung — HOA, vergangene Fälle, Versicherung, Grundbuch, Steuer. Kategorien aufklappen oder einfach suchen.${msg ? ' — ' + esc(msg) : ''}</p>`,
    `<div class="card">
      <input class="u1444c6ea" id="libsearch" placeholder="Suchen … (z. B. rules, minutes, approval, quote)">
     </div>
     ${groups}
     <div class="card"><h2>Datei hochladen</h2>
      <form method="post" action="/admin/library/upload" enctype="multipart/form-data">
        <label>Kategorie</label>
        <select name="cat">${LIB_CATS.map(([c, l]) => `<option value="${c}">${esc(l)}</option>`).join('')}</select>
        <label>Datei</label><input type="file" name="file" required>
        <p><button>Hochladen</button></p>
      </form>
     </div>
     <script>
     document.getElementById('libsearch').addEventListener('input', e => {
       const q = e.target.value.toLowerCase().trim();
       document.querySelectorAll('.libfile').forEach(li => li.style.display = !q || li.dataset.name.includes(q) ? '' : 'none');
       document.querySelectorAll('.libcat').forEach(c => {
         const any = [...c.querySelectorAll('.libfile')].some(li => li.style.display !== 'none');
         c.style.display = any ? '' : 'none';
         c.open = q ? any : false;
       });
     });
     </script>`);
}

// ---------- receipts ----------
const RCPT_CATS = [
  ['hoa-gebuehren', 'HOA-Gebühren & Beiträge'],
  ['airbnb', 'Airbnb (Auszahlungen & Gebühren)'],
  ['turno', 'Turno / Reinigung (DemoGivenNameD)'],
  ['strom', 'Strom (Duke Energy)'],
  ['versicherung', 'Versicherung'],
  ['steuern', 'Steuern'],
  ['maut', 'Maut & Transport (SunPass)'],
  ['anschaffungen', 'Anschaffungen & Reparaturen'],
];

// ---------- receipts export (per year, by email) ----------
const EXPORT_RECIPIENTS = {
  usa:     { to: 'contact009@example.test', name: 'DemoGivenNameE DemoNameO — Hamilton & Associates (US-Steuerberaterin)', lang: 'en' },
  de:      { to: 'contact004@example.test', name: 'Dr. DemoSurnameH — DemoSurnameH & Balfanz (Steuerberater DE)', lang: 'de' },
  demoContactA: { to: 'contact003@example.test', name: 'DemoGivenNameA DemoNameB', lang: 'de' },
};
function rcptYear(key) {
  const m = libDisplayName(key).match(/20\d{2}/) || key.match(/20\d{2}/);
  return m ? m[0] : 'ohne-jahr';
}
async function exportReceipts(env, year, who) {
  const keys = (await rcptList(env)).filter(k => rcptYear(k) === year)
    .sort((a, b) => a.localeCompare(b));
  if (!keys.length) throw new Error(`keine Belege für ${year}`);
  const MAX = 15 * 1024 * 1024; // raw bytes per mail; base64 bleibt unter Gmails 25-MB-Grenze
  const batches = [[]];
  let size = 0;
  for (const k of keys) {
    const data = await env.CASES.get(k, 'arrayBuffer');
    if (!data) continue;
    if (size + data.byteLength > MAX && batches[batches.length - 1].length) { batches.push([]); size = 0; }
    batches[batches.length - 1].push({ key: k, filename: libDisplayName(k), bytes: new Uint8Array(data) });
    size += data.byteLength;
  }
  const catLabel = (k) => (RCPT_CATS.find(([c]) => c === k.slice(5).split('/')[0]) || [null, k.slice(5).split('/')[0]])[1];
  for (let i = 0; i < batches.length; i++) {
    const part = batches.length > 1 ? (who.lang === 'en' ? ` (part ${i + 1} of ${batches.length})` : ` (Teil ${i + 1} von ${batches.length})`) : '';
    const list = batches[i].map(a => `  • [${catLabel(a.key)}] ${a.filename}`).join('\n');
    const subject = (who.lang === 'en'
      ? `Receipts ${year} — Condo Unit 405D, 6219 Palma Del Mar Blvd S, St. Petersburg FL`
      : `Belege ${year} — Wohnung 405D, 6219 Palma Del Mar Blvd S, St. Petersburg FL`) + part;
    const text = who.lang === 'en'
      ? `Hello DemoGivenNameE,\n\nattached are the receipts and statements for tax year ${year} for my rental condo (Unit 405D, 100 Example Avenue, Example City, FL 00000 — Parcel account DEMO-PARCEL)${part}:\n\n${list}\n\nPlease let me know if anything is missing for the 1040-NR.\n\nBest regards,\nProperty Owner`
      : `Hallo,\n\nanbei die Belege des Jahres ${year} zur Wohnung 405D, 6219 Palma Del Mar Blvd S, St. Petersburg, Florida${part}:\n\n${list}\n\nAutomatisch versandt aus dem Verwaltungsportal portal.example.test.\n\nViele Grüße\nOwner`;
    await sendViaGmail(env, {
      to: [who.to], cc: ['contact008@example.test'],
      subject, text,
      attachments: batches[i].map(({ filename, bytes }) => ({ filename, bytes })),
    });
  }
  return { files: batches.flat().length, mails: batches.length };
}

// ---------- board (Hinweise & Merkzettel) ----------
function boardView(notes, msg) {
  const open = notes.filter(n => !n.done), done = notes.filter(n => n.done);
  const note = (n) => `
    <li><div class="u97445a8d">
      <b>${esc(n.title)}</b> <span class="muted u53f8a2fa">${esc((n.createdAt || '').slice(0, 10))}</span>
      ${n.done ? '<span class="pill ok">erledigt</span>' : ''}
      ${n.text ? `<br><span class="${n.done ? 'muted' : ''} ua548ea71">${esc(n.text)}</span>` : ''}
    </div>
    <div class="uee52adba">
      <form method="post" action="/admin/board/toggle"><input type="hidden" name="id" value="${esc(n.id)}"><button class="small ${n.done ? 'ghost' : ''}">${n.done ? 'reaktivieren' : 'erledigt ✓'}</button></form>
      <form method="post" action="/admin/board/del" data-confirm="Hinweis löschen?"><input type="hidden" name="id" value="${esc(n.id)}"><button class="small ghost">×</button></form>
    </div></li>`;
  return adminPage('Board — Demo Unit Admin', '/admin/board',
    `<h1>Board</h1><p>Merkzettel rund um Wohnung, Konten und Behörden — Dinge, die nicht vergessen werden dürfen.${msg ? ' — ' + esc(msg) : ''}</p>`,
    `<div class="card"><h2>Offen ${open.length ? `<span class="muted u433de30b">(${open.length})</span>` : ''}</h2>
      ${open.length ? `<ul class="steps">${open.map(note).join('')}</ul>` : '<p class="muted">Nichts offen. 🌴</p>'}</div>
     <div class="card"><h2>Neuer Hinweis</h2>
      <form method="post" action="/admin/board/add">
        <label>Titel</label><input name="title" required>
        <label>Text</label><textarea class="u0466783d" name="text" rows="4"></textarea>
        <p><button class="small">Auf das Board</button></p>
      </form></div>
     ${done.length ? `<details class="sect"><summary>Erledigt <span class="muted u433de30b">(${done.length})</span></summary><ul class="steps">${done.map(note).join('')}</ul></details>` : ''}`);
}
async function rcptList(env) {
  const out = [];
  let cursor;
  do {
    const r = await env.CASES.list({ prefix: 'rcpt:', cursor, limit: 1000 });
    out.push(...r.keys.map(k => k.name));
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return out;
}
function receiptsView(keys, msg) {
  const groups = RCPT_CATS.map(([cat, label]) => {
    const files = keys.filter(k => k.startsWith(`rcpt:${cat}/`)).sort((a, b) => libDisplayName(a).localeCompare(libDisplayName(b)));
    return `<div class="card libcat" data-cat="${cat}"><h2>${esc(label)} <span class="muted u433de30b">(${files.length})</span></h2>
      ${files.length ? `<ul class="steps">${files.map(k => `
        <li class="libfile" data-name="${esc(libDisplayName(k).toLowerCase())}">
          <div class="u97445a8d"><a href="/admin/receipts/f/${encodeURIComponent(k.slice(5))}" target="_blank">${esc(libDisplayName(k))}</a></div>
          <form method="post" action="/admin/receipts/delete" data-confirm="Beleg löschen?">
            <input type="hidden" name="key" value="${esc(k)}"><button class="small ghost">×</button>
          </form>
        </li>`).join('')}
      </ul>` : '<p class="muted">noch keine Belege — unten hochladen</p>'}</div>`;
  }).join('');
  const years = [...new Set(keys.map(rcptYear))].sort().reverse();
  const yearCount = (y) => keys.filter(k => rcptYear(k) === y).length;
  return adminPage('Quittungen — Demo Unit Admin', '/admin/receipts',
    `<h1>Quittungsordner</h1><p>Alle Belege zur Wohnung an einem Ort — für Steuer, Nebenkostenabrechnung und den Überblick.${msg ? ' — ' + esc(msg) : ''}</p>`,
    `<div class="card">
      <input class="u1444c6ea" id="libsearch" placeholder="Beleg suchen …">
      <p class="muted uef0b7a11">Laufende Quellen: Turno-Belege in der Turno-App unter „Receipts" · Duke-Energy-Rechnungen im Duke-Konto · Airbnb-Auszahlungen unter Verlauf → Auszahlungen (CSV). Einfach als PDF sichern und hier hochladen.</p>
     </div>
     <div class="card"><h2>Jahres-Export per E-Mail</h2>
      <p class="muted">Verschickt alle Belege eines Jahres als PDF-Anhänge (bei großen Mengen automatisch aufgeteilt). Du bekommst jede Mail als CC und eine Telegram-Bestätigung.</p>
      <form method="post" action="/admin/receipts/export">
        <div class="ua8ddc3e4">
          <div><label>Jahr</label>
            <select name="year">${years.map(y => `<option value="${esc(y)}">${esc(y)} (${yearCount(y)} Belege)</option>`).join('')}</select></div>
          <div><label>Empfänger</label>
            <select name="to">
              <option value="usa">Steuerberaterin USA — DemoGivenNameE DemoNameO (Hamilton &amp; Associates)</option>
              <option value="de">Steuerberater Deutschland — Dr. DemoSurnameH (DemoSurnameH &amp; Balfanz)</option>
              <option value="demoContactA">DemoGivenNameA (contact003@example.test)</option>
            </select></div>
        </div>
        <p><button>Jetzt exportieren &amp; senden</button></p>
      </form>
     </div>
     ${groups}
     <div class="card"><h2>Beleg hochladen</h2>
      <form method="post" action="/admin/receipts/upload" enctype="multipart/form-data">
        <label>Kategorie</label>
        <select name="cat">${RCPT_CATS.map(([c, l]) => `<option value="${c}">${esc(l)}</option>`).join('')}</select>
        <label>Datei</label><input type="file" name="file" required>
        <p><button>Hochladen</button></p>
      </form>
     </div>
     <script>
     document.getElementById('libsearch').addEventListener('input', e => {
       const q = e.target.value.toLowerCase().trim();
       document.querySelectorAll('.libfile').forEach(li => li.style.display = !q || li.dataset.name.includes(q) ? '' : 'none');
     });
     </script>`);
}

// ---------- dashboard ----------
function dashboardView(cases, counts, ownerSigOnFile, liveMode, msg, news) {
  const isDone = (c, id) => !!c.steps.find(s => s.id === id && s.done);
  const active = cases.filter(c => daysUntil(c.checkIn) >= -1 && !(isDone(c, 'board_approved') && isDone(c, 'checkin_released')));
  const attn = [];
  if (!ownerSigOnFile) attn.push(['crit', 'Deine Unterschrift fehlt — kein finales Paket kann freigegeben werden.', '/admin/settings', 'Unterschrift hinterlegen']);
  if (!liveMode) attn.push(['warn', 'Testmodus aktiv — Pakete gehen nur an dich, nicht an die Verwaltung.', '/admin/settings', 'Einstellungen']);
  if (counts.boardOpen) attn.push(['warn', `📌 ${counts.boardOpen} offene${counts.boardOpen === 1 ? 'r' : ''} Hinweis${counts.boardOpen === 1 ? '' : 'e'} auf dem Board.`, '/admin/board', 'Zum Board']);
  for (const c of active) {
    const days = daysUntil(c.checkIn);
    const who = `<b>${esc(c.guestName)}</b> (Check-in ${esc(c.checkIn)})`;
    if (c.submissionError) attn.push(['crit', `${who}: Versand-Störung — „${esc(c.submissionError.message.slice(0, 80))}". Es gibt keinen automatischen Wiederholungsversuch.`, '/admin/cases', 'Zum Vorgang']);
    if (days >= 0 && days <= 10 && !isDone(c, 'board_approved')) attn.push(['crit', `${who}: nur noch ${days} Tage bis Check-in, Board-Approval fehlt.`, '/admin/cases', 'Zum Vorgang']);
    if (c.pathType === 'full' && c.screeningRoute === 'undecided') attn.push(['warn', `${who}: Gast hat den offiziellen Antragsweg noch nicht gewählt.`, `/v/${c.token}`, 'Gast-Seite']);
    else if (c.screeningRoute === 'online' && !isDone(c, 'screening_complete')) attn.push(['warn', `${who}: Tenant Evaluation ${c.screeningReportedAt ? 'vom Gast als erledigt gemeldet; bitte mit HOA bestätigen' : 'noch nicht als erledigt gemeldet'}.`, '/admin/cases', 'Zum Vorgang']);
    else if (c.screeningRoute !== 'online' && !c.wizard) attn.push(['warn', `${who}: Gast hat die Papierformulare noch nicht ausgefüllt. Eine Erinnerung darf nur nach deiner Freigabe versandt werden.`, `/v/${c.token}`, 'Gast-Seite']);
    else if (c.screeningRoute !== 'online' && !c.submission && !c.submissionError) attn.push(['warn', `${who}: Daten liegen vor — Vollständigkeit und Signaturen prüfen, danach den Versand ausdrücklich freigeben.`, '/admin/cases', 'Zum Vorgang']);
    const caseFeeState = applicationFeeState(c);
    if (caseFeeState === 'required' && c.wizard && !c.feeMailed && !isDone(c, 'fee_sent')) attn.push(['warn', `${who}: $100-Scheck noch nicht als versandt gemeldet.`, '/admin/cases', 'Zum Vorgang']);
    if (caseFeeState === 'prohibited_same_lessee_renewal') attn.push(['ok', `${who}: gleiche Mieter bei Verlängerung bestätigt — keine Transfer-/Antragsgebühr zulässig.`, '/admin/cases', 'Zum Vorgang']);
    if (c.submission && !isDone(c, 'board_approved')) attn.push(['ok', `${who}: Paket eingereicht am ${esc(c.submission.sentAt.slice(0, 10))} — wartet auf das Board.`, '/admin/cases', 'Zum Vorgang']);
  }
  const attnHtml = attn.length
    ? attn.map(([lvl, text, href, label]) =>
        `<div class="attn${lvl === 'crit' ? ' crit' : lvl === 'ok' ? ' okk' : ''}">${text} <a href="${href}">${esc(label)} →</a></div>`).join('')
    : '<div class="attn okk">Alles ruhig — keine offenen Punkte. 🌴</div>';
  const caseRows = active.map(c => {
    const done = c.steps.filter(s => s.done).length, pct = Math.round(done / c.steps.length * 100);
    return `<li><div class="u97445a8d"><b>${esc(c.guestName)}</b> <span class="muted">${esc(c.checkIn)} → ${esc(c.checkOut)} · ${c.nights} Nächte</span>
      <div class="bar"><div data-pct="${pct}" class="barfill"></div></div>
      <span class="muted">${done}/${c.steps.length} Schritte</span>
      ${c.submission ? '<span class="pill ok">eingereicht</span>' : c.wizard ? '<span class="pill teal">Daten da</span>' : '<span class="pill warn">wartet auf Gast</span>'}
      ${isDone(c, 'board_approved') ? '<span class="pill ok">approved</span>' : ''}</div>
      <a class="btn small ghost" href="/admin/cases">Öffnen</a></li>`;
  }).join('');
  return adminPage('Übersicht — Demo Unit Admin', '/admin',
    `<h1>Übersicht</h1><p>Dein Vermietungs-Cockpit für Unit 405D — was läuft und was Aufmerksamkeit braucht.${msg ? ' — ' + esc(msg) : ''}</p>
     <p class="u2d724d0f">${liveMode ? '<span class="pill ok">Freigegebener Versand an Verwaltung</span>' : '<span class="pill warn">TESTMODUS — Versand nur an Owner</span>'}
     ${ownerSigOnFile ? '<span class="pill ok">Unterschrift ✓</span>' : '<span class="pill ue90617ff">Unterschrift fehlt</span>'}</p>`,
    `<div class="card"><h2>Braucht Aufmerksamkeit</h2>${attnHtml}</div>
     <div class="card"><h2>Offene Vorgänge</h2>${active.length
       ? `<ul class="steps">${caseRows}</ul>`
       : '<p class="muted">Keine offenen Vorgänge. Neue Buchungen werden automatisch aus Gmail angelegt — du bekommst dann eine Telegram-Nachricht mit dem Magic-Link.</p>'}</div>
     <div class="card"><h2>Neues von der Verwaltung</h2>${(news && news.length)
       ? `<ul class="steps">${news.slice(0, 5).map(n => newsItemHtml(n, Date.now())).join('')}</ul><p class="u82460327"><a href="/admin/news">Alle Neuigkeiten →</a></p>`
       : '<p class="muted">Noch keine Verwaltungs-Mails erfasst — neue E-Mails von Example Property Management erscheinen hier automatisch.</p>'}</div>
     <div class="kpis">
      <a class="kpi" href="/admin/cases"><b>${cases.length}</b><span>Vorgänge gesamt</span></a>
      <a class="kpi" href="/admin/contacts"><b>${counts.contacts}</b><span>Kontakte</span></a>
      <a class="kpi" href="/admin/library"><b>${counts.library}</b><span>Dokumente</span></a>
      <a class="kpi" href="/admin/receipts"><b>${counts.receipts}</b><span>Belege</span></a>
     </div>`);
}

// ---------- HOA news ----------
function fmtNewsDate(iso) {
  return iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '';
}
function newsItemHtml(n, now) {
  const fresh = n.at && (now - new Date(n.at)) < 7 * 86400000;
  return `<li><div class="u97445a8d">
    <span class="muted ue1e124fa">${esc(fmtNewsDate(n.at))}</span>
    ${fresh ? '<span class="pill teal">neu</span>' : ''}<br>
    <b>${esc(n.subject || '(ohne Betreff)')}</b><br>
    <span class="muted u5e0faad2">${esc(n.from)}</span>
    ${n.excerpt ? `<br><span class="muted">${esc(n.excerpt.slice(0, 220))}${n.excerpt.length > 220 ? '…' : ''}</span>` : ''}
    ${/^[a-f0-9]{64}$/.test(n.id||'') ? `<p><a href="/admin/hoa-mail/${n.id}">E-Mail-Beleg öffnen</a> · Zuordnung: ${esc(n.matchReason||'unbekannt')}</p>` : ''}
  </div></li>`;
}
function newsView(news, msg) {
  const now = Date.now();
  return adminPage('Neuigkeiten — Demo Unit Admin', '/admin/news',
    `<h1>Neuigkeiten der Verwaltung</h1><p>Der Hintergrundlauf prüft das konfigurierte Postfach alle 30 Minuten. Erkannte HOA-Antworten werden getrennt nach Unterlageneingang, möglichem Zahlungseingang, fehlenden Angaben und möglicher Freigabe erfasst. Die Einordnung ist noch keine bestätigte Zahlung oder Genehmigung und löst keine Gastnachricht aus. <a href="/admin/automation-health">Technischen Status prüfen</a>.${msg ? ' — ' + esc(msg) : ''}</p>`,
    `${news.length
      ? `<div class="card"><ul class="steps">${news.map(n => newsItemHtml(n, now)).join('')}</ul></div>`
      : '<div class="card"><p class="muted">Noch keine Verwaltungs-Mails erfasst. Absenderliste und Postfachordner müssen zur tatsächlichen HOA-Korrespondenz passen.</p></div>'}`);
}

// ---------- contacts ----------
const CONTACT_GROUPS = [
  ['HOA & Verwaltung', /hoa|verwaltung|board/i],
  ['Versicherung, Steuer & Bank', /versicherung|makler|steuer|bank/i],
  ['Betrieb & Dienstleister', /reinigung|handwerk|lieferant|geräte|strom|internet|klempner|wartung|turno|plattform/i],
  ['Accounts & Infrastruktur', /account|domain|hosting|lock|einkäufe/i],
];
function contactsView(contacts, msg) {
  const groups = CONTACT_GROUPS.map(([label]) => ({ label, items: [] }));
  const rest = { label: 'Adressen & Sonstiges', items: [] };
  contacts.forEach((ct, i) => {
    const gi = CONTACT_GROUPS.findIndex(([, re]) => re.test(`${ct.name} ${ct.role}`));
    (gi >= 0 ? groups[gi] : rest).items.push([ct, i]);
  });
  groups.push(rest);
  const cards = groups.filter(g => g.items.length).map(g =>
    `<div class="card cgroup"><h2>${esc(g.label)} <span class="muted u433de30b">(${g.items.length})</span></h2>
     <ul class="steps">${g.items.map(([ct, i]) => `
      <li class="cfile" data-name="${esc(`${ct.name} ${ct.role} ${ct.notes || ''}`.toLowerCase())}">
        <div class="u97445a8d"><b>${esc(ct.name)}</b> <span class="pill teal">${esc(ct.role)}</span>
          ${ct.email || ct.phone ? `<br>${[
            ct.email ? `<a href="mailto:${esc(ct.email)}">${esc(ct.email)}</a>` : '',
            ct.phone ? `<a href="tel:${esc(ct.phone.replace(/[^+\d]/g, ''))}">${esc(ct.phone)}</a>` : '',
          ].filter(Boolean).join(' · ')}` : ''}
          ${ct.notes ? `<br><span class="muted">${esc(ct.notes)}</span>` : ''}</div>
        <form method="post" action="/admin/library/contact-del" data-confirm="Kontakt löschen?">
          <input type="hidden" name="i" value="${i}"><button class="small ghost">×</button></form>
      </li>`).join('')}
     </ul></div>`).join('');
  return adminPage('Kontakte — Demo Unit Admin', '/admin/contacts',
    `<h1>Kontakte</h1><p>Alle Ansprechpartner und Accounts rund um Unit 405D — Verwaltung, Versicherung, Dienstleister, Infrastruktur.${msg ? ' — ' + esc(msg) : ''}</p>`,
    `<div class="card"><input class="u1444c6ea" id="csearch" placeholder="Kontakt suchen … (z. B. Versicherung, Duke, Jeanine)"></div>
     ${cards || '<div class="card"><p class="muted">noch keine Kontakte</p></div>'}
     <div class="card"><h2>Kontakt hinzufügen</h2>
      <form method="post" action="/admin/library/contact-add">
        <div class="u4e330d89">
          <div><label>Name</label><input name="name" required></div>
          <div><label>Rolle</label><input name="role" placeholder="z. B. Verwaltung, Versicherung, Handwerker" required></div>
          <div><label>E-Mail</label><input name="email"></div>
          <div><label>Telefon</label><input name="phone"></div>
        </div>
        <label>Notiz</label><input name="notes">
        <p><button class="small">Kontakt hinzufügen</button></p>
      </form>
     </div>
     <script>
     document.getElementById('csearch').addEventListener('input', e => {
       const q = e.target.value.toLowerCase().trim();
       document.querySelectorAll('.cfile').forEach(li => li.style.display = !q || li.dataset.name.includes(q) ? '' : 'none');
       document.querySelectorAll('.cgroup').forEach(c => {
         const any = [...c.querySelectorAll('.cfile')].some(li => li.style.display !== 'none');
         c.style.display = any ? '' : 'none';
       });
     });
     </script>`);
}

function casesView(cases, msg, ownerSigOnFile, liveMode, compliance = {}) {
  const HOA_TO = 'contact005@example.test';
  const HOA_CC = 'contact006@example.test';
  const gmail = (to, cc, subject, body) =>
    `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to)}${cc ? '&cc=' + encodeURIComponent(cc) : ''}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const rows = cases.map(c => {
    const journey=planGuestJourney(c,new Date(),{feeRequestAuthorized:externalFeeRequestAuthorized(c,compliance)});
    const relay=usableAirbnbRelay(c),candidate=c.airbnbRelay?.candidate;
    const contactLine=journey.guestTasks.length&&!guestReminderEmail(c)?`<p class="pill warn">No usable reminder email. ${relay?'A verified Airbnb reply route is available; delivery still requires its separate activation.':'Follow up through the existing Airbnb conversation or verify its reply route below.'}</p>`:'';
    const relayLine=candidate?`<details><summary>Airbnb reply route: ${relay?'verified':'source review needed'}</summary><p>Check the original notification and the actual Airbnb conversation, sender, recipient, reservation and dates. Header discovery alone is not authentication.</p><p>Notification: ${esc(candidate.date)} · ${esc(candidate.subject)}<br>Original Message-ID: ${esc(candidate.messageId)}</p><form method="post" action="/admin/airbnb-relay"><input type="hidden" name="id" value="${esc(c.id)}"><input type="hidden" name="caseVersion" value="${caseSnapshotVersion(cases,c.id)}"><input type="hidden" name="sourceHash" value="${candidate.sourceHash}"><label>Type the reservation code<input name="reservation" required autocomplete="off"></label><label><input type="checkbox" name="attested" value="yes" required> I checked the original message and Airbnb conversation. This reply address belongs to this guest and this reservation. I authorize it only for HOA task reminders, not approvals or cancellation.</label><button name="action" value="verify">Verify reply route</button><button class="ghost" name="action" value="revoke" formnovalidate>Revoke reply route</button></form><p class="muted">Saving sends no message. A source older than 30 days or changed reservation needs verification of a fresh source; this is a local safety limit, not an Airbnb delivery guarantee. No relay address is published here.</p></details>`:'';
    const deliveryNotices=pendingDeliveryNotices(c);
    const deliveryLine=deliveryNotices.length?`<details><summary>Delivery notices need review (${deliveryNotices.length})</summary><p class="muted">A structured mail-delivery notice was matched to a prior reminder. This does not confirm a bounce, recipient contact, or authorize a resend.</p>${deliveryNotices.map(n=>`<form method="post" action="/admin/reminder-delivery-review"><input type="hidden" name="id" value="${esc(c.id)}"><input type="hidden" name="caseVersion" value="${caseSnapshotVersion(cases,c.id)}"><input type="hidden" name="messageId" value="${esc(n.messageId)}"><input type="hidden" name="sourceHash" value="${esc(n.sourceHash)}"><label>Reservation code<input name="reservation" required autocomplete="off"></label><label><input type="checkbox" name="attested" value="yes" required> I checked the original reminder and this delivery notice.</label><button>Mark notice reviewed</button></form>`).join('')}</details>`:'';
    const packageDeliveryLine=packageReconciliationView(c,()=>caseSnapshotVersion(cases,c.id),esc);
    const bookingChangeLine=c.bookingChange?.pending?`<details open><summary class="pill warn">Airbnb booking details changed — owner review required</summary><p>Prior documents and approvals are marked stale. Check the new dates, guest count and original Airbnb confirmation before continuing.</p><form method="post" action="/admin/booking-change-review"><input type="hidden" name="id" value="${esc(c.id)}"><input type="hidden" name="caseVersion" value="${caseSnapshotVersion(cases,c.id)}"><label>Reservation code<input name="reservation" required autocomplete="off"></label><label><input type="checkbox" name="attested" value="yes" required> I checked the original Airbnb confirmation and approve this updated stay context for renewed paperwork.</label><button>Confirm booking change</button></form></details>`:'';
    const hoaEvents=(c.hoaMailEvents||[]).filter(e=>/^[a-f0-9]{64}$/.test(e.id||'')).slice(-5).reverse();
    const hoaLine=hoaEvents.length?`<details><summary>HOA-E-Mail-Belege (${(c.hoaMailEvents||[]).length})</summary><p class="muted">Ungeprüfte Einordnungen, keine automatische Zahlungs- oder Board-Bestätigung.</p><ul>${hoaEvents.map(e=>`<li><a href="/admin/hoa-mail/${e.id}">${esc(e.mailDate||e.at)}: ${esc((e.categories||[]).join(', '))}</a></li>`).join('')}</ul></details>`:'';
    const journeyLine=`<p class="muted">Workflow: <b>${esc(journey.state.replace(/_/g,' '))}</b>${c.automation?.lastGuestReminderAt?` · Last guest reminder: ${esc(c.automation.lastGuestReminderAt.slice(0,16).replace('T',' '))} UTC`:''}${journey.waitingForEvidence.length?`<br>Pending evidence: ${esc(journey.waitingForEvidence.join(', ').replace(/_/g,' '))}`:''}${c.autoRelease?'<br>Released automatically under standing owner authorization.':''}</p>${bookingChangeLine}${contactLine}${relayLine}${deliveryLine}${hoaLine}`;
    const visibleSteps = guestProgressSteps(c);
    const done = visibleSteps.filter(s => s.done).length;
    const stepBtns = visibleSteps.map(s => ['fee_sent','screening_complete','board_approved'].includes(s.id)
      ? `<a class="btn small ghost" href="${hoaEvents.length?'/admin/hoa-mail/'+hoaEvents[0].id:'/admin/news'}" title="${esc(s.label)} — verify source">${s.done?'✓':'·'} source</a>` :
      `<form class="ucccfa456" method="post" action="/admin/toggle">
         <input type="hidden" name="id" value="${c.id}"><input type="hidden" name="step" value="${s.id}">
         <button class="small ${s.done ? '' : 'ghost'}" title="${esc(s.label)}">${s.done ? '✓' : '·'}</button>
       </form>`).join(' ');
    const guestEmail = c.wizard && c.wizard.adults && c.wizard.adults[0] && c.wizard.adults[0].email;
    const stayRef = `Unit 405D / ${c.guestName} / ${c.checkIn} – ${c.checkOut}${c.reservationCode ? ' / Airbnb ' + c.reservationCode : ''}`;
    const feeMode = applicationFeeState(c);
    const screeningStep = c.steps.find(s => s.id === 'screening_complete');
    const screeningControl = c.screeningRoute === 'online' && screeningStep ? `<p><a href="${hoaEvents.length?'/admin/hoa-mail/'+hoaEvents[0].id:'/admin/news'}">Tenant Evaluation: Beleg prüfen / Nachforderungen bearbeiten</a></p>` : '';
    const feeState = feeMode === 'prohibited_same_lessee_renewal'
      ? `<span class="pill ok">same-lessee renewal: no application/transfer fee</span>`
        : feeMode === 'handled_online'
          ? `<span class="pill teal">fee handled in Tenant Evaluation</span>`
          : feeMode === 'route_required'
            ? `<span class="pill warn">application route not selected</span>`
        : feeMode === 'required' && c.feeMailed
          ? `<span class="pill ok">check mailed ${esc(c.feeMailed.slice(0,10))}</span>`
          : feeMode === 'required' ? `<span class="pill warn">fee not mailed yet</span>` : '';
    const mailBtns = feeMode !== 'required' || !feeRequestReleased(c, compliance) ? '' : `
      ${guestEmail ? `<a class="btn small ghost" href="${gmail(guestEmail, '', `Reminder: $100 HOA fee for your stay ${c.checkIn}`,
        `Hi ${c.guestName.split(' ')[0]},\n\nA friendly reminder about the $100 association fee (check or money order payable to "Example Condominium").\n\nMailing address:\nExample Condominium Association, Inc.\nc/o Example Property Management, Inc.\n570 Carillon Parkway, Suite 210\nSt. Petersburg, FL 33716\n\nPlease include a note: ${stayRef}\nOnce mailed, please tap "I've mailed the check" on your status page.\n\nThank you!\nOwner`)}"
        target="_blank" rel="noopener">✉ Gast: Gebühr erinnern</a>` : ''}
      <a class="btn small ghost" href="${gmail(HOA_TO, HOA_CC, `Fee receipt confirmation — ${stayRef}`,
        `Dear Example Property Management / Example Condominium,\n\nCould you please confirm receipt of the $100 application fee (check/money order) for the following lease application?\n\n${stayRef}${c.feeMailed ? `\n\nThe applicant reports having mailed the check on ${c.feeMailed.slice(0,10)}.` : ''}\n\nThank you very much!\n\nBest regards,\nProperty Owner\nOwner, Unit 405D`)}"
        target="_blank" rel="noopener">✉ HOA: Empfang bestätigen</a>`;
    const ds = docStates(c, ownerSigOnFile);
    const docLine = c.screeningRoute === 'online'
      ? 'Official application remains in Tenant Evaluation; no local PDF package is generated.'
      : ds.docs.map(d => {
      const state = c.submission ? '📤' : d.signed ? '✍️' : d.filled ? '📝' : '⬜';
      const title = c.submission ? 'an Verwaltung gesendet' : d.signed ? 'ausgefüllt + signiert' : d.filled ? 'ausgefüllt, Signatur fehlt' : 'noch nicht ausgefüllt';
      return `<span title="${esc(d.label)}: ${title}">${state} ${esc(d.label.split(' ')[0])}</span>`;
    }).join(' · ');
    const subLine = c.submission
      ? `<span class="pill ok">📬 gesendet ${esc(c.submission.sentAt.slice(0,10))}${c.submission.live ? '' : ' (TEST)'}</span>`
      : c.submissionError
        ? `<span class="pill ue90617ff">Versand-Störung: ${esc(c.submissionError.message.slice(0,60))}</span>`
        : c.screeningRoute === 'online'
          ? `<span class="pill ${c.screeningReportedAt ? 'warn' : 'teal'}">Tenant Evaluation ${c.screeningReportedAt ? 'vom Gast als erledigt gemeldet — Bestätigung ausstehend' : 'ausstehend'}</span>`
          : (c.wizard ? '<span class="pill warn">wartet auf Owner-Prüfung / vollständige Signaturen</span>' : '');
    const ready = (c.pathType !== 'full' || c.screeningRoute === 'paper') && isReadyForOwnerReview(c, ownerSigOnFile);
    const ai = c.aiReview && c.aiReview.reviewHash === c.reviewHash ? c.aiReview : null;
    const aiLine = !ready ? '' : !ai
      ? '<span class="pill warn">Lokale KI-Prüfung ausstehend</span>'
      : ai.status === 'green'
        ? `<span class="pill ok">Lokale KI-Prüfung grün · ${esc(ai.model || 'local')}</span><p class="muted">${esc(ai.summary || 'Keine Abweichungen gefunden.')}</p>`
        : `<span class="pill ue90617ff">KI-Prüfung ${esc(ai.status || 'red')}</span><p class="muted">${esc((ai.findings || []).join(' · ') || ai.summary || 'Prüfung wiederholen.')}</p>`;
    const reviewButton = ready && !c.submission ? `
      <div class="ud2c171b1">
        ${aiLine}
        ${ai && ai.status === 'green' ? `<form class="ua605c51e" method="post" action="/admin/submit" data-confirm="Die OpenAI-KI-Prüfung ist grün. Jetzt ${liveMode ? 'den externen Versand an die Verwaltung freigeben' : 'ein Testpaket nur an Owner senden'}?">
          <input type="hidden" name="id" value="${esc(c.id)}"><input type="hidden" name="reviewHash" value="${esc(c.reviewHash || '')}">
          <button class="small">${liveMode ? 'Grünen KI-Bericht bestätigen und versenden' : 'Grünen KI-Bericht bestätigen und Testpaket erzeugen'}</button>
        </form>` : '<p class="muted">Kein manueller PDF-Abgleich nötig. Der Versand wird erst nach einem grünen OpenAI-KI-Bericht freigeschaltet.</p>'}
      </div>` : '';
    const classification = c.pathType === 'full' ? `
      <form class="u575c0429" method="post" action="/admin/case-classification">
        <input type="hidden" name="id" value="${esc(c.id)}">
        <select class="u30e741d9" name="applicationType"><option value="lease" ${(c.applicationType || 'lease') === 'lease' ? 'selected' : ''}>Neuer/anderer Mieter</option><option value="renewal" ${c.applicationType === 'renewal' ? 'selected' : ''}>Verlängerung</option></select>
        <label class="uc42fdd48"><input type="checkbox" name="sameLesseesConfirmed" value="yes" ${c.sameLesseesConfirmed ? 'checked' : ''}> exakt dieselben Mieter</label>
        <button class="small ghost">Einordnen</button>
      </form>` : '';
    return `<tr>
      <td><b>${esc(c.guestName)}</b><br><span class="muted">${esc(c.checkIn)} → ${esc(c.checkOut)} · ${c.nights}n · ${esc(c.pathType)}</span><br>
          ${c.screeningRoute === 'online' ? '<span class="pill teal">external application — no local wizard required</span>' : c.wizard ? `<span class="pill ok">wizard data ${esc((c.wizard.savedAt || '').slice(0,10))}</span>` : '<span class="pill warn">no wizard data yet</span>'}
          ${feeState}<br>${screeningControl}
          <span class="muted">${docLine}</span><br>${subLine}${journeyLine}${packageDeliveryLine}${classification}${reviewButton}</td>
      <td>${done}/${visibleSteps.length}<br>${stepBtns}<br>${mailBtns}</td>
      <td><a href="/v/${c.token}" target="_blank">/v/${c.token}</a><br>
          ${c.pathType === 'full' ? `<a href="/admin/adverse-action?id=${encodeURIComponent(c.id)}">Adverse-Action-Hinweis</a><br>` : ''}
          <form class="ucccfa456" method="post" action="/admin/delete" data-confirm="Delete case?">
            <input type="hidden" name="id" value="${c.id}"><button class="small ghost">delete</button>
          </form></td></tr>`;
  }).join('');
  return adminPage('Vorgänge — Demo Unit Admin', '/admin/cases',
    `<h1>Vorgänge</h1><p>${cases.length} Vorgang/Vorgänge${msg ? ' — ' + esc(msg) : ''}</p>
     <p class="u2d724d0f">${liveMode ? '<span class="pill ok">Freigegebener Versand an Verwaltung</span>' : '<span class="pill warn">TESTMODUS — Versand nur an Owner</span>'}
     ${ownerSigOnFile ? '' : '<span class="pill ue90617ff">Owner-Signatur fehlt — finaler Versand gesperrt</span>'}
     <a class="ue785b9bd" href="/admin/settings">Einstellungen →</a></p>`,
    `<div class="card"><h2>Alle Vorgänge</h2><table><tr><th>Gast / Aufenthalt</th><th>Schritte</th><th>Link</th></tr>${rows || '<tr><td colspan=3 class=muted>Noch keine — neue Buchungen werden automatisch aus Gmail angelegt.</td></tr>'}</table></div>
     <details class="sect"><summary>Vorgang manuell anlegen <span class="muted u433de30b">(Normalfall: automatisch aus Gmail)</span></summary>
      <form method="post" action="/admin/create">
        <label>Voller Name des Gastes</label><input name="guestName" required>
        <label>Airbnb-Buchungscode</label><input name="reservationCode" placeholder="HM…">
        <label>Check-in (YYYY-MM-DD)</label><input name="checkIn" required pattern="\\d{4}-\\d{2}-\\d{2}">
        <label>Check-out (YYYY-MM-DD)</label><input name="checkOut" required pattern="\\d{4}-\\d{2}-\\d{2}">
        <label>Erwachsene (18+)</label><input name="adults" type="number" value="2" min="1" max="4">
        <p class="muted">Airbnb-Buchungen werden immer als vollständiger Mietvorgang angelegt und müssen mindestens 30 Nächte umfassen. Guest Registration ist ausschließlich für bestätigte, unentgeltliche Gäste vorgesehen.</p>
        <p><button>Vorgang anlegen & Magic-Link erhalten</button></p>
      </form></details>`);
}

// ---------- router ----------
export async function onRequest(context) {
  try { return await routeRequest(context); }
  catch (error) {
    if (!String(error.code || '').startsWith('CASE_')) throw error;
    const conflict=error.code==='CASE_CONFLICT';
    return html(page(conflict ? 'Reservation updated' : 'Please try again shortly',
      `<h1>${conflict ? 'This reservation was updated' : 'Your paperwork is temporarily unavailable'}</h1>`,
      `<div class="card"><p>${conflict ? 'Your latest action was not saved because the reservation changed. Open your latest page before trying again.' : 'Please keep your paperwork open and try again shortly. If this continues, message Owner through Airbnb.'}</p><p><a href="/">Return to your reservation</a></p></div>`),conflict ? 409 : 503);
  }
}

async function routeRequest(context) {
  const { request, env } = context;
  const waitUntil = context.waitUntil ? context.waitUntil.bind(context) : (p) => p;
  const url = new URL(request.url);
  const p = url.pathname;
  if (request.method === 'POST' && !isAllowedMutationOrigin(
    request.headers.get('Origin'),
    url.origin,
    request.headers.get('Sec-Fetch-Site'),
  )) {
    return new Response('Forbidden: invalid request origin', { status: 403, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
  }

  // canonical host: old domain and www redirect permanently — keeps every old magic link alive
  if (url.hostname === 'legacy-portal.example.test' || url.hostname === 'www.portal.example.test') {
    return new Response(null, { status: 301, headers: { Location: `https://portal.example.test${url.pathname}${url.search}`, ...SEC_HEADERS } });
  }


  if (p === '/' && (request.method === 'GET' || request.method === 'HEAD')) return html(landingView(), 200, true);
  if (p === '/privacy' && request.method === 'GET') return html(page('Privacy — Demo Unit', '<h1>Privacy notice</h1><p>This private portal is operated by Property Owner for the limited purpose of preparing and tracking Example Condominium guest-registration and lease-approval paperwork for Unit 405D.</p>', `<div class="card"><h2>What is collected</h2><p>Booking reference, stay dates, applicant names and contact details, address, birth date and identification details where the association form requires them, electronic consent, signatures, signature-event hashes, and workflow status. Raw IP addresses, Social Security numbers, medical information, and ID-image uploads are deliberately not retained through this portal.</p><h2>Why and with whom</h2><p>The information is used only to prepare and quality-check the association forms and, after an explicit owner release, submit the package to Example Property Management / Example Condominium. Cloudflare provides the portal infrastructure. OpenAI processes the purpose-bound application data and generated document text in the United States for automated completeness and consistency review. Google Gmail is used only for an owner-approved submission email. Infrastructure credentials and unrelated personal data are not included in the AI review.</p><h2>Retention and security</h2><p>Sensitive wizard contents, including government-ID numbers and applicant signatures, and the reusable owner signature are encrypted by the application with AES-256-GCM before KV storage. Operational case metadata remains access-controlled but is not represented as application-layer encrypted. Private pages are marked no-store and noindex. Access links use high-entropy bearer tokens and must not be forwarded. Active guest case data is deleted 90 days after checkout unless a documented legal hold or mandatory recordkeeping duty applies. Temporary review files are deleted after processing. If a breach involving covered personal information is determined, the owner workflow requires the Florida Information Protection Act response plan, including notice deadlines and secure disposal.</p><h2>Your choices</h2><p>Do not enter information for another adult or sign on their behalf. To request access, correction, deletion, a paper alternative, or review without automated processing, contact Owner through the existing Airbnb conversation before submitting data.</p><p class="muted">Last updated: September 2, 2026 · policy ${COMPLIANCE_POLICY_VERSION}</p>`));
  if (p === '/fair-housing' && request.method === 'GET') return html(page('Fair housing — Demo Unit', '<h1>Fair housing and reasonable accommodations</h1><p>Applications are handled consistently and without discrimination prohibited by federal or Florida law.</p>', `<div class="card"><h2>How decisions are made</h2><p>No protected characteristic is used to rank, screen, approve or deny a stay. This portal never automatically approves or denies an applicant. Tenant-screening reports remain in the association's approved external process; any adverse action based on a consumer report requires a separate notice and human review.</p><h2>Assistance animals</h2><p>Service animals and other assistance animals are not pets. A no-pets rule does not by itself bar a reasonable accommodation. No pet fee or animal deposit is charged for an approved assistance animal. A request may be made through the existing Airbnb conversation; please describe the accommodation requested, but do not send a diagnosis or medical records through this portal. No particular certificate or registration is required, and breed, size, or weight alone is not a reason for denial. If both the disability and disability-related need are not apparent, Owner may request only reliable supporting information permitted by law. Any direct-threat or property-damage assessment is individualized and considers whether another accommodation can reduce the risk.</p><h2>Privacy and equal treatment</h2><p>Owner does not disclose or discuss the race, color, national origin, religion, sex, familial status, disability, or other protected characteristics of past, current, or prospective guests or neighbors. Every applicant receives the same neutral booking, occupancy, and condominium-association process information.</p><h2>Corrections</h2><p>If application data is wrong or incomplete, use the private edit link before submission or message Owner. A screening-report dispute must be made with the reporting agency identified in any adverse-action notice.</p></div>`));
  if (p === '/healthz') return new Response('ok', { headers: { 'Content-Type': 'text/plain', ...SEC_HEADERS, 'Cache-Control': 'no-store' } });
  if (p === '/automation-healthz' && request.method === 'GET') {
    let ok=false;
    try {ok=automationHealth(await readAutomationStatus(env)).ok;} catch { /* Fail closed without exposing configuration or storage errors. */ }
    return new Response(ok?'ok':'unavailable',{status:ok?200:503,headers:{'Content-Type':'text/plain',...SEC_HEADERS,'Cache-Control':'no-store'}});
  }
  if (p.startsWith('/forms/') || p === '/robots.txt' || p === '/llms.txt' || p === '/sitemap.xml' || p === '/manifest.webmanifest' || p === '/favicon.svg') return env.ASSETS.fetch(request);

  // Dedicated replica feed: no admin, reviewer or legacy read-token fallback.
  if(p.startsWith('/api/knowledge/'))return knowledgeExportResponse(request,env,SEC_HEADERS);

  // Read-only API for Hermes/GBrain — GET only, token-gated, no mutations possible.
  if (p.startsWith('/api/ro/')) {
    if (request.method !== 'GET') return new Response('read-only', { status: 405 });
    const token = request.headers.get('X-RO-Token') || '';
    const expected = await env.CASES.get('readonly-token');
    if (!expected || token !== expected) return new Response('unauthorized', { status: 401 });
    const jsonResp = (data) => new Response(JSON.stringify(data, null, 1), { headers: {
      'Content-Type': 'application/json', 'X-Robots-Tag': 'noindex',
      'Cache-Control': 'private, no-store, max-age=0', ...SEC_HEADERS,
    } });
    if (p === '/api/ro/cases') {
      const cases = await loadCases(env);
      return jsonResp(cases.map(c => ({
        id: c.id, guestName: c.guestName, reservationCode: c.reservationCode || null,
        checkIn: c.checkIn, checkOut: c.checkOut, nights: c.nights, adults: c.adults,
        pathType: c.pathType, screeningRoute: c.screeningRoute || null, createdAt: c.createdAt,
        steps: (c.steps || []).map(s => ({ id: s.id, label: s.label, done: !!s.done, date: s.date || null })),
        paperworkSaved: !!c.wizard, ownerReviewReadyAt: c.ownerReviewReadyAt || null,
        submittedAt: c.submission && c.submission.sentAt || null,
        feeMailed: c.feeMailed || null, screeningReportedAt: c.screeningReportedAt || null, approvalCandidate: c.approvalCandidate || null,
      })));
    }
    if (p === '/api/ro/contacts') return jsonResp(JSON.parse((await env.CASES.get('library-contacts')) || '[]'));
    if (p === '/api/ro/news') return jsonResp(JSON.parse((await env.CASES.get('hoa-news')) || '[]'));
    if (p === '/api/ro/library') return jsonResp((await libList(env)).map(k => k.slice(4)));
    if (p === '/api/ro/receipts') return jsonResp((await rcptList(env)).map(k => k.slice(5)));
    if (p === '/api/ro/summary') {
      const cases = await loadCases(env);
      return jsonResp({
        generatedAt: new Date().toISOString(),
        activeCases: cases.map(c => ({ guest: c.guestName, checkIn: c.checkIn, checkOut: c.checkOut,
          pathType: c.pathType, screeningRoute: c.screeningRoute || null, stepsDone: c.steps.filter(s => s.done).length, stepsTotal: c.steps.length,
          submitted: !!c.submission, approved: !!c.steps.find(s => s.id === 'board_approved' && s.done),
          feeMailed: c.feeMailed || null })),
        libraryFiles: (await libList(env)).length,
        receiptFiles: (await rcptList(env)).length,
      });
    }
    return new Response('not found', { status: 404 });
  }

  if (p === '/find' && request.method === 'GET') return redirect('/');

  if (p === '/find' && request.method === 'POST') {
    if (!(await findRateAllowed(request, env))) {
      return html(page('Please wait — Demo Unit', '<h1>Too many attempts</h1><p>Please wait 15 minutes or message Owner through Airbnb.</p>', ''), 429);
    }
    const form = await request.formData();
    const code = String(form.get('code') || '').trim().toUpperCase();
    const name = normalizedLastName(form.get('name'));
    if (/^HM[A-Z0-9]{8,12}$/.test(code) && name) {
      const c = (await loadCases(env)).find(c =>
        isGuestAccessibleCase(c) &&
        (c.reservationCode || '').toUpperCase() === code &&
        normalizedLastName(c.guestName) === name);
      if (c) return redirect(`/v/${c.token}`);
    }
    return html(page('Not found yet — Demo Unit',
      `<h1>We couldn't find your page yet</h1>
       <p>Please double-check the confirmation code and last name — or your page may simply not be ready yet.</p>`,
      `<div class="card"><p>Your personal paperwork page is created automatically within about an hour of your booking confirmation. Please try again a little later, or just message Owner via the Airbnb chat — he'll send you the direct link.</p>
       <p><a href="/">← back</a></p></div>`), 404);
  }

  const mV = p.match(/^\/v\/([A-Za-z0-9_-]{6,})(\/fee-mailed|\/fee-unmailed|\/screening-reported|\/hoa-task-reported|\/reminder-contact|\/brief\.txt|\/executed-lease\.pdf|\/executed-flood-disclosure\.pdf)?$/);
  if (mV) {
    const cases = await loadCases(env);
    const c = cases.find(c => c.token === mV[1]);
    if (!c) return html(page('Not found', '<h1>Link not found</h1><p>Please check the link from your Airbnb chat or message Owner.</p>', ''), 404);
    if (!isGuestAccessibleCase(c)) return html(page('Reservation canceled', '<h1>This reservation is no longer active</h1><p>The Airbnb reservation has been canceled, so this paperwork page is closed.</p>', ''), 410);
    if(mV[2]==='/reminder-contact'&&request.method==='POST') {
      if(!env.CASE_STORE) return new Response('Atomic storage is required',{status:503,headers:SEC_HEADERS});
      const form=await request.formData();
      if(String(caseSnapshotVersion(cases,c.id))!==form.get('contactVersion')) return new Response('Preference not saved. Reload your page and try again.',{status:409,headers:SEC_HEADERS});
      const contact=contactPreference(form);
      if(!contact) return new Response('Confirm your request and enter the same valid email address twice.',{status:400,headers:SEC_HEADERS});
      c.guestContact=contact;await saveCases(env,cases);
      return redirect('/v/'+c.token);
    }
    if(mV[2]==='/hoa-task-reported'&&request.method==='POST') {
      if(!env.CASE_STORE) return new Response('Atomic storage is required',{status:503,headers:{...SEC_HEADERS,'Cache-Control':'private, no-store'}});
      const form=await request.formData();
      if(form.get('confirmed')!=='yes') return new Response('Confirmation required',{status:400,headers:SEC_HEADERS});
      const result=reportHoaTask(c,String(form.get('taskId')||''),Number(form.get('taskVersion')));
      if(!result.ok) return new Response(result.error,{status:result.status,headers:{...SEC_HEADERS,'Cache-Control':'private, no-store'}});
      await saveCases(env,cases);
      return redirect('/v/'+c.token);
    }
    if (mV[2] === '/fee-mailed' && request.method === 'POST') {
      if (c.screeningRoute !== 'paper') return new Response('paper-route fee action is not available for this case', { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
      if (!feeRequestReleased(c, await loadComplianceConfig(env))) return new Response('fee action is blocked until recorded authority and Airbnb fee disclosure are verified', { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
      if (!c.feeMailed) { c.feeMailed = new Date().toISOString(); await saveCases(env, cases); }
      return redirect(`/v/${c.token}`);
    }
    if (mV[2] === '/fee-unmailed' && request.method === 'POST') {
      if (c.screeningRoute !== 'paper') return new Response('paper-route fee action is not available for this case', { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
      if (c.feeMailed) { delete c.feeMailed; await saveCases(env, cases); }
      return redirect(`/v/${c.token}`);
    }
    if (mV[2] === '/screening-reported' && request.method === 'POST') {
      if (c.screeningRoute !== 'online') return new Response('online screening report is not available for this case', { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
      const form = await request.formData();
      if (form.get('confirmed') !== 'yes') return new Response('confirmation required', { status: 400, headers: SEC_HEADERS });
      if (!c.screeningReportedAt) { c.screeningReportedAt = new Date().toISOString(); await saveCases(env, cases); }
      return redirect(`/v/${c.token}`);
    }
    if (mV[2] === '/brief.txt' && request.method === 'GET') {
      return new Response(guestBrief(c, await loadComplianceConfig(env)), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'private, no-store, max-age=0', 'Pragma': 'no-cache', 'X-Robots-Tag': 'noindex', ...SEC_HEADERS } });
    }
    if ((mV[2] === '/executed-lease.pdf' || mV[2] === '/executed-flood-disclosure.pdf') && request.method === 'GET') {
      if (!c.submission || !c.wizard) return new Response('executed documents are available only after live owner release', { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
      if (mV[2] === '/executed-flood-disclosure.pdf' && !isAnnualRental(c)) return new Response('flood disclosure not required for this term', { status: 404, headers: SEC_HEADERS });
      const manifest=c.submission.packageManifest||c.preparedPackage;
      if(!env.CASE_STORE||!manifest||manifest.id!==c.submission.packageId||manifest.packageHash!==c.submission.packageHash) return new Response('The original signed document has not been archived. Please request the original through the existing Airbnb conversation. A newly generated document cannot replace the original.',{status:409,headers:{...SEC_HEADERS,'Cache-Control':'private, no-store'}});
      const archive=await loadArchivedPackage(env,{...c,preparedPackage:manifest});
      const name=mV[2]==='/executed-lease.pdf'?'04-short-term-lease.pdf':'05-flood-disclosure.pdf';
      const index=archive.manifest.documents.findIndex(d=>d.reviewFilename===name);
      if(index<0) return new Response('document not in this signed package',{status:404,headers:SEC_HEADERS});
      const bytes=archive.attachments[index].bytes;
      return new Response(bytes, { headers: { 'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${mV[2].slice(1)}"`, 'Cache-Control': 'private, no-store, max-age=0',
        'Pragma': 'no-cache', 'X-Robots-Tag': 'noindex', ...SEC_HEADERS } });
    }
    if (!mV[2] && request.method === 'GET') return html(statusView(c, await loadComplianceConfig(env),env.CASE_STORE?caseSnapshotVersion(cases,c.id):null,env.AUTO_GUEST_REMINDERS==='yes'));
  }

  const mRoute = p.match(/^\/w\/([A-Za-z0-9_-]{6,})\/route$/);
  if (mRoute && request.method === 'POST') {
    const cases = await loadCases(env);
    const c = cases.find(c => c.token === mRoute[1]);
    if (!c) return html(page('Not found', '<h1>Link not found</h1><p>Please check the link from your Airbnb chat or message Owner.</p>', ''), 404);
    if (!isGuestAccessibleCase(c)) return html(page('Reservation canceled', '<h1>This reservation is no longer active</h1><p>The Airbnb reservation has been canceled, so this paperwork page is closed.</p>', ''), 410);
    if (c.pathType !== 'full') return new Response('application route is not required for this case', { status: 409, headers: SEC_HEADERS });
    if (c.submission || c.reviewLockedAt || c.screeningRoute !== 'undecided') return new Response('application route is already locked; message Owner through Airbnb', { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
    const form = await request.formData();
    const route = String(form.get('route') || '');
    if (!['online', 'paper'].includes(route)) return html(applicationRouteView(c, 'Choose one of the two application routes.'), 400);
    c.screeningRoute = route;
    const step = c.steps.find(s => s.id === 'route_selected');
    if (step) { step.done = true; step.date = new Date().toISOString(); }
    await saveCases(env, cases);
    return redirect(route === 'online' ? `/v/${c.token}` : `/w/${c.token}`);
  }

  const mOccupancy = p.match(/^\/w\/([A-Za-z0-9_-]{6,})\/occupancy$/);
  if (mOccupancy && request.method === 'POST') {
    const cases = await loadCases(env);
    const c = cases.find(c => c.token === mOccupancy[1]);
    if (!c) return html(page('Not found', '<h1>Link not found</h1><p>Please check the link from your Airbnb chat or message Owner.</p>', ''), 404);
    if (!isGuestAccessibleCase(c)) return html(page('Reservation canceled', '<h1>This reservation is no longer active</h1><p>The Airbnb reservation has been canceled, so this paperwork page is closed.</p>', ''), 410);
    if (c.submission || c.reviewLockedAt || c.wizard) return new Response('occupancy can no longer be changed here; message Owner through Airbnb', { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
    const form = await request.formData();
    const confirmed = confirmHoaOccupancy(c, { hoaAdults: form.get('hoaAdults'), minors: form.get('minors') });
    if (!confirmed.ok) return html(occupancyView(c, confirmed.error), 400);
    await saveCases(env, cases);
    return redirect(`/w/${c.token}`);
  }

  const mW = p.match(/^\/w\/([A-Za-z0-9_-]{6,})(\/pdf\/(lease-application|background-authorization|rules-and-regulations|guest-registration|lease-agreement|flood-disclosure))?$/);
  if (mW) {
    const cases = await loadCases(env);
    const c = cases.find(c => c.token === mW[1]);
    if (!c) return html(page('Not found', '<h1>Link not found</h1><p>Please check the link from your Airbnb chat or message Owner.</p>', ''), 404);
    if (!isGuestAccessibleCase(c)) return html(page('Reservation canceled', '<h1>This reservation is no longer active</h1><p>The Airbnb reservation has been canceled, so this paperwork page is closed.</p>', ''), 410);

    if (!mW[2] && request.method === 'GET') {
      if (c.submission || c.reviewLockedAt) return redirect(`/v/${c.token}`);
      if (c.pathType === 'full' && !c.hoaOccupancyConfirmedAt) return html(occupancyView(c));
      if (c.pathType === 'full' && c.screeningRoute === 'undecided') return html(applicationRouteView(c));
      if (c.pathType === 'full' && c.screeningRoute === 'online') return redirect(`/v/${c.token}`);
      return html(wizardView(c, url.searchParams.get('saved'), env.CASE_STORE ? caseSnapshotVersion(cases,c.id) : null));
    }

    if (!mW[2] && request.method === 'POST') {
      if (c.submission || c.reviewLockedAt) return new Response('paperwork is locked after owner release', { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
      if (c.pathType === 'full' && !c.hoaOccupancyConfirmedAt) return redirect(`/w/${c.token}`);
      if (c.pathType === 'full' && c.screeningRoute !== 'paper') return new Response('choose the paper route before editing local forms', { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
      const form = await request.formData();
      if (env.CASE_STORE && String(form.get('draftVersion') || '') !== String(caseSnapshotVersion(cases,c.id))) {
        return html(page('Draft updated', '<h1>Your changes were not saved</h1>', `<div class="card"><p>This reservation or draft changed since you opened the form. Keep your entries in the original tab and compare them with the latest saved form before continuing.</p><a href="/w/${c.token}" target="_blank" rel="noopener">Open latest saved form</a></div>`),409);
      }
      const g = (n, max = 254) => String(form.get(n) || '').trim().slice(0, max);
      const saveMode = g('saveMode', 16);
      const prevWizard = c.wizard || null;
      const prevAdults = (prevWizard && prevWizard.adults) || [];
      const { adults, explicitSigs, removeSigs } = parseAdultFormSlots(form, c.adults);
      const savedAt = new Date().toISOString();
      const nextWizard = {
        adults,
        esignConsent: adults.length === c.adults && adults.every(a => a.esignConsent),
        esignConsentVersion: 'fl-2026.09.02',
        rulesAcknowledged: c.pathType !== 'full' || g('rules_acknowledged') === 'yes',
        floodDisclosureAcknowledged: !isAnnualRental(c) || g('flood_disclosure_acknowledged') === 'yes',
        auto: { make: g('auto_make'), year: g('auto_year'), plate: g('auto_plate') },
        references: [0,1].map(i => ({ name: g(`ref${i}_name`), phone: g(`ref${i}_phone`), address: g(`ref${i}_address`) })),
        emergency: [0,1].map(i => ({ name: g(`em${i}_name`), phone: g(`em${i}_phone`) })),
        children: [0,1].map(i => ({ name: g(`ch${i}_name`, 120), birthDate: g(`ch${i}_birthDate`, 10) })),
        savedAt,
      };
      const previousContentHash = prevWizard ? await reviewDigest(c, prevWizard, false) : null;
      const previousReviewHash = prevWizard ? (c.reviewHash || await reviewDigest(c, prevWizard, true)) : null;
      const nextContentHash = await reviewDigest(c, nextWizard, false);
      const materialChange = !!prevWizard && previousContentHash !== nextContentHash;
      const auditSalt = String(env.AUDIT_HASH_SALT || env.DATA_ENCRYPTION_KEY || 'unconfigured-audit-salt');
      const networkHash = await sha256hex(`${auditSalt}:network:${request.headers.get('CF-Connecting-IP') || 'unknown'}`);
      const userAgentHash = await sha256hex(`${auditSalt}:browser:${request.headers.get('User-Agent') || 'unknown'}`);
      nextWizard.adults.forEach((a, i) => {
        if (removeSigs[i]) { a.sigPng = null; a.signatureAudit = null; }
        else if (explicitSigs[i]) {
          a.sigPng = explicitSigs[i];
          a.signatureAudit = { signedAt: savedAt, contentHash: nextContentHash, networkHash, userAgentHash, consentVersion: 'fl-2026.09.02' };
        } else if (materialChange) { a.sigPng = null; a.signatureAudit = null; }
        else {
          a.sigPng = (prevAdults[i] && prevAdults[i].sigPng) || null;
          a.signatureAudit = (prevAdults[i] && prevAdults[i].signatureAudit) || null;
        }
      });
      c.wizard = nextWizard;
      c.contentHash = nextContentHash;
      c.reviewHash = await reviewDigest(c, nextWizard, true);
      if (previousReviewHash !== c.reviewHash) delete c.aiReview;
      const reviewChanged = !!prevWizard && previousReviewHash !== c.reviewHash;
      if (reviewChanged) {
        delete c.ownerReviewReadyAt;
        delete c.ownerApprovedAt;
        delete c.ownerApprovedBy;
        delete c.ownerApprovedReviewHash;
        delete c.ownerReviewedDocuments;
      }
      const opened = c.steps.find(s => s.id === 'forms_sent');
      if (opened && !opened.done) { opened.done = true; opened.date = savedAt; }
      const guestPaperworkComplete = isGuestPaperworkComplete(c);
      if (c.pathType === 'full') {
        for (const id of ['application', 'background', 'rules_ack']) {
          const step = c.steps.find(candidate => candidate.id === id);
          if (!step) continue;
          step.done = guestPaperworkComplete;
          step.date = guestPaperworkComplete ? (step.date || savedAt) : null;
        }
      }
      const becameReady = saveMode !== 'draft' && guestPaperworkComplete && !c.ownerReviewReadyAt;
      if (becameReady) c.ownerReviewReadyAt = savedAt;
      await saveCases(env, cases);
      if (becameReady) waitUntil(sendTelegram(env, `🤖 ${c.guestName} (${c.checkIn}): Unterlagen vollständig. Die OpenAI-KI-Vorprüfung läuft; du erhältst nur bei Abweichungen Rückfragen oder anschließend eine kompakte Versandfreigabe.`));
      const saveState = saveMode !== 'draft' && guestPaperworkComplete ? 'ready' : 'draft';
      return redirect(`/w/${c.token}?saved=${saveState}`);
    }

    if (mW[2] && request.method === 'GET') {
      if (!c.wizard) return redirect(`/w/${c.token}`);
      const doc = mW[3];
      if (doc === 'flood-disclosure' && !isAnnualRental(c)) return new Response('flood disclosure not required for this term', { status: 404, headers: SEC_HEADERS });
      const compliance = await loadComplianceConfig(env);
      const data = { checkIn: c.checkIn, checkOut: c.checkOut, reservationCode: c.reservationCode,
        applicationType: c.applicationType || 'lease', ownerSigPng: null, preview: true,
        todayISO: new Date().toISOString().slice(0, 10), reviewHash: c.reviewHash,
        landlordNoticeAddress: compliance.landlordNoticeAddress,
        floodDamageKnown: compliance.floodDamageKnown, floodClaimFiled: compliance.floodClaimFiled,
        floodAssistanceReceived: compliance.floodAssistanceReceived, ...c.wizard };
      let bytes;
      const template = async (name) => {
        const response = await env.ASSETS.fetch(new URL(`/forms/${name}.pdf`, request.url));
        if (!response.ok) throw new Error(`form template unavailable: ${name}`);
        return new Uint8Array(await response.arrayBuffer());
      };
      if (doc === 'lease-agreement') {
        bytes = await generateLeaseAgreement(data);
      } else if (doc === 'flood-disclosure') {
        bytes = await generateFloodDisclosure(data);
      } else if (doc === 'lease-application' || doc === 'background-authorization') {
        const filled = await fillLeaseApplication(await template('lease-application'), data);
        const split = await splitLeaseApplicationPackage(filled);
        bytes = doc === 'lease-application' ? split.application : split.background;
      } else if (doc === 'rules-and-regulations') {
        bytes = await buildRulesAcknowledgment(await template('rules-and-regulations'), data);
      } else {
        bytes = await fillGuestRegistration(await template('guest-registration'), data);
      }
      return new Response(bytes, { headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Palma-del-Mar-2-${doc}-${c.checkIn}.pdf"`,
        'Cache-Control': 'private, no-store, max-age=0', 'Pragma': 'no-cache',
        ...SEC_HEADERS,
        'X-Robots-Tag': 'noindex',
      }});
    }
  }

  if (p.startsWith('/admin')) {
    const reviewRoute=['/admin/review/candidates','/admin/review/package','/admin/review/result','/admin/review/claim','/admin/review/failure','/admin/review/heartbeat'].includes(p);
    const reviewToken=String(env.REVIEW_API_TOKEN||'');
    const reviewer=reviewRoute && reviewToken.length>=32 && await tolerantCompare(request.headers.get('Authorization')||'', 'Bearer '+reviewToken);
    const denied = reviewer ? null : await checkAdmin(request, env);
    if (denied) return denied;
    if(p==='/admin/package-delivery-reconcile'&&request.method==='POST') {
      if(!env.CASE_STORE)return new Response('Atomic storage required',{status:503,headers:SEC_HEADERS});
      const form=await request.formData(),cases=await loadCases(env),c=cases.find(c=>c.id===form.get('id'));
      const result=await reconcileAcceptedPackage(env,cases,c,{
        caseVersion:form.get('caseVersion'),reservation:form.get('reservation'),packageId:form.get('packageId'),packageHash:form.get('packageHash'),
        messageId:form.get('messageId'),sentAt:form.get('sentAt'),attested:form.get('attested')==='yes',by:env.ADMIN_USER||'owner',
      });
      if(!result.ok)return new Response(result.error,{status:result.status,headers:SEC_HEADERS});
      return redirect('/admin/cases?msg='+encodeURIComponent('Prior package send recorded from owner verification. No email sent; HOA approval remains separate.'));
    }
    if(p==='/admin/airbnb-relay'&&request.method==='POST') {
      if(!env.CASE_STORE)return new Response('Atomic storage required',{status:503,headers:SEC_HEADERS});
      const form=await request.formData(),cases=await loadCases(env),c=cases.find(c=>c.id===form.get('id'));
      if(!c||c.status==='canceled'||String(caseSnapshotVersion(cases,c.id))!==form.get('caseVersion'))return new Response('Reservation changed. Reload before saving.',{status:409,headers:SEC_HEADERS});
      if(form.get('action')==='revoke') {if(c.airbnbRelay)delete c.airbnbRelay.verified;delete c.airbnbRelayKey;}
      else {
        if(form.get('reservation')!==c.reservationCode)return new Response('Reservation mismatch',{status:409,headers:SEC_HEADERS});
        if(form.get('action')!=='verify'||!verifyAirbnbRelay(c,form.get('sourceHash'),{attested:form.get('attested')==='yes',by:env.ADMIN_USER||'owner'}))return new Response('Original source verification required',{status:400,headers:SEC_HEADERS});
      }
      await saveCases(env,cases);return redirect('/admin/cases');
    }
    if(p==='/admin/reminder-delivery-review'&&request.method==='POST') {
      if(!env.CASE_STORE)return new Response('Atomic storage required',{status:503,headers:SEC_HEADERS});
      const form=await request.formData(),cases=await loadCases(env),c=cases.find(c=>c.id===form.get('id'));
      if(!c||c.status==='canceled'||String(caseSnapshotVersion(cases,c.id))!==form.get('caseVersion'))return new Response('Reservation changed. Reload before saving.',{status:409,headers:SEC_HEADERS});
      if(form.get('reservation')!==c.reservationCode)return new Response('Reservation mismatch',{status:409,headers:SEC_HEADERS});
      if(form.get('attested')!=='yes'||!reviewDeliveryNotice(c,form.get('messageId'),form.get('sourceHash'),env.ADMIN_USER||'owner'))return new Response('Original delivery notice review required',{status:400,headers:SEC_HEADERS});
      await saveCases(env,cases);return redirect('/admin/cases');
    }
    if(p==='/admin/booking-change-review'&&request.method==='POST') {
      if(!env.CASE_STORE)return new Response('Atomic storage required',{status:503,headers:SEC_HEADERS});
      const form=await request.formData(),cases=await loadCases(env),c=cases.find(c=>c.id===form.get('id'));
      if(!c||c.status==='canceled'||String(caseSnapshotVersion(cases,c.id))!==form.get('caseVersion'))return new Response('Reservation changed. Reload before saving.',{status:409,headers:SEC_HEADERS});
      if(form.get('reservation')!==c.reservationCode)return new Response('Reservation mismatch',{status:409,headers:SEC_HEADERS});
      if(form.get('attested')!=='yes'||!acknowledgeBookingChange(c))return new Response('Original booking-change review required',{status:400,headers:SEC_HEADERS});
      await saveCases(env,cases);return redirect('/admin/cases');
    }
    const hoaSource=p.match(/^\/admin\/hoa-mail\/([a-f0-9]{64})(\/review)?$/);
    if(hoaSource && request.method==='POST'&&hoaSource[2]==='/review') {
      if(!env.CASE_STORE) return new Response('Atomic storage is required',{status:503,headers:{...SEC_HEADERS,'Cache-Control':'private, no-store'}});
      const source=await readHoaReply(env,hoaSource[1]);
      if(!source) return new Response('Original source unavailable or expired',{status:404,headers:SEC_HEADERS});
      const form=await request.formData(),cases=await loadCases(env),c=cases.find(c=>c.id===form.get('id'));
      if(!c||String(caseSnapshotVersion(cases,c.id))!==form.get('caseVersion')||String(form.get('reservation')||'').trim()!==(c.reservationCode||c.guestName)) return new Response('Reservation or revision mismatch. Reload the source page.',{status:409,headers:{...SEC_HEADERS,'Cache-Control':'private, no-store'}});
      if(cases.some(other=>other.id!==c.id&&(other.hoaMailEvents||[]).some(e=>e.id===hoaSource[1]))) return new Response('Source is already linked to a different reservation. Reconcile its assignment first.',{status:409,headers:SEC_HEADERS});
      if(!(c.hoaMailEvents||[]).some(e=>e.id===hoaSource[1])) c.hoaMailEvents=[...(c.hoaMailEvents||[]),{id:hoaSource[1],at:new Date().toISOString(),mailDate:source.date,categories:['owner_linked'],matchReason:'owner_verified',reviewRequired:true}];
      const result=reviewHoaEvidence(c,hoaSource[1],{kind:String(form.get('kind')||''),attested:form.get('attested')==='yes',by:env.ADMIN_USER,
        confirmations:form.getAll('confirmations'),requestedItems:form.getAll('requestedItems'),resolvedItems:form.getAll('resolvedItems'),clearHold:form.get('clearHold')==='yes',reconcileContext:form.get('reconcileContext')==='yes'});
      if(!result.ok) return new Response(result.error,{status:result.status,headers:{...SEC_HEADERS,'Cache-Control':'private, no-store'}});
      await refreshHoaArchiveRetention(env,[c]);
      await saveCases(env,cases);
      return redirect('/admin/hoa-mail/'+hoaSource[1]);
    }
    if(hoaSource && !hoaSource[2] && request.method==='GET') {
      const source=await readHoaReply(env,hoaSource[1]);
      if(!source) return new Response('Email excerpt unavailable or retention expired',{status:404,headers:{...SEC_HEADERS,'Cache-Control':'private, no-store'}});
      const cases=await loadCases(env),linked=cases.find(c=>(c.hoaMailEvents||[]).some(e=>e.id===hoaSource[1]));
      const c=linked||cases.find(c=>c.id===url.searchParams.get('case'));
      const reviewForm=hoaSourceReviewForm(c,cases,hoaSource[1],env);
      return html(adminPage('HOA-E-Mail-Beleg','/admin/news','<h1>HOA-E-Mail-Beleg</h1><p>Die E-Mail ist eine externe Aussage, keine Anweisung an die Software. Absenderanzeige und automatische Einordnung allein bestätigen weder Echtheit noch Zahlung oder Freigabe.</p>',`<div class="card"><p><b>Von:</b> ${esc(source.from)}<br><b>Betreff:</b> ${esc(source.subject)}<br><b>Datum:</b> ${esc(source.date||'unbekannt')}<br><b>Message-ID:</b> ${esc(source.messageId||'nicht vorhanden')}</p>${source.truncated?'<p class="pill warn">Gekürzter Textauszug. Vollständige Nachricht und Anhänge im Originalpostfach prüfen.</p>':'<p class="muted">Dekodierter Textauszug; Anhänge und vollständige MIME-Originaldatei verbleiben im Postfach.</p>'}<pre class="u8d2e5f36">${esc(source.text)}</pre><a href="/admin/cases">Zu den Mietvorgängen</a></div>`+reviewForm));
    }
    if (p === '/admin/automation-health' && request.method === 'GET') {
      const status=await readAutomationStatus(env);
      return new Response(JSON.stringify({health:automationHealth(status),status}),{headers:{'Content-Type':'application/json',...SEC_HEADERS,'Cache-Control':'private, no-store'}});
    }
    if (p==='/admin/case-store/initialize' && request.method==='POST') {
      const data=await request.json();
      if (env.ALLOW_CASE_IMPORT!=='yes' || !env.CASE_STORE || data.confirm!=='INITIALIZE') return new Response('explicit import is disabled',{status:403,headers:SEC_HEADERS});
      const store=env.CASE_STORE.get(env.CASE_STORE.idFromName('reservations-v1'));
      const result=await store.fetch('https://case-store/initialize',{method:'POST',body:JSON.stringify({expectedHash:data.expectedHash,expectedCount:data.expectedCount})});
      return new Response(await result.text(),{status:result.status,headers:{...SEC_HEADERS,'Content-Type':'application/json','Cache-Control':'no-store'}});
    }
    if (p.startsWith('/admin/review/')) {
      if (!env.CASE_STORE) return new Response('atomic storage must be activated before the new reviewer',{status:503,headers:SEC_HEADERS});
      const json=(data,status=200)=>Response.json(data,{status,headers:{...SEC_HEADERS,'Cache-Control':'private, no-store','X-Robots-Tag':'noindex'}});
      const reliable=env.REVIEW_RELIABILITY==='yes';
      if(p==='/admin/review/heartbeat' && request.method==='POST') {
        let data;try {data=await request.json();} catch {return json({error:'invalid JSON'},400);}
        if(!reliable) return json({error:'hybrid review disabled'},409);
        if(!['started','completed','failed'].includes(data?.state)) return json({error:'invalid state'},400);
        await recordReviewerHeartbeat(env,data.state);return json({ok:true});
      }
      const ownerSignature=await getEncryptedSecret(env,'owner-signature-png');
      const compliance=await loadComplianceConfig(env);
      if (p==='/admin/review/candidates' && request.method==='GET') {
        const candidates=[];
        for (const c of await loadCases(env)) {
          if (!needsReview(c)) continue;
          const contextHash=await reviewContextHash(c,ownerSignature,compliance);
          if (completedReview(c,contextHash) || (reliable&&!reviewAvailable(c,contextHash))) continue;
          candidates.push({...reviewCaseData(c),reviewContextHash:contextHash});
        }
        candidates.sort((a,b)=>String(a.checkIn||'9999').localeCompare(String(b.checkIn||'9999')));
        return json({cases:candidates,protocol:reliable?2:1});
      }
      if(['/admin/review/claim','/admin/review/failure'].includes(p)&&request.method==='POST') {
        if(!reliable) return json({error:'hybrid review disabled'},409);
        let data;try {data=await request.json();} catch {return json({error:'invalid JSON'},400);}
        const cases=await loadCases(env),c=cases.find(c=>c.id===data?.id);
        if(!c||c.reviewHash!==data.reviewHash||await reviewContextHash(c,ownerSignature,compliance)!==data.reviewContextHash) return json({error:'review inputs changed'},409);
        if(p.endsWith('/claim')) {
          const claim=claimReview(c,data.reviewContextHash);
          if(!claim) return json({error:'review unavailable'},409);
          await saveCases(env,cases);return json({token:claim.token,leaseUntil:claim.leaseUntil});
        }
        if(!ownsReview(c,data.reviewContextHash,data.claimToken)) return json({error:'review lease changed'},409);
        failReview(c);await saveCases(env,cases);return json({ok:true});
      }
      if(p==='/admin/review/package' && request.method==='POST') {
        let data;try {data=await request.json();} catch {return json({error:'invalid JSON'},400);}
        const cases=await loadCases(env),c=cases.find(c=>c.id===data.id);
        if(reliable&&(!c||!ownsReview(c,data.reviewContextHash,data.claimToken))) return json({error:'review lease changed'},409);
        if(!c || !needsReview(c) || c.reviewHash!==data.reviewHash || await reviewContextHash(c,ownerSignature,compliance)!==data.reviewContextHash || !isReadyForOwnerReview(c,validateSignaturePng(ownerSignature)) || await reviewDigest(c,c.wizard,true)!==c.reviewHash) return json({error:'paperwork changed or is incomplete'},409);
        if(!c.preparedPackage || c.preparedPackage.reviewHash!==c.reviewHash || c.preparedPackage.contextHash!==data.reviewContextHash) {
          c.preparedPackage=await archivePackage(env,cases,c,await generatePackage(c,env,{ownerSignature,compliance}),data.reviewContextHash);
        }
        return json(reviewPackagePayload(await loadArchivedPackage(env,c)));
      }
      if (p==='/admin/review/result' && request.method==='POST') {
        let data;try { data=await request.json(); } catch {return json({error:'invalid JSON'},400);}
        if (!validateReviewReport(data.report)) return json({error:'invalid structured review report'},400);
        const cases=await loadCases(env),c=cases.find(c=>c.id===data.id);
        if (!c || !needsReview(c) || c.reviewHash!==data.reviewHash || await reviewContextHash(c,ownerSignature,compliance)!==data.reviewContextHash) return json({error:'review inputs changed'},409);
        if(reliable) {
          // A retry after a lost acknowledgement reports success but never
          // overwrites the accepted report. Changed inputs still fail above.
          if(c.reviewJob?.state==='completed'&&c.reviewJob.token===data.claimToken&&c.reviewJob.contextHash===data.reviewContextHash&&c.aiReview?.reviewHash===data.reviewHash&&c.aiReview?.reviewContextHash===data.reviewContextHash&&c.aiReview?.packageId===data.packageId&&c.aiReview?.packageHash===data.packageHash) return json({ok:true,alreadyRecorded:true});
          if(!ownsReview(c,data.reviewContextHash,data.claimToken)) return json({error:'review lease changed'},409);
        }
        if (data.report.status==='green' && (!isReadyForOwnerReview(c,validateSignaturePng(ownerSignature)) || await reviewDigest(c,c.wizard,true)!==c.reviewHash)) return json({error:'paperwork does not pass server validation'},409);
        if((data.report.status==='green'||c.preparedPackage) && (!c.preparedPackage || data.packageId!==c.preparedPackage.id || data.packageHash!==c.preparedPackage.packageHash || c.preparedPackage.reviewHash!==c.reviewHash || c.preparedPackage.contextHash!==data.reviewContextHash)) return json({error:'reviewed package version changed'},409);
        const {status,summary,findings,confidence,model}=data.report;
        c.aiReview={status,summary,findings,confidence,model,reviewHash:c.reviewHash,reviewContextHash:data.reviewContextHash,packageId:c.preparedPackage?.id,packageHash:c.preparedPackage?.packageHash,reviewedAt:new Date().toISOString()};
        if(reliable) c.reviewJob={...c.reviewJob,state:'completed',completedAt:new Date().toISOString()};
        await saveCases(env,cases);
        return json({ok:true});
      }
      return json({error:'not found'},404);
    }
    if (p === '/admin' && request.method === 'GET') {
      const ownerSigOnFile = validateSignaturePng(await getEncryptedSecret(env, 'owner-signature-png'));
      const liveMode = (await env.CASES.get('submit-live')) === 'yes';
      const contacts = JSON.parse((await env.CASES.get('library-contacts')) || '[]');
      const board = JSON.parse((await env.CASES.get('admin-board')) || '[]');
      const counts = { contacts: contacts.length, library: (await libList(env)).length, receipts: (await rcptList(env)).length, boardOpen: board.filter(n => !n.done).length };
      const news = JSON.parse((await env.CASES.get('hoa-news')) || '[]');
      return html(dashboardView(await loadCases(env), counts, ownerSigOnFile, liveMode, url.searchParams.get('msg'), news));
    }
    if (p === '/admin/news' && request.method === 'GET') {
      const news = JSON.parse((await env.CASES.get('hoa-news')) || '[]');
      return html(newsView(news, url.searchParams.get('msg')));
    }
    if (p === '/admin/cases' && request.method === 'GET') {
      const ownerSigOnFile = validateSignaturePng(await getEncryptedSecret(env, 'owner-signature-png'));
      const liveMode = (await env.CASES.get('submit-live')) === 'yes';
      return html(casesView(await loadCases(env), url.searchParams.get('msg'), ownerSigOnFile, liveMode, await loadComplianceConfig(env)));
    }
    if (p === '/admin/contacts' && request.method === 'GET') {
      const contacts = JSON.parse((await env.CASES.get('library-contacts')) || '[]');
      return html(contactsView(contacts, url.searchParams.get('msg')));
    }
    if (p === '/admin/adverse-action' && request.method === 'GET') {
      const c = (await loadCases(env)).find(item => item.id === url.searchParams.get('id'));
      if (!c) return new Response('case not found', { status: 404, headers: SEC_HEADERS });
      return html(adverseActionView(c, await loadComplianceConfig(env), url.searchParams.get('msg')));
    }
    if (p === '/admin/settings' && request.method === 'GET') {
      const sig = await getEncryptedSecret(env, 'owner-signature-png');
      const liveMode = (await env.CASES.get('submit-live')) === 'yes';
      const compliance = await loadComplianceConfig(env);
      const complianceState = liveComplianceState({ pathType: 'full', nights: 30, applicationType: 'lease' }, compliance, env);
      return html(settingsView(validateSignaturePng(sig), liveMode, url.searchParams.get('msg'), compliance, complianceState));
    }
    if (p === '/admin/receipts' && request.method === 'GET') {
      return html(receiptsView(await rcptList(env), url.searchParams.get('msg')));
    }
    if (p.startsWith('/admin/receipts/f/') && request.method === 'GET') {
      const key = 'rcpt:' + decodeURIComponent(p.slice('/admin/receipts/f/'.length));
      const data = await env.CASES.get(key, 'arrayBuffer');
      if (!data) return new Response('not found', { status: 404 });
      const name = libDisplayName(key);
      const type = name.toLowerCase().endsWith('.pdf') ? 'application/pdf'
        : /\.(png|jpg|jpeg)$/i.test(name) ? 'image/' + name.split('.').pop().toLowerCase().replace('jpg', 'jpeg')
        : 'application/octet-stream';
      return new Response(data, { headers: { 'Content-Type': type, 'Content-Disposition': `inline; filename="${name}"`, 'X-Robots-Tag': 'noindex' } });
    }
    if (p === '/admin/receipts/upload' && request.method === 'POST') {
      const form = await request.formData();
      const file = form.get('file');
      const cat = String(form.get('cat') || 'anschaffungen');
      if (!file || typeof file === 'string' || !RCPT_CATS.some(([c]) => c === cat)) return new Response('invalid', { status: 400 });
      const safe = file.name.replace(/[^\w.\-äöüÄÖÜß ]+/g, '_').slice(0, 120);
      await env.CASES.put(`rcpt:${cat}/${safe}`, await file.arrayBuffer());
      return redirect('/admin/receipts?msg=' + encodeURIComponent(safe + ' hochgeladen'));
    }
    if (p === '/admin/receipts/export' && request.method === 'POST') {
      const form = await request.formData();
      const year = String(form.get('year') || '');
      const who = EXPORT_RECIPIENTS[String(form.get('to') || '')];
      if (!who || !/^(20\d{2}|ohne-jahr)$/.test(year)) return new Response('invalid', { status: 400 });
      waitUntil((async () => {
        try {
          const r = await exportReceipts(env, year, who);
          await sendTelegram(env, `📤 Beleg-Export ${year} an ${who.name} (${who.to}): ${r.files} Datei(en) in ${r.mails} Mail(s) versandt. CC liegt in deinem Postfach.`);
        } catch (e) {
          await sendTelegram(env, `🚨 Beleg-Export ${year} an ${who.name} FEHLGESCHLAGEN: ${String(e && e.message || e).slice(0, 200)}`);
        }
      })());
      return redirect('/admin/receipts?msg=' + encodeURIComponent(`Export ${year} an ${who.name} läuft im Hintergrund — Telegram-Bestätigung folgt.`));
    }
    if (p === '/admin/board' && request.method === 'GET') {
      const notes = JSON.parse((await env.CASES.get('admin-board')) || '[]');
      return html(boardView(notes, url.searchParams.get('msg')));
    }
    if (p === '/admin/board/add' && request.method === 'POST') {
      const form = await request.formData();
      const notes = JSON.parse((await env.CASES.get('admin-board')) || '[]');
      notes.unshift({ id: crypto.randomUUID(), title: String(form.get('title') || '').slice(0, 200),
        text: String(form.get('text') || '').slice(0, 4000), createdAt: new Date().toISOString(), done: false });
      await env.CASES.put('admin-board', JSON.stringify(notes));
      return redirect('/admin/board');
    }
    if (p === '/admin/board/toggle' && request.method === 'POST') {
      const form = await request.formData();
      const notes = JSON.parse((await env.CASES.get('admin-board')) || '[]');
      const n = notes.find(n => n.id === form.get('id'));
      if (n) { n.done = !n.done; n.doneAt = n.done ? new Date().toISOString() : null; await env.CASES.put('admin-board', JSON.stringify(notes)); }
      return redirect('/admin/board');
    }
    if (p === '/admin/board/del' && request.method === 'POST') {
      const form = await request.formData();
      const notes = JSON.parse((await env.CASES.get('admin-board')) || '[]');
      await env.CASES.put('admin-board', JSON.stringify(notes.filter(n => n.id !== form.get('id'))));
      return redirect('/admin/board');
    }
    if (p === '/admin/receipts/delete' && request.method === 'POST') {
      const form = await request.formData();
      const key = String(form.get('key') || '');
      if (key.startsWith('rcpt:')) await env.CASES.delete(key);
      return redirect('/admin/receipts');
    }
    if (p === '/admin/library' && request.method === 'GET') {
      return html(libraryView(await libList(env), url.searchParams.get('msg')));
    }
    if (p.startsWith('/admin/library/f/') && request.method === 'GET') {
      const key = 'lib:' + decodeURIComponent(p.slice('/admin/library/f/'.length));
      const data = await env.CASES.get(key, 'arrayBuffer');
      if (!data) return new Response('not found', { status: 404 });
      const name = libDisplayName(key);
      const type = name.toLowerCase().endsWith('.pdf') ? 'application/pdf'
        : /\.(png|jpg|jpeg)$/i.test(name) ? 'image/' + name.split('.').pop().toLowerCase().replace('jpg', 'jpeg')
        : 'application/octet-stream';
      return new Response(data, { headers: { 'Content-Type': type, 'Content-Disposition': `inline; filename="${name}"`, 'X-Robots-Tag': 'noindex' } });
    }
    if (p === '/admin/library/upload' && request.method === 'POST') {
      const form = await request.formData();
      const file = form.get('file');
      const cat = String(form.get('cat') || 'hoa-sonstiges');
      if (!file || typeof file === 'string' || !LIB_CATS.some(([c]) => c === cat)) return new Response('invalid', { status: 400 });
      const safe = file.name.replace(/[^\w.\-äöüÄÖÜß ]+/g, '_').slice(0, 120);
      await env.CASES.put(`lib:${cat}/${safe}`, await file.arrayBuffer());
      return redirect('/admin/library?msg=' + encodeURIComponent(safe + ' hochgeladen'));
    }
    if (p === '/admin/library/delete' && request.method === 'POST') {
      const form = await request.formData();
      const key = String(form.get('key') || '');
      if (key.startsWith('lib:')) await env.CASES.delete(key);
      return redirect('/admin/library');
    }
    if (p === '/admin/library/contact-add' && request.method === 'POST') {
      const form = await request.formData();
      const contacts = JSON.parse((await env.CASES.get('library-contacts')) || '[]');
      contacts.push({ name: String(form.get('name') || ''), role: String(form.get('role') || ''),
        email: String(form.get('email') || ''), phone: String(form.get('phone') || ''), notes: String(form.get('notes') || '') });
      await env.CASES.put('library-contacts', JSON.stringify(contacts));
      return redirect('/admin/contacts');
    }
    if (p === '/admin/library/contact-del' && request.method === 'POST') {
      const form = await request.formData();
      const contacts = JSON.parse((await env.CASES.get('library-contacts')) || '[]');
      contacts.splice(parseInt(form.get('i'), 10), 1);
      await env.CASES.put('library-contacts', JSON.stringify(contacts));
      return redirect('/admin/contacts');
    }
    if (p === '/admin/compliance' && request.method === 'POST') {
      const form = await request.formData();
      if (form.get('attest') !== 'yes') return new Response('owner attestation required', { status: 400, headers: SEC_HEADERS });
      const textField = (name, max = 500) => String(form.get(name) || '').trim().slice(0, max);
      const dateField = name => {
        const value = textField(name, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be an ISO date`);
        return value;
      };
      let config;
      try {
        config = {
          landlordNoticeAddress: textField('landlordNoticeAddress', 500),
          governingDocumentsVerifiedAt: dateField('governingDocumentsVerifiedAt'),
          approvalAuthorityCitation: textField('approvalAuthorityCitation', 1000),
          feeAuthorityCitation: textField('feeAuthorityCitation', 1000),
          airbnbFeeDisclosureVerifiedAt: dateField('airbnbFeeDisclosureVerifiedAt'),
          airbnbExternalFeeAuthorizationReference: textField('airbnbExternalFeeAuthorizationReference',1000),
          rulesVersion: textField('rulesVersion', 500),
          hoaESignAcceptedAt: dateField('hoaESignAcceptedAt'),
          privacySecurityReviewedAt: dateField('privacySecurityReviewedAt'),
          fairHousingReviewedAt: dateField('fairHousingReviewedAt'),
          floodDamageKnown: ['yes', 'no'].includes(textField('floodDamageKnown', 3)) ? textField('floodDamageKnown', 3) : '',
          floodClaimFiled: ['yes', 'no'].includes(textField('floodClaimFiled', 3)) ? textField('floodClaimFiled', 3) : '',
          floodAssistanceReceived: ['yes', 'no'].includes(textField('floodAssistanceReceived', 3)) ? textField('floodAssistanceReceived', 3) : '',
          craName: textField('craName', 300), craAddress: textField('craAddress', 500), craPhone: textField('craPhone', 100),
          savedAt: new Date().toISOString(), verifiedBy: env.ADMIN_USER || 'markus', policyVersion: COMPLIANCE_POLICY_VERSION,
          sourcePacket: { portalDocumentId: HOA_SOURCE_PACKET.portalDocumentId, sha256: HOA_SOURCE_PACKET.sha256 },
        };
      } catch (error) {
        return new Response(String(error.message || error), { status: 400, headers: SEC_HEADERS });
      }
      if (!config.landlordNoticeAddress || !config.approvalAuthorityCitation || !config.rulesVersion) {
        return new Response('required compliance fields are missing', { status: 400, headers: SEC_HEADERS });
      }
      await env.CASES.put('compliance-config', JSON.stringify(config));
      await env.CASES.delete('submit-live');
      return redirect('/admin/settings?msg=' + encodeURIComponent('Compliance-Angaben gespeichert; LIVE wurde vorsorglich deaktiviert und muss neu freigegeben werden'));
    }
    if (p === '/admin/case-classification' && request.method === 'POST') {
      const form = await request.formData();
      const cases = await loadCases(env);
      const c = cases.find(item => item.id === form.get('id'));
      if (!c) return new Response('case not found', { status: 404, headers: SEC_HEADERS });
      if (c.submission) return new Response('submitted cases are locked', { status: 409, headers: SEC_HEADERS });
      c.applicationType = form.get('applicationType') === 'renewal' ? 'renewal' : 'lease';
      c.sameLesseesConfirmed = c.applicationType === 'renewal' && form.get('sameLesseesConfirmed') === 'yes';
      delete c.aiReview;
      delete c.ownerApprovedAt;
      c.reviewHash = c.wizard ? await reviewDigest(c, c.wizard, true) : null;
      await saveCases(env, cases);
      return redirect('/admin/cases?msg=' + encodeURIComponent('Mietvorgang rechtlich eingeordnet; vorhandene Qualitätsprüfung wurde zurückgesetzt'));
    }
    if (p === '/admin/adverse-action' && request.method === 'POST') {
      const form = await request.formData();
      if (form.get('reportBased') !== 'yes' || form.get('fairHousingReviewed') !== 'yes') {
        return new Response('consumer-report and fair-housing attestations are required', { status: 400, headers: SEC_HEADERS });
      }
      const cases = await loadCases(env);
      const c = cases.find(item => item.id === form.get('id'));
      if (!c) return new Response('case not found', { status: 404, headers: SEC_HEADERS });
      try {
        const notice = adverseActionNotice({ date: new Date().toISOString().slice(0, 10), applicantName: c.guestName,
          property: 'Unit 405D, 6219 Palma Del Mar Blvd S, St. Petersburg, FL 33715',
          action: String(form.get('action') || ''), craName: form.get('craName'), craAddress: form.get('craAddress'), craPhone: form.get('craPhone') });
        c.adverseAction = { preparedAt: new Date().toISOString(), preparedBy: env.ADMIN_USER || 'markus', notice, delivered: false };
      } catch (error) {
        return new Response(String(error.message || error), { status: 400, headers: SEC_HEADERS });
      }
      await saveCases(env, cases);
      return redirect(`/admin/adverse-action?id=${encodeURIComponent(c.id)}&msg=${encodeURIComponent('Entwurf erstellt; nicht automatisch versandt')}`);
    }
    if (p === '/admin/submit' && request.method === 'POST') {
      const form = await request.formData();
      const cases = await loadCases(env);
      const c = cases.find(x => x.id === form.get('id'));
      const ownerSigOnFile = validateSignaturePng(await getEncryptedSecret(env, 'owner-signature-png'));
      if (!c) return new Response('case not found', { status: 404, headers: SEC_HEADERS });
      if (c.pathType === 'full' && c.screeningRoute !== 'paper') {
        return new Response(c.screeningRoute === 'online'
          ? 'Tenant Evaluation cases are completed in the official external portal and must not be emailed as a local paper package'
          : 'choose the official application route before preparing a local package',
        { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
      }
      if (!isGuestAccessibleCase(c) || c.reviewLockedAt) return new Response('reservation is canceled or delivery has already been claimed',{status:409,headers:SEC_HEADERS});
      if(env.CASE_STORE && (!c.preparedPackage || c.aiReview?.packageId!==c.preparedPackage.id || c.aiReview?.packageHash!==c.preparedPackage.packageHash)) return new Response('the exact document package must be prepared and reviewed before release',{status:409,headers:SEC_HEADERS});
      if (!isReadyForOwnerReview(c, ownerSigOnFile)) {
        return new Response('paperwork is not complete or was already submitted', { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
      }
      const ai = c.aiReview;
      if (!ai || ai.reviewHash !== c.reviewHash || ai.status !== 'green') {
        return new Response('OpenAI review is missing, stale, or not green', { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
      }
      if (env.CASE_STORE && ai.reviewContextHash!==await reviewContextHash(c,await getEncryptedSecret(env,'owner-signature-png'),await loadComplianceConfig(env))) return new Response('review inputs changed; run the review again',{status:409,headers:SEC_HEADERS});
      c.ownerReviewedDocuments = ['openai-ai-review'];
      const expectedReviewHash = await reviewDigest(c, c.wizard, true);
      const submittedReviewHash = String(form.get('reviewHash') || '');
      if (!submittedReviewHash || submittedReviewHash !== c.reviewHash || expectedReviewHash !== c.reviewHash) {
        return new Response(`review version changed; reopen and review all ${isAnnualRental(c) ? 'five' : 'four'} PDFs`, { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
      }
      const live = (await env.CASES.get('submit-live')) === 'yes';
      if (live) {
        const compliance = liveComplianceState(c, await loadComplianceConfig(env), env);
        if (!compliance.ok) return new Response(`live submission blocked by compliance policy ${compliance.policyVersion}: ${compliance.missing.join(', ')}`, { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
        const prerequisites = validateLiveSubmissionPrerequisites(c);
        if (!prerequisites.ok) return new Response(`live submission blocked: ${prerequisites.missing.join(', ')}`, { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
      }
      c.ownerApprovedAt = new Date().toISOString();
      c.ownerApprovedBy = env.ADMIN_USER || 'markus';
      c.ownerApprovedReviewHash = c.reviewHash;
      if (live) c.reviewLockedAt = c.ownerApprovedAt;
      const claimKey = `send-claim:${c.id}:${c.reviewHash}`;
      if (await env.CASES.get(claimKey)) return new Response('submission already in progress or completed', { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
      await env.CASES.put(claimKey, c.ownerApprovedAt, { expirationTtl: 600 });
      await saveCases(env, cases);
      const sent = await submitApprovedPackage(c, cases, env);
      if (!sent || !live) await env.CASES.delete(claimKey);
      else await env.CASES.put(claimKey, c.submission.sentAt, { expirationTtl: 604800 });
      const message = sent ? (live ? `${isAnnualRental(c) ? 'Fünf' : 'Vier'}-Dokumente-Paket live an die Verwaltung versandt` : 'Testpaket nur an Owner versandt; Live-Versand bleibt offen') : 'Versand nicht bestätigt — vor einem neuen Versuch Vorgang und Gesendet-Ordner prüfen';
      return redirect('/admin/cases?msg=' + encodeURIComponent(message));
    }
    if (p === '/admin/submit-live' && request.method === 'POST') {
      const form = await request.formData();
      if (form.get('mode') === 'yes') {
        if (String(form.get('confirm') || '') !== 'LIVE') return new Response('type LIVE to enable external delivery', { status: 400, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
        const compliance = liveComplianceState({ pathType: 'full', nights: 30, applicationType: 'lease' }, await loadComplianceConfig(env), env);
        if (!compliance.ok) return new Response(`LIVE blocked by compliance policy ${compliance.policyVersion}: ${compliance.missing.join(', ')}`, { status: 409, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
        await env.CASES.put('submit-live', 'yes');
        await env.CASES.put('submit-live-audit', JSON.stringify({ at: new Date().toISOString(), by: env.ADMIN_USER || 'markus' }));
      } else await env.CASES.delete('submit-live');
      return redirect('/admin/settings');
    }
    if (p === '/admin/signature' && request.method === 'GET') return redirect('/admin/settings');
    if (p === '/admin/signature' && request.method === 'POST') {
      const dataUrl = await request.text();
      const m = dataUrl.match(/^data:image\/png;base64,(.+)$/s);
      if (!m || !validateSignaturePng(m[1])) return new Response('invalid signature PNG', { status: 400, headers: { ...SEC_HEADERS, 'Cache-Control': 'private, no-store' } });
      await putEncryptedSecret(env, 'owner-signature-png', m[1]);
      return new Response('ok');
    }
    if (p === '/admin/create' && request.method === 'POST') {
      const form = await request.formData();
      const input = {
        guestName: String(form.get('guestName') || '').trim(),
        reservationCode: String(form.get('reservationCode') || '').trim().toUpperCase(),
        checkIn: String(form.get('checkIn') || ''), checkOut: String(form.get('checkOut') || ''),
        adults: Number(form.get('adults')),
      };
      const validation = validateCaseInput(input);
      if (!validation.ok) return new Response(validation.error, { status: 400, headers: SEC_HEADERS });
      if (validation.nights >= 30 && input.adults > 2) return new Response('rentals with more than two adults require a separate manual HOA application package', { status: 400, headers: SEC_HEADERS });
      const cases = await loadCases(env);
      if (input.reservationCode && cases.some(x => String(x.reservationCode || '').toUpperCase() === input.reservationCode)) {
        return new Response('reservation code already exists', { status: 409, headers: SEC_HEADERS });
      }
      const c = newCase({ ...input, nights: validation.nights });
      cases.push(c);
      await saveCases(env, cases);
      return redirect('/admin/cases?msg=' + encodeURIComponent('angelegt — Magic-Link: /v/' + c.token));
    }
    if (p === '/admin/toggle' && request.method === 'POST') {
      const form = await request.formData();
      const cases = await loadCases(env);
      const c = cases.find(c => c.id === form.get('id'));
      const s = c && c.steps.find(s => s.id === form.get('step'));
      if (s) {
        if(['fee_sent','screening_complete','board_approved'].includes(s.id)) return new Response('Open the HOA email source and record verified evidence instead of using a status toggle.',{status:409,headers:{...SEC_HEADERS,'Cache-Control':'private, no-store'}});
        if(!s.done&&s.id==='checkin_released'&&(!c.steps.some(step=>step.id==='board_approved'&&step.done)||hoaEvidenceState(c).exception||hoaEvidenceState(c).tasks.length)) return new Response('Approval or follow-up verification is outstanding.',{status:409,headers:SEC_HEADERS});
        s.done = !s.done; s.date = s.done ? new Date().toISOString() : null;
        if (s.id === 'board_approved' && s.done) delete c.approvalCandidate;
        await saveCases(env, cases);
      }
      return redirect('/admin/cases');
    }
    if (p === '/admin/delete' && request.method === 'POST') {
      const form = await request.formData();
      const cases=await loadCases(env);
      await saveCases(env, inheritCaseSnapshot(cases,cases.filter(c => c.id !== form.get('id'))));
      return redirect('/admin/cases');
    }
  }
  return html(page('Not found', '<h1>Page not found</h1>', ''), 404);
}
