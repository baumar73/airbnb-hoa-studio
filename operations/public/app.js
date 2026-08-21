const statusOptions = [
  ["new_booking", "Neue Buchung"],
  ["airbnb_initial_message_due", "Airbnb-Erstnachricht fehlt"],
  ["waiting_for_tenant_documents", "Warten auf Unterlagen"],
  ["reminder_due", "Reminder faellig"],
  ["firm_deadline_sent", "Harte Frist gesetzt"],
  ["ready_for_hoa_submission", "Bereit fuer HOA"],
  ["submitted_to_hoa", "Bei HOA eingereicht"],
  ["waiting_for_board_approval", "Warten auf Board Approval"],
  ["approved", "Genehmigt"],
  ["cancellation_review", "Storno-Pruefung"],
];

const checklistLabels = {
  airbnbInitialMessage: "Airbnb-Erstnachricht gesendet",
  guestAcknowledged: "Gast hat HOA-Prozess bestaetigt",
  packetSent: "Dokumentpaket gesendet",
  leaseApplication: "Lease Application erhalten",
  backgroundAuthorization: "Background Authorization erhalten",
  shortTermLeaseTenantSigned: "Short-Term Lease vom Tenant signiert",
  shortTermLeaseOwnerSigned: "Short-Term Lease vom Owner signiert",
  rulesSent: "Rules and Regulations gesendet",
  photoIds: "Photo IDs / supporting documents erhalten",
  feeTracked: "USD 100 Fee / Check verfolgt",
  submittedToHoa: "Unterlagen an HOA eingereicht",
  boardApproval: "Board Approval erhalten",
};

const documentStatusOptions = [
  ["missing", "fehlt"],
  ["requested", "angefordert"],
  ["received", "eingegangen"],
  ["incomplete", "unvollstaendig"],
  ["signed", "signiert"],
  ["submitted", "eingereicht"],
  ["approved", "genehmigt"],
  ["not_required", "nicht noetig"],
];

const documentStatusDefinitions = [
  ["leaseApplication", "Lease Application", "Vom Mieter ausgefuellt und unterschrieben."],
  ["backgroundAuthorization", "Background Authorization", "Fuer jeden erwachsenen Bewohner erforderlich."],
  ["shortTermLeaseTenantSigned", "Short-Term Lease Tenant", "Vom Mieter signiert."],
  ["shortTermLeaseOwnerSigned", "Short-Term Lease Owner", "Von Owner/Owner signiert."],
  ["rulesSent", "Rules and Regulations", "An Mieter gesendet bzw. bestaetigt."],
  ["photoIds", "Photo IDs / Supporting Docs", "Ausweise und weitere HOA-Nachweise."],
  ["feeTracked", "USD 100 HOA Fee", "Check oder Money Order fuer die HOA verfolgt."],
  ["submittedToHoa", "Einreichung an HOA", "Komplettes Paket an Verwaltung/HOA gesendet."],
  ["boardApproval", "Board Approval", "Approval-Beleg muss vorhanden sein."],
];

const completedDocumentStatuses = new Set(["received", "signed", "submitted", "approved", "not_required"]);

const templateLabels = {
  listingDisclosure: "Listing / House Rules Hinweis",
  airbnbInitialMessage: "Airbnb-Erstnachricht",
  airbnbReminder: "Reminder an Gast",
  firmDeadline: "Harte Frist",
  submittedToHoa: "HOA eingereicht",
  airbnbSupportReview: "Airbnb Support",
  cancellationDecisionNote: "Interne Storno-Notiz",
};

const maintenanceStatusOptions = [
  ["open", "offen"],
  ["planned", "Termin geplant"],
  ["ordered", "Ersatz bestellt"],
  ["done", "erledigt"],
  ["cancelled", "entfaellt"],
];

const maintenancePriorityOptions = [
  ["high", "hoch"],
  ["medium", "mittel"],
  ["low", "niedrig"],
];

const paymentStatusOptions = [
  ["needs_airbnb_review", "Airbnb pruefen"],
  ["expected", "Auszahlung erwartet"],
  ["paid", "bezahlt"],
  ["partial", "teilweise bezahlt"],
  ["cancelled", "storniert"],
  ["disputed", "Problem"],
];

const telephonyStatusOptions = [
  ["planned", "geplant"],
  ["called", "angerufen"],
  ["reached", "erreicht"],
  ["left_message", "Nachricht hinterlassen"],
  ["failed", "fehlgeschlagen"],
  ["cancelled", "entfaellt"],
];

let appState;
let calendar;
let dailyCheck;
let integrationStatus;
let displayInfo;
let operationsManifest;
let today;
let selectedCaseId;

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dateOnly(value) {
  if (!value) return null;
  return new Date(`${value}T00:00:00`);
}

function daysBetween(a, b) {
  const left = dateOnly(a);
  const right = dateOnly(b);
  if (!left || !right) return null;
  return Math.round((right - left) / 86400000);
}

function addDays(value, count) {
  const date = dateOnly(value);
  if (!date) return "";
  date.setDate(date.getDate() + count);
  return date.toISOString().slice(0, 10);
}

function slugify(value) {
  return String(value || "case")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "case";
}

function stableKey(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96) || "item";
}

function uniqueCaseId(base) {
  let id = base;
  let index = 2;
  while (appState.cases.some((caseItem) => caseItem.id === id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function firstName(caseItem) {
  return caseItem.guestName.split(/[ /]/).filter(Boolean)[0] || "there";
}

function focusGuestLabel(caseItem) {
  return caseItem.guestName.split(/[\\/]/).map((part) => part.trim()).filter(Boolean)[0] || firstName(caseItem);
}

function statusLabel(value) {
  return statusOptions.find(([id]) => id === value)?.[1] || value;
}

function gmailReplyLabel(value) {
  const labels = {
    approved_thread_found: "Approval gefunden",
    documents_missing_after_reply: "Antwort, Unterlagen fehlen",
    no_reply_after_packet: "Keine Unterlagen seit Paket",
    reply_needs_review: "Antwort pruefen",
    documents_received: "Unterlagen eingegangen",
    hoa_reply_pending: "HOA-Antwort offen",
  };
  return labels[value] || "Nicht geprueft";
}

function suggestionStatusLabel(value) {
  const labels = {
    pending: "offen",
    accepted: "uebernommen",
    rejected: "abgelehnt",
  };
  return labels[value] || value || "offen";
}

function suggestionConfidenceLabel(value) {
  const labels = {
    high: "hoch",
    medium: "mittel",
    low: "niedrig",
  };
  return labels[value] || value || "unbekannt";
}

function documentStatusLabel(value) {
  return documentStatusOptions.find(([id]) => id === value)?.[1] || value || "fehlt";
}

function documentStatusClass(value) {
  if (["approved", "submitted", "signed", "received", "not_required"].includes(value)) return "green";
  if (value === "incomplete") return "red";
  if (value === "requested") return "amber";
  return "red";
}

function inboxStatusLabel(value) {
  const labels = {
    new: "neu",
    reviewed: "geprueft",
    applied: "erledigt",
    ignored: "ignoriert",
  };
  return labels[value] || value || "neu";
}

function inboxPriorityLabel(value) {
  const labels = {
    high: "hoch",
    medium: "mittel",
    low: "niedrig",
  };
  return labels[value] || value || "mittel";
}

function communicationChannelLabel(value) {
  const labels = {
    gmail: "Gmail",
    airbnb: "Airbnb",
    whatsapp: "WhatsApp",
    imessage: "iMessage",
    sms: "SMS",
    phone: "Telefon",
    hoa: "HOA",
    turno: "Turno",
    other: "Sonstiges",
  };
  return labels[value] || value || "Kanal";
}

function communicationDirectionLabel(value) {
  const labels = {
    inbound: "eingehend",
    outbound: "ausgehend",
    internal: "intern",
    unknown: "unbekannt",
  };
  return labels[value] || value || "unbekannt";
}

function reservationType(event) {
  if (event.summary === "Reserved") return "reserved";
  return "blocked";
}

function matchingCase(event) {
  return appState.cases.find((caseItem) => caseItem.calendarUid === event.uid || (caseItem.start === event.start && caseItem.end === event.end));
}

function completion(caseItem) {
  const values = Object.values(caseItem.checklist || {});
  if (!values.length) return 0;
  return Math.round((values.filter(Boolean).length / values.length) * 100);
}

function risk(caseItem) {
  if (caseItem.status === "approved") return { level: "green", text: "Approved" };
  if (caseItem.status === "cancellation_review") return { level: "red", text: "Storno pruefen" };
  if (caseItem.status === "reminder_due") return { level: "amber", text: "Reminder faellig" };
  if (caseItem.checkInLocked) return { level: "red", text: "Check-in gesperrt" };
  return { level: "blue", text: statusLabel(caseItem.status) };
}

function calendarSummaryLabel(value) {
  const labels = {
    Reserved: "Reserviert",
    Unavailable: "Blockiert",
  };
  return labels[value] || value || "-";
}

function deriveAlerts(caseItem) {
  const alerts = [];
  if (!caseItem.checklist?.boardApproval) alerts.push({ level: "red", text: "Kein Board Approval" });
  if (caseItem.checkInLocked) alerts.push({ level: "red", text: "Check-in gesperrt" });
  if (caseItem.status === "reminder_due") alerts.push({ level: "amber", text: "Reminder jetzt senden" });
  if (caseItem.cancellationReviewAt && daysBetween(today, caseItem.cancellationReviewAt) <= 4 && !caseItem.checklist?.submittedToHoa) {
    alerts.push({ level: "amber", text: `Cancellation Review am ${formatDate(caseItem.cancellationReviewAt)}` });
  }
  if (caseItem.decisionBy && daysBetween(today, caseItem.decisionBy) <= 7 && !caseItem.checklist?.submittedToHoa) {
    alerts.push({ level: "red", text: `Entscheidung bis ${formatDate(caseItem.decisionBy)}` });
  }
  return alerts;
}

function nextAction(caseItem) {
  if (!caseItem.checklist?.packetSent) return ["Dokumentpaket senden", "Lease Application, Background Authorization, Short-Term Lease und Rules an den Gast senden."];
  if (caseItem.status === "reminder_due") return ["Reminder senden", "Gmail-Entwurf pruefen/senden und parallel eine kurze Airbnb-Nachricht schicken."];
  if (!caseItem.checklist?.leaseApplication || !caseItem.checklist?.backgroundAuthorization || !caseItem.checklist?.photoIds) {
    return ["Ruecklauf abwarten / nachfassen", "Unterlagen sind noch nicht vollstaendig. Check-in bleibt gesperrt."];
  }
  if (!caseItem.checklist?.shortTermLeaseOwnerSigned) return ["Owner-Signatur ergaenzen", "HOA akzeptiert den Lease nur, wenn Tenant und Owner signiert haben."];
  if (!caseItem.checklist?.submittedToHoa) return ["An HOA einreichen", "Vollstaendiges Paket an Example Property Management / Tenant Evaluation einreichen."];
  if (!caseItem.checklist?.boardApproval) return ["Board Approval abwarten", "Keine Check-in-Daten senden, bis die Approval-Mail vorliegt."];
  return ["Freigegeben", "HOA Approval liegt vor. Normale Check-in-Kommunikation ist erlaubt."];
}

function missingChecklistItems(caseItem) {
  const checklist = caseItem.checklist || {};
  return Object.entries(checklistLabels)
    .filter(([key]) => !checklist[key])
    .map(([key, label]) => ({ key, label }));
}

function requiredDocumentKeys() {
  return [
    "leaseApplication",
    "backgroundAuthorization",
    "shortTermLeaseTenantSigned",
    "shortTermLeaseOwnerSigned",
    "rulesSent",
    "photoIds",
    "feeTracked",
  ];
}

function requiredDocumentsReady(caseItem) {
  const checklist = caseItem.checklist || {};
  return requiredDocumentKeys().every((key) => Boolean(checklist[key]));
}

function relativeDateText(value) {
  if (!value) return "-";
  const diff = daysBetween(today, value);
  if (diff === null) return formatDate(value);
  if (diff < 0) return `${formatDate(value)} · ueberfaellig`;
  if (diff === 0) return `${formatDate(value)} · heute`;
  if (diff === 1) return `${formatDate(value)} · morgen`;
  return `${formatDate(value)} · in ${diff} Tagen`;
}

function actionTemplateKey(caseItem) {
  if (!caseItem.checklist?.packetSent || caseItem.status === "airbnb_initial_message_due") return "airbnbInitialMessage";
  if (caseItem.status === "cancellation_review") return "airbnbSupportReview";
  if (caseItem.status === "firm_deadline_sent") return "firmDeadline";
  if (caseItem.status === "submitted_to_hoa" || caseItem.status === "waiting_for_board_approval") return "submittedToHoa";
  if (caseItem.status === "reminder_due") return "airbnbReminder";
  if (caseItem.decisionBy && daysBetween(today, caseItem.decisionBy) <= 3 && !caseItem.checklist?.submittedToHoa) return "airbnbSupportReview";
  return "airbnbReminder";
}

function actionCopyLabel(caseItem) {
  const labels = {
    airbnbInitialMessage: "Erstnachricht kopieren",
    airbnbReminder: "Reminder kopieren",
    firmDeadline: "Fristtext kopieren",
    submittedToHoa: "HOA-Update kopieren",
    airbnbSupportReview: "Support-Text kopieren",
  };
  return labels[actionTemplateKey(caseItem)] || "Text kopieren";
}

function priorityCase() {
  const items = dailyCheck?.items || [];
  const actionable = items.find((item) => {
    if (!item.caseId || ["payment", "cleaning", "maintenance"].includes(item.kind)) return false;
    return appState.cases.some((caseItem) => caseItem.id === item.caseId);
  });
  if (actionable) return appState.cases.find((caseItem) => caseItem.id === actionable.caseId);
  return appState.cases.find((caseItem) => caseItem.status !== "approved") || appState.cases[0];
}

function primaryDailyItem(caseItem) {
  return (dailyCheck?.items || []).find((item) => item.caseId === caseItem.id && !["payment", "cleaning", "maintenance"].includes(item.kind))
    || (dailyCheck?.items || []).find((item) => item.caseId === caseItem.id);
}

function guardrailForCase(caseItem) {
  if (caseItem.checklist?.boardApproval) {
    return {
      level: "green",
      title: "Check-in darf vorbereitet werden",
      detail: "Board Approval ist dokumentiert. Normale Check-in-Kommunikation ist erlaubt.",
      pill: "Freigegeben",
    };
  }
  if (caseItem.checkInLocked) {
    return {
      level: "red",
      title: "Check-in bleibt gesperrt",
      detail: "Keine Zugangsdaten senden, bis Board Approval mit Beleg eingetragen ist.",
      pill: "Gesperrt",
    };
  }
  return {
    level: "red",
    title: "Pruefen: Check-in nicht gesperrt",
    detail: "Board Approval fehlt. Der Fall sollte gesperrt bleiben.",
    pill: "Risiko",
  };
}

function setMetricLevel(id, level) {
  const target = $(id)?.closest(".metric");
  if (!target) return;
  target.className = `metric ${level || ""}`.trim();
}

function flashButtonText(buttonId, text, fallback, delay = 1200) {
  const button = $(buttonId);
  if (!button) return;
  button.textContent = text;
  setTimeout(() => {
    button.textContent = fallback;
  }, delay);
}

async function copyCaseTemplate(caseItem, buttonId) {
  const button = $(buttonId);
  const original = button?.textContent || "Text kopieren";
  const key = actionTemplateKey(caseItem);
  const text = fillTemplate(appState.templates[key], caseItem);
  try {
    await copyTextToClipboard(text);
    flashButtonText(buttonId, "Kopiert", original);
  } catch {
    flashButtonText(buttonId, "Kopieren blockiert", original, 1600);
  }
}

function fillTemplate(template, caseItem) {
  const property = appState.property || {};
  return template
    .replaceAll("{{firstName}}", firstName(caseItem))
    .replaceAll("{{start}}", formatDate(caseItem.start))
    .replaceAll("{{end}}", formatDate(caseItem.end))
    .replaceAll("{{deadlineDocuments}}", formatDate(caseItem.deadlineDocuments))
    .replaceAll("{{cancellationReviewAt}}", formatDate(caseItem.cancellationReviewAt))
    .replaceAll("{{decisionBy}}", formatDate(caseItem.decisionBy))
    .replaceAll("{{reservationCode}}", caseItem.reservationCode || "unknown")
    .replaceAll("{{guestName}}", caseItem.guestName || "guest")
    .replaceAll("{{hoaEmail}}", property.hoaEmail || "contact005@example.test")
    .replaceAll("{{hoaAddress}}", property.hoaAddress || "")
    .replaceAll("{{unit}}", property.unit || "Unit 405D")
    .replaceAll("{{fee}}", property.fee || "USD 100 check or money order payable to Example Condominium");
}

function ensureAISuggestions() {
  if (!Array.isArray(appState.aiSuggestions)) appState.aiSuggestions = [];
  return appState.aiSuggestions;
}

function ensureInboxItems() {
  if (!Array.isArray(appState.inboxItems)) appState.inboxItems = [];
  return appState.inboxItems;
}

function defaultDocumentStatus(caseItem, key) {
  const checklist = caseItem.checklist || {};
  if (!checklist[key]) return checklist.packetSent ? "requested" : "missing";
  if (key === "boardApproval") return "approved";
  if (key === "submittedToHoa") return "submitted";
  if (key === "shortTermLeaseTenantSigned" || key === "shortTermLeaseOwnerSigned") return "signed";
  return "received";
}

function ensureDocumentStatus(caseItem) {
  if (!caseItem.documentStatus || typeof caseItem.documentStatus !== "object" || Array.isArray(caseItem.documentStatus)) {
    caseItem.documentStatus = {};
  }
  for (const [key] of documentStatusDefinitions) {
    if (!caseItem.documentStatus[key] || typeof caseItem.documentStatus[key] !== "object") {
      caseItem.documentStatus[key] = {
        status: defaultDocumentStatus(caseItem, key),
        updatedAt: caseItem.documentPacketSentAt || today,
      };
    }
    if (!caseItem.documentStatus[key].status) {
      caseItem.documentStatus[key].status = defaultDocumentStatus(caseItem, key);
    }
  }
  return caseItem.documentStatus;
}

function setChecklistFromDocumentStatus(caseItem, key, status) {
  caseItem.checklist = caseItem.checklist || {};
  caseItem.checklist[key] = completedDocumentStatuses.has(status);
  if (key === "boardApproval") {
    if (status === "approved") {
      caseItem.status = "approved";
      caseItem.checkInLocked = false;
    } else {
      caseItem.status = caseItem.status === "approved" ? "waiting_for_board_approval" : caseItem.status;
      caseItem.checkInLocked = true;
      delete caseItem.boardApprovalEvidence;
    }
  }
}

function ensureMaintenanceItems() {
  if (!Array.isArray(appState.maintenanceItems)) appState.maintenanceItems = [];
  return appState.maintenanceItems;
}

function ensureCleaning() {
  if (!appState.cleaning || typeof appState.cleaning !== "object") {
    appState.cleaning = { provider: "Turno", projects: [] };
  }
  if (!Array.isArray(appState.cleaning.projects)) appState.cleaning.projects = [];
  return appState.cleaning;
}

function cleaningProjects() {
  return ensureCleaning().projects;
}

function ensurePayments() {
  if (!appState.payments || typeof appState.payments !== "object") {
    appState.payments = {
      source: "Airbnb account",
      lastAirbnbReviewAt: "",
      notes: "Payments are stored per tenant/case.",
      items: [],
    };
  }
  if (!Array.isArray(appState.payments.items)) appState.payments.items = [];
  return appState.payments;
}

function paymentItems() {
  return ensurePayments().items;
}

function paymentStatusLabel(value) {
  return paymentStatusOptions.find(([id]) => id === value)?.[1] || value || "Airbnb pruefen";
}

function paymentForCase(caseItem) {
  if (!caseItem) return null;
  return paymentItems().find((payment) => payment.caseId === caseItem.id || (caseItem.reservationCode && payment.reservationCode === caseItem.reservationCode));
}

function paymentsNeedingReview() {
  return paymentItems().filter((payment) => ["needs_airbnb_review", "partial", "disputed"].includes(payment.status));
}

function paymentRisk(payment) {
  if (!payment) return { level: "amber", text: "fehlt" };
  if (payment.status === "paid") return { level: "green", text: "bezahlt" };
  if (payment.status === "cancelled") return { level: "blue", text: "storniert" };
  if (payment.status === "expected") {
    if (payment.expectedPayoutDate && daysBetween(today, payment.expectedPayoutDate) < 0 && !payment.receivedPayout) {
      return { level: "amber", text: "ueberfaellig" };
    }
    return { level: "blue", text: "erwartet" };
  }
  if (payment.status === "partial" || payment.status === "disputed") return { level: "red", text: "Problem" };
  return { level: "amber", text: "Airbnb pruefen" };
}

function integrationStatusText(value) {
  const labels = {
    ok: "bereit",
    warn: "pruefen",
    error: "blockiert",
  };
  return labels[value] || value || "unbekannt";
}

function integrationGeneratedText(value) {
  if (!value) return "Noch nicht geprueft";
  return `Stand ${formatDate(String(value).slice(0, 10))} ${String(value).slice(11, 16)} UTC`;
}

function paymentIdForCase(caseItem) {
  return `payment-${caseItem.id}`;
}

function createPaymentForCase(caseItem) {
  return {
    id: paymentIdForCase(caseItem),
    caseId: caseItem.id,
    source: "airbnb",
    reservationCode: caseItem.reservationCode || "",
    guestName: caseItem.guestName,
    stayStart: caseItem.start,
    stayEnd: caseItem.end,
    status: "needs_airbnb_review",
    currency: "USD",
    expectedPayout: "",
    expectedPayoutDate: "",
    receivedPayout: "",
    receivedAt: "",
    airbnbTransactionId: "",
    cleaningCostAmount: "",
    cleaningProjectId: "",
    hoaFee: "Tenant-paid USD 100 application/background-check fee; not a host payout.",
    evidence: ["Created from local Airbnb HOA case"],
    notes: "Airbnb payout details need review.",
    lastCheckedAt: "",
  };
}

function ensurePaymentsForCases() {
  const items = paymentItems();
  for (const caseItem of appState.cases || []) {
    let payment = paymentForCase(caseItem);
    if (!payment) {
      payment = createPaymentForCase(caseItem);
      items.push(payment);
    } else {
      payment.caseId = caseItem.id;
      payment.guestName = payment.guestName || caseItem.guestName;
      payment.reservationCode = payment.reservationCode || caseItem.reservationCode || "";
      payment.stayStart = payment.stayStart || caseItem.start;
      payment.stayEnd = payment.stayEnd || caseItem.end;
      payment.currency = payment.currency || "USD";
      payment.status = payment.status || "needs_airbnb_review";
    }
  }
}

function defaultTelephony() {
  return {
    provider: "Google Fi",
    primaryUse: "USA-Anrufe aus Panama ueber WLAN",
    webCallsUrl: "https://messages.google.com/web",
    androidDialIntent: "tel:",
    guardrail: "Keine automatischen Anrufe; die App bereitet Nummer und Notiz vor, Owner bestaetigt im Google-Fi- oder Telefon-Dialer.",
    wifiCallingRule: "In Panama Flugmodus aktivieren, WLAN wieder einschalten, dann Google Fi ueber WLAN nutzen.",
    lastUpdatedAt: today || "",
    contacts: [
      {
        id: "famous-tate-largo-clearwater",
        label: "Famous Tate Largo / Clearwater",
        phone: "+17272390001",
        context: "Geschirrspueler Ersatz/Service",
      },
      {
        id: "famous-tate-main",
        label: "Famous Tate Hauptnummer",
        phone: "+18008516238",
        context: "Fallback fuer Appliance Quote",
      },
      {
        id: "bay-area-appliance",
        label: "Bay Area Appliance",
        phone: "+17274473048",
        context: "Lokaler Installations-/Service-Backup",
      },
      {
        id: "big-sam-appliance-repair",
        label: "Big Sam Appliance Repair",
        phone: "+17278101766",
        context: "Lokaler Reparatur-/Installations-Backup",
      },
    ],
    callLog: [],
  };
}

function ensureTelephony() {
  const defaults = defaultTelephony();
  if (!appState.telephony || typeof appState.telephony !== "object" || Array.isArray(appState.telephony)) {
    appState.telephony = defaults;
    return appState.telephony;
  }
  appState.telephony.provider = appState.telephony.provider || defaults.provider;
  appState.telephony.primaryUse = appState.telephony.primaryUse || defaults.primaryUse;
  appState.telephony.webCallsUrl = appState.telephony.webCallsUrl || defaults.webCallsUrl;
  appState.telephony.androidDialIntent = appState.telephony.androidDialIntent || defaults.androidDialIntent;
  appState.telephony.guardrail = appState.telephony.guardrail || defaults.guardrail;
  appState.telephony.wifiCallingRule = appState.telephony.wifiCallingRule || defaults.wifiCallingRule;
  if (!Array.isArray(appState.telephony.contacts) || !appState.telephony.contacts.length) {
    appState.telephony.contacts = defaults.contacts;
  }
  if (!Array.isArray(appState.telephony.callLog)) appState.telephony.callLog = [];
  return appState.telephony;
}

function telephonyContacts() {
  return ensureTelephony().contacts;
}

function telephonyCallLog() {
  return ensureTelephony().callLog;
}

function normalizePhoneNumber(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (raw.startsWith("+")) return `+${digits}`;
  return `+${digits}`;
}

function formatPhoneDisplay(value) {
  const normalized = normalizePhoneNumber(value);
  if (/^\+1\d{10}$/.test(normalized)) {
    const digits = normalized.slice(2);
    return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return normalized || value || "-";
}

function telephonyStatusLabel(value) {
  return telephonyStatusOptions.find(([id]) => id === value)?.[1] || value || "geplant";
}

function telephonyStatusLevel(value) {
  if (value === "reached" || value === "called") return "green";
  if (value === "failed") return "red";
  if (value === "planned") return "amber";
  return "blue";
}

function openTelephonyCalls() {
  return telephonyCallLog().filter((call) => ["planned", "failed", "left_message"].includes(call.status || "planned"));
}

function telephonyCallId(contactLabel, phone, date) {
  const base = `call-${stableKey(contactLabel || phone)}-${date || today}`;
  let id = base;
  let index = 2;
  while (telephonyCallLog().some((call) => call.id === id)) {
    id = `${base}-${index}`;
    index += 1;
  }
  return id;
}

function selectedTelephonyContact() {
  const value = $("telephonyContact")?.value || "";
  return telephonyContacts().find((contact) => contact.id === value) || null;
}

function cleaningProjectDate(project) {
  return project.date || String(project.scheduledStart || "").slice(0, 10);
}

function cleaningStatusLabel(value) {
  const labels = {
    scheduled: "geplant",
    accepted: "angenommen",
    started: "gestartet",
    completed: "abgeschlossen",
    paid: "bezahlt",
    problem: "Problem",
    cancelled: "entfaellt",
  };
  return labels[value] || value || "unbekannt";
}

function cleaningRisk(project) {
  if (project.status === "completed" || project.status === "paid") return { level: "green", text: "fertig" };
  if (project.status === "problem") return { level: "red", text: "Problem" };
  if (project.status === "started") return { level: "amber", text: "laeuft" };
  if (project.status === "accepted" || project.status === "scheduled") return { level: "blue", text: "geplant" };
  return { level: "blue", text: cleaningStatusLabel(project.status) };
}

function cleaningProjectForCheckout(checkoutDate) {
  if (!checkoutDate) return null;
  return cleaningProjects().find((project) => {
    if (project.status === "cancelled") return false;
    const projectDate = cleaningProjectDate(project);
    const diff = daysBetween(checkoutDate, projectDate);
    return diff !== null && diff >= 0 && diff <= 2;
  });
}

function nextCleaningNeed() {
  const candidates = appState.cases
    .filter((caseItem) => caseItem.end && caseItem.status !== "cancelled" && caseItem.status !== "cancellation_review" && daysBetween(today, caseItem.end) >= 0)
    .sort((left, right) => left.end.localeCompare(right.end));
  for (const caseItem of candidates) {
    const project = cleaningProjectForCheckout(caseItem.end);
    if (!project) {
      return { caseItem, project: null, dueDate: caseItem.end, status: "missing" };
    }
    return { caseItem, project, dueDate: cleaningProjectDate(project), status: project.status };
  }
  return null;
}

function maintenanceStatusLabel(value) {
  return maintenanceStatusOptions.find(([id]) => id === value)?.[1] || value || "offen";
}

function maintenancePriorityLabel(value) {
  return maintenancePriorityOptions.find(([id]) => id === value)?.[1] || value || "mittel";
}

function activeMaintenanceItems() {
  return ensureMaintenanceItems().filter((item) => !["done", "cancelled"].includes(item.status));
}

function maintenanceRisk(item) {
  if (item.status === "done") return { level: "green", text: "erledigt" };
  if (item.status === "cancelled") return { level: "blue", text: "entfaellt" };
  if (item.dueDate && daysBetween(today, item.dueDate) < 0) return { level: "red", text: "ueberfaellig" };
  if (item.priority === "high") return { level: "red", text: "hoch" };
  if (item.status === "ordered") return { level: "blue", text: "bestellt" };
  if (item.status === "planned") return { level: "amber", text: "geplant" };
  return { level: "amber", text: maintenancePriorityLabel(item.priority) };
}

function sortedMaintenanceItems() {
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const statusOrder = { open: 0, planned: 1, ordered: 2, done: 3, cancelled: 4 };
  return [...ensureMaintenanceItems()].sort((left, right) => {
    const leftActive = ["done", "cancelled"].includes(left.status) ? 1 : 0;
    const rightActive = ["done", "cancelled"].includes(right.status) ? 1 : 0;
    if (leftActive !== rightActive) return leftActive - rightActive;
    const leftDue = left.dueDate || "9999-12-31";
    const rightDue = right.dueDate || "9999-12-31";
    if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
    const leftPriority = priorityOrder[left.priority] ?? 9;
    const rightPriority = priorityOrder[right.priority] ?? 9;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return (statusOrder[left.status] ?? 9) - (statusOrder[right.status] ?? 9);
  });
}

function procurementLabel(value) {
  const labels = {
    replacement_appliance: "Ersatzgeraet",
    dishwasher: "Geschirrspueler",
    under_counter_beneath_kitchen_countertop: "Unterbau unter Kuechenplatte",
    "weekdays_after_16:00": "werktags ab 16:00 Uhr",
    needs_vendor_quote: "Angebot/Haendler pruefen",
    needs_management_confirmation: "Rueckfrage an Verwaltung offen",
    ordered: "bestellt",
    scheduled: "Termin geplant",
    completed: "abgeschlossen",
  };
  return labels[value] || value || "-";
}

function renderHoaComplianceDetails(compliance) {
  if (!compliance || !Object.keys(compliance).length) return "";
  const knownRules = Array.isArray(compliance.knownRules) ? compliance.knownRules : [];
  const notFound = Array.isArray(compliance.notFoundInRules) ? compliance.notFoundInRules : [];
  const questions = Array.isArray(compliance.questionsForManagement) ? compliance.questionsForManagement : [];

  return `
    <div class="maintenance-hoa-compliance">
      <h4>HOA-Regeln & Rueckfrage</h4>
      <p><strong>Status:</strong> ${escapeHtml(procurementLabel(compliance.status))}</p>
      ${compliance.operatingAssumption ? `<p>${escapeHtml(compliance.operatingAssumption)}</p>` : ""}
      ${knownRules.length ? `<details open><summary>Gefundene Regeln</summary><ul>${knownRules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul></details>` : ""}
      ${notFound.length ? `<details><summary>Nicht konkret gefunden</summary><ul>${notFound.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul></details>` : ""}
      ${questions.length ? `<details open><summary>Fragen an Verwaltung</summary><ul>${questions.map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ul></details>` : ""}
    </div>
  `;
}

function renderExistingAppliance(appliance) {
  if (!appliance || !Object.keys(appliance).length) return "";
  const photos = Array.isArray(appliance.photoEvidence) ? appliance.photoEvidence : [];
  const facts = [
    ["Marke", appliance.brand],
    ["Modell", appliance.model],
    ["Seriennummer", appliance.serialNumber],
    ["Type", appliance.type],
    ["Finish", appliance.finish],
    ["Bedienung", appliance.controlPanelType],
    ["Griff", appliance.handleType],
    ["Referenzmasse", appliance.referenceDimensions],
  ].filter(([, value]) => value);

  return `
    <div class="existing-appliance">
      <h4>Bestandsgeraet</h4>
      ${facts.length ? `<dl>${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : ""}
      ${appliance.visibleCondition ? `<p>${escapeHtml(appliance.visibleCondition)}</p>` : ""}
      ${photos.length ? `
        <div class="existing-appliance-photos">
          ${photos.map((photo) => `
            <figure>
              <img src="${escapeHtml(photo.appUrl || photo.originalPath || "")}" alt="${escapeHtml(photo.label || "Bestandsgeraet")}" loading="lazy">
              <figcaption>${escapeHtml(photo.label || "Foto")}</figcaption>
            </figure>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderServiceVerification(verification) {
  if (!verification || !Object.keys(verification).length) return "";
  const findings = Array.isArray(verification.officialFindings) ? verification.officialFindings : [];
  const openChecks = Array.isArray(verification.openChecksBeforeOrder) ? verification.openChecksBeforeOrder : [];
  const phoneScript = Array.isArray(verification.phoneCheckScript) ? verification.phoneCheckScript : [];
  const sources = Array.isArray(verification.sourceUrls) ? verification.sourceUrls : [];
  const addressCheck = verification.addressCheck || {};
  const addressFacts = [
    ["Adresse", addressCheck.address],
    ["Status", procurementLabel(addressCheck.status)],
    ["Fazit", addressCheck.bestCurrentConclusion],
  ].filter(([, value]) => value);
  const blockingFacts = Array.isArray(addressCheck.blockingFacts) ? addressCheck.blockingFacts : [];

  return `
    <div class="service-verification">
      <h4>Lieferung, Einbau & Abtransport</h4>
      ${verification.summary ? `<p>${escapeHtml(verification.summary)}</p>` : ""}
      ${addressFacts.length ? `
        <details open>
          <summary>Adresspruefung</summary>
          <dl>${addressFacts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
          ${blockingFacts.length ? `<ul>${blockingFacts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>` : ""}
        </details>
      ` : ""}
      ${findings.length ? `<details open><summary>Offiziell gefunden</summary><ul>${findings.map((finding) => `<li>${escapeHtml(finding)}</li>`).join("")}</ul></details>` : ""}
      ${openChecks.length ? `<details open><summary>Vor Bestellung klaeren</summary><ul>${openChecks.map((check) => `<li>${escapeHtml(check)}</li>`).join("")}</ul></details>` : ""}
      ${phoneScript.length ? `<details><summary>Telefon-/Checkout-Fragen</summary><ol>${phoneScript.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ol></details>` : ""}
      ${sources.length ? `<div class="vendor-links">${sources.map((source) => `<a href="${escapeHtml(source)}" target="_blank" rel="noreferrer">Quelle oeffnen</a>`).join("")}</div>` : ""}
    </div>
  `;
}

function renderServiceProviderShortlist(procurement) {
  const search = procurement.localProviderSearch || {};
  const providers = Array.isArray(procurement.serviceProviderShortlist) ? procurement.serviceProviderShortlist : [];
  if (!providers.length && !Object.keys(search).length) return "";
  const sorted = [...providers].sort((left, right) => (left.rank || 99) - (right.rank || 99));
  const mustConfirm = Array.isArray(search.mustConfirmBeforeOrder) ? search.mustConfirmBeforeOrder : [];
  const searchSources = Array.isArray(search.sourceUrls) ? search.sourceUrls : [];

  return `
    <div class="service-provider-shortlist">
      <h4>Lokale Anbieter nach Servicequalitaet</h4>
      ${search.conclusion ? `<p>${escapeHtml(search.conclusion)}</p>` : ""}
      ${mustConfirm.length ? `<details open><summary>Immer vor Bestellung bestaetigen</summary><ul>${mustConfirm.map((check) => `<li>${escapeHtml(check)}</li>`).join("")}</ul></details>` : ""}
      ${sorted.length ? `
        <ol>
          ${sorted.map((provider) => {
            const why = Array.isArray(provider.why) ? provider.why : [];
            const caveats = Array.isArray(provider.caveats) ? provider.caveats : [];
            const sources = Array.isArray(provider.sourceUrls) ? provider.sourceUrls : [];
            return `
              <li class="service-provider-option">
                <div class="vendor-option-header">
                  <strong>${escapeHtml(provider.provider || "Anbieter")}</strong>
                  ${provider.role ? `<span>${escapeHtml(provider.role)}</span>` : ""}
                </div>
                ${provider.accessIssue ? `<p class="provider-access-warning">${escapeHtml(provider.accessIssue)}</p>` : ""}
                ${provider.serviceFit ? `<p>${escapeHtml(provider.serviceFit)}</p>` : ""}
                <dl>
                  ${provider.phone ? `<div><dt>Kontakt</dt><dd>${escapeHtml(provider.phone)}</dd></div>` : ""}
                  ${provider.role ? `<div><dt>Rolle</dt><dd>${escapeHtml(provider.role)}</dd></div>` : ""}
                </dl>
                ${why.length ? `<details><summary>Warum dieser Anbieter</summary><ul>${why.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>` : ""}
                ${caveats.length ? `<details><summary>Noch klaeren</summary><ul>${caveats.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></details>` : ""}
                <div class="vendor-links">
                  ${provider.website ? `<a href="${escapeHtml(provider.website)}" target="_blank" rel="noreferrer">Website oeffnen</a>` : ""}
                  ${sources.map((source) => `<a href="${escapeHtml(source)}" target="_blank" rel="noreferrer">Quelle</a>`).join("")}
                </div>
              </li>
            `;
          }).join("")}
        </ol>
      ` : ""}
      ${searchSources.length ? `<div class="vendor-links">${searchSources.map((source) => `<a href="${escapeHtml(source)}" target="_blank" rel="noreferrer">Recherchequelle</a>`).join("")}</div>` : ""}
    </div>
  `;
}

function renderVendorShortlist(procurement) {
  const shortlist = Array.isArray(procurement.vendorShortlist) ? procurement.vendorShortlist : [];
  if (!shortlist.length) return "";
  const recommendedOptionId = procurement.recommendedOptionId || "";
  const sorted = [...shortlist].sort((left, right) => (left.rank || 99) - (right.rank || 99));

  return `
    <div class="vendor-shortlist">
      <h4>Geraete-Shortlist</h4>
      ${procurement.recommendedRationale ? `<p>${escapeHtml(procurement.recommendedRationale)}</p>` : ""}
      <ol>
        ${sorted.map((option) => {
          const isRecommended = option.id === recommendedOptionId;
          const pros = Array.isArray(option.pros) ? option.pros : [];
          const risks = Array.isArray(option.risks) ? option.risks : [];
          return `
            <li class="vendor-option ${isRecommended ? "recommended" : ""}">
              <div class="vendor-option-header">
                <strong>${escapeHtml(option.retailer || "Anbieter")} - ${escapeHtml(option.model || option.productName || "Geraet")}</strong>
                ${isRecommended ? `<span>Empfohlen</span>` : ""}
              </div>
              <p>${escapeHtml(option.productName || "")}</p>
              <dl>
                <div><dt>Geraet</dt><dd>${escapeHtml(option.itemPrice || "-")}</dd></div>
                <div><dt>Service</dt><dd>${escapeHtml(option.servicePrice || "-")}</dd></div>
                <div><dt>Gesamt vor Steuer</dt><dd>${escapeHtml(option.estimatedTotalPretax || "-")}</dd></div>
              </dl>
              ${option.serviceScope ? `<p>${escapeHtml(option.serviceScope)}</p>` : ""}
              ${option.fitNotes ? `<p>${escapeHtml(option.fitNotes)}</p>` : ""}
              ${pros.length ? `<details><summary>Warum sinnvoll</summary><ul>${pros.map((pro) => `<li>${escapeHtml(pro)}</li>`).join("")}</ul></details>` : ""}
              ${risks.length ? `<details><summary>Noch bestaetigen</summary><ul>${risks.map((risk) => `<li>${escapeHtml(risk)}</li>`).join("")}</ul></details>` : ""}
              <div class="vendor-links">
                ${option.productUrl ? `<a href="${escapeHtml(option.productUrl)}" target="_blank" rel="noreferrer">Geraet oeffnen</a>` : ""}
                ${option.serviceUrl ? `<a href="${escapeHtml(option.serviceUrl)}" target="_blank" rel="noreferrer">Service oeffnen</a>` : ""}
              </div>
            </li>
          `;
        }).join("")}
      </ol>
    </div>
  `;
}

function renderProcurementDetails(item) {
  const procurement = item.procurement || {};
  const hoaCompliance = item.hoaCompliance || {};
  const actions = Array.isArray(item.nextActions) ? item.nextActions : [];
  if (!Object.keys(procurement).length && !Object.keys(hoaCompliance).length && !actions.length) return "";
  const facts = [
    ["Bedarf", procurementLabel(procurement.need)],
    ["Geraet", procurementLabel(procurement.applianceType)],
    ["Einbau", procurementLabel(procurement.installationType)],
    ["Lieferfenster", procurementLabel(procurement.deliveryWindow)],
    ["Anschluss", procurement.installationRequired ? "erforderlich" : ""],
    ["Altgeraet", procurement.haulAwayOldAppliance || procurement.disposalRequired ? "Mitnahme/Entsorgung erforderlich" : ""],
    ["Masse", procurement.measurementRequired ? "vor Bestellung pruefen" : ""],
    ["Beschaffung", procurementLabel(procurement.purchaseStatus)],
  ].filter(([, value]) => value && value !== "-");

  return `
    <div class="maintenance-procurement">
      <h4>Beschaffung & Termin</h4>
      ${facts.length ? `<dl>${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : ""}
      ${procurement.notes ? `<p>${escapeHtml(procurement.notes)}</p>` : ""}
      ${renderExistingAppliance(procurement.existingAppliance)}
      ${renderServiceProviderShortlist(procurement)}
      ${renderServiceVerification(procurement.homeDepotServiceVerification)}
      ${renderVendorShortlist(procurement)}
      ${renderHoaComplianceDetails(hoaCompliance)}
      ${actions.length ? `<ol>${actions.map((action) => `<li>${escapeHtml(action)}</li>`).join("")}</ol>` : ""}
    </div>
  `;
}

function suggestionsForCase(caseId) {
  return ensureAISuggestions()
    .filter((suggestion) => suggestion.caseId === caseId)
    .sort((left, right) => {
      if (left.status === "pending" && right.status !== "pending") return -1;
      if (right.status === "pending" && left.status !== "pending") return 1;
      return String(right.generatedAt || "").localeCompare(String(left.generatedAt || ""));
    });
}

function hermesTask(caseItem) {
  const terms = (caseItem.gmail?.searchTerms || [caseItem.email, caseItem.reservationCode, caseItem.guestName]).filter(Boolean);
  return [
    "Use $airbnb-hoa-operations to review the Airbnb HOA case.",
    "",
    `Case: ${caseItem.guestName}`,
    `Stay: ${formatDate(caseItem.start)} to ${formatDate(caseItem.end)}`,
    `Reservation: ${caseItem.reservationCode || "unknown"}`,
    `Guest email: ${caseItem.email || "unknown"}`,
    `Document deadline: ${formatDate(caseItem.deadlineDocuments)}`,
    `Cancellation review: ${formatDate(caseItem.cancellationReviewAt)}`,
    "",
    "Tasks:",
    "1. Build/read the Hermes operations context, including Airbnb iCal calendar and deadline calendar.",
    "2. Search Gmail for guest replies, returned documents, attachments, and HOA/management messages.",
    "3. Check WhatsApp if the Hermes WhatsApp bridge is active; report bridge downtime if it is not available.",
    "4. Check iMessage through the Mac mini bridge when relevant: ssh demo-user@192.0.2.11 'python3 ~/hermes-bridges/apple-messages/macmini_imessage_bridge.py search \"SEARCH_TERM\" --limit 20 --since-days 365'.",
    "5. Classify whether the HOA package is complete, incomplete, or missing.",
    "6. Include payment, Turno cleaning, maintenance, WhatsApp and iMessage findings as compact evidence pointers only.",
    "7. Write a safe sync report for the app's KI-Vorschlaege inbox.",
    "8. Prepare a short recommendation for Owner.",
    "9. Do not set Board Approval or release check-in through the sync report.",
    "10. Do not send any Gmail, Airbnb, WhatsApp or iMessage message without explicit Owner approval for the exact text and recipient.",
    "",
    `Search terms: ${terms.join(" | ")}`,
  ].join("\n");
}

function pendingInboxItems() {
  return ensureInboxItems().filter((item) => !["applied", "ignored"].includes(item.status || "new"));
}

function workLevelOrder(level) {
  const order = { red: 0, amber: 1, blue: 2, green: 3 };
  return order[level] ?? 9;
}

function deriveWorkSteps() {
  const steps = [];
  const seen = new Set();
  const addStep = (step) => {
    if (!step?.id || seen.has(step.id)) return;
    seen.add(step.id);
    steps.push(step);
  };

  for (const item of dailyCheck?.items || []) {
    if (["payment", "cleaning"].includes(item.kind)) continue;
    const caseItem = item.caseId ? appState.cases.find((entry) => entry.id === item.caseId) : null;
    const target = item.kind === "payment" ? "payments" : item.kind === "cleaning" ? "cleaning" : item.kind === "maintenance" ? "maintenance" : item.kind === "telephony" ? "telephony" : "case";
    const owner = item.kind === "payment" ? "Airbnb-Zahlung" : item.kind === "cleaning" ? "Turno" : item.kind === "maintenance" ? "Maengel" : item.kind === "telephony" ? "Telefonie" : caseItem?.guestName || item.guestName || "Airbnb";
    addStep({
      id: item.kind === "telephony" ? `telephony-${item.telephonyCallId || stableKey(item.title)}` : `daily-${item.kind || "case"}-${item.caseId || item.maintenanceId || item.title}`,
      level: item.level || "blue",
      title: item.title || "Risiko pruefen",
      detail: item.detail || "",
      due: item.due || caseItem?.deadlineDocuments || "",
      owner,
      caseId: item.caseId || "",
      target,
      canCopy: Boolean(caseItem) && target === "case",
    });
  }

  for (const suggestion of ensureAISuggestions().filter((item) => item.status === "pending")) {
    const caseItem = appState.cases.find((entry) => entry.id === suggestion.caseId);
    addStep({
      id: `suggestion-${suggestion.id}`,
      level: "amber",
      title: `KI-Hinweis pruefen: ${suggestion.title || "Neue Auswertung"}`,
      detail: suggestion.detail || "Hermes/Gmail hat einen neuen Hinweis gefunden.",
      due: suggestion.generatedAt || today,
      owner: caseItem?.guestName || "KI-Vorschlaege",
      caseId: suggestion.caseId || "",
      target: "case",
      canCopy: false,
    });
  }

  for (const item of pendingInboxItems()) {
    addStep({
      id: `inbox-${item.id}`,
      level: item.priority === "high" ? "red" : item.priority === "low" ? "blue" : "amber",
      title: `Eingang pruefen: ${item.title || "Neuer Hinweis"}`,
      detail: item.summary || "",
      due: item.date || today,
      owner: item.caseId ? caseLabel(item.caseId) : communicationChannelLabel(item.channel),
      caseId: item.caseId || "",
      target: "inbox",
      canCopy: false,
    });
  }

  const missingCleaning = nextCleaningNeed();
  if (missingCleaning && !missingCleaning.project) {
    addStep({
      id: `cleaning-${missingCleaning.caseItem.id}`,
      level: "amber",
      title: "Turno-Reinigung nach Check-out belegen",
      detail: `Fuer ${missingCleaning.caseItem.guestName} ist nach ${formatDate(missingCleaning.caseItem.end)} noch kein Turno-Projekt gespeichert.`,
      due: missingCleaning.caseItem.end,
      owner: "Turno",
      target: "cleaning",
      canCopy: false,
    });
  }

  const openPayments = paymentsNeedingReview();
  if (openPayments.length) {
    addStep({
      id: "payments-review",
      level: openPayments.some((payment) => ["partial", "disputed"].includes(payment.status)) ? "red" : "amber",
      title: "Airbnb-Zahlungen Mietern zuordnen",
      detail: `${openPayments.length} Zahlungseintrag${openPayments.length === 1 ? "" : "e"} brauchen Airbnb-Pruefung oder Betrag.`,
      due: today,
      owner: "Airbnb-Zahlung",
      target: "payments",
      canCopy: false,
    });
  }

  const urgentMaintenance = activeMaintenanceItems().find((item) => maintenanceRisk(item).level === "red");
  if (urgentMaintenance) {
    addStep({
      id: `maintenance-${urgentMaintenance.id}`,
      level: "red",
      title: `Mangel klaeren: ${urgentMaintenance.item}`,
      detail: urgentMaintenance.title || urgentMaintenance.description || "Offener Mangel mit hoher Wirkung.",
      due: urgentMaintenance.dueDate || today,
      owner: "Maengel",
      target: "maintenance",
      canCopy: false,
    });
  }

  for (const call of openTelephonyCalls()) {
    addStep({
      id: `telephony-${call.id}`,
      level: call.status === "failed" ? "red" : "amber",
      title: `Anruf vorbereiten: ${call.contact || call.phone || "Telefonie"}`,
      detail: [call.topic, call.nextAction, call.notes].filter(Boolean).join(" "),
      due: call.date || today,
      owner: "Telefonie",
      target: "telephony",
      canCopy: false,
    });
  }

  return steps
    .sort((left, right) => {
      const leftLevel = workLevelOrder(left.level);
      const rightLevel = workLevelOrder(right.level);
      if (leftLevel !== rightLevel) return leftLevel - rightLevel;
      return String(left.due || "9999-12-31").localeCompare(String(right.due || "9999-12-31"));
    })
    .slice(0, 8);
}

function openWorkStep(step) {
  if (step.caseId && appState.cases.some((caseItem) => caseItem.id === step.caseId)) {
    selectedCaseId = step.caseId;
    render();
    $("casePanel").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const targets = {
    inbox: "inboxPanel",
    payments: "paymentsPanel",
    cleaning: "cleaningPanel",
    maintenance: "maintenancePanel",
    telephony: "telephonyPanel",
  };
  const target = $(targets[step.target] || "casePanel");
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function copyWorkStepText(stepId) {
  const step = deriveWorkSteps().find((item) => item.id === stepId);
  if (!step) return;
  const caseItem = step.caseId ? appState.cases.find((item) => item.id === step.caseId) : null;
  const text = caseItem ? fillTemplate(appState.templates[actionTemplateKey(caseItem)], caseItem) : `${step.title}\n\n${step.detail}`;
  await copyTextToClipboard(text);
}

function renderWorkMode() {
  const list = $("workModeList");
  if (!list) return;
  const steps = deriveWorkSteps();
  const red = steps.filter((step) => step.level === "red").length;
  const amber = steps.filter((step) => step.level === "amber").length;
  const pill = $("workModePill");

  $("workModeMeta").textContent = steps.length
    ? `${steps.length} priorisierte Schritte aus Tagescheck, Eingangsmappe, Zahlungen, Turno, Maengeln und Telefonie.`
    : "Keine akuten Schritte aus den gespeicherten Daten.";
  pill.textContent = red ? `${red} dringend` : amber ? `${amber} pruefen` : "OK";
  pill.className = `pill ${red ? "red" : amber ? "amber" : "green"}`;

  if (!steps.length) {
    list.innerHTML = `<p class="muted work-mode-empty">Keine offenen Arbeitsschritte. Naechster sinnvoller Schritt: Integrationen und Airbnb-Kalender bei neuen Buchungen aktualisieren.</p>`;
    return;
  }

  list.innerHTML = steps
    .map((step, index) => `
      <article class="work-step ${escapeHtml(step.level)}">
        <div class="work-step-index">${index + 1}</div>
        <div class="work-step-body">
          <div class="work-step-header">
            <div>
              <strong>${escapeHtml(step.title)}</strong>
              <p>${escapeHtml(step.owner || "Airbnb")}${step.due ? ` · ${relativeDateText(step.due)}` : ""}</p>
            </div>
            <span class="pill ${escapeHtml(step.level)}">${escapeHtml(step.level === "red" ? "dringend" : step.level === "amber" ? "pruefen" : "Info")}</span>
          </div>
          <p class="work-step-detail">${escapeHtml(step.detail || "Kein Detail gespeichert.")}</p>
          <div class="work-step-actions">
            <button type="button" class="button secondary mini" data-work-open="${escapeHtml(step.id)}">${step.target === "case" ? "Fall anzeigen" : "Bereich oeffnen"}</button>
            ${step.canCopy ? `<button type="button" class="button secondary mini" data-work-copy="${escapeHtml(step.id)}">Text kopieren</button>` : ""}
          </div>
        </div>
      </article>
    `)
    .join("");

  for (const button of list.querySelectorAll("[data-work-open]")) {
    button.addEventListener("click", () => {
      const step = deriveWorkSteps().find((item) => item.id === button.dataset.workOpen);
      if (step) openWorkStep(step);
    });
  }
  for (const button of list.querySelectorAll("[data-work-copy]")) {
    button.addEventListener("click", () => {
      const original = button.textContent;
      copyWorkStepText(button.dataset.workCopy)
        .then(() => {
          button.textContent = "Kopiert";
          setTimeout(() => (button.textContent = original), 1200);
        })
        .catch(() => {
          button.textContent = "Blockiert";
          setTimeout(() => (button.textContent = original), 1600);
        });
    });
  }
}

function renderMetrics() {
  const cases = appState.cases;
  const openCases = cases.filter((caseItem) => caseItem.status !== "approved").length;
  const reminders = cases.filter((caseItem) => caseItem.status === "reminder_due").length;
  const locked = cases.filter((caseItem) => caseItem.checkInLocked).length;
  const defects = activeMaintenanceItems().length;
  const payments = paymentsNeedingReview().length;
  $("metricOpen").textContent = openCases;
  $("metricReminder").textContent = reminders;
  $("metricLocked").textContent = locked;
  $("metricDefects").textContent = activeMaintenanceItems().length;
  const cleaningNeed = nextCleaningNeed();
  $("metricCleaning").textContent = cleaningNeed ? formatDate(cleaningNeed.dueDate) : "-";
  $("metricPayments").textContent = payments;
  const decisions = cases
    .filter((caseItem) => caseItem.decisionBy && caseItem.status !== "approved")
    .map((caseItem) => caseItem.decisionBy)
    .sort();
  $("metricDecision").textContent = decisions[0] ? formatDate(decisions[0]) : "-";
  const nextDecisionDays = decisions[0] ? daysBetween(today, decisions[0]) : null;
  setMetricLevel("metricOpen", openCases ? "amber" : "green");
  setMetricLevel("metricReminder", reminders ? "amber" : "green");
  setMetricLevel("metricLocked", locked ? "red" : "green");
  setMetricLevel("metricDecision", nextDecisionDays !== null && nextDecisionDays <= 3 ? "red" : nextDecisionDays !== null && nextDecisionDays <= 10 ? "amber" : "green");
  setMetricLevel("metricDefects", defects ? "amber" : "green");
  setMetricLevel("metricCleaning", cleaningNeed && !cleaningNeed.project ? "amber" : "green");
  setMetricLevel("metricPayments", payments ? "amber" : "green");
}

function renderTodayFocus() {
  const caseItem = priorityCase();
  if (!caseItem) return;
  const item = primaryDailyItem(caseItem);
  const action = nextAction(caseItem);
  const guard = guardrailForCase(caseItem);
  const missing = missingChecklistItems(caseItem);
  const focusLevel = item?.level || guard.level || "blue";
  const focusPanel = document.querySelector(".today-focus");
  if (focusPanel) focusPanel.className = `today-focus ${focusLevel}`;

  $("focusTitle").textContent = `${focusGuestLabel(caseItem)}: ${item?.title || action[0]}`;
  $("focusMeta").textContent = `${caseItem.guestName} · ${formatDate(caseItem.start)} bis ${formatDate(caseItem.end)} · ${caseItem.reservationCode || "ohne Reservierungscode"}`;
  $("focusDetail").textContent = item?.detail || action[1];

  $("focusGuardPill").textContent = guard.pill;
  $("focusGuardPill").className = `pill ${guard.level}`;
  $("focusGuardTitle").textContent = guard.title;
  $("focusGuardDetail").textContent = guard.detail;

  const deadlines = [
    ["Unterlagen", caseItem.deadlineDocuments],
    ["Storno-Pruefung", caseItem.cancellationReviewAt],
    ["Entscheidung", caseItem.decisionBy],
  ].filter(([, value]) => value);
  $("focusDeadlineSummary").innerHTML = deadlines
    .map(([label, value]) => `<div><dt>${label}</dt><dd>${relativeDateText(value)}</dd></div>`)
    .join("");

  $("focusCopyText").textContent = actionCopyLabel(caseItem);
  $("focusCopyText").onclick = () => copyCaseTemplate(caseItem, "focusCopyText").catch((error) => alert(error.message));
  $("focusOpenCase").onclick = () => {
    selectedCaseId = caseItem.id;
    render();
    $("casePanel").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  $("focusCopyDossier").onclick = () => copyDossierForCase(caseItem, "focusCopyDossier").catch((error) => alert(error.message));

  $("focusOpenCase").textContent = "Fall anzeigen";
}

function renderDailyCheck() {
  const summary = dailyCheck?.summary || {};
  const items = dailyCheck?.items || [];
  const red = summary.red || 0;
  const amber = summary.amber || 0;
  const pill = $("dailyStatusPill");

  if (red) {
    pill.textContent = `${red} rot`;
    pill.className = "pill red";
  } else if (amber) {
    pill.textContent = `${amber} gelb`;
    pill.className = "pill amber";
  } else {
    pill.textContent = "OK";
    pill.className = "pill green";
  }

  if (dailyCheck?.error) {
    $("dailyCheck").innerHTML = `<p class="muted">Tagescheck konnte nicht geladen werden: ${escapeHtml(dailyCheck.error)}</p>`;
    return;
  }

  const header = `
    <div class="daily-summary">
      <span><strong>${red}</strong> rot</span>
      <span><strong>${amber}</strong> gelb</span>
      <span><strong>${summary.openCases || 0}</strong> offen</span>
      <span><strong>${activeMaintenanceItems().length}</strong> Maengel</span>
      <span><strong>${summary.paymentsOpen || paymentsNeedingReview().length}</strong> Zahlungen</span>
      <span><strong>${summary.telephonyOpen || openTelephonyCalls().length}</strong> Anrufe</span>
    </div>
  `;

  if (!items.length) {
    $("dailyCheck").innerHTML = `${header}<p class="muted daily-empty">Keine offenen Risiken gefunden.</p>`;
    return;
  }

  const list = items
    .slice(0, 6)
    .map((item) => {
      const canSelect = !["cleaning", "payment", "telephony"].includes(item.kind) && item.caseId && appState.cases.some((caseItem) => caseItem.id === item.caseId);
      const canSelectMaintenance = item.maintenanceId && ensureMaintenanceItems().some((maintenance) => maintenance.id === item.maintenanceId);
      const canSelectCleaning = item.kind === "cleaning";
      const canSelectPayment = item.kind === "payment";
      const canSelectTelephony = item.kind === "telephony";
      const tag = canSelect ? "button" : "div";
      const rowTag = canSelect || canSelectMaintenance || canSelectCleaning || canSelectPayment || canSelectTelephony ? "button" : tag;
      const attrs = canSelect
        ? ` type="button" data-case-id="${escapeHtml(item.caseId)}"`
        : canSelectMaintenance
          ? ` type="button" data-maintenance-id="${escapeHtml(item.maintenanceId)}"`
          : canSelectCleaning
            ? ` type="button" data-cleaning-item="1"`
            : canSelectPayment
              ? ` type="button" data-payment-item="1"`
              : canSelectTelephony
                ? ` type="button" data-telephony-item="1"`
            : "";
      const owner = item.kind === "maintenance" ? "Maengel" : item.kind === "cleaning" ? "Turno" : item.kind === "payment" ? "Airbnb-Zahlung" : item.kind === "telephony" ? "Telefonie" : item.guestName || "Airbnb-Kalender";
      return `
        <${rowTag}${attrs} class="daily-item ${escapeHtml(item.level)}">
          <span class="daily-item-title">${escapeHtml(item.title)}</span>
          <span class="daily-item-meta">${escapeHtml(owner)} ${item.due ? `· ${relativeDateText(item.due)}` : ""}</span>
          <span class="daily-item-detail">${escapeHtml(item.detail)}</span>
        </${rowTag}>
      `;
    })
    .join("");

  $("dailyCheck").innerHTML = `${header}<div class="daily-list">${list}</div>`;
  for (const button of $("dailyCheck").querySelectorAll("button[data-case-id]")) {
    button.addEventListener("click", () => {
      selectedCaseId = button.dataset.caseId;
      render();
    });
  }
  for (const button of $("dailyCheck").querySelectorAll("button[data-maintenance-id]")) {
    button.addEventListener("click", () => {
      $("maintenancePanel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  for (const button of $("dailyCheck").querySelectorAll("button[data-cleaning-item]")) {
    button.addEventListener("click", () => {
      $("cleaningPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  for (const button of $("dailyCheck").querySelectorAll("button[data-payment-item]")) {
    button.addEventListener("click", () => {
      $("paymentsPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  for (const button of $("dailyCheck").querySelectorAll("button[data-telephony-item]")) {
    button.addEventListener("click", () => {
      $("telephonyPanel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function renderIntegrationStatus() {
  const list = $("integrationStatusList");
  if (!list) return;
  const pill = $("integrationStatusPill");
  if (!integrationStatus) {
    $("integrationMeta").textContent = "Noch nicht geprueft";
    pill.textContent = "Bereit";
    pill.className = "pill blue";
    list.innerHTML = `
      <div class="integration-placeholder">
        <span>Airbnb iCal</span>
        <span>iPhone-Kalender</span>
        <span>Tageswecker</span>
        <span>Hermes</span>
        <span>GBrain</span>
        <span>WhatsApp</span>
        <span>iMessage</span>
      </div>
    `;
    return;
  }

  const overall = integrationStatus.overall || "warn";
  $("integrationMeta").textContent = integrationGeneratedText(integrationStatus.generatedAt);
  pill.textContent = integrationStatusText(overall);
  pill.className = `pill ${overall === "error" ? "red" : overall === "warn" ? "amber" : "green"}`;

  const items = Array.isArray(integrationStatus.items) ? integrationStatus.items : [];
  if (!items.length) {
    list.innerHTML = `<p class="muted integration-empty">Kein Integrationsstatus vorhanden.</p>`;
    return;
  }

  list.innerHTML = items
    .map((entry) => {
      const level = entry.status === "error" ? "red" : entry.status === "warn" ? "amber" : "green";
      return `
        <article class="integration-card ${level}">
          <div class="integration-card-header">
            <div>
              <span>${escapeHtml(entry.label || "Integration")}</span>
              <strong>${escapeHtml(entry.title || integrationStatusText(entry.status))}</strong>
            </div>
            <span class="pill ${level}">${escapeHtml(integrationStatusText(entry.status))}</span>
          </div>
          ${entry.detail ? `<p>${escapeHtml(entry.detail)}</p>` : ""}
          ${entry.action ? `<p class="integration-action">${escapeHtml(entry.action)}</p>` : ""}
        </article>
      `;
    })
    .join("");
}

function renderDeviceAccess() {
  const list = $("deviceAccessList");
  if (!list) return;
  const info = displayInfo || {};
  const lanUrls = Array.isArray(info.lanDisplayUrls) ? info.lanDisplayUrls : [];
  const candidateUrls = Array.isArray(info.lanCandidateDisplayUrls) ? info.lanCandidateDisplayUrls : [];
  const bestLanUrl = lanUrls[0] || candidateUrls[0] || "";
  const pill = $("deviceStatusPill");

  $("deviceMeta").textContent = info.lanEnabled
    ? "Display ist im privaten LAN erreichbar. Fuer unterwegs weiter VPN/Tailscale/Hermes-Relay nutzen."
    : "Standard ist sicher lokal. LAN, TV und unterwegs sind als bewusste Uebertragungswege vorbereitet.";
  pill.textContent = info.lanEnabled ? "LAN aktiv" : "lokal sicher";
  pill.className = `pill ${info.lanEnabled ? "green" : "blue"}`;

  const cards = [
    {
      level: "green",
      label: "App",
      title: "Bearbeiten auf diesem Mac",
      detail: "Volles Dashboard mit Speichern, Fallakte, Mängeln, Zahlungen, Turno und Dossier.",
      format: info.localUrl || "http://127.0.0.1:4327/",
      action: "Mac-App oder Dashboard",
    },
    {
      level: "blue",
      label: "Display",
      title: "TV, iPad, iPhone, Monitor",
      detail: "Grosse read-only Anzeige mit Auto-Aktualisierung. Gut fuer Fernseher, Tablet, Wandmonitor oder Zweitbildschirm.",
      format: info.localDisplayUrl || "/display",
      action: "HTML/PWA",
    },
    {
      level: info.lanEnabled ? "green" : "amber",
      label: "LAN",
      title: "Geraete im Haus",
      detail: info.lanEnabled
        ? "LAN-Anzeige ist aktiv. Ein Geraet im gleichen privaten Netzwerk kann die Display-URL oeffnen."
        : "LAN ist vorbereitet, aber nicht aktiv. Aktivierung nur bewusst im privaten Netzwerk starten.",
      format: bestLanUrl || "LAN-Adresse wird nach Aktivierung angezeigt",
      action: info.lanEnabled ? "privates LAN" : "optional",
    },
    {
      level: "blue",
      label: "JSON",
      title: "Hermes / Home Assistant / Signage",
      detail: "Verdichteter Status fuer Sprachbefehle, Home Assistant, WallPanel, Anthias, MagicMirror oder eigene Agenten.",
      format: "/api/display-state",
      action: "Status-API",
    },
    {
      level: "blue",
      label: "Voice",
      title: "Hermes-Sprachansage",
      detail: "Kurzer, sicherer Vorlesetext: rote/gelbe Punkte, gesperrte Check-ins, naechste Aktion und Display-Link.",
      format: "/api/voice-brief",
      action: "Sprachstatus",
    },
    {
      level: "amber",
      label: "Unterwegs",
      title: "Nicht oeffentlich freigeben",
      detail: "Von ausserhalb nur ueber VPN, Tailscale oder Hermes-Relay. Keine Router-Portfreigabe fuer die Fallakte.",
      format: "VPN/Tailscale/Hermes-Relay",
      action: "privater Tunnel",
    },
  ];

  list.innerHTML = cards
    .map((card) => `
      <article class="device-card ${escapeHtml(card.level)}">
        <div class="device-card-header">
          <div>
            <span>${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(card.title)}</strong>
          </div>
          <span class="pill ${escapeHtml(card.level)}">${escapeHtml(card.action)}</span>
        </div>
        <p>${escapeHtml(card.detail)}</p>
        <code>${escapeHtml(card.format)}</code>
      </article>
    `)
    .join("");
}

function telephonyProjectOptions() {
  const domains = Array.isArray(operationsManifest?.domains) ? operationsManifest.domains : [];
  const options = domains.map((domain) => [domain.id, domain.label || domain.id]);
  if (!options.some(([id]) => id === "airbnb_hoa")) options.unshift(["airbnb_hoa", "Airbnb HOA"]);
  if (!options.some(([id]) => id === "panama_house")) options.push(["panama_house", "Haus Panama"]);
  options.push(["general", "Allgemein"]);
  return options;
}

function telephonyPrimaryNumber() {
  const contact = selectedTelephonyContact();
  return normalizePhoneNumber($("telephonyPhone")?.value || contact?.phone || "");
}

function syncTelephonyPhoneFromContact() {
  const contact = selectedTelephonyContact();
  if (!contact) return;
  $("telephonyPhone").value = formatPhoneDisplay(contact.phone);
  if (!$("telephonyTopic").value.trim()) $("telephonyTopic").value = contact.context || "";
}

function createTelephonyCall(event) {
  event.preventDefault();
  const contact = selectedTelephonyContact();
  const phone = normalizePhoneNumber($("telephonyPhone").value || contact?.phone || "");
  if (!phone) {
    alert("Bitte erst eine Telefonnummer eintragen oder einen Kontakt auswaehlen.");
    return;
  }
  const topic = $("telephonyTopic").value.trim() || contact?.context || "Telefonat";
  const call = {
    id: telephonyCallId(contact?.label || "Freie Nummer", phone, today),
    date: today,
    contactId: contact?.id || "",
    contact: contact?.label || "Freie Nummer",
    phone,
    project: $("telephonyProject").value || "airbnb_hoa",
    topic,
    status: "planned",
    notes: $("telephonyNotes").value.trim(),
    nextAction: $("telephonyNextAction").value.trim() || "Anrufen und Ergebnis danach eintragen.",
    createdAt: new Date().toISOString(),
    lastUpdatedAt: today,
  };
  const telephony = ensureTelephony();
  telephony.callLog.push(call);
  telephony.lastUpdatedAt = today;
  $("telephonyNotes").value = "";
  $("telephonyNextAction").value = "";
  render();
  saveState(false).catch((error) => alert(error.message));
}

function updateTelephonyCall(id, patch) {
  const call = telephonyCallLog().find((item) => item.id === id);
  if (!call) return;
  Object.assign(call, patch, { lastUpdatedAt: today });
  ensureTelephony().lastUpdatedAt = today;
  render();
  saveState(false).catch((error) => alert(error.message));
}

async function copyTelephonyNumber(buttonId, phone = "") {
  const number = normalizePhoneNumber(phone || telephonyPrimaryNumber());
  if (!number) {
    alert("Keine Telefonnummer vorhanden.");
    return;
  }
  await copyTextToClipboard(number);
  flashButtonText(buttonId, "Nummer kopiert", "Nummer kopieren");
}

async function openGoogleFiWeb(buttonId = "openGoogleFiWeb", phone = "") {
  const number = normalizePhoneNumber(phone || telephonyPrimaryNumber());
  if (!number) {
    alert("Keine Telefonnummer vorhanden.");
    return;
  }
  await copyTextToClipboard(number).catch(() => {});
  window.open(ensureTelephony().webCallsUrl || "https://messages.google.com/web", "_blank", "noopener");
  flashButtonText(buttonId, "Google Fi geoeffnet", "Google Fi Web");
}

function openTelephonyDialer(phone = "") {
  const number = normalizePhoneNumber(phone || telephonyPrimaryNumber());
  if (!number) {
    alert("Keine Telefonnummer vorhanden.");
    return;
  }
  window.location.href = `${ensureTelephony().androidDialIntent || "tel:"}${number}`;
}

function renderTelephony() {
  const panel = $("telephonyPanel");
  if (!panel) return;
  const telephony = ensureTelephony();
  const contacts = telephonyContacts();
  const calls = [...telephonyCallLog()].sort((left, right) => {
    const leftDate = `${left.date || ""} ${left.createdAt || ""}`;
    const rightDate = `${right.date || ""} ${right.createdAt || ""}`;
    return rightDate.localeCompare(leftDate);
  });
  const open = openTelephonyCalls();
  const failed = calls.filter((call) => call.status === "failed").length;

  $("telephonyStatusPill").textContent = failed ? `${failed} Problem` : open.length ? `${open.length} offen` : "bereit";
  $("telephonyStatusPill").className = `pill ${failed ? "red" : open.length ? "amber" : "green"}`;
  $("telephonyMeta").textContent = telephony.wifiCallingRule || "Google Fi ueber WLAN vorbereiten; Owner bestaetigt den Anruf.";

  const previousContact = $("telephonyContact").value;
  $("telephonyContact").innerHTML = [
    `<option value="">Freie Nummer</option>`,
    ...contacts.map((contact) => `<option value="${escapeHtml(contact.id)}">${escapeHtml(contact.label)}</option>`),
  ].join("");
  if (contacts.some((contact) => contact.id === previousContact)) $("telephonyContact").value = previousContact;

  const previousProject = $("telephonyProject").value || "airbnb_hoa";
  $("telephonyProject").innerHTML = telephonyProjectOptions()
    .map(([id, label]) => `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`)
    .join("");
  $("telephonyProject").value = telephonyProjectOptions().some(([id]) => id === previousProject) ? previousProject : "airbnb_hoa";

  $("telephonySummary").innerHTML = `
    <div class="telephony-summary-item">
      <span>Anbieter</span>
      <strong>${escapeHtml(telephony.provider || "Google Fi")}</strong>
      <p>${escapeHtml(telephony.primaryUse || "USA-Anrufe aus Panama")}</p>
    </div>
    <div class="telephony-summary-item">
      <span>Arbeitsregel</span>
      <strong>manuell bestaetigen</strong>
      <p>${escapeHtml(telephony.guardrail || "")}</p>
    </div>
    <div class="telephony-summary-item">
      <span>Aktuell</span>
      <strong>${open.length} offen</strong>
      <p>${calls.length ? `${calls.length} Anrufnotiz${calls.length === 1 ? "" : "en"} gespeichert.` : "Noch keine Anrufnotiz gespeichert."}</p>
    </div>
  `;

  $("telephonyContacts").innerHTML = contacts
    .map((contact) => `
      <article class="telephony-contact-card">
        <div>
          <strong>${escapeHtml(contact.label)}</strong>
          <p>${escapeHtml(contact.context || "")}</p>
          <code>${escapeHtml(formatPhoneDisplay(contact.phone))}</code>
        </div>
        <div class="telephony-card-actions">
          <button type="button" class="button secondary mini" data-telephony-use-contact="${escapeHtml(contact.id)}">Vorbereiten</button>
          <button type="button" class="button secondary mini" data-telephony-copy-contact="${escapeHtml(contact.id)}">Nummer kopieren</button>
        </div>
      </article>
    `)
    .join("");

  $("telephonyLogMeta").textContent = calls.length ? `${calls.length} Eintraege` : "noch leer";
  $("telephonyCallLog").innerHTML = calls.length
    ? calls
        .map((call) => {
          const level = telephonyStatusLevel(call.status);
          const statusOptions = telephonyStatusOptions
            .map(([id, label]) => `<option value="${escapeHtml(id)}"${call.status === id ? " selected" : ""}>${escapeHtml(label)}</option>`)
            .join("");
          return `
            <article class="telephony-call-card ${escapeHtml(level)}">
              <div class="telephony-call-header">
                <div>
                  <strong>${escapeHtml(call.contact || "Telefonat")}</strong>
                  <p>${formatDate(call.date)} · ${escapeHtml(call.project || "airbnb_hoa")}</p>
                </div>
                <span class="pill ${escapeHtml(level)}">${escapeHtml(telephonyStatusLabel(call.status))}</span>
              </div>
              <p>${escapeHtml(call.topic || "Telefonat")}</p>
              ${call.notes ? `<p class="telephony-note">${escapeHtml(call.notes)}</p>` : ""}
              <dl class="telephony-call-meta">
                <div><dt>Nummer</dt><dd>${escapeHtml(formatPhoneDisplay(call.phone))}</dd></div>
                <div><dt>Naechster Schritt</dt><dd>${escapeHtml(call.nextAction || "-")}</dd></div>
              </dl>
              <div class="telephony-controls">
                <label>
                  <span>Status</span>
                  <select data-telephony-status="${escapeHtml(call.id)}">${statusOptions}</select>
                </label>
                <label>
                  <span>Naechster Schritt</span>
                  <textarea rows="2" data-telephony-next="${escapeHtml(call.id)}">${escapeHtml(call.nextAction || "")}</textarea>
                </label>
                <button type="button" class="button secondary mini" data-telephony-google-fi="${escapeHtml(call.id)}">Google Fi</button>
                <button type="button" class="button secondary mini" data-telephony-dial="${escapeHtml(call.id)}">Dialer</button>
              </div>
            </article>
          `;
        })
        .join("")
    : `<p class="muted telephony-empty">Noch keine Telefonate gespeichert.</p>`;

  for (const button of $("telephonyContacts").querySelectorAll("[data-telephony-use-contact]")) {
    button.addEventListener("click", () => {
      const contact = contacts.find((item) => item.id === button.dataset.telephonyUseContact);
      if (!contact) return;
      $("telephonyContact").value = contact.id;
      $("telephonyPhone").value = formatPhoneDisplay(contact.phone);
      $("telephonyTopic").value = $("telephonyTopic").value.trim() || contact.context || "";
      $("telephonyNotes").focus();
    });
  }
  for (const button of $("telephonyContacts").querySelectorAll("[data-telephony-copy-contact]")) {
    button.addEventListener("click", () => {
      const contact = contacts.find((item) => item.id === button.dataset.telephonyCopyContact);
      copyTelephonyNumber(button.id || "copyTelephonyNumber", contact?.phone).catch((error) => alert(error.message));
    });
  }
  for (const select of $("telephonyCallLog").querySelectorAll("[data-telephony-status]")) {
    select.addEventListener("change", () => updateTelephonyCall(select.dataset.telephonyStatus, { status: select.value }));
  }
  for (const input of $("telephonyCallLog").querySelectorAll("[data-telephony-next]")) {
    input.addEventListener("change", () => updateTelephonyCall(input.dataset.telephonyNext, { nextAction: input.value.trim() }));
  }
  for (const button of $("telephonyCallLog").querySelectorAll("[data-telephony-google-fi]")) {
    button.addEventListener("click", () => {
      const call = calls.find((item) => item.id === button.dataset.telephonyGoogleFi);
      openGoogleFiWeb(button.id || "openGoogleFiWeb", call?.phone).catch((error) => alert(error.message));
    });
  }
  for (const button of $("telephonyCallLog").querySelectorAll("[data-telephony-dial]")) {
    button.addEventListener("click", () => {
      const call = calls.find((item) => item.id === button.dataset.telephonyDial);
      openTelephonyDialer(call?.phone);
    });
  }
}

function renderOperationsTree() {
  const list = $("operationsTreeList");
  if (!list) return;
  const manifest = operationsManifest || {};
  const domains = Array.isArray(manifest.domains) ? manifest.domains : [];
  const runtimePolicy = manifest.runtimePolicy || {};
  const runtimeLabel = runtimePolicy.defaultTarget === "proxmox_vm" ? "Proxmox-VM" : runtimePolicy.defaultTarget || "lokal";
  const activeCount = domains.filter((domain) => domain.status === "active").length;
  const plannedCount = domains.filter((domain) => domain.status === "planned").length;

  $("operationsTreeMeta").textContent = domains.length
    ? `${activeCount} aktiv, ${plannedCount} vorbereitet. Standardbetrieb: ${runtimeLabel}. Dienste: Kalender, Dokumente, Zahlungen, Maengel, Hermes und GBrain.`
    : "Arbeitsbaum noch nicht geladen.";
  $("operationsTreePill").textContent = domains.length ? `${domains.length} Bereiche` : "Laedt";
  $("operationsTreePill").className = `pill ${activeCount ? "green" : "blue"}`;

  if (!domains.length) {
    list.innerHTML = `<p class="muted operations-tree-empty">Kein Operations-Manifest geladen.</p>`;
    return;
  }

  list.innerHTML = domains
    .map((domain) => {
      const status = domain.status === "active" ? "aktiv" : "vorbereitet";
      const level = domain.status === "active" ? "green" : "blue";
      const source = domain.sourceOfTruth || "noch keine Quelle";
      const deployment = domain.deployment || domain.deploymentPlan || {};
      const runtime = deployment.target === "proxmox_vm" ? "Proxmox-VM" : deployment.target || runtimeLabel;
      const capabilities = (domain.sharedCapabilities || []).slice(0, 6).join(" · ");
      return `
        <article class="operations-domain-card ${level}">
          <div class="operations-domain-header">
            <div>
              <span>${escapeHtml(domain.primaryObject || "domain")}</span>
              <strong>${escapeHtml(domain.label || domain.id || "Bereich")}</strong>
            </div>
            <span class="pill ${level}">${escapeHtml(status)}</span>
          </div>
          <p>${escapeHtml(domain.scope || "")}</p>
          <dl class="operations-domain-facts">
            <div><dt>Quelle</dt><dd>${escapeHtml(source)}</dd></div>
            <div><dt>Betrieb</dt><dd>${escapeHtml(runtime)}</dd></div>
            <div><dt>Dienste</dt><dd>${escapeHtml(capabilities || "noch nicht festgelegt")}</dd></div>
          </dl>
        </article>
      `;
    })
    .join("");
}

function renderCalendar() {
  $("calendarGenerated").textContent = calendar.generated_at ? `Stand ${calendar.generated_at.slice(0, 10)}` : "";
  $("calendarList").innerHTML = "";

  for (const event of calendar.events || []) {
    const caseItem = matchingCase(event);
    const kind = reservationType(event);
    const row = document.createElement(caseItem ? "button" : "div");
    if (caseItem) row.type = "button";
    row.className = `calendar-item ${caseItem?.id === selectedCaseId ? "active" : ""}`;

    const title = caseItem?.guestName || (kind === "reserved" ? "Reservierung ohne Akte" : "Blockierung / Puffer");
    const badge = caseItem ? risk(caseItem) : { level: kind === "reserved" ? "amber" : "blue", text: kind === "reserved" ? "Akte fehlt" : "Block" };
    const days = daysBetween(today, event.start);

    row.innerHTML = `
      <div class="calendar-item-header">
        <strong>${escapeHtml(title)}</strong>
        <span class="pill ${badge.level}">${escapeHtml(badge.text)}</span>
      </div>
      <p class="muted">${formatDate(event.start)} bis ${formatDate(event.end)} · ${days === null ? "-" : `${days} Tage`}</p>
      <p class="muted">${escapeHtml(calendarSummaryLabel(event.summary))}</p>
    `;

    if (!caseItem && kind === "reserved") {
      const createButton = document.createElement("button");
      createButton.type = "button";
      createButton.className = "button secondary mini";
      createButton.textContent = "Akte anlegen";
      createButton.addEventListener("click", () => createCaseFromEvent(event));
      row.append(createButton);
    }

    row.addEventListener("click", () => {
      if (caseItem) {
        selectedCaseId = caseItem.id;
        render();
      }
    });
    $("calendarList").append(row);
  }
}

function createCaseFromEvent(event) {
  const guestName = window.prompt("Gastname fuer diese Reservierung:", "Neue Airbnb-Reservierung");
  if (!guestName) return;
  const reservationCode = window.prompt("Airbnb-Reservierungscode, falls bekannt:", "") || "";
  const email = window.prompt("E-Mail des Gasts, falls bekannt:", "") || "";
  const deadlineDocuments = addDays(today, daysBetween(today, event.start) !== null && daysBetween(today, event.start) < 14 ? 2 : 7);
  const id = uniqueCaseId(`${slugify(guestName)}-${event.start}`);
  const caseItem = {
    id,
    source: "airbnb-ical",
    calendarUid: event.uid,
    guestName,
    start: event.start,
    end: event.end,
    adults: 2,
    reservationCode,
    email,
    status: "airbnb_initial_message_due",
    checkInLocked: true,
    documentPacketSentAt: "",
    deadlineDocuments,
    cancellationReviewAt: addDays(deadlineDocuments, 1),
    airbnbSupportAt: addDays(deadlineDocuments, 3),
    decisionBy: addDays(deadlineDocuments, 4),
    gmail: {
      searchTerms: [email, reservationCode, guestName, "Palma Del Mar"].filter(Boolean),
      lastCheckedAt: "",
      replyStatus: "",
      hoaStatus: "not_submitted",
      outboundDraftId: "",
    },
    checklist: Object.fromEntries(Object.keys(checklistLabels).map((key) => [key, false])),
    timeline: [{ date: today, text: "Fallakte aus Airbnb-iCal-Reservierung angelegt." }],
    communicationEvidence: [],
  };
  ensureDocumentStatus(caseItem);
  appState.cases.push(caseItem);
  paymentItems().push(createPaymentForCase(caseItem));
  selectedCaseId = id;
  render();
  saveState(true).catch((error) => alert(error.message));
}

function renderCaseSummary(caseItem) {
  const missing = missingChecklistItems(caseItem);
  const requiredMissing = missing.filter((item) => item.key !== "boardApproval");
  const nextDeadline = [
    ["Unterlagen", caseItem.deadlineDocuments],
    ["Storno-Pruefung", caseItem.cancellationReviewAt],
    ["Airbnb Support", caseItem.airbnbSupportAt],
    ["Entscheidung", caseItem.decisionBy],
  ].find(([, value]) => value && daysBetween(today, value) >= 0);
  const approval = caseItem.checklist?.boardApproval;
  const guard = guardrailForCase(caseItem);
  const payment = paymentForCase(caseItem);
  const paymentBadge = paymentRisk(payment);

  $("caseSummary").innerHTML = `
    <div class="summary-tile ${requiredMissing.length ? "amber" : "green"}">
      <span>Unterlagen</span>
      <strong>${requiredMissing.length ? `${requiredMissing.length} offen` : "vollstaendig"}</strong>
      <small>${requiredMissing.slice(0, 2).map((item) => escapeHtml(item.label)).join(", ") || "Keine fehlenden Pflichtunterlagen"}</small>
    </div>
    <div class="summary-tile ${approval ? "green" : "red"}">
      <span>Board Approval</span>
      <strong>${approval ? "vorhanden" : "fehlt"}</strong>
      <small>${approval ? "Check-in darf vorbereitet werden" : "Ohne Approval keine Zugangsdaten"}</small>
    </div>
    <div class="summary-tile ${guard.level}">
      <span>Naechste Frist</span>
      <strong>${nextDeadline ? escapeHtml(nextDeadline[0]) : "keine"}</strong>
      <small>${nextDeadline ? relativeDateText(nextDeadline[1]) : "Keine offene Frist fuer diesen Fall"}</small>
    </div>
    <div class="summary-tile ${paymentBadge.level}">
      <span>Airbnb-Zahlung</span>
      <strong>${escapeHtml(paymentBadge.text)}</strong>
      <small>${payment ? `${escapeHtml(paymentStatusLabel(payment.status))}${payment.receivedPayout ? ` · erhalten ${escapeHtml(payment.receivedPayout)} ${escapeHtml(payment.currency || "")}` : ""}` : "Kein Zahlungseintrag"}</small>
    </div>
  `;
}

function sortedCommunicationEvidence(caseItem) {
  return [...(caseItem.communicationEvidence || [])].sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
}

function renderCommunicationEvidence(caseItem) {
  const target = $("communicationEvidence");
  if (!target) return;
  const entries = sortedCommunicationEvidence(caseItem);
  if (!entries.length) {
    target.innerHTML = `<p class="muted communication-empty">Noch keine WhatsApp-, iMessage- oder Airbnb-Hinweise gespeichert.</p>`;
    return;
  }
  target.innerHTML = entries
    .map((entry) => {
      const channelClass = entry.channel === "whatsapp" ? "green" : entry.channel === "imessage" ? "blue" : entry.channel === "airbnb" ? "amber" : "blue";
      return `
        <article class="communication-card">
          <div class="communication-card-header">
            <div>
              <strong>${escapeHtml(communicationChannelLabel(entry.channel))}</strong>
              <p>${formatDate(entry.date)} · ${escapeHtml(communicationDirectionLabel(entry.direction))}${entry.contact ? ` · ${escapeHtml(entry.contact)}` : ""}</p>
            </div>
            <span class="pill ${channelClass}">${escapeHtml(communicationChannelLabel(entry.channel))}</span>
          </div>
          <p>${escapeHtml(entry.summary)}</p>
          ${entry.impact ? `<p class="communication-impact">${escapeHtml(entry.impact)}</p>` : ""}
          ${entry.source ? `<p class="muted communication-source">${escapeHtml(entry.source)}</p>` : ""}
        </article>
      `;
    })
    .join("");
}

function promptBoardApprovalEvidence(caseItem) {
  const source = window.prompt("Approval-Beleg: Absender/Betreff oder kurzer Hinweis:");
  if (!source) return false;
  const approvalDate = window.prompt("Approval-Datum:", today) || today;
  caseItem.boardApprovalEvidence = { date: approvalDate, source };
  caseItem.timeline = caseItem.timeline || [];
  const text = `Board Approval belegt: ${source}`;
  if (!caseItem.timeline.some((entry) => entry.date === approvalDate && entry.text === text)) {
    caseItem.timeline.push({ date: approvalDate, text });
  }
  return true;
}

function updateDocumentStatus(caseItem, key, status) {
  const documentStatus = ensureDocumentStatus(caseItem);
  if (key === "boardApproval" && status === "approved" && !caseItem.checklist?.boardApproval) {
    if (!promptBoardApprovalEvidence(caseItem)) return false;
  }
  documentStatus[key] = {
    ...(documentStatus[key] || {}),
    status,
    updatedAt: today,
  };
  setChecklistFromDocumentStatus(caseItem, key, status);
  return true;
}

function renderDocumentStatus(caseItem) {
  const target = $("documentStatusList");
  if (!target) return;
  const documentStatus = ensureDocumentStatus(caseItem);
  const done = documentStatusDefinitions.filter(([key]) => completedDocumentStatuses.has(documentStatus[key]?.status)).length;
  $("documentStatusMeta").textContent = `${done} von ${documentStatusDefinitions.length} erledigt`;

  target.innerHTML = documentStatusDefinitions
    .map(([key, label, detail]) => {
      const entry = documentStatus[key] || {};
      const level = documentStatusClass(entry.status);
      const options = documentStatusOptions
        .map(([value, optionLabel]) => `<option value="${value}" ${entry.status === value ? "selected" : ""}>${optionLabel}</option>`)
        .join("");
      return `
        <article class="document-card ${level}">
          <div class="document-card-header">
            <div>
              <strong>${escapeHtml(label)}</strong>
              <p>${escapeHtml(detail)}</p>
            </div>
            <span class="pill ${level}">${escapeHtml(documentStatusLabel(entry.status))}</span>
          </div>
          <div class="document-card-controls">
            <label>
              <span>Status</span>
              <select data-document-status="${escapeHtml(key)}">${options}</select>
            </label>
            <small>${entry.updatedAt ? `Stand ${formatDate(entry.updatedAt)}` : "Noch kein Stand"}${entry.source ? ` · ${escapeHtml(entry.source)}` : ""}</small>
          </div>
        </article>
      `;
    })
    .join("");

  for (const select of target.querySelectorAll("[data-document-status]")) {
    select.addEventListener("change", () => {
      const changed = updateDocumentStatus(caseItem, select.dataset.documentStatus, select.value);
      if (!changed) {
        render();
        return;
      }
      render();
      saveState(false)
        .then(() => loadDailyCheckSilently())
        .catch((error) => alert(error.message));
    });
  }
}

function decisionPathLevel(step) {
  if (step.complete) return "green";
  if (step.blocked) return "red";
  const diff = step.date ? daysBetween(today, step.date) : null;
  if (diff !== null && diff < 0) return "red";
  if (diff !== null && diff <= 2) return "amber";
  return "blue";
}

function decisionPathSteps(caseItem) {
  const docsReady = requiredDocumentsReady(caseItem);
  const submitted = Boolean(caseItem.checklist?.submittedToHoa);
  const approved = Boolean(caseItem.checklist?.boardApproval);
  return [
    {
      key: "documents",
      label: "Unterlagen vollstaendig",
      date: caseItem.deadlineDocuments,
      complete: docsReady,
      detail: docsReady
        ? "Alle Pflichtunterlagen und Fee-Nachverfolgung sind abgehakt."
        : "Fehlende Unterlagen aktiv nachfassen. Check-in bleibt gesperrt.",
    },
    {
      key: "submission",
      label: "An HOA einreichen",
      date: caseItem.cancellationReviewAt || caseItem.deadlineDocuments,
      complete: submitted,
      blocked: !docsReady,
      detail: submitted
        ? "Paket ist bei HOA/Verwaltung eingereicht."
        : docsReady
          ? "Jetzt an Example Property Management / Tenant Evaluation einreichen."
          : "Einreichung ist blockiert, solange Pflichtunterlagen fehlen.",
    },
    {
      key: "support",
      label: "Airbnb Support / Storno pruefen",
      date: caseItem.airbnbSupportAt || caseItem.cancellationReviewAt,
      complete: approved || caseItem.status === "approved",
      blocked: !submitted && caseItem.airbnbSupportAt && daysBetween(today, caseItem.airbnbSupportAt) <= 0,
      detail: approved
        ? "Nicht noetig, weil Board Approval vorliegt."
        : "Wenn Unterlagen oder HOA-Freigabe nicht rechtzeitig vorliegen, Dossier nutzen und Airbnb Support einschalten.",
    },
    {
      key: "decision",
      label: "Entscheidung treffen",
      date: caseItem.decisionBy,
      complete: approved,
      blocked: !approved && caseItem.decisionBy && daysBetween(today, caseItem.decisionBy) <= 0,
      detail: approved
        ? "Freigabe ist entschieden."
        : "Bis hier muss klar sein: fortsetzen mit Approval oder Airbnb-/Storno-Prozess.",
    },
    {
      key: "checkin",
      label: "Check-in freigeben",
      date: caseItem.start,
      complete: approved && !caseItem.checkInLocked,
      blocked: !approved,
      detail: approved
        ? "Check-in-Kommunikation ist erlaubt."
        : "Keine Zugangsdaten senden, solange Board Approval fehlt.",
    },
  ];
}

function renderDecisionPath(caseItem) {
  const target = $("decisionPathList");
  if (!target) return;
  const steps = decisionPathSteps(caseItem);
  const blocked = steps.filter((step) => decisionPathLevel(step) === "red").length;
  const done = steps.filter((step) => step.complete).length;
  $("decisionPathMeta").textContent = `${done} von ${steps.length} erledigt${blocked ? ` · ${blocked} kritisch` : ""}`;
  target.innerHTML = steps
    .map((step, index) => {
      const level = decisionPathLevel(step);
      const statusText = step.complete ? "erledigt" : step.blocked ? "blockiert" : step.date ? relativeDateText(step.date) : "offen";
      return `
        <article class="decision-step ${level}">
          <div class="decision-step-index">${index + 1}</div>
          <div class="decision-step-body">
            <div class="decision-step-header">
              <strong>${escapeHtml(step.label)}</strong>
              <span class="pill ${level}">${escapeHtml(statusText)}</span>
            </div>
            <p>${escapeHtml(step.detail)}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderCase() {
  const caseItem = appState.cases.find((item) => item.id === selectedCaseId) || appState.cases[0];
  if (!caseItem) return;
  selectedCaseId = caseItem.id;

  $("caseTitle").textContent = caseItem.guestName;
  $("caseSubtitle").textContent = `${formatDate(caseItem.start)} bis ${formatDate(caseItem.end)} · ${caseItem.reservationCode || "ohne Reservierungscode"} · ${completion(caseItem)}% erledigt`;

  $("caseStatus").innerHTML = statusOptions
    .map(([value, label]) => `<option value="${value}" ${value === "approved" && !caseItem.checklist?.boardApproval ? "disabled" : ""}>${label}</option>`)
    .join("");
  $("caseStatus").value = caseItem.status;

  $("alertStrip").innerHTML = "";
  for (const alert of deriveAlerts(caseItem)) {
    const pill = document.createElement("span");
    pill.className = `pill ${alert.level}`;
    pill.textContent = alert.text;
    $("alertStrip").append(pill);
  }
  renderCaseSummary(caseItem);

  $("checklist").innerHTML = "";
  for (const [key, label] of Object.entries(checklistLabels)) {
    const row = document.createElement("label");
    const checked = Boolean(caseItem.checklist?.[key]);
    row.className = `check-row ${checked ? "complete" : "missing"} ${key === "boardApproval" ? "critical" : ""}`;
    row.innerHTML = `<input type="checkbox" ${caseItem.checklist?.[key] ? "checked" : ""} /><span>${label}</span>`;
    row.querySelector("input").addEventListener("change", (event) => {
      if (key === "boardApproval" && event.target.checked) {
        if (!promptBoardApprovalEvidence(caseItem)) {
          event.target.checked = false;
          return;
        }
      }
      caseItem.checklist[key] = event.target.checked;
      if (key === "boardApproval" && event.target.checked) {
        caseItem.status = "approved";
        caseItem.checkInLocked = false;
      }
      if (key === "boardApproval" && !event.target.checked) {
        caseItem.status = "waiting_for_board_approval";
        caseItem.checkInLocked = true;
        delete caseItem.boardApprovalEvidence;
      }
      const documentStatus = ensureDocumentStatus(caseItem);
      if (documentStatus[key]) {
        documentStatus[key] = {
          ...documentStatus[key],
          status: event.target.checked ? defaultDocumentStatus(caseItem, key) : "missing",
          updatedAt: today,
        };
      }
      render();
      saveState(false).catch((error) => alert(error.message));
    });
    $("checklist").append(row);
  }

  const deadlines = [
    ["Dokumente faellig", caseItem.deadlineDocuments],
    ["Cancellation Review", caseItem.cancellationReviewAt],
    ["Airbnb Support", caseItem.airbnbSupportAt],
    ["Entscheidung", caseItem.decisionBy],
    ["Check-in", caseItem.start],
  ];
  $("deadlineList").innerHTML = deadlines
    .filter(([, value]) => value)
    .map(([label, value]) => `<div class="deadline"><dt>${label}</dt><dd>${formatDate(value)}</dd></div>`)
    .join("");

  $("timeline").innerHTML = (caseItem.timeline || [])
    .map((entry) => `<div class="timeline-item"><span class="timeline-date">${formatDate(entry.date)}</span><span class="timeline-text">${escapeHtml(entry.text)}</span></div>`)
    .join("");
  renderDocumentStatus(caseItem);
  renderDecisionPath(caseItem);
  renderCommunicationEvidence(caseItem);

  const action = nextAction(caseItem);
  $("nextAction").innerHTML = `
    <strong>${action[0]}</strong>
    <p>${action[1]}</p>
    <div class="next-action-buttons">
      <button id="nextCopyText" class="button primary full" type="button">${actionCopyLabel(caseItem)}</button>
      <button id="nextCopyDossier" class="button secondary full" type="button">Dossier kopieren</button>
    </div>
  `;
  $("nextCopyText").addEventListener("click", () => copyCaseTemplate(caseItem, "nextCopyText").catch((error) => alert(error.message)));
  $("nextCopyDossier").addEventListener("click", () => copyDossierForCase(caseItem, "nextCopyDossier").catch((error) => alert(error.message)));

  renderAISuggestions(caseItem);
  renderGmailSync(caseItem);
  renderTemplate(caseItem);
}

function renderGmailSync(caseItem) {
  const gmail = caseItem.gmail || {};
  const automation = appState.automation || {};
  const terms = (gmail.searchTerms || [caseItem.email, caseItem.reservationCode, caseItem.guestName]).filter(Boolean);
  const statusText = gmailReplyLabel(gmail.replyStatus);
  $("gmailStatusPill").textContent = statusText;
  const amberGmailStatuses = ["documents_missing_after_reply", "no_reply_after_packet"];
  $("gmailStatusPill").className = `pill ${amberGmailStatuses.includes(gmail.replyStatus) ? "amber" : gmail.replyStatus === "approved_thread_found" ? "green" : "blue"}`;
  $("gmailSync").innerHTML = `
    <dl class="sync-list">
      <div><dt>Letzte E-Mail-Pruefung</dt><dd>${formatDate(gmail.lastCheckedAt || automation.lastGmailReviewAt)}</dd></div>
      <div><dt>HOA-Status</dt><dd>${escapeHtml(gmail.hoaStatus || "unbekannt")}</dd></div>
      <div><dt>Entwurf</dt><dd>${escapeHtml(gmail.outboundDraftId || caseItem.reminderDraftId || "-")}</dd></div>
      <div><dt>Letzte KI-Pruefung</dt><dd>${formatDate(automation.lastHermesSyncAt)}</dd></div>
    </dl>
    <details class="technical-details">
      <summary>Suchbegriffe und technische Spur</summary>
      <div class="search-chips">
        ${terms.map((term) => `<span>${escapeHtml(term)}</span>`).join("")}
      </div>
      <p class="muted">Skill: ${escapeHtml(automation.hermesSkillPath || "hermes-skills/airbnb-hoa-operations")}</p>
    </details>
    ${caseItem.hermesRecommendation ? `<p class="sync-recommendation">${escapeHtml(caseItem.hermesRecommendation)}</p>` : ""}
    <p class="muted sync-note">Neue Ergebnisse landen zuerst als KI-Vorschlag. Es wird nichts automatisch freigegeben.</p>
  `;
}

function renderAISuggestions(caseItem) {
  const target = $("aiSuggestions");
  if (!target) return;
  const allSuggestions = suggestionsForCase(caseItem.id);
  const pending = allSuggestions.filter((suggestion) => suggestion.status === "pending");
  const visibleSuggestions = [...pending, ...allSuggestions.filter((suggestion) => suggestion.status !== "pending").slice(0, 1)];
  $("suggestionStatusPill").textContent = `${pending.length} offen`;
  $("suggestionStatusPill").className = `pill ${pending.length ? "amber" : "green"}`;

  if (!visibleSuggestions.length) {
    target.innerHTML = `<p class="muted suggestion-empty">Keine offenen KI-Vorschlaege fuer diesen Fall.</p>`;
    return;
  }

  target.innerHTML = visibleSuggestions
    .map((suggestion) => {
      const evidence = Array.isArray(suggestion.evidence) ? suggestion.evidence.filter(Boolean) : [];
      const statusClass = suggestion.status === "pending" ? "amber" : suggestion.status === "accepted" ? "green" : "red";
      const actions = suggestion.status === "pending"
        ? `<div class="suggestion-actions">
            <button type="button" class="button primary mini" data-accept-suggestion="${escapeHtml(suggestion.id)}">Uebernehmen</button>
            <button type="button" class="button secondary mini" data-reject-suggestion="${escapeHtml(suggestion.id)}">Ablehnen</button>
          </div>`
        : "";
      return `
        <article class="suggestion-card ${escapeHtml(suggestion.status || "pending")}">
          <div class="suggestion-header">
            <strong>${escapeHtml(suggestion.title || "KI-Vorschlag")}</strong>
            <span class="pill ${statusClass}">${escapeHtml(suggestionStatusLabel(suggestion.status))}</span>
          </div>
          <p>${escapeHtml(suggestion.detail || "Hermes hat neue Hinweise gefunden.")}</p>
          <dl class="suggestion-meta">
            <div><dt>Quelle</dt><dd>${escapeHtml(suggestion.source || "Hermes")}</dd></div>
            <div><dt>Datum</dt><dd>${formatDate(suggestion.generatedAt)}</dd></div>
            <div><dt>Sicherheit</dt><dd>${escapeHtml(suggestionConfidenceLabel(suggestion.confidence))}</dd></div>
          </dl>
          ${evidence.length ? `<div class="suggestion-evidence">${evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
          ${actions}
        </article>
      `;
    })
    .join("");

  for (const button of target.querySelectorAll("[data-accept-suggestion]")) {
    button.addEventListener("click", () => applySuggestion(button.dataset.acceptSuggestion).catch((error) => alert(error.message)));
  }
  for (const button of target.querySelectorAll("[data-reject-suggestion]")) {
    button.addEventListener("click", () => rejectSuggestion(button.dataset.rejectSuggestion).catch((error) => alert(error.message)));
  }
}

function sortedInboxItems() {
  const statusOrder = { new: 0, reviewed: 1, applied: 2, ignored: 3 };
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  return [...ensureInboxItems()].sort((left, right) => {
    const leftStatus = statusOrder[left.status || "new"] ?? 9;
    const rightStatus = statusOrder[right.status || "new"] ?? 9;
    if (leftStatus !== rightStatus) return leftStatus - rightStatus;
    const leftPriority = priorityOrder[left.priority || "medium"] ?? 9;
    const rightPriority = priorityOrder[right.priority || "medium"] ?? 9;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return String(right.date || "").localeCompare(String(left.date || ""));
  });
}

function updateInboxItem(id, patch) {
  const item = ensureInboxItems().find((entry) => entry.id === id);
  if (!item) return;
  Object.assign(item, patch);
  render();
  saveState(false).catch((error) => alert(error.message));
}

function renderInbox() {
  const target = $("inboxList");
  if (!target) return;
  const items = sortedInboxItems();
  const open = items.filter((item) => !["applied", "ignored"].includes(item.status || "new"));
  const high = open.filter((item) => item.priority === "high").length;
  const pill = $("inboxStatusPill");
  pill.textContent = `${open.length} offen`;
  pill.className = `pill ${high ? "red" : open.length ? "amber" : "green"}`;

  if (!items.length) {
    target.innerHTML = `<p class="muted inbox-empty">Keine neuen Eingänge gespeichert. Neue Hermes-, Gmail-, WhatsApp- oder iMessage-Hinweise koennen hier landen.</p>`;
    return;
  }

  target.innerHTML = items
    .slice(0, 10)
    .map((item) => {
      const status = item.status || "new";
      const level = item.priority === "high" ? "red" : status === "new" ? "amber" : status === "reviewed" ? "blue" : "green";
      const caseText = item.caseId ? caseLabel(item.caseId) : communicationChannelLabel(item.channel);
      return `
        <article class="inbox-card ${level}">
          <div class="inbox-card-header">
            <div>
              <strong>${escapeHtml(item.title || "Neuer Eingang")}</strong>
              <p>${formatDate(item.date)} · ${escapeHtml(caseText || "ohne Zuordnung")} · ${escapeHtml(communicationChannelLabel(item.channel))}</p>
            </div>
            <span class="pill ${level}">${escapeHtml(status === "new" ? inboxPriorityLabel(item.priority) : inboxStatusLabel(status))}</span>
          </div>
          <p>${escapeHtml(item.summary || "")}</p>
          ${item.impact ? `<p class="communication-impact">${escapeHtml(item.impact)}</p>` : ""}
          <div class="inbox-actions">
            ${item.caseId ? `<button type="button" class="button secondary mini" data-inbox-case="${escapeHtml(item.caseId)}">Fall anzeigen</button>` : ""}
            ${status !== "reviewed" && status !== "applied" ? `<button type="button" class="button secondary mini" data-inbox-reviewed="${escapeHtml(item.id)}">Geprueft</button>` : ""}
            ${status !== "applied" ? `<button type="button" class="button secondary mini" data-inbox-applied="${escapeHtml(item.id)}">Erledigt</button>` : ""}
            ${status !== "ignored" ? `<button type="button" class="button secondary mini" data-inbox-ignored="${escapeHtml(item.id)}">Ignorieren</button>` : ""}
          </div>
        </article>
      `;
    })
    .join("");

  for (const button of target.querySelectorAll("[data-inbox-case]")) {
    button.addEventListener("click", () => {
      selectedCaseId = button.dataset.inboxCase;
      render();
      $("casePanel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  for (const button of target.querySelectorAll("[data-inbox-reviewed]")) {
    button.addEventListener("click", () => updateInboxItem(button.dataset.inboxReviewed, { status: "reviewed" }));
  }
  for (const button of target.querySelectorAll("[data-inbox-applied]")) {
    button.addEventListener("click", () => updateInboxItem(button.dataset.inboxApplied, { status: "applied" }));
  }
  for (const button of target.querySelectorAll("[data-inbox-ignored]")) {
    button.addEventListener("click", () => updateInboxItem(button.dataset.inboxIgnored, { status: "ignored" }));
  }
}

function caseLabel(caseId) {
  if (!caseId) return "ohne Buchungsbezug";
  const caseItem = appState.cases.find((item) => item.id === caseId);
  if (!caseItem) return caseId;
  return `${caseItem.guestName} · ${formatDate(caseItem.start)}`;
}

function renderMaintenanceCaseOptions() {
  const options = [
    `<option value="">ohne Buchungsbezug</option>`,
    ...appState.cases.map((caseItem) => `<option value="${escapeHtml(caseItem.id)}">${escapeHtml(caseLabel(caseItem.id))}</option>`),
  ];
  $("maintenanceCase").innerHTML = options.join("");
}

function maintenanceId(item, reportedAt) {
  return `maint-${slugify(item)}-${reportedAt || today}-${Date.now().toString(36)}`;
}

function createMaintenanceItem(event) {
  event.preventDefault();
  const item = $("maintenanceItem").value.trim();
  const title = $("maintenanceTitle").value.trim();
  if (!item || !title) return;
  const reportedAt = $("maintenanceReportedAt").value || today;
  const nextItem = {
    id: maintenanceId(item, reportedAt),
    item,
    room: $("maintenanceRoom").value,
    title,
    description: $("maintenanceDescription").value.trim(),
    priority: $("maintenancePriority").value,
    status: $("maintenanceStatus").value,
    reportedAt,
    dueDate: $("maintenanceDueDate").value,
    caseId: $("maintenanceCase").value,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  ensureMaintenanceItems().push(nextItem);
  event.target.reset();
  $("maintenanceReportedAt").value = today;
  $("maintenancePriority").value = "medium";
  $("maintenanceStatus").value = "open";
  render();
  saveState(true)
    .then(() => loadDailyCheckSilently())
    .catch((error) => alert(error.message));
}

function updateMaintenanceItem(id, patch) {
  const item = ensureMaintenanceItems().find((entry) => entry.id === id);
  if (!item) return;
  Object.assign(item, patch, { updatedAt: new Date().toISOString() });
  render();
  saveState(false)
    .then(() => loadDailyCheckSilently())
    .catch((error) => alert(error.message));
}

function renderMaintenance() {
  renderMaintenanceCaseOptions();
  const items = sortedMaintenanceItems();
  const active = activeMaintenanceItems();
  const high = active.filter((item) => item.priority === "high").length;
  $("maintenanceStatusPill").textContent = `${active.length} offen`;
  $("maintenanceStatusPill").className = `pill ${high ? "red" : active.length ? "amber" : "green"}`;
  $("maintenanceListMeta").textContent = high ? `${high} dringend` : active.length ? "Status offen" : "Keine offenen Maengel";

  if (!$("maintenanceReportedAt").value) $("maintenanceReportedAt").value = today;

  if (!items.length) {
    $("maintenanceList").innerHTML = `<p class="muted maintenance-empty">Noch keine Maengel erfasst.</p>`;
    return;
  }

  $("maintenanceList").innerHTML = items
    .map((item) => {
      const risk = maintenanceRisk(item);
      const statusOptions = maintenanceStatusOptions
        .map(([value, label]) => `<option value="${value}" ${item.status === value ? "selected" : ""}>${label}</option>`)
        .join("");
      const priorityOptions = maintenancePriorityOptions
        .map(([value, label]) => `<option value="${value}" ${item.priority === value ? "selected" : ""}>${label}</option>`)
        .join("");
      return `
        <article class="maintenance-card ${escapeHtml(risk.level)}">
          <div class="maintenance-card-header">
            <div>
              <strong>${escapeHtml(item.item)}</strong>
              <p>${escapeHtml(item.title)}</p>
            </div>
            <span class="pill ${risk.level}">${escapeHtml(risk.text)}</span>
          </div>
          <dl class="maintenance-meta">
            <div><dt>Bereich</dt><dd>${escapeHtml(item.room || "-")}</dd></div>
            <div><dt>Gemeldet</dt><dd>${formatDate(item.reportedAt)}</dd></div>
            <div><dt>Frist</dt><dd>${item.dueDate ? relativeDateText(item.dueDate) : "-"}</dd></div>
            <div><dt>Buchung</dt><dd>${escapeHtml(caseLabel(item.caseId))}</dd></div>
          </dl>
          ${item.description ? `<p class="maintenance-description">${escapeHtml(item.description)}</p>` : ""}
          ${renderProcurementDetails(item)}
          <div class="maintenance-controls">
            <label>
              <span>Status</span>
              <select data-maintenance-status="${escapeHtml(item.id)}">${statusOptions}</select>
            </label>
            <label>
              <span>Dringlichkeit</span>
              <select data-maintenance-priority="${escapeHtml(item.id)}">${priorityOptions}</select>
            </label>
            <label>
              <span>Erledigen bis</span>
              <input type="date" value="${escapeHtml(item.dueDate || "")}" data-maintenance-due="${escapeHtml(item.id)}" />
            </label>
            ${item.status !== "done" ? `<button type="button" class="button secondary mini" data-maintenance-done="${escapeHtml(item.id)}">Erledigt markieren</button>` : ""}
          </div>
        </article>
      `;
    })
    .join("");

  for (const select of $("maintenanceList").querySelectorAll("[data-maintenance-status]")) {
    select.addEventListener("change", () => updateMaintenanceItem(select.dataset.maintenanceStatus, { status: select.value }));
  }
  for (const select of $("maintenanceList").querySelectorAll("[data-maintenance-priority]")) {
    select.addEventListener("change", () => updateMaintenanceItem(select.dataset.maintenancePriority, { priority: select.value }));
  }
  for (const input of $("maintenanceList").querySelectorAll("[data-maintenance-due]")) {
    input.addEventListener("change", () => updateMaintenanceItem(input.dataset.maintenanceDue, { dueDate: input.value }));
  }
  for (const button of $("maintenanceList").querySelectorAll("[data-maintenance-done]")) {
    button.addEventListener("click", () => updateMaintenanceItem(button.dataset.maintenanceDone, { status: "done", completedAt: today }));
  }
}

function renderListingKnowledge() {
  const listing = appState.listingKnowledge || {};
  const capacity = listing.capacity || {};
  const amenities = Array.isArray(listing.advertisedAmenities) ? listing.advertisedAmenities : [];
  const checklist = Array.isArray(listing.cleaningChecklist) ? listing.cleaningChecklist : [];
  const rules = Array.isArray(listing.defectPriorityRules) ? listing.defectPriorityRules : [];

  $("listingStatusPill").textContent = listing.reviewedAt ? `geprueft ${formatDate(listing.reviewedAt)}` : "pruefen";
  $("listingStatusPill").className = `pill ${listing.reviewedAt ? "green" : "amber"}`;
  $("listingMeta").textContent = `${amenities.length} Ausstattungen · ${checklist.length} Reinigungschecks`;

  $("listingSummary").innerHTML = `
    <div class="info-card">
      <span>Airbnb-Titel</span>
      <strong>${escapeHtml(listing.title || appState.property?.listingName || "-")}</strong>
      <p>${escapeHtml(listing.summary || "Noch kein Inseratswissen hinterlegt.")}</p>
      ${listing.sourceUrl ? `<a href="${escapeHtml(listing.sourceUrl)}" target="_blank" rel="noreferrer">Airbnb-Inserat oeffnen</a>` : ""}
    </div>
    <div class="info-grid compact">
      <div><span>Gaeste</span><strong>${escapeHtml(capacity.guests || "-")}</strong></div>
      <div><span>Schlafzimmer</span><strong>${escapeHtml(capacity.bedrooms || "-")}</strong></div>
      <div><span>Betten</span><strong>${escapeHtml(capacity.beds || "-")}</strong></div>
      <div><span>Baeder</span><strong>${escapeHtml(capacity.baths || "-")}</strong></div>
    </div>
    <div class="info-card subtle">
      <span>Mindestregel</span>
      <strong>${escapeHtml(capacity.minimumStay || "HOA Approval erforderlich")}</strong>
    </div>
  `;

  $("listingDetails").innerHTML = `
    <div class="chip-list">${amenities.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
    <div class="check-list-card">
      <h4>Reinigung muss bestaetigen</h4>
      <ul>${checklist.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
    <div class="check-list-card">
      <h4>Maengel mit hoher Wirkung</h4>
      <ul>${rules.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderCleaning() {
  const cleaning = ensureCleaning();
  const projects = [...cleaningProjects()].sort((left, right) => String(cleaningProjectDate(right)).localeCompare(String(cleaningProjectDate(left))));
  const need = nextCleaningNeed();
  const latest = projects[0];

  if (need?.project) {
    $("cleaningStatusPill").textContent = "belegt";
    $("cleaningStatusPill").className = "pill green";
  } else if (need) {
    $("cleaningStatusPill").textContent = "Reinigung fehlt";
    $("cleaningStatusPill").className = "pill amber";
  } else {
    $("cleaningStatusPill").textContent = "OK";
    $("cleaningStatusPill").className = "pill green";
  }

  $("cleaningSummary").innerHTML = `
    <div class="info-card">
      <span>Anbieter</span>
      <strong>${escapeHtml(cleaning.provider || "Turno")}</strong>
      <p>${escapeHtml(cleaning.property || appState.property?.address || "")}</p>
    </div>
    <div class="info-grid">
      <div><span>Standardkraft</span><strong>${escapeHtml(cleaning.primaryCleaner?.displayName || cleaning.primaryCleaner?.name || "-")}</strong></div>
      <div><span>Standardkosten</span><strong>${escapeHtml(cleaning.defaultCharge || cleaning.defaultRate || "-")}</strong></div>
      <div><span>Letzte Pruefung</span><strong>${formatDate(cleaning.lastEmailReviewAt)}</strong></div>
      <div><span>Letztes Projekt</span><strong>${latest ? formatDate(cleaningProjectDate(latest)) : "-"}</strong></div>
    </div>
    <div class="info-card ${need && !need.project ? "warning" : "subtle"}">
      <span>Naechster Reinigungsbedarf</span>
      <strong>${need ? `${formatDate(need.caseItem.end)} · ${escapeHtml(need.caseItem.guestName)}` : "keiner"}</strong>
      <p>${need?.project ? `Turno #${escapeHtml(need.project.projectId)} ist fuer ${formatDate(cleaningProjectDate(need.project))} hinterlegt.` : need ? "Fuer diesen Check-out ist noch kein Turno-Projekt in den gespeicherten E-Mails belegt." : "Keine kommende Reinigung aus den bekannten Buchungen."}</p>
    </div>
  `;

  $("cleaningListMeta").textContent = `${projects.length} Projekte gespeichert`;
  if (!projects.length) {
    $("cleaningProjects").innerHTML = `<p class="muted maintenance-empty">Noch keine Turno-Projekte gespeichert.</p>`;
    return;
  }

  $("cleaningProjects").innerHTML = projects
    .map((project) => {
      const badge = cleaningRisk(project);
      return `
        <article class="operation-card ${badge.level}">
          <div class="operation-card-header">
            <div>
              <strong>Turno #${escapeHtml(project.projectId)}</strong>
              <p>${formatDate(cleaningProjectDate(project))} · ${escapeHtml(project.cleaner || "-")}</p>
            </div>
            <span class="pill ${badge.level}">${escapeHtml(badge.text)}</span>
          </div>
          <dl class="operation-meta">
            <div><dt>Status</dt><dd>${escapeHtml(cleaningStatusLabel(project.status))}</dd></div>
            <div><dt>Kosten</dt><dd>${escapeHtml(project.amount || project.rate || "-")}</dd></div>
            <div><dt>Probleme</dt><dd>${project.problems ?? "-"}</dd></div>
            <div><dt>Bilder</dt><dd>${project.images ?? "-"}</dd></div>
          </dl>
          ${project.note ? `<p>${escapeHtml(project.note)}</p>` : ""}
          ${project.projectUrl ? `<a href="${escapeHtml(project.projectUrl)}" target="_blank" rel="noreferrer">Turno-Projekt oeffnen</a>` : ""}
        </article>
      `;
    })
    .join("");
}

function sortedPaymentItems() {
  const order = { disputed: 0, partial: 1, needs_airbnb_review: 2, expected: 3, paid: 4, cancelled: 5 };
  return [...paymentItems()].sort((left, right) => {
    const leftOrder = order[left.status] ?? 9;
    const rightOrder = order[right.status] ?? 9;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return String(left.stayStart || "").localeCompare(String(right.stayStart || ""));
  });
}

function updatePaymentItem(id, patch) {
  const payment = paymentItems().find((entry) => entry.id === id);
  if (!payment) return;
  Object.assign(payment, patch, { updatedAt: new Date().toISOString() });
  render();
  saveState(false)
    .then(() => loadDailyCheckSilently())
    .catch((error) => alert(error.message));
}

function renderPayments() {
  ensurePaymentsForCases();
  const payments = sortedPaymentItems();
  const open = paymentsNeedingReview();
  const disputed = payments.filter((payment) => ["partial", "disputed"].includes(payment.status));
  const paid = payments.filter((payment) => payment.status === "paid");
  const config = ensurePayments();

  $("paymentsStatusPill").textContent = disputed.length ? `${disputed.length} Problem` : open.length ? `${open.length} pruefen` : "OK";
  $("paymentsStatusPill").className = `pill ${disputed.length ? "red" : open.length ? "amber" : "green"}`;
  $("paymentsListMeta").textContent = `${payments.length} Mieter/Faelle`;

  $("paymentsSummary").innerHTML = `
    <div class="info-grid">
      <div><span>Quelle</span><strong>${escapeHtml(config.source || "Airbnb")}</strong></div>
      <div><span>Airbnb geprueft</span><strong>${formatDate(config.lastAirbnbReviewAt)}</strong></div>
      <div><span>bezahlt markiert</span><strong>${paid.length}</strong></div>
      <div><span>offen/problematisch</span><strong>${open.length}</strong></div>
    </div>
    <div class="info-card ${open.length ? "warning" : "subtle"}">
      <span>Regel</span>
      <strong>Zahlung immer dem Mieter zuordnen</strong>
      <p>${escapeHtml(config.notes || "Betrag und Auszahlung muessen aus Airbnb oder einer bewussten manuellen Eintragung kommen.")}</p>
    </div>
  `;

  if (!payments.length) {
    $("paymentsList").innerHTML = `<p class="muted maintenance-empty">Noch keine Zahlungseintraege gespeichert.</p>`;
    return;
  }

  $("paymentsList").innerHTML = payments
    .map((payment) => {
      const badge = paymentRisk(payment);
      const caseItem = appState.cases.find((item) => item.id === payment.caseId);
      const statusOptions = paymentStatusOptions
        .map(([value, label]) => `<option value="${value}" ${payment.status === value ? "selected" : ""}>${label}</option>`)
        .join("");
      const evidence = Array.isArray(payment.evidence) ? payment.evidence.filter(Boolean) : [];
      return `
        <article class="operation-card payment-card ${badge.level}">
          <div class="operation-card-header">
            <div>
              <strong>${escapeHtml(payment.guestName || caseItem?.guestName || "Mieter")}</strong>
              <p>${formatDate(payment.stayStart || caseItem?.start)} bis ${formatDate(payment.stayEnd || caseItem?.end)} · ${escapeHtml(payment.reservationCode || caseItem?.reservationCode || "ohne Airbnb-Code")}</p>
            </div>
            <span class="pill ${badge.level}">${escapeHtml(badge.text)}</span>
          </div>
          <dl class="operation-meta">
            <div><dt>Erwartet</dt><dd>${escapeHtml(payment.expectedPayout || "-")} ${escapeHtml(payment.currency || "")}</dd></div>
            <div><dt>Erhalten</dt><dd>${escapeHtml(payment.receivedPayout || "-")} ${escapeHtml(payment.currency || "")}</dd></div>
            <div><dt>Auszahlung am</dt><dd>${formatDate(payment.expectedPayoutDate)}</dd></div>
            <div><dt>Geprueft</dt><dd>${formatDate(payment.lastCheckedAt)}</dd></div>
          </dl>
          <div class="payment-controls">
            <label>
              <span>Status</span>
              <select data-payment-status="${escapeHtml(payment.id)}">${statusOptions}</select>
            </label>
            <label>
              <span>Erwartete Auszahlung</span>
              <input value="${escapeHtml(payment.expectedPayout || "")}" placeholder="z.B. 2500.00" data-payment-expected="${escapeHtml(payment.id)}" />
            </label>
            <label>
              <span>Erwartet am</span>
              <input type="date" value="${escapeHtml(payment.expectedPayoutDate || "")}" data-payment-expected-date="${escapeHtml(payment.id)}" />
            </label>
            <label>
              <span>Erhalten</span>
              <input value="${escapeHtml(payment.receivedPayout || "")}" placeholder="z.B. 2500.00" data-payment-received="${escapeHtml(payment.id)}" />
            </label>
            <label>
              <span>Erhalten am</span>
              <input type="date" value="${escapeHtml(payment.receivedAt || "")}" data-payment-received-date="${escapeHtml(payment.id)}" />
            </label>
            <label>
              <span>Airbnb-Transaktion</span>
              <input value="${escapeHtml(payment.airbnbTransactionId || "")}" placeholder="ID oder kurzer Hinweis" data-payment-transaction="${escapeHtml(payment.id)}" />
            </label>
            <label>
              <span>Turno-Kosten</span>
              <input value="${escapeHtml(payment.cleaningCostAmount || "")}" placeholder="z.B. 118.80" data-payment-cleaning="${escapeHtml(payment.id)}" />
            </label>
            <label>
              <span>Notiz</span>
              <input value="${escapeHtml(payment.notes || "")}" data-payment-notes="${escapeHtml(payment.id)}" />
            </label>
          </div>
          <div class="operation-actions">
            ${caseItem ? `<button type="button" class="button secondary mini" data-payment-case="${escapeHtml(caseItem.id)}">Fall anzeigen</button>` : ""}
            <button type="button" class="button secondary mini" data-payment-reviewed="${escapeHtml(payment.id)}">Heute geprueft</button>
          </div>
          ${evidence.length ? `<div class="suggestion-evidence">${evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>` : ""}
        </article>
      `;
    })
    .join("");

  const list = $("paymentsList");
  for (const select of list.querySelectorAll("[data-payment-status]")) {
    select.addEventListener("change", () => updatePaymentItem(select.dataset.paymentStatus, { status: select.value, lastCheckedAt: today }));
  }
  for (const input of list.querySelectorAll("[data-payment-expected]")) {
    input.addEventListener("change", () => updatePaymentItem(input.dataset.paymentExpected, { expectedPayout: input.value.trim(), lastCheckedAt: today }));
  }
  for (const input of list.querySelectorAll("[data-payment-expected-date]")) {
    input.addEventListener("change", () => updatePaymentItem(input.dataset.paymentExpectedDate, { expectedPayoutDate: input.value, lastCheckedAt: today }));
  }
  for (const input of list.querySelectorAll("[data-payment-received]")) {
    input.addEventListener("change", () => updatePaymentItem(input.dataset.paymentReceived, { receivedPayout: input.value.trim(), lastCheckedAt: today }));
  }
  for (const input of list.querySelectorAll("[data-payment-received-date]")) {
    input.addEventListener("change", () => updatePaymentItem(input.dataset.paymentReceivedDate, { receivedAt: input.value, lastCheckedAt: today }));
  }
  for (const input of list.querySelectorAll("[data-payment-transaction]")) {
    input.addEventListener("change", () => updatePaymentItem(input.dataset.paymentTransaction, { airbnbTransactionId: input.value.trim(), lastCheckedAt: today }));
  }
  for (const input of list.querySelectorAll("[data-payment-cleaning]")) {
    input.addEventListener("change", () => updatePaymentItem(input.dataset.paymentCleaning, { cleaningCostAmount: input.value.trim(), lastCheckedAt: today }));
  }
  for (const input of list.querySelectorAll("[data-payment-notes]")) {
    input.addEventListener("change", () => updatePaymentItem(input.dataset.paymentNotes, { notes: input.value.trim(), lastCheckedAt: today }));
  }
  for (const button of list.querySelectorAll("[data-payment-reviewed]")) {
    button.addEventListener("click", () => updatePaymentItem(button.dataset.paymentReviewed, { lastCheckedAt: today }));
  }
  for (const button of list.querySelectorAll("[data-payment-case]")) {
    button.addEventListener("click", () => {
      selectedCaseId = button.dataset.paymentCase;
      render();
      $("casePanel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function renderTemplate(caseItem) {
  $("templateSelect").innerHTML = Object.keys(appState.templates)
    .map((key) => `<option value="${escapeHtml(key)}">${escapeHtml(templateLabels[key] || key)}</option>`)
    .join("");
  const selected = $("templateSelect").value || "airbnbReminder";
  $("templateSelect").value = selected;
  $("templateText").value = fillTemplate(appState.templates[selected], caseItem);
}

function render() {
  ensurePaymentsForCases();
  renderMetrics();
  renderDailyCheck();
  renderIntegrationStatus();
  renderDeviceAccess();
  renderTelephony();
  renderOperationsTree();
  renderTodayFocus();
  renderWorkMode();
  renderInbox();
  renderCalendar();
  renderCase();
  renderListingKnowledge();
  renderPayments();
  renderCleaning();
  renderMaintenance();
}

async function saveState(showFeedback = true) {
  const response = await fetch("/api/state", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(appState),
  });
  if (!response.ok) throw new Error("Speichern fehlgeschlagen");
  if (showFeedback) {
    $("saveState").textContent = "Gespeichert";
    setTimeout(() => ($("saveState").textContent = "Speichern"), 1200);
  }
}

async function refreshCalendar() {
  $("refreshCalendar").textContent = "Aktualisiere...";
  const response = await fetch("/api/refresh-calendar", { method: "POST" });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Kalender-Refresh fehlgeschlagen");
  calendar = payload.calendar;
  $("refreshCalendar").textContent = "Buchungen aktualisieren";
  render();
}

async function syncAppleCalendar() {
  $("syncAppleCalendar").textContent = "Synchronisiere...";
  const response = await fetch("/api/sync-apple-calendar", { method: "POST" });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Mac-Kalender-Sync fehlgeschlagen");
  $("syncAppleCalendar").textContent = "Kalender synchronisiert";
  setTimeout(() => ($("syncAppleCalendar").textContent = "iPhone-Kalender sync"), 1600);
}

async function refreshDailyCheck() {
  $("refreshDailyCheck").textContent = "Pruefe...";
  const response = await fetch("/api/daily-check");
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Tagescheck fehlgeschlagen");
  dailyCheck = payload.report;
  $("refreshDailyCheck").textContent = "Aktualisiert";
  render();
  setTimeout(() => ($("refreshDailyCheck").textContent = "Tagescheck aktualisieren"), 1200);
}

async function refreshIntegrationStatus(showBusy = true) {
  const button = $("refreshIntegrationStatus");
  const original = button?.textContent || "Status pruefen";
  if (showBusy && button) button.textContent = "Pruefe...";
  const response = await fetch("/api/integration-status");
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Integrationsstatus fehlgeschlagen");
  integrationStatus = payload.report;
  renderIntegrationStatus();
  if (showBusy && button) {
    button.textContent = "Aktualisiert";
    setTimeout(() => (button.textContent = original), 1200);
  }
}

async function refreshDisplayInfo(showBusy = true) {
  const button = $("refreshDisplayInfo");
  const original = button?.textContent || "Wege pruefen";
  if (showBusy && button) button.textContent = "Pruefe...";
  const response = await fetch("/api/display-info");
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Anzeigewege konnten nicht geladen werden");
  displayInfo = payload.display;
  renderDeviceAccess();
  if (showBusy && button) {
    button.textContent = "Aktualisiert";
    setTimeout(() => (button.textContent = original), 1200);
  }
}

async function copyDisplayUrl() {
  const url = displayInfo?.lanDisplayUrls?.[0] || displayInfo?.localDisplayUrl || `${window.location.origin}/display`;
  await copyTextToClipboard(url);
  flashButtonText("copyDisplayLink", "Link kopiert", "Link kopieren");
}

async function syncGbrain() {
  const button = $("syncGbrain");
  const original = button?.textContent || "GBrain aktualisieren";
  button.textContent = "Sichere Wissen...";
  const response = await fetch("/api/gbrain-sync", { method: "POST" });
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "GBrain-Sync fehlgeschlagen");
  const pageCount = payload.report?.manifest?.pages?.length || 0;
  button.textContent = `${pageCount} Seiten gesichert`;
  await refreshIntegrationStatus(false).catch(() => {});
  setTimeout(() => (button.textContent = original), 1800);
}

async function loadDailyCheckSilently() {
  const response = await fetch("/api/daily-check");
  const payload = await response.json();
  if (!response.ok || !payload.ok) return;
  dailyCheck = payload.report;
  render();
}

function selectedCase() {
  return appState.cases.find((item) => item.id === selectedCaseId) || appState.cases[0];
}

async function fetchDossier(caseItem) {
  const response = await fetch(`/api/cancellation-dossier?caseId=${encodeURIComponent(caseItem.id)}`);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Dossier konnte nicht erzeugt werden");
  }
  return response.text();
}

async function copyDossier() {
  const caseItem = selectedCase();
  await copyDossierForCase(caseItem, "copyDossier");
}

async function copyDossierForCase(caseItem, buttonId) {
  const button = $(buttonId);
  const original = button?.textContent || "Dossier kopieren";
  if (button) button.textContent = "Erzeuge...";
  try {
    const dossier = await fetchDossier(caseItem);
    await copyTextToClipboard(dossier);
    flashButtonText(buttonId, "Dossier kopiert", original);
  } catch (error) {
    const message = error?.message?.includes("Dossier") ? "Dossier fehlerhaft" : "Kopieren blockiert";
    flashButtonText(buttonId, message, original, 1600);
  }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch (error) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error(error?.message || "Kopieren wurde vom Browser blockiert");
  }
}

async function downloadDossier() {
  const caseItem = selectedCase();
  $("downloadDossier").textContent = "Erzeuge...";
  const dossier = await fetchDossier(caseItem);
  downloadText(`${caseItem.id}-airbnb-hoa-dossier.md`, dossier);
  $("downloadDossier").textContent = "Dossier geladen";
  setTimeout(() => ($("downloadDossier").textContent = "Dossier herunterladen"), 1200);
}

function findCaseForHermesReport(reportCase) {
  return appState.cases.find((caseItem) => {
    if (reportCase.id && caseItem.id === reportCase.id) return true;
    if (reportCase.reservationCode && caseItem.reservationCode === reportCase.reservationCode) return true;
    if (reportCase.email && caseItem.email && caseItem.email.toLowerCase() === reportCase.email.toLowerCase()) return true;
    return false;
  });
}

function suggestionIdForReportCase(report, reportCase, caseItem) {
  const source = report.source || "hermes";
  const generatedAt = String(report.generatedAt || today).slice(0, 10);
  const signal = reportCase.gmail?.replyStatus || reportCase.gmail?.hoaStatus || "review";
  return stableKey(`${source}-${caseItem.id}-${generatedAt}-${signal}`);
}

function safeGmailPatch(gmail) {
  if (!gmail || typeof gmail !== "object") return null;
  const allowed = ["lastCheckedAt", "replyStatus", "hoaStatus", "outboundDraftId"];
  const patch = {};
  for (const key of allowed) {
    if (typeof gmail[key] === "string") patch[key] = gmail[key];
  }
  return Object.keys(patch).length ? patch : null;
}

function safeCommunicationEvidencePatch(entries) {
  if (!Array.isArray(entries)) return [];
  const channels = new Set(["gmail", "airbnb", "whatsapp", "imessage", "sms", "phone", "hoa", "turno", "other"]);
  const directions = new Set(["inbound", "outbound", "internal", "unknown"]);
  const allowed = ["id", "date", "channel", "direction", "contact", "summary", "impact", "source", "confidence"];
  return entries
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => {
      const next = {};
      for (const key of allowed) {
        if (entry[key] !== undefined) next[key] = String(entry[key]).trim().slice(0, 500);
      }
      if (!next.date || !next.channel || !next.summary || !channels.has(next.channel)) return null;
      if (next.direction && !directions.has(next.direction)) next.direction = "unknown";
      if (!next.direction) next.direction = "unknown";
      if (!next.id) next.id = stableKey(`${next.date}-${next.channel}-${next.contact || ""}-${next.summary}`);
      return next;
    })
    .filter(Boolean);
}

function safeInboxItemsPatch(entries, fallbackCaseId = "") {
  if (!Array.isArray(entries)) return [];
  const channels = new Set(["gmail", "airbnb", "whatsapp", "imessage", "sms", "phone", "hoa", "turno", "other"]);
  const statuses = new Set(["new", "reviewed", "applied", "ignored"]);
  const priorities = new Set(["high", "medium", "low"]);
  const allowed = ["id", "caseId", "date", "source", "channel", "title", "summary", "status", "priority", "impact", "gbrainSyncedAt"];
  return entries
    .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => {
      const next = {};
      for (const key of allowed) {
        if (entry[key] !== undefined) next[key] = String(entry[key]).trim().slice(0, 700);
      }
      next.caseId = next.caseId || fallbackCaseId;
      next.date = next.date || today;
      next.channel = channels.has(next.channel) ? next.channel : "other";
      next.status = statuses.has(next.status) ? next.status : "new";
      next.priority = priorities.has(next.priority) ? next.priority : "medium";
      if (!next.title || !next.summary) return null;
      if (!next.id) next.id = stableKey(`${next.caseId || "general"}-${next.date}-${next.channel}-${next.title}-${next.summary}`);
      return next;
    })
    .filter(Boolean);
}

function createSuggestionFromHermesReport(report, reportCase, caseItem) {
  const gmail = safeGmailPatch(reportCase.gmail);
  const communicationEvidence = safeCommunicationEvidencePatch(reportCase.communicationEvidence);
  const inboxItems = safeInboxItemsPatch(reportCase.inboxItems, caseItem.id);
  const timeline = Array.isArray(reportCase.timeline)
    ? reportCase.timeline
        .filter((entry) => entry && typeof entry.date === "string" && typeof entry.text === "string")
        .map((entry) => ({ date: entry.date, text: entry.text }))
    : [];
  const patch = {};
  if (gmail) patch.gmail = gmail;
  if (typeof reportCase.recommendation === "string" && reportCase.recommendation.trim()) patch.recommendation = reportCase.recommendation.trim();
  if (timeline.length) patch.timeline = timeline;
  if (communicationEvidence.length) patch.communicationEvidence = communicationEvidence;
  if (inboxItems.length) patch.inboxItems = inboxItems;
  if (!Object.keys(patch).length) return null;

  const evidence = Array.isArray(reportCase.evidence) ? reportCase.evidence.filter(Boolean).map(String) : [];
  if (reportCase.reservationCode) evidence.push(`Airbnb ${reportCase.reservationCode}`);
  if (gmail?.outboundDraftId) evidence.push(`Gmail draft ${gmail.outboundDraftId}`);
  for (const item of communicationEvidence) evidence.push(`${communicationChannelLabel(item.channel)} ${item.date}`);
  for (const item of inboxItems) evidence.push(`Eingang ${item.date}: ${item.title}`);
  if (!evidence.length) evidence.push(`${report.source || "Hermes"} ${String(report.generatedAt || today).slice(0, 10)}`);

  return {
    id: suggestionIdForReportCase(report, reportCase, caseItem),
    caseId: caseItem.id,
    source: report.source || "hermes-sync",
    generatedAt: String(report.generatedAt || today).slice(0, 10),
    status: "pending",
    title: gmail?.replyStatus ? gmailReplyLabel(gmail.replyStatus) : "Neue Hermes-Auswertung",
    detail: patch.recommendation || timeline[0]?.text || "Hermes hat neue Hinweise fuer diesen Fall gefunden.",
    confidence: reportCase.confidence || (report.source === "gmail-live-readonly" ? "high" : "medium"),
    evidence: [...new Set(evidence)],
    patch,
  };
}

function suggestionAlreadyApplied(caseItem, suggestion) {
  const patch = suggestion.patch || {};
  let hasPatch = false;
  if (patch.gmail) {
    hasPatch = true;
    const gmail = caseItem.gmail || {};
    for (const [key, value] of Object.entries(patch.gmail)) {
      if (gmail[key] !== value) return false;
    }
  }
  if (patch.recommendation) {
    hasPatch = true;
    if (caseItem.hermesRecommendation !== patch.recommendation) return false;
  }
  if (Array.isArray(patch.timeline) && patch.timeline.length) {
    hasPatch = true;
    const timeline = caseItem.timeline || [];
    for (const entry of patch.timeline) {
      if (!timeline.some((existing) => existing.date === entry.date && existing.text === entry.text)) return false;
    }
  }
  if (Array.isArray(patch.communicationEvidence) && patch.communicationEvidence.length) {
    hasPatch = true;
    const existingEvidence = caseItem.communicationEvidence || [];
    for (const entry of patch.communicationEvidence) {
      const entryId = entry.id || stableKey(`${entry.date}-${entry.channel}-${entry.contact || ""}-${entry.summary}`);
      if (!existingEvidence.some((existing) => (existing.id || stableKey(`${existing.date}-${existing.channel}-${existing.contact || ""}-${existing.summary}`)) === entryId)) {
        return false;
      }
    }
  }
  if (Array.isArray(patch.inboxItems) && patch.inboxItems.length) {
    hasPatch = true;
    const existingInbox = ensureInboxItems();
    for (const entry of safeInboxItemsPatch(patch.inboxItems, caseItem.id)) {
      if (!existingInbox.some((existing) => existing.id === entry.id)) return false;
    }
  }
  return hasPatch;
}

function addHermesSuggestions(report) {
  if (!report || !Array.isArray(report.cases)) throw new Error("Hermes-Report hat kein cases-Array");
  let pending = 0;
  let archived = 0;
  let existing = 0;
  appState.automation = appState.automation || {};
  appState.automation.lastHermesSyncAt = (report.generatedAt || today).slice(0, 10);
  const suggestions = ensureAISuggestions();

  for (const reportCase of report.cases) {
    const caseItem = findCaseForHermesReport(reportCase);
    if (!caseItem) continue;
    const suggestion = createSuggestionFromHermesReport(report, reportCase, caseItem);
    if (!suggestion) continue;
    if (suggestions.some((existingSuggestion) => existingSuggestion.id === suggestion.id)) {
      existing += 1;
      continue;
    }
    if (suggestionAlreadyApplied(caseItem, suggestion)) {
      suggestion.status = "accepted";
      suggestion.resolvedAt = today;
      archived += 1;
    } else {
      pending += 1;
    }
    suggestions.push(suggestion);
  }
  return { pending, archived, existing };
}

function applySafeSuggestionPatch(caseItem, patch) {
  if (!patch || typeof patch !== "object") return;
  if (patch.gmail && typeof patch.gmail === "object") {
    caseItem.gmail = { ...(caseItem.gmail || {}), ...safeGmailPatch(patch.gmail) };
  }
  if (typeof patch.recommendation === "string" && patch.recommendation.trim()) {
    caseItem.hermesRecommendation = patch.recommendation.trim();
  }
  if (Array.isArray(patch.timeline)) {
    caseItem.timeline = caseItem.timeline || [];
    for (const entry of patch.timeline) {
      if (!entry?.date || !entry?.text) continue;
      const exists = caseItem.timeline.some((existing) => existing.date === entry.date && existing.text === entry.text);
      if (!exists) caseItem.timeline.push({ date: entry.date, text: entry.text });
    }
  }
  const communicationEvidence = safeCommunicationEvidencePatch(patch.communicationEvidence);
  if (communicationEvidence.length) {
    caseItem.communicationEvidence = caseItem.communicationEvidence || [];
    for (const entry of communicationEvidence) {
      const entryId = entry.id || stableKey(`${entry.date}-${entry.channel}-${entry.contact || ""}-${entry.summary}`);
      const exists = caseItem.communicationEvidence.some((existing) => (existing.id || stableKey(`${existing.date}-${existing.channel}-${existing.contact || ""}-${existing.summary}`)) === entryId);
      if (!exists) caseItem.communicationEvidence.push(entry);
    }
  }
  const inboxItems = safeInboxItemsPatch(patch.inboxItems, caseItem.id);
  if (inboxItems.length) {
    const existingInbox = ensureInboxItems();
    for (const item of inboxItems) {
      if (!existingInbox.some((existing) => existing.id === item.id)) existingInbox.push(item);
    }
  }
}

async function applySuggestion(id) {
  const suggestion = ensureAISuggestions().find((item) => item.id === id);
  if (!suggestion || suggestion.status !== "pending") return;
  const caseItem = appState.cases.find((item) => item.id === suggestion.caseId);
  if (!caseItem) return;
  applySafeSuggestionPatch(caseItem, suggestion.patch);
  suggestion.status = "accepted";
  suggestion.resolvedAt = today;
  render();
  await saveState(false);
}

async function rejectSuggestion(id) {
  const suggestion = ensureAISuggestions().find((item) => item.id === id);
  if (!suggestion || suggestion.status !== "pending") return;
  suggestion.status = "rejected";
  suggestion.resolvedAt = today;
  render();
  await saveState(false);
}

async function pullHermesSync() {
  $("pullHermesSync").textContent = "Pruefe...";
  const response = await fetch("/api/hermes-sync");
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || "Hermes-Sync fehlgeschlagen");
  const result = addHermesSuggestions(payload.report);
  $("pullHermesSync").textContent = result.pending ? `${result.pending} Vorschlag` : "Keine neuen Vorschlaege";
  render();
  await saveState(false);
  setTimeout(() => ($("pullHermesSync").textContent = "Neue Pruefung holen"), 1600);
}

async function bootstrap() {
  const response = await fetch("/api/bootstrap");
  const payload = await response.json();
  today = payload.today;
  appState = payload.state;
  calendar = payload.calendar;
  dailyCheck = payload.dailyCheck;
  displayInfo = payload.displayInfo;
  operationsManifest = payload.operationsManifest;
  selectedCaseId = appState.cases.find((caseItem) => caseItem.status === "reminder_due")?.id || appState.cases[0]?.id;
  ensureMaintenanceItems();
  ensurePayments();
  ensurePaymentsForCases();
  ensureCleaning();
  ensureTelephony();

  $("caseStatus").addEventListener("change", (event) => {
    const caseItem = appState.cases.find((item) => item.id === selectedCaseId);
    const previousStatus = caseItem.status;
    const nextStatus = event.target.value;
    if (nextStatus === "approved" && !caseItem.checklist?.boardApproval) {
      const approved = updateDocumentStatus(caseItem, "boardApproval", "approved");
      if (!approved) {
        event.target.value = previousStatus;
        render();
        return;
      }
    } else {
      caseItem.status = nextStatus;
    }
    if (caseItem.status !== "approved" && !caseItem.checklist.boardApproval) caseItem.checkInLocked = true;
    if (caseItem.status === "approved") caseItem.checkInLocked = false;
    render();
    saveState(false).catch((error) => alert(error.message));
  });

  $("templateSelect").addEventListener("change", () => {
    const caseItem = appState.cases.find((item) => item.id === selectedCaseId);
    renderTemplate(caseItem);
  });

  $("copyTemplate").addEventListener("click", async () => {
    try {
      await copyTextToClipboard($("templateText").value);
      $("copyTemplate").textContent = "Kopiert";
    } catch {
      $("copyTemplate").textContent = "Kopieren blockiert";
    }
    setTimeout(() => ($("copyTemplate").textContent = "Text kopieren"), 1200);
  });

  $("copyHermesTask").addEventListener("click", async () => {
    try {
      const caseItem = selectedCase();
      await copyTextToClipboard(hermesTask(caseItem));
      $("copyHermesTask").textContent = "Auftrag kopiert";
    } catch {
      $("copyHermesTask").textContent = "Kopieren blockiert";
    }
    setTimeout(() => ($("copyHermesTask").textContent = "Pruefauftrag kopieren"), 1200);
  });

  $("copyDossier").addEventListener("click", () => copyDossier().catch((error) => {
    $("copyDossier").textContent = error?.message?.includes("Dossier") ? "Dossier fehlerhaft" : "Kopieren blockiert";
    setTimeout(() => ($("copyDossier").textContent = "Dossier kopieren"), 1600);
  }));

  $("downloadDossier").addEventListener("click", () => downloadDossier().catch((error) => {
    alert(error.message);
    $("downloadDossier").textContent = "Dossier herunterladen";
  }));

  $("pullHermesSync").addEventListener("click", () => pullHermesSync().catch((error) => alert(error.message)).finally(() => {
    if ($("pullHermesSync").textContent === "Pruefe...") $("pullHermesSync").textContent = "Neue Pruefung holen";
  }));

  $("saveState").addEventListener("click", () => saveState(true));
  $("refreshCalendar").addEventListener("click", () => refreshCalendar().catch((error) => alert(error.message)));
  $("syncAppleCalendar").addEventListener("click", () => syncAppleCalendar().catch((error) => {
    alert(error.message);
    $("syncAppleCalendar").textContent = "iPhone-Kalender sync";
  }));
  $("refreshDailyCheck").addEventListener("click", () => refreshDailyCheck().catch((error) => {
    alert(error.message);
    $("refreshDailyCheck").textContent = "Tagescheck aktualisieren";
  }));
  $("refreshIntegrationStatus").addEventListener("click", () => refreshIntegrationStatus(true).catch((error) => {
    alert(error.message);
    $("refreshIntegrationStatus").textContent = "Status pruefen";
  }));
  $("openDisplayMode").addEventListener("click", () => window.open("/display", "_blank", "noopener"));
  $("copyDisplayLink").addEventListener("click", () => copyDisplayUrl().catch((error) => {
    alert(error.message);
    $("copyDisplayLink").textContent = "Link kopieren";
  }));
  $("refreshDisplayInfo").addEventListener("click", () => refreshDisplayInfo(true).catch((error) => {
    alert(error.message);
    $("refreshDisplayInfo").textContent = "Wege pruefen";
  }));
  $("syncGbrain").addEventListener("click", () => syncGbrain().catch((error) => {
    alert(error.message);
    $("syncGbrain").textContent = "GBrain aktualisieren";
  }));
  $("telephonyForm").addEventListener("submit", createTelephonyCall);
  $("telephonyContact").addEventListener("change", syncTelephonyPhoneFromContact);
  $("copyTelephonyNumber").addEventListener("click", () => copyTelephonyNumber("copyTelephonyNumber").catch((error) => alert(error.message)));
  $("openGoogleFiWeb").addEventListener("click", () => openGoogleFiWeb("openGoogleFiWeb").catch((error) => alert(error.message)));
  $("openTelephonyDialer").addEventListener("click", () => openTelephonyDialer());
  $("maintenanceForm").addEventListener("submit", createMaintenanceItem);

  render();
  refreshIntegrationStatus(false).catch((error) => {
    integrationStatus = {
      overall: "error",
      generatedAt: new Date().toISOString(),
      items: [
        {
          id: "integrationStatus",
          label: "Integrationen",
          status: "error",
          title: "Status konnte nicht geladen werden",
          detail: error.message,
          action: "Status manuell erneut pruefen.",
        },
      ],
    };
    renderIntegrationStatus();
  });
}

bootstrap().catch((error) => {
  const pre = document.createElement("pre");
  pre.textContent = error.stack || error.message;
  document.body.replaceChildren(pre);
});
