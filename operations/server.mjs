import { createServer } from "node:http";
import { copyFile, readFile, writeFile, mkdir, open, rename, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { execFile, spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
// Overridable so tests can run against an isolated data directory.
const dataDir = process.env.AIRBNB_HOA_DATA_DIR ? join(process.env.AIRBNB_HOA_DATA_DIR, "") : join(root, "data");
const stateFile = join(dataDir, "airbnb-hoa-state.json");
const stateLockFile = join(dataDir, ".airbnb-hoa-state.flock");
const stateBackupDir = join(dataDir, "backups");
const calendarFile = join(dataDir, "airbnb-florida-calendar-snapshot.json");
const operationsManifestFile = join(dataDir, "markus-operations-manifest.json");
const port = Number(process.env.PORT || 4327);
const host = process.env.HOST || "127.0.0.1";
// Explicit opt-in so read-only display endpoints can answer LAN requests.
// Everything else stays loopback-only until real authentication exists.
const allowLanDisplay = process.env.ALLOW_LAN_DISPLAY === "1";
const maxBodyBytes = 1024 * 1024; // 1 MiB JSON body limit
const hermesHost = process.env.HERMES_HOST || "markus@192.0.2.10";
const hermesSyncPath = process.env.HERMES_SYNC_PATH || "/srv/agents/hermes/state/workspace/airbnb-hoa-operations/sync/latest.json";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function todayISO() {
  if (process.env.APP_TODAY) return process.env.APP_TODAY;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Panama",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function seedState() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    property: {
      listingId: "DEMOID0002",
      listingName: "Example Island, Meerblick",
      unit: "Example Condominium, Unit 405D",
      address: "100 Example Avenue, Example City, FL 00000",
      hoaName: "Example Condominium Association",
      management: "Example Property Management",
      hoaEmail: "contact005@example.test",
      hoaAddress: "200 Management Road, Example City, FL 00000",
      tenantEvaluationCode: "DEMOID0001",
      fee: "USD 100 check or money order payable to Example Condominium",
    },
    listingKnowledge: {
      sourceUrl: "https://www.airbnb.com/rooms/DEMOID0002",
      reviewedAt: "2026-06-27",
      title: "Sun Island, Sea View",
      summary:
        "Airbnb listing describes the unit as a bay-view condo on Example Island with self check-in, 700 Mbps Wi-Fi, workspace, pool/spa access, elevator access, parking, shared laundry, kitchen, dishwasher, AC, screened balcony and four pool passes.",
      capacity: {
        guests: 4,
        bedrooms: 1,
        beds: 1,
        baths: 1,
        minimumStay: "1 month minimum / HOA approval required",
      },
      advertisedAmenities: [
        "Smartlock / self check-in",
        "700 Mbps Wi-Fi",
        "Workspace / dining table with outlet",
        "Air conditioning",
        "Dishwasher",
        "Kitchen",
        "Screened balcony",
        "Pool and spa access",
        "Four pool passes",
        "Private parking spot",
        "Elevator / fourth floor access",
        "Shared laundry",
        "Garbage chute",
      ],
      cleaningChecklist: [
        "Confirm four pool passes are present.",
        "Check dishwasher works and is empty.",
        "Check smartlock/building access path is usable.",
        "Check Wi-Fi and visible router/access instructions.",
        "Check AC is working.",
        "Check screened balcony and balcony furniture.",
        "Check king bed and sofa bed readiness.",
        "Check kitchen basics and garbage chute area.",
        "Check shared laundry instructions are present.",
      ],
      defectPriorityRules: [
        "Dishwasher, AC, smartlock/access, Wi-Fi, pool passes and elevator/access issues are high priority because the listing creates guest expectations.",
        "Cleaning should verify advertised amenities before the next guest, not only general cleanliness.",
      ],
    },
    automation: {
      gmailMode: "Hermes Gmail MCP, read/review first, send only after Owner approval",
      hermesSkillPath: "hermes-skills/airbnb-hoa-operations",
      lastGmailReviewAt: "2026-06-26",
      status: "skill_prepared",
    },
    cases: [
      {
        id: "DEMOID0010",
        source: "gmail-and-ical",
        calendarUid: "contact001@example.test",
        guestName: "DemoNameS DemoSurnameA / DemoNameJ DemoSurnameB",
        start: "2026-06-25",
        end: "2026-07-31",
        adults: 2,
        reservationCode: "",
        email: "contact010@example.test",
        status: "waiting_for_board_approval",
        checkInLocked: true,
        documentPacketSentAt: "2026-05-11",
        deadlineDocuments: "2026-05-14",
        cancellationReviewAt: "",
        airbnbSupportAt: "",
        decisionBy: "",
        gmail: {
          searchTerms: ["contact010@example.test", "DemoNameS DemoSurnameA", "DemoNameJ DemoSurnameB", "Palma Del Mar"],
          lastCheckedAt: "2026-05-18",
          replyStatus: "approved_thread_found",
          hoaStatus: "approved",
          outboundDraftId: "",
        },
        checklist: {
          airbnbInitialMessage: true,
          guestAcknowledged: true,
          packetSent: true,
          leaseApplication: true,
          vendorHandoff: true,
          vendorStatus: true,
          shortTermLeaseTenantSigned: true,
          shortTermLeaseOwnerSigned: true,
          rulesSent: true,

          feeTracked: true,
          submittedToHoa: true,
          boardApproval: false,
        },
        timeline: [
          { date: "2026-05-11", text: "Lease Application, secure vendor handoff instructions and Rules sent to tenant." },
          { date: "2026-05-18", text: "HOA Board approval received for DemoSurnameA/DemoSurnameB." },
        ],
        communicationEvidence: [],
      },
      {
        id: "DEMOID0008",
        source: "gmail-and-ical",
        calendarUid: "contact002@example.test",
        guestName: "DemoSurnameC DemoSurnameD / DemoSurnameC DemoSurnameF",
        start: "2026-08-03",
        end: "2026-08-31",
        adults: 2,
        reservationCode: "HMDEMO0001",
        email: "contact011@example.test",
        status: "reminder_due",
        checkInLocked: true,
        documentPacketSentAt: "2026-06-21",
        deadlineDocuments: "2026-06-29",
        cancellationReviewAt: "2026-06-30",
        airbnbSupportAt: "2026-07-02",
        decisionBy: "2026-07-03",
        reminderDraftId: "DEMOID0009",
        gmail: {
          searchTerms: ["contact011@example.test", "HMDEMO0001", "DemoSurnameC DemoSurnameD", "DemoSurnameC DemoSurnameF", "Palma Del Mar"],
          lastCheckedAt: "2026-06-26",
          replyStatus: "documents_missing_after_reply",
          hoaStatus: "not_submitted",
          outboundDraftId: "DEMOID0009",
        },
        checklist: {
          airbnbInitialMessage: true,
          guestAcknowledged: true,
          packetSent: true,
          leaseApplication: false,
          vendorHandoff: false,
          vendorStatus: false,
          shortTermLeaseTenantSigned: false,
          shortTermLeaseOwnerSigned: false,
          rulesSent: true,

          feeTracked: false,
          submittedToHoa: false,
          boardApproval: false,
        },
        timeline: [
          { date: "2026-06-18", text: "Airbnb booking confirmed and guest email received." },
          { date: "2026-06-21", text: "HOA document package sent by email." },
          { date: "2026-06-24", text: "Submission instructions clarified: documents by email, fee by check or money order." },
          { date: "2026-06-26", text: "No completed documents found. Gmail reminder draft created." },
          { date: "2026-06-26", text: "Read-only Gmail review confirmed DemoSurnameC replied on 2026-06-23, but no completed documents or attachments were found after the 2026-06-24 submission clarification." },
        ],
        hermesRecommendation:
          "Reminder faellig. DemoSurnameC hat am 2026-06-23 geantwortet, aber nach der Klarstellung vom 2026-06-24 wurden keine completed documents oder Anhaenge gefunden. Keine Check-in-Daten freigeben, bis Board Approval vorliegt.",
        communicationEvidence: [],
      },
    ],
    aiSuggestions: [
      {
        id: "gmail-live-readonly-DEMOID0008-2026-06-26-documents-missing-after-reply",
        caseId: "DEMOID0008",
        source: "gmail-live-readonly",
        generatedAt: "2026-06-26",
        status: "accepted",
        title: "Antwort gefunden, Unterlagen fehlen",
        detail:
          "DemoSurnameC replied on 2026-06-23, but no completed documents or attachments were found after the 2026-06-24 submission clarification.",
        confidence: "high",
        evidence: ["Gmail live review 2026-06-26", "Gmail draft DEMOID0009"],
        patch: {
          gmail: {
            lastCheckedAt: "2026-06-26",
            replyStatus: "documents_missing_after_reply",
            hoaStatus: "not_submitted",
            outboundDraftId: "DEMOID0009",
          },
          recommendation:
            "Reminder faellig. DemoSurnameC hat am 2026-06-23 geantwortet, aber nach der Klarstellung vom 2026-06-24 wurden keine completed documents oder Anhaenge gefunden. Keine Check-in-Daten freigeben, bis Board Approval vorliegt.",
          timeline: [
            {
              date: "2026-06-26",
              text:
                "Live Gmail review: DemoSurnameC replied on 2026-06-23, but no completed documents or attachments were found after the 2026-06-24 submission clarification. Draft DEMOID0009 exists.",
            },
          ],
        },
        resolvedAt: "2026-06-26",
      },
    ],
    inboxItems: [],
    maintenanceItems: [],
    cleaning: {
      provider: "Turno",
      property: "100 Example Avenue, Unit 405, Example City",
      primaryCleaner: {
        name: "DemoGivenNameD DemoSurnameG DemoNameE",
        displayName: "DemoGivenNameD",
        source: "Turno email",
        lastSeenAt: "2026-06-25",
      },
      defaultRate: "$110.00/project",
      defaultCharge: "$118.80",
      lastEmailReviewAt: "2026-06-26",
      projects: [
        {
          id: "turno-DEMOID0007",
          projectId: "DEMOID0007",
          date: "2026-06-24",
          status: "completed",
          cleaner: "DemoGivenNameD DemoSurnameG DemoNameE",
          scheduledStart: "2026-06-24 10:00",
          scheduledEnd: "2026-06-24 15:00",
          startedAt: "2026-06-24 15:47",
          endedAt: "2026-06-25 19:10",
          rate: "$110.00/project",
          amount: "$118.80",
          problems: 0,
          images: 0,
          sourceMessageIds: ["19c63d36bc9e164f", "19ef9f36d5163ac7", "19f010c609c4e172", "19f010c5fb9cc037"],
          projectUrl: "https://app.turno.com/view/schedule?project_id=DEMOID0007",
          note: "Accepted by DemoGivenNameD, late-start alert occurred, completed with 0 problems.",
        },
        {
          id: "turno-DEMOID0006",
          projectId: "DEMOID0006",
          date: "2026-03-15",
          status: "completed",
          cleaner: "DemoGivenNameD DemoSurnameG DemoNameE",
          scheduledStart: "2026-03-15 10:00",
          scheduledEnd: "2026-03-15 15:00",
          rate: "$110.00/project",
          amount: "$118.80",
          sourceMessageIds: ["19b50c7e06c51928", "19cf1d1481a8785c", "19d1d3ab6056c041", "19d1d3aeee0ee7f1"],
          projectUrl: "https://app.turno.com/view/schedule?project_id=DEMOID0006",
          note: "Receipt found; late-start/start emails found.",
        },
        {
          id: "turno-DEMOID0005",
          projectId: "DEMOID0005",
          date: "2026-01-30",
          status: "completed",
          cleaner: "DemoGivenNameD DemoSurnameG DemoNameE",
          scheduledStart: "2026-01-30 10:00",
          scheduledEnd: "2026-01-30 15:00",
          rate: "$110.00/project",
          amount: "$118.80",
          sourceMessageIds: ["19abd5ecdf51ea09", "19c0f3d20bcc8037", "19c0fab630cb5640", "19c0fab604612eda"],
          projectUrl: "https://app.turno.com/view/schedule?project_id=DEMOID0005",
          note: "Accepted, started, completed and receipt emails found.",
        },
      ],
    },
    payments: {
      source: "Airbnb account",
      lastAirbnbReviewAt: "",
      lastGmailSearchAt: "2026-06-26",
      notes:
        "Payments are stored per tenant/case. Amounts must come from Airbnb payout/reservation financials or a deliberate manual entry; Gmail snippets did not provide reliable payout amounts.",
      items: [
        {
          id: "payment-DEMOID0010",
          caseId: "DEMOID0010",
          source: "airbnb",
          reservationCode: "",
          guestName: "DemoNameS DemoSurnameA / DemoNameJ DemoSurnameB",
          stayStart: "2026-06-25",
          stayEnd: "2026-07-31",
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
          evidence: ["HOA-approved case in local state", "Airbnb/iCal stay 2026-06-25 to 2026-07-31"],
          notes: "Airbnb payout details have not been imported yet.",
          lastCheckedAt: "",
        },
        {
          id: "payment-DEMOID0008",
          caseId: "DEMOID0008",
          source: "airbnb",
          reservationCode: "HMDEMO0001",
          guestName: "DemoSurnameC DemoSurnameD / DemoSurnameC DemoSurnameF",
          stayStart: "2026-08-03",
          stayEnd: "2026-08-31",
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
          evidence: ["Airbnb booking confirmation email found: reservation HMDEMO0001"],
          notes: "Airbnb booking confirmation was found in Gmail; payout amount has not been imported yet.",
          lastCheckedAt: "",
        },
      ],
    },
    templates: {
      listingDisclosure:
        "Important HOA requirement: This condominium is located in Example Condominium and occupancy is subject to condominium association / HOA approval before check-in. After booking, guests must promptly complete the required HOA lease/application paperwork, follow the association's secure Tenant Evaluation vendor process, review the Rules and Regulations, and follow the HOA fee instructions. Sensitive identity or screening material must go only to the association's designated vendor, never to this application. Check-in/access information cannot be released until the HOA / Board approval has been received. Delayed or incomplete paperwork may make the stay impossible under the condominium rules.",
      airbnbInitialMessage:
        "Hi {{firstName}},\n\nthank you for your booking request/reservation for {{unit}} from {{start}} to {{end}}.\n\nImportant HOA step: Example Condominium requires a lease/application package and HOA/Board approval before occupancy. I will send you the HOA paperwork and the association's secure Tenant Evaluation vendor instructions by email. Please complete the Lease Application and signed Short-Term Lease Agreement promptly. Send any sensitive identity or screening material only through the association's designated secure vendor channel, never by reply email or through this application.\n\nThe HOA application fee must be handled as instructed by the association: {{fee}}.\n\nI cannot release check-in or access information until the HOA / Board approval is received. Please confirm that you understand this HOA requirement and tell me the best email address for the non-sensitive coordination paperwork.\n\nBest,\nOwner",
      airbnbReminder:
        "Hi {{firstName}},\n\nquick reminder: I have not yet received the completed HOA paperwork for your {{start}} stay.\n\nPlease send the completed and signed documents by {{deadlineDocuments}}, so I can submit everything to the condominium association in time.\n\nImportant: I cannot release check-in/access information until Example Condominium / the HOA Board has approved the application.\n\nPlease confirm today or tomorrow when you will send the documents.\n\nBest,\nOwner",
      firmDeadline:
        "Hi {{firstName}},\n\nI need to set a firm deadline for the HOA paperwork.\n\nExample Condominium requires HOA/Board approval before occupancy, and I cannot provide check-in or access information without that approval.\n\nPlease complete the following by {{deadlineDocuments}}:\n\n- Lease Application\n- signed Short-Term Lease Agreement\n- secure Tenant Evaluation vendor handoff and vendor confirmation\n\nSensitive identity or screening material must go only to the association's designated secure vendor channel, never by reply email or through this application. The USD 100 HOA application fee must also be mailed by check or money order as previously explained.\n\nIf the required coordination documents and vendor confirmation are not complete by this deadline, I will need to contact Airbnb because the reservation may not be possible under the HOA requirements.\n\nBest,\nOwner",
      submittedToHoa:
        "Hi {{firstName}},\n\nI have submitted your HOA application package to the condominium association / management office. We are now waiting for HOA/Board approval.\n\nI will update you as soon as approval is received. Check-in details will be released only after approval.\n\nBest,\nOwner",
      airbnbSupportReview:
        "Hello Airbnb Support,\n\nI need assistance with reservation {{reservationCode}} for {{guestName}}, staying at {{unit}} from {{start}} to {{end}}.\n\nThis condominium is subject to Example Condominium HOA / Board approval before occupancy. I informed the guest of the HOA paperwork requirement and sent the required documents. As of today, the completed HOA paperwork is still missing, and I cannot legally/compliantly release check-in or access information without HOA / Board approval.\n\nDocument deadline communicated to guest: {{deadlineDocuments}}\nCancellation review date: {{cancellationReviewAt}}\nDecision target: {{decisionBy}}\n\nI am trying to keep the reservation on track, but if the guest does not provide the required documents in time for HOA review and approval, the stay may not be possible under the condominium rules. Please review the attached/supporting timeline and advise on the appropriate host-safe process.\n\nBest,\nProperty Owner",
      cancellationDecisionNote:
        "Internal decision note for {{guestName}} / {{reservationCode}}:\n\nStay: {{start}} to {{end}}\nDocument deadline: {{deadlineDocuments}}\nCancellation review: {{cancellationReviewAt}}\nDecision by: {{decisionBy}}\n\nDo not release check-in information unless Board Approval is documented. If completed HOA documents remain missing by the deadline, prepare Airbnb Support escalation with the generated dossier before any cancellation decision. If Airbnb Support confirms host-safe handling or the guest still fails to comply after firm notice, move the case to cancellation_review.",
    },
  };
}

function timestampForFile() {
  return new Date().toISOString().replaceAll(":", "").replaceAll(".", "");
}

function localIPv4Addresses() {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)];
}

function displayInfo() {
  const boundToLan = host === "0.0.0.0" || host === "::" || localIPv4Addresses().includes(host);
  const lanEnabled = allowLanDisplay && boundToLan;
  const localBaseUrl = `http://127.0.0.1:${port}`;
  const lanUrls = localIPv4Addresses().map((address) => `http://${address}:${port}`);
  return {
    port,
    listenHost: host,
    lanEnabled,
    localUrl: `${localBaseUrl}/`,
    localDisplayUrl: `${localBaseUrl}/display`,
    lanDisplayUrls: lanEnabled ? lanUrls.map((url) => `${url}/display`) : [],
    lanCandidateDisplayUrls: lanUrls.map((url) => `${url}/display`),
    notes: [
      "Die Anzeigeansicht ist read-only und fuer TV, iPad, iPhone und Monitore gedacht.",
      "LAN-Zugriff nur in einem privaten, vertrauenswuerdigen Netzwerk aktivieren.",
      "Fuer Zugriff von unterwegs besser VPN/Tailscale/Hermes-Relay statt oeffentliche Portfreigabe verwenden.",
    ],
  };
}

function isLocalRequest(req) {
  const address = req.socket?.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

// Private-by-default API policy:
// - /api/health answers remotely with a minimal, non-sensitive payload.
// - Read-only display endpoints may answer remotely only with an explicit
//   ALLOW_LAN_DISPLAY=1 opt-in.
// - Full state reads and every mutating/action endpoint stay loopback-only
//   until real authentication exists.
const DISPLAY_READ_PATHS = new Set(["/api/display-state", "/api/display-info", "/api/voice-brief"]);

function denyRemote(res) {
  json(res, 403, { ok: false, error: "forbidden_nonlocal", detail: "Dieser Endpunkt ist auf loopback (127.0.0.1) beschraenkt." });
}

function requestAllowed(req, pathname) {
  if (isLocalRequest(req)) return true;
  if (pathname === "/api/health") return true;
  if (allowLanDisplay && DISPLAY_READ_PATHS.has(pathname)) return true;
  return false;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) {
      const error = new Error("request_body_too_large");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error("invalid_json_body");
    error.statusCode = 400;
    throw error;
  }
}

function assertValidCommunicationEvidenceList(entries, context) {
  if (!Array.isArray(entries)) throw new Error(`${context}: Kommunikationshinweise ungueltig`);
  const channels = new Set(["gmail", "airbnb", "whatsapp", "imessage", "sms", "phone", "hoa", "turno", "other"]);
  const directions = new Set(["inbound", "outbound", "internal", "unknown"]);
  const allowedKeys = new Set(["id", "date", "channel", "direction", "contact", "summary", "impact", "source", "confidence"]);
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${context}: Kommunikationshinweis ungueltig`);
    for (const key of Object.keys(entry)) {
      if (!allowedKeys.has(key)) throw new Error(`${context}: unsicheres Kommunikationsfeld ${key}`);
    }
    if (typeof entry.date !== "string" || !entry.date) throw new Error(`${context}: Kommunikationsdatum fehlt`);
    if (!channels.has(entry.channel)) throw new Error(`${context}: Kommunikationskanal ungueltig`);
    if (entry.direction !== undefined && !directions.has(entry.direction)) throw new Error(`${context}: Kommunikationsrichtung ungueltig`);
    if (typeof entry.summary !== "string" || !entry.summary.trim()) throw new Error(`${context}: Kommunikationszusammenfassung fehlt`);
    for (const key of ["contact", "summary", "impact", "source", "confidence"]) {
      if (entry[key] !== undefined && typeof entry[key] !== "string") throw new Error(`${context}: ${key} muss Text sein`);
      if (typeof entry[key] === "string" && entry[key].length > 500) throw new Error(`${context}: ${key} ist zu lang`);
    }
  }
}

function assertValidDocumentStatus(documentStatus, context) {
  if (!documentStatus || typeof documentStatus !== "object" || Array.isArray(documentStatus)) {
    throw new Error(`${context}: Dokumentenstatus ungueltig`);
  }
  const statuses = new Set(["missing", "requested", "received", "incomplete", "signed", "submitted", "approved", "not_required"]);
  const allowedKeys = new Set(["status", "updatedAt", "source", "note"]);
  for (const [documentKey, entry] of Object.entries(documentStatus)) {
    if (!/^[a-zA-Z0-9_-]{2,80}$/.test(documentKey)) throw new Error(`${context}: Dokumentenschluessel ungueltig`);
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`${context}: Dokument ${documentKey} ungueltig`);
    for (const key of Object.keys(entry)) {
      if (!allowedKeys.has(key)) throw new Error(`${context}: unsicheres Dokumentenfeld ${key}`);
    }
    if (!statuses.has(entry.status)) throw new Error(`${context}: Dokumentenstatus ${documentKey} ungueltig`);
    for (const key of ["updatedAt", "source", "note"]) {
      if (entry[key] !== undefined && typeof entry[key] !== "string") throw new Error(`${context}: ${key} muss Text sein`);
      if (typeof entry[key] === "string" && entry[key].length > 500) throw new Error(`${context}: ${key} ist zu lang`);
    }
  }
}

function assertValidInboxItems(items, context, caseIds) {
  if (!Array.isArray(items)) throw new Error(`${context}: Eingangsmappe ungueltig`);
  const statuses = new Set(["new", "reviewed", "applied", "ignored"]);
  const priorities = new Set(["high", "medium", "low"]);
  const channels = new Set(["gmail", "airbnb", "whatsapp", "imessage", "sms", "phone", "hoa", "turno", "other"]);
  const allowedKeys = new Set(["id", "caseId", "date", "source", "channel", "title", "summary", "status", "priority", "impact", "gbrainSyncedAt"]);
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${context}: Eingang ungueltig`);
    for (const key of Object.keys(item)) {
      if (!allowedKeys.has(key)) throw new Error(`${context}: unsicheres Eingangsfeld ${key}`);
    }
    if (!item.id || typeof item.id !== "string") throw new Error(`${context}: Eingang ohne ID`);
    if (ids.has(item.id)) throw new Error(`${context}: doppelte Eingang-ID ${item.id}`);
    ids.add(item.id);
    if (caseIds && item.caseId && !caseIds.has(item.caseId)) throw new Error(`${context}: Eingang ${item.id}: Fall nicht gefunden`);
    if (!item.title || typeof item.title !== "string") throw new Error(`${context}: Eingang ${item.id}: Titel fehlt`);
    if (!item.summary || typeof item.summary !== "string") throw new Error(`${context}: Eingang ${item.id}: Zusammenfassung fehlt`);
    if (!statuses.has(item.status || "new")) throw new Error(`${context}: Eingang ${item.id}: Status ungueltig`);
    if (!priorities.has(item.priority || "medium")) throw new Error(`${context}: Eingang ${item.id}: Prioritaet ungueltig`);
    if (item.channel && !channels.has(item.channel)) throw new Error(`${context}: Eingang ${item.id}: Kanal ungueltig`);
    for (const key of ["date", "source", "channel", "title", "summary", "impact", "gbrainSyncedAt"]) {
      if (item[key] !== undefined && typeof item[key] !== "string") throw new Error(`${context}: Eingang ${item.id}: ${key} muss Text sein`);
      if (typeof item[key] === "string" && item[key].length > 700) throw new Error(`${context}: Eingang ${item.id}: ${key} ist zu lang`);
    }
  }
}

function assertValidSuggestionPatch(suggestion) {
  const patch = suggestion.patch;
  if (!patch || typeof patch !== "object") return;
  const allowedKeys = new Set(["gmail", "recommendation", "timeline", "communicationEvidence", "inboxItems"]);
  for (const key of Object.keys(patch)) {
    if (!allowedKeys.has(key)) throw new Error(`KI-Vorschlag ${suggestion.id}: unsicheres Patch-Feld ${key}`);
  }
  if (patch.gmail !== undefined && (!patch.gmail || typeof patch.gmail !== "object" || Array.isArray(patch.gmail))) {
    throw new Error(`KI-Vorschlag ${suggestion.id}: Gmail-Patch ungueltig`);
  }
  if (patch.recommendation !== undefined && typeof patch.recommendation !== "string") {
    throw new Error(`KI-Vorschlag ${suggestion.id}: Empfehlung ungueltig`);
  }
  if (patch.timeline !== undefined) {
    if (!Array.isArray(patch.timeline)) throw new Error(`KI-Vorschlag ${suggestion.id}: Timeline-Patch ungueltig`);
    for (const entry of patch.timeline) {
      if (!entry || typeof entry !== "object" || typeof entry.date !== "string" || typeof entry.text !== "string") {
        throw new Error(`KI-Vorschlag ${suggestion.id}: Timeline-Eintrag ungueltig`);
      }
    }
  }
  if (patch.communicationEvidence !== undefined) {
    assertValidCommunicationEvidenceList(patch.communicationEvidence, `KI-Vorschlag ${suggestion.id}`);
  }
  if (patch.inboxItems !== undefined) {
    assertValidInboxItems(patch.inboxItems, `KI-Vorschlag ${suggestion.id}`, null);
  }
}

const PROHIBITED_SENSITIVE_KEYS = new Set([
  "ssn",
  "ssnnumber",
  "socialsecurity",
  "socialsecuritynumber",
  "taxid",
  "taxpayeridentificationnumber",
  "dob",
  "dateofbirth",
  "datebirth",
  "birthdate",
  "gender",
  "governmentid",
  "governmentidnumber",
  "identitydocument",
  "idtype",
  "idnumber",
  "idstate",
  "passport",
  "passportnumber",
  "driverlicense",
  "driverlicensenumber",
  "driverslicense",
  "driverslicensenumber",
  "photoid",
  "photoids",
  "idimage",
  "employer",
  "employerphone",
  "employment",
  "employmenthistory",
  "employeraddress",
  "reference",
  "references",
  "personalreferences",
  "landlordreferences",
  "emergency",
  "emergencycontact",
  "emergencycontacts",
  "credit",
  "creditscore",
  "creditreport",
  "creditdata",
  "criminal",
  "criminalhistory",
  "criminalrecord",
  "eviction",
  "evictionhistory",
  "bank",
  "bankaccount",
  "bankaccountnumber",
  "bankinformation",
  "bankrouting",
  "financialdata",
  "financialinformation",
  "routingnumber",
  "screening",
  "backgroundauthorization",
  "backgroundreport",
  "backgroundcheckreport",
  "screeningreport",
  "tenantevaluationreport",
]);

function normalizeSensitiveKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isValidISODate(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function assertNoProhibitedSensitiveData(value, path = "state", seen = new Set()) {
  if (typeof value === "string") {
    const prohibitedText = /\b\d{3}[- ]?\d{2}[- ]?\d{4}\b/.test(value) ||
      /\b(?:ssn|social\s*security(?:\s*number)?|tax(?:payer)?\s*(?:id|identification\s*number)|date\s*of\s*birth|dob|gender|passport(?:\s*number)?|driver'?s?\s*licen[cs]e(?:\s*number)?|credit\s*(?:score|report)|criminal\s*(?:history|record)|eviction\s*history|bank\s*(?:account|routing|information)|routing\s*number|financial\s*(?:data|information)|employer|employment(?:\s*history)?|personal\s*references?|landlord\s*references?|emergency\s*contacts?|background(?:\s*check)?\s*report|screening\s*report|tenant\s*evaluation\s*report)\s*[:=#-]\s*\S+/i.test(value);
    if (prohibitedText) {
      const error = new Error("prohibited_sensitive_data");
      error.prohibitedPath = path;
      throw error;
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoProhibitedSensitiveData(entry, `${path}[${index}]`, seen));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (PROHIBITED_SENSITIVE_KEYS.has(normalizeSensitiveKey(key))) {
      const error = new Error("prohibited_sensitive_data");
      error.prohibitedPath = `${path}.${key}`;
      throw error;
    }
    assertNoProhibitedSensitiveData(entry, `${path}.${key}`, seen);
  }
}

function assertValidState(state) {
  assertNoProhibitedSensitiveData(state);
  if (!state || typeof state !== "object") throw new Error("State fehlt");
  if (!state.property || typeof state.property !== "object") throw new Error("Property fehlt");
  if (!Array.isArray(state.cases)) throw new Error("Cases fehlen");
  if (!state.templates || typeof state.templates !== "object") throw new Error("Templates fehlen");
  if (state.listingKnowledge !== undefined && (!state.listingKnowledge || typeof state.listingKnowledge !== "object")) {
    throw new Error("Inseratswissen ungueltig");
  }
  if (state.listingKnowledge?.advertisedAmenities !== undefined && !Array.isArray(state.listingKnowledge.advertisedAmenities)) {
    throw new Error("Inseratsausstattung ungueltig");
  }
  if (state.listingKnowledge?.cleaningChecklist !== undefined && !Array.isArray(state.listingKnowledge.cleaningChecklist)) {
    throw new Error("Inserats-Reinigungscheckliste ungueltig");
  }

  const ids = new Set();
  for (const caseItem of state.cases) {
    if (!caseItem.id || typeof caseItem.id !== "string") throw new Error("Fall ohne ID");
    if (ids.has(caseItem.id)) throw new Error(`Doppelte Fall-ID: ${caseItem.id}`);
    ids.add(caseItem.id);
    if (!caseItem.guestName || typeof caseItem.guestName !== "string") throw new Error(`Fall ${caseItem.id}: Gastname fehlt`);
    if (!caseItem.start || !caseItem.end) throw new Error(`Fall ${caseItem.id}: Zeitraum fehlt`);
    if (!caseItem.checklist || typeof caseItem.checklist !== "object") throw new Error(`Fall ${caseItem.id}: Checkliste fehlt`);
    const submittedToHoa = caseItem.checklist.submittedToHoa === true;
    if (submittedToHoa && caseItem.checklist.vendorHandoff !== true) {
      throw new Error(`Fall ${caseItem.id}: HOA-Einreichung ohne bestaetigten Vendor-Handoff`);
    }
    if (submittedToHoa && caseItem.checklist.vendorStatus !== true) {
      throw new Error(`Fall ${caseItem.id}: HOA-Einreichung ohne bestaetigten Vendor-Status`);
    }
    if (submittedToHoa && caseItem.checklist.feeTracked !== true) {
      throw new Error(`Fall ${caseItem.id}: HOA-Einreichung ohne dokumentierte Gebuehrenentscheidung`);
    }
    const approvalUnlocked = Boolean(caseItem.checklist.boardApproval) || caseItem.status === "approved" || caseItem.checkInLocked === false;
    if (approvalUnlocked) {
      if (!submittedToHoa) throw new Error(`Fall ${caseItem.id}: Board Approval ohne vorherige HOA-Einreichung`);
      const evidence = caseItem.boardApprovalEvidence;
      const allowedAuthorities = new Set(["Board", "Board designee"]);
      const today = new Date().toISOString().slice(0, 10);
      const created = String(caseItem.createdAt || "").slice(0, 10);
      if (
        !evidence ||
        typeof evidence !== "object" ||
        Array.isArray(evidence) ||
        !allowedAuthorities.has(evidence.authority) ||
        typeof evidence.date !== "string" ||
        !isValidISODate(evidence.date) ||
        evidence.date > today ||
        (isValidISODate(created) && evidence.date < created) ||
        typeof evidence.referenceId !== "string" ||
        !evidence.referenceId.trim() ||
        evidence.referenceId.length > 200 ||
        typeof evidence.namedParty !== "string" ||
        evidence.namedParty.trim() !== caseItem.guestName.trim() ||
        evidence.namedParty.length > 200
      ) {
        throw new Error(`Fall ${caseItem.id}: Board Approval ohne substantiellen Beleg (authority, nicht-zukuenftiges Datum, minutes/signed-consent referenceId und namedParty erforderlich)`);
      }
      for (const [key, value] of Object.entries(evidence)) {
        if (!["authority", "date", "referenceId", "namedParty"].includes(key)) throw new Error(`Fall ${caseItem.id}: unsicheres Board-Approval-Feld ${key}`);
        if (typeof value !== "string") throw new Error(`Fall ${caseItem.id}: Board-Approval-Feld ${key} muss Text sein`);
      }
    }
    if (caseItem.checklist.boardApproval && caseItem.checkInLocked) throw new Error(`Fall ${caseItem.id}: approved, aber Check-in gesperrt`);
    if (caseItem.status === "approved" && !caseItem.checklist.boardApproval) {
      throw new Error(`Fall ${caseItem.id}: Status approved ohne Board Approval`);
    }
    if (!caseItem.checklist.boardApproval && caseItem.checkInLocked === false) {
      throw new Error(`Fall ${caseItem.id}: Check-in entsperrt ohne Board Approval`);
    }
    if (caseItem.communicationEvidence !== undefined) {
      assertValidCommunicationEvidenceList(caseItem.communicationEvidence, `Fall ${caseItem.id}`);
    }
    if (caseItem.documentStatus !== undefined) {
      assertValidDocumentStatus(caseItem.documentStatus, `Fall ${caseItem.id}`);
    }
  }

  if (state.inboxItems !== undefined) assertValidInboxItems(state.inboxItems, "Eingangsmappe", ids);

  if (state.aiSuggestions !== undefined && !Array.isArray(state.aiSuggestions)) throw new Error("KI-Vorschlaege ungueltig");
  const suggestionIds = new Set();
  const statuses = new Set(["pending", "accepted", "rejected"]);
  for (const suggestion of state.aiSuggestions || []) {
    if (!suggestion || typeof suggestion !== "object") throw new Error("KI-Vorschlag ungueltig");
    if (!suggestion.id || typeof suggestion.id !== "string") throw new Error("KI-Vorschlag ohne ID");
    if (suggestionIds.has(suggestion.id)) throw new Error(`Doppelte KI-Vorschlag-ID: ${suggestion.id}`);
    suggestionIds.add(suggestion.id);
    if (suggestion.caseId && !ids.has(suggestion.caseId)) throw new Error(`KI-Vorschlag ${suggestion.id}: Fall nicht gefunden`);
    if (!statuses.has(suggestion.status)) throw new Error(`KI-Vorschlag ${suggestion.id}: Status ungueltig`);
    assertValidSuggestionPatch(suggestion);
  }

  if (state.maintenanceItems !== undefined && !Array.isArray(state.maintenanceItems)) throw new Error("Maengelliste ungueltig");
  const maintenanceIds = new Set();
  const maintenanceStatuses = new Set(["open", "planned", "ordered", "done", "cancelled"]);
  const maintenancePriorities = new Set(["high", "medium", "low"]);
  for (const item of state.maintenanceItems || []) {
    if (!item || typeof item !== "object") throw new Error("Mangel ungueltig");
    if (!item.id || typeof item.id !== "string") throw new Error("Mangel ohne ID");
    if (maintenanceIds.has(item.id)) throw new Error(`Doppelte Mangel-ID: ${item.id}`);
    maintenanceIds.add(item.id);
    if (!item.title || typeof item.title !== "string") throw new Error(`Mangel ${item.id}: Titel fehlt`);
    if (!item.item || typeof item.item !== "string") throw new Error(`Mangel ${item.id}: Gegenstand fehlt`);
    if (!maintenanceStatuses.has(item.status)) throw new Error(`Mangel ${item.id}: Status ungueltig`);
    if (!maintenancePriorities.has(item.priority)) throw new Error(`Mangel ${item.id}: Dringlichkeit ungueltig`);
    if (item.caseId && !ids.has(item.caseId)) throw new Error(`Mangel ${item.id}: Fall nicht gefunden`);
  }

  if (state.cleaning !== undefined) {
    if (!state.cleaning || typeof state.cleaning !== "object") throw new Error("Reinigung ungueltig");
    if (!Array.isArray(state.cleaning.projects)) throw new Error("Reinigungsprojekte fehlen");
    const cleaningProjectIds = new Set();
    const cleaningStatuses = new Set(["scheduled", "accepted", "started", "completed", "paid", "problem", "cancelled"]);
    for (const project of state.cleaning.projects) {
      if (!project || typeof project !== "object") throw new Error("Reinigungsprojekt ungueltig");
      if (!project.id || typeof project.id !== "string") throw new Error("Reinigungsprojekt ohne ID");
      if (cleaningProjectIds.has(project.id)) throw new Error(`Doppelte Reinigungs-ID: ${project.id}`);
      cleaningProjectIds.add(project.id);
      if (!project.projectId || typeof project.projectId !== "string") throw new Error(`Reinigung ${project.id}: Turno-Projekt-ID fehlt`);
      if (!project.date || typeof project.date !== "string") throw new Error(`Reinigung ${project.id}: Datum fehlt`);
      if (!cleaningStatuses.has(project.status)) throw new Error(`Reinigung ${project.id}: Status ungueltig`);
    }
  }

  if (state.payments !== undefined) {
    if (!state.payments || typeof state.payments !== "object") throw new Error("Zahlungen ungueltig");
    if (!Array.isArray(state.payments.items)) throw new Error("Zahlungseintraege fehlen");
    const paymentIds = new Set();
    const paymentStatuses = new Set(["needs_airbnb_review", "expected", "paid", "partial", "cancelled", "disputed"]);
    for (const payment of state.payments.items) {
      if (!payment || typeof payment !== "object") throw new Error("Zahlungseintrag ungueltig");
      if (!payment.id || typeof payment.id !== "string") throw new Error("Zahlung ohne ID");
      if (paymentIds.has(payment.id)) throw new Error(`Doppelte Zahlungs-ID: ${payment.id}`);
      paymentIds.add(payment.id);
      if (!payment.caseId || !ids.has(payment.caseId)) throw new Error(`Zahlung ${payment.id}: Fall nicht gefunden`);
      if (!payment.guestName || typeof payment.guestName !== "string") throw new Error(`Zahlung ${payment.id}: Mieter/Gast fehlt`);
      if (!paymentStatuses.has(payment.status)) throw new Error(`Zahlung ${payment.id}: Status ungueltig`);
      for (const key of ["expectedPayout", "receivedPayout", "cleaningCostAmount", "airbnbTransactionId"]) {
        if (payment[key] !== undefined && typeof payment[key] !== "string") throw new Error(`Zahlung ${payment.id}: ${key} muss Text sein`);
      }
    }
  }

  if (state.telephony !== undefined) {
    if (!state.telephony || typeof state.telephony !== "object" || Array.isArray(state.telephony)) throw new Error("Telefonie ungueltig");
    if (!Array.isArray(state.telephony.contacts)) throw new Error("Telefonie-Kontakte fehlen");
    if (!Array.isArray(state.telephony.callLog)) throw new Error("Telefonie-Anrufliste fehlt");
    const contactIds = new Set();
    for (const contact of state.telephony.contacts) {
      if (!contact || typeof contact !== "object") throw new Error("Telefonie-Kontakt ungueltig");
      if (!contact.id || typeof contact.id !== "string") throw new Error("Telefonie-Kontakt ohne ID");
      if (contactIds.has(contact.id)) throw new Error(`Doppelte Telefonie-Kontakt-ID: ${contact.id}`);
      contactIds.add(contact.id);
      if (!contact.label || typeof contact.label !== "string") throw new Error(`Telefonie-Kontakt ${contact.id}: Name fehlt`);
      for (const key of ["phone", "context", "notes", "source"]) {
        if (contact[key] !== undefined && typeof contact[key] !== "string") throw new Error(`Telefonie-Kontakt ${contact.id}: ${key} muss Text sein`);
      }
    }
    const callIds = new Set();
    const callStatuses = new Set(["planned", "called", "reached", "left_message", "failed", "cancelled"]);
    for (const call of state.telephony.callLog) {
      if (!call || typeof call !== "object") throw new Error("Telefonie-Anruf ungueltig");
      if (!call.id || typeof call.id !== "string") throw new Error("Telefonie-Anruf ohne ID");
      if (callIds.has(call.id)) throw new Error(`Doppelte Telefonie-Anruf-ID: ${call.id}`);
      callIds.add(call.id);
      if (!call.date || typeof call.date !== "string") throw new Error(`Telefonie-Anruf ${call.id}: Datum fehlt`);
      if (!call.phone || typeof call.phone !== "string") throw new Error(`Telefonie-Anruf ${call.id}: Telefonnummer fehlt`);
      if (!callStatuses.has(call.status)) throw new Error(`Telefonie-Anruf ${call.id}: Status ungueltig`);
      if (call.caseId && !ids.has(call.caseId)) throw new Error(`Telefonie-Anruf ${call.id}: Fall nicht gefunden`);
      for (const key of ["contactId", "contact", "project", "topic", "notes", "nextAction", "createdAt", "lastUpdatedAt"]) {
        if (call[key] !== undefined && typeof call[key] !== "string") throw new Error(`Telefonie-Anruf ${call.id}: ${key} muss Text sein`);
      }
    }
  }
}

async function backupCurrentState() {
  if (!existsSync(stateFile)) return "";
  await mkdir(stateBackupDir, { recursive: true });
  const backupFile = join(stateBackupDir, `airbnb-hoa-state-${timestampForFile()}.json`);
  await copyFile(stateFile, backupFile);
  return backupFile;
}

class StateReadError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "StateReadError";
  }
}

let stateInitPromise = null;

async function acquireStateLock({ timeoutMs = 5000 } = {}) {
  await mkdir(dataDir, { recursive: true });
  // Delegate the actual inter-process lock to the kernel. Python's fcntl.flock
  // is available on both Linux and macOS, is released automatically on crash,
  // and avoids every stale-directory/ABA reclamation race. The helper holds the
  // descriptor until Node closes its stdin.
  const helper = String.raw`
import fcntl, os, sys, time
path, timeout = sys.argv[1], float(sys.argv[2])
fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
os.fchmod(fd, 0o600)
deadline = time.monotonic() + timeout
while True:
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except BlockingIOError:
        if time.monotonic() >= deadline:
            print("TIMEOUT", flush=True)
            sys.exit(73)
        time.sleep(0.025)
print("LOCKED", flush=True)
for _ in sys.stdin.buffer:
    pass
fcntl.flock(fd, fcntl.LOCK_UN)
os.close(fd)
`;

  const child = spawn("python3", ["-u", "-c", helper, stateLockFile, String(timeoutMs / 1000)], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (!settled && stdout.includes("LOCKED\n")) {
        settled = true;
        resolve();
      }
      if (!settled && stdout.includes("TIMEOUT\n")) {
        const error = new Error("state_locked");
        error.statusCode = 423;
        fail(error);
      }
    });
    child.once("error", fail);
    child.once("exit", (code, signal) => {
      if (settled) return;
      const error = new Error(code === 73 ? "state_locked" : `state_lock_helper_failed: ${stderr.trim() || signal || code}`);
      error.statusCode = code === 73 ? 423 : 500;
      fail(error);
    });
  }).catch((error) => {
    child.stdin.destroy();
    if (!child.killed) child.kill();
    throw error;
  });

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        if (!child.killed) child.kill();
        setTimeout(finish, 100).unref();
      }, 1000);
      child.once("exit", finish);
      child.stdin.end();
    });
  };
}

async function initializeStateFile() {
  await mkdir(dataDir, { recursive: true });
  if (existsSync(stateFile)) return;

  if (!stateInitPromise) {
    stateInitPromise = (async () => {
      const releaseLock = await acquireStateLock();
      try {
        if (existsSync(stateFile)) return;
        const initialState = seedState();
        assertValidState(initialState);
        const tempFile = `${stateFile}.tmp-init-${process.pid}-${Date.now()}`;
        let handle;
        try {
          handle = await open(tempFile, "wx", 0o600);
          await handle.writeFile(JSON.stringify(initialState, null, 2) + "\n", "utf8");
          await handle.sync();
          await handle.close();
          handle = undefined;
          await rename(tempFile, stateFile);
        } catch (error) {
          if (handle) {
            try {
              await handle.close();
            } catch {
              // preserve the original initialization failure
            }
          }
          try {
            await unlink(tempFile);
          } catch {
            // temp file already gone
          }
          throw error;
        }
      } finally {
        await releaseLock();
      }
    })();
  }

  const pending = stateInitPromise;
  try {
    await pending;
  } finally {
    if (stateInitPromise === pending) stateInitPromise = null;
  }
}

// Strict state reader: fails closed when the real state file exists but is
// unreadable, malformed, schema-invalid or violates invariants. Seed data is
// created only when the file truly does not exist.
function migrateLegacyChecklistState(state) {
  for (const caseItem of state?.cases || []) {
    const checklist = caseItem?.checklist;
    if (!checklist || typeof checklist !== "object" || Array.isArray(checklist)) continue;
    const hadBackgroundAuthorization = Object.hasOwn(checklist, "backgroundAuthorization");
    const hadPhotoIds = Object.hasOwn(checklist, "photoIds");
    if (!hadBackgroundAuthorization && !hadPhotoIds) continue;
    if (checklist.vendorHandoff === undefined) {
      // Legacy identity/background flags do not prove that the external vendor
      // received a current handoff.  Migrate conservatively so an upgrade can
      // never turn old sensitive-data workflow state into a completed gate.
      checklist.vendorHandoff = false;
    }
    if (checklist.vendorStatus === undefined) checklist.vendorStatus = false;
    if (checklist.vendorHandoff !== true || checklist.vendorStatus !== true) {
      // Downstream completion depended on the former sensitive-data flags.
      // Revoke it rather than preserving an unsupported submission/approval.
      checklist.submittedToHoa = false;
      checklist.boardApproval = false;
      caseItem.checkInLocked = true;
      if (caseItem.status === "approved") caseItem.status = "waiting_for_board_approval";
      delete caseItem.boardApprovalEvidence;
    }
    delete checklist.backgroundAuthorization;
    delete checklist.photoIds;
  }
  return state;
}

async function readStateStrict({ validate = true } = {}) {
  await initializeStateFile();
  let raw;
  try {
    raw = await readFile(stateFile, "utf8");
  } catch (error) {
    throw new StateReadError(`state_file_unreadable: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new StateReadError(`state_file_malformed: ${error.message}`);
  }
  parsed = migrateLegacyChecklistState(parsed);
  if (validate) {
    try {
      assertValidState(parsed);
    } catch (error) {
      throw new StateReadError(`state_file_invalid: ${error.message}`);
    }
  }
  return parsed;
}

let stateWriteChain = Promise.resolve();

function nextStateToken(currentToken) {
  const now = Date.now();
  const currentMilliseconds = Date.parse(currentToken || "");
  const nextMilliseconds = Number.isFinite(currentMilliseconds) ? Math.max(now, currentMilliseconds + 1) : now;
  return new Date(nextMilliseconds).toISOString();
}

// Serialize the compare, validation, backup and replacement as one critical
// section. Comparing updatedAt before entering this queue would let two
// simultaneous clients both pass and the second silently overwrite the first.
function writeStateAtomic(incomingState) {
  const run = async () => {
    // Sensitive payloads are rejected deterministically before concurrency-token
    // handling so a stale token can never mask a prohibited-data violation.
    assertNoProhibitedSensitiveData(incomingState);
    await initializeStateFile();
    const releaseLock = await acquireStateLock();
    try {
      const currentState = await readStateStrict();
      if (!incomingState.updatedAt || incomingState.updatedAt !== currentState.updatedAt) {
        const error = new Error("stale_state");
        error.statusCode = 409;
        throw error;
      }
      const nextState = { ...incomingState, updatedAt: nextStateToken(currentState.updatedAt) };
      assertValidState(nextState);
      const backupFile = await backupCurrentState();
      const tempFile = `${stateFile}.tmp-${process.pid}-${Date.now()}`;
      let handle;
      try {
        handle = await open(tempFile, "wx", 0o600);
        await handle.writeFile(JSON.stringify(nextState, null, 2) + "\n", "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(tempFile, stateFile);
      } catch (error) {
        if (handle) {
          try {
            await handle.close();
          } catch {
            // preserve the original write failure
          }
        }
        try {
          await unlink(tempFile);
        } catch {
          // temp file already gone
        }
        throw error;
      }
      return { backupFile, nextState };
    } finally {
      await releaseLock();
    }
  };
  const result = stateWriteChain.then(run, run);
  stateWriteChain = result.then(() => {}, () => {});
  return result;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

async function buildHealth() {
  const operationsManifest = await readJson(operationsManifestFile, { version: 1, domains: [], runtimePolicy: {} });
  const runtimePolicy = operationsManifest.runtimePolicy || {};
  let stateError = "";
  try {
    await initializeStateFile();
  } catch {
    stateError = "state_file_unreadable";
  }
  const checks = {
    dataDir: existsSync(dataDir),
    stateFile: existsSync(stateFile),
    calendarSnapshot: existsSync(calendarFile),
    operationsManifest: existsSync(operationsManifestFile),
  };
  if (checks.stateFile && !stateError) {
    try {
      await readStateStrict();
    } catch (error) {
      // Report degradation without leaking private state content.
      stateError = error instanceof StateReadError ? error.message.split(":")[0] : "state_file_unreadable";
    }
  }
  const ok = Object.values(checks).every(Boolean) && !stateError;
  return {
    ok,
    status: ok ? "ok" : "degraded",
    app: "airbnb-hoa-operations",
    generatedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    runtime: {
      target: process.env.RUNTIME_TARGET || runtimePolicy.defaultTarget || "local_mac_dev",
      deploymentMode: process.env.DEPLOYMENT_MODE || (host === "127.0.0.1" ? "local_development" : "private_vm"),
      host,
      port,
      node: process.version,
      workspace: root,
      publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
    },
    checks: { ...checks, stateValid: !stateError },
    ...(stateError ? { stateError } : {}),
    domains: (operationsManifest.domains || []).map((domain) => ({
      id: domain.id,
      status: domain.status,
      deploymentTarget: domain.deployment?.target || domain.deploymentPlan?.target || "",
    })),
  };
}

function notFound(res) {
  json(res, 404, { error: "not_found" });
}

function formatDate(value) {
  if (!value) return "-";
  const [year, month, day] = String(value).split("-");
  if (!year || !month || !day) return value;
  return `${day}.${month}.${year}`;
}

function checklistText(value) {
  return value ? "ja" : "nein";
}

function missingChecklist(caseItem) {
  const labels = {
    airbnbInitialMessage: "Airbnb-Erstnachricht",
    guestAcknowledged: "Gastbestaetigung HOA-Prozess",
    packetSent: "Dokumentpaket gesendet",
    leaseApplication: "Lease Application",
    vendorHandoff: "Sicherer Vendor-Handoff",
    vendorStatus: "Vendor-Bestaetigung",
    shortTermLeaseTenantSigned: "Short-Term Lease Tenant-Signatur",
    shortTermLeaseOwnerSigned: "Short-Term Lease Owner-Signatur",
    rulesSent: "Rules and Regulations gesendet",

    feeTracked: "USD 100 Fee / Check",
    submittedToHoa: "Einreichung bei HOA",
    boardApproval: "Board Approval",
  };
  const checklist = caseItem.checklist || {};
  return Object.entries(labels)
    .filter(([key]) => !checklist[key])
    .map(([, label]) => label);
}

function daysBetweenISO(a, b) {
  if (!a || !b) return null;
  const left = new Date(`${a}T00:00:00`);
  const right = new Date(`${b}T00:00:00`);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return null;
  return Math.round((right - left) / 86400000);
}

function relativeDueText(value) {
  if (!value) return "";
  const diff = daysBetweenISO(todayISO(), value);
  if (diff === null) return formatDate(value);
  if (diff < 0) return `${formatDate(value)} ueberfaellig`;
  if (diff === 0) return `${formatDate(value)} heute`;
  if (diff === 1) return `${formatDate(value)} morgen`;
  return `${formatDate(value)} in ${diff} Tagen`;
}

function displayRisk(caseItem) {
  if (caseItem.status === "approved" || caseItem.checklist?.boardApproval) return { level: "green", label: "Freigegeben" };
  if (caseItem.status === "cancellation_review") return { level: "red", label: "Storno pruefen" };
  if (caseItem.checkInLocked) return { level: "red", label: "Check-in gesperrt" };
  if (caseItem.status === "reminder_due") return { level: "amber", label: "Reminder faellig" };
  return { level: "amber", label: "Pruefen" };
}

function displayWorkItems(state, dailyCheck) {
  const cases = state.cases || [];
  const items = [];
  const push = (item) => {
    if (!item.title) return;
    items.push(item);
  };

  for (const item of dailyCheck.items || []) {
    if (["payment", "cleaning"].includes(item.kind)) continue;
    const caseItem = cases.find((entry) => entry.id === item.caseId);
    push({
      level: item.level || "blue",
      title: item.title,
      detail: item.detail || "",
      due: item.due || "",
      dueText: item.due ? relativeDueText(item.due) : "",
      owner: item.kind === "telephony" ? "Telefonie" : caseItem?.guestName || item.guestName || item.kind || "Airbnb HOA",
      target: item.caseId || item.kind || "",
    });
  }

  const cleaningItems = (dailyCheck.items || []).filter((item) => item.kind === "cleaning");
  if (cleaningItems.length) {
    const firstCleaning = [...cleaningItems].sort((left, right) => String(left.due || "").localeCompare(String(right.due || "")))[0];
    push({
      level: cleaningItems.some((item) => item.level === "red") ? "red" : "amber",
      title: "Turno-Reinigung nach Check-out belegen",
      detail:
        cleaningItems.length === 1
          ? firstCleaning.detail || "Eine Reinigung nach Check-out ist noch nicht belegt."
          : `${cleaningItems.length} Reinigungen nach Check-out brauchen Turno-Beleg.`,
      due: firstCleaning?.due || todayISO(),
      dueText: relativeDueText(firstCleaning?.due || todayISO()),
      owner: "Turno",
      target: "cleaning",
    });
  }

  for (const item of state.inboxItems || []) {
    if (["applied", "ignored"].includes(item.status || "new")) continue;
    push({
      level: item.priority === "high" ? "red" : item.priority === "low" ? "blue" : "amber",
      title: `Eingang pruefen: ${item.title}`,
      detail: item.summary || "",
      due: item.date || todayISO(),
      dueText: relativeDueText(item.date || todayISO()),
      owner: item.caseId ? (cases.find((entry) => entry.id === item.caseId)?.guestName || item.caseId) : item.channel || "Eingangsmappe",
      target: item.caseId || "inbox",
    });
  }

  const payments = state.payments?.items || [];
  const paymentOpen = payments.filter((payment) => ["needs_airbnb_review", "partial", "disputed"].includes(payment.status));
  if (paymentOpen.length) {
    push({
      level: paymentOpen.some((payment) => ["partial", "disputed"].includes(payment.status)) ? "red" : "amber",
      title: "Airbnb-Zahlungen Mietern zuordnen",
      detail: `${paymentOpen.length} Zahlungseintrag${paymentOpen.length === 1 ? "" : "e"} brauchen Airbnb-Pruefung oder Betrag.`,
      due: todayISO(),
      dueText: "heute",
      owner: "Airbnb",
      target: "payments",
    });
  }

  const maintenance = (state.maintenanceItems || []).filter((item) => !["done", "cancelled"].includes(item.status));
  const urgentMaintenance = maintenance.find((item) => item.priority === "high" || (item.dueDate && daysBetweenISO(todayISO(), item.dueDate) < 0));
  if (urgentMaintenance) {
    push({
      level: "red",
      title: `Mangel klaeren: ${urgentMaintenance.item}`,
      detail: urgentMaintenance.title || urgentMaintenance.description || "",
      due: urgentMaintenance.dueDate || todayISO(),
      dueText: relativeDueText(urgentMaintenance.dueDate || todayISO()),
      owner: "Maengel",
      target: urgentMaintenance.caseId || "maintenance",
    });
  }

  const hasTelephonyDailyItems = (dailyCheck.items || []).some((item) => item.kind === "telephony");
  if (!hasTelephonyDailyItems) {
    const telephonyCalls = (state.telephony?.callLog || []).filter((call) => ["planned", "failed", "left_message"].includes(call.status || "planned"));
    for (const call of telephonyCalls) {
      push({
        level: call.status === "failed" ? "red" : "amber",
        title: `Anruf vorbereiten: ${call.contact || call.phone || "Telefonie"}`,
        detail: [call.topic, call.nextAction, call.notes].filter(Boolean).join(" "),
        due: call.date || todayISO(),
        dueText: relativeDueText(call.date || todayISO()),
        owner: "Telefonie",
        target: "telephony",
      });
    }
  }

  const order = { red: 0, amber: 1, blue: 2, green: 3 };
  return items
    .sort((left, right) => {
      const leftOrder = order[left.level] ?? 9;
      const rightOrder = order[right.level] ?? 9;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return String(left.due || "9999-12-31").localeCompare(String(right.due || "9999-12-31"));
    })
    .slice(0, 8);
}

function buildDisplayState(state, calendar, dailyCheck) {
  const cases = state.cases || [];
  const payments = state.payments?.items || [];
  const maintenance = state.maintenanceItems || [];
  const inbox = state.inboxItems || [];
  const telephonyOpen = (state.telephony?.callLog || []).filter((call) => ["planned", "failed", "left_message"].includes(call.status || "planned"));
  const workItems = displayWorkItems(state, dailyCheck);
  const openCases = cases.filter((caseItem) => caseItem.status !== "approved");
  const lockedCases = cases.filter((caseItem) => caseItem.checkInLocked);
  const paymentOpen = payments.filter((payment) => ["needs_airbnb_review", "partial", "disputed"].includes(payment.status));
  const activeMaintenance = maintenance.filter((item) => !["done", "cancelled"].includes(item.status));
  const openInbox = inbox.filter((item) => !["applied", "ignored"].includes(item.status || "new"));
  return {
    generatedAt: new Date().toISOString(),
    today: todayISO(),
    property: {
      listingName: state.property?.listingName || "Airbnb HOA",
      unit: state.property?.unit || "",
    },
    summary: {
      openCases: openCases.length,
      lockedCases: lockedCases.length,
      inboxOpen: openInbox.length,
      paymentsOpen: paymentOpen.length,
      maintenanceOpen: activeMaintenance.length,
      telephonyOpen: telephonyOpen.length,
      dailyRed: dailyCheck.summary?.red || workItems.filter((item) => item.level === "red").length,
      dailyAmber: dailyCheck.summary?.amber || workItems.filter((item) => item.level === "amber").length,
      calendarEvents: (calendar.events || []).length,
    },
    workItems,
    cases: cases
      .map((caseItem) => {
        const risk = displayRisk(caseItem);
        return {
          id: caseItem.id,
          guestName: caseItem.guestName,
          start: caseItem.start,
          end: caseItem.end,
          stayText: `${formatDate(caseItem.start)} bis ${formatDate(caseItem.end)}`,
          reservationCode: caseItem.reservationCode || "",
          status: caseItem.status,
          checkInLocked: Boolean(caseItem.checkInLocked),
          boardApproval: Boolean(caseItem.checklist?.boardApproval),
          deadlineDocuments: caseItem.deadlineDocuments || "",
          deadlineText: relativeDueText(caseItem.deadlineDocuments),
          level: risk.level,
          label: risk.label,
          missingCount: missingChecklist(caseItem).length,
        };
      })
      .sort((left, right) => {
        const riskOrder = { red: 0, amber: 1, blue: 2, green: 3 };
        const leftRisk = riskOrder[left.level] ?? 9;
        const rightRisk = riskOrder[right.level] ?? 9;
        if (leftRisk !== rightRisk) return leftRisk - rightRisk;
        return String(left.start || "").localeCompare(String(right.start || ""));
      }),
    deviceAccess: displayInfo(),
  };
}

function buildVoiceBrief(state, calendar, dailyCheck) {
  const displayState = buildDisplayState(state, calendar, dailyCheck);
  const summary = displayState.summary;
  const first = displayState.workItems[0] || null;
  const level = summary.dailyRed ? "red" : summary.dailyAmber || summary.lockedCases ? "amber" : "green";
  const statusSentence = summary.dailyRed
    ? `Es gibt ${summary.dailyRed} rote Punkte und ${summary.dailyAmber} gelbe Punkte.`
    : summary.dailyAmber
      ? `Es gibt keine roten Punkte, aber ${summary.dailyAmber} gelbe Punkte.`
      : "Es gibt aktuell keine roten oder gelben Punkte.";
  const lockedSentence = summary.lockedCases === 1
    ? "Ein Check-in ist gesperrt."
    : `${summary.lockedCases} Check-ins sind gesperrt.`;
  const nextSentence = first
    ? `Naechste Aktion: ${first.title}. ${first.detail}`
    : "Keine akute Aktion in der Arbeitsliste.";
  const displaySentence = `Die grosse Anzeige ist lokal unter ${displayState.deviceAccess.localDisplayUrl} erreichbar.`;
  const guardrail = "Sicherheitsregel: Keine Zugangsdaten senden, solange Board Approval fehlt.";
  return {
    generatedAt: displayState.generatedAt,
    today: displayState.today,
    level,
    text: [
      "Airbnb HOA Status.",
      statusSentence,
      lockedSentence,
      nextSentence,
      displaySentence,
      guardrail,
    ].join(" "),
    summary,
    nextAction: first,
    displayUrl: displayState.deviceAccess.localDisplayUrl,
    lanCandidateDisplayUrls: displayState.deviceAccess.lanCandidateDisplayUrls,
    guardrail,
  };
}

function buildCancellationDossier(state, calendar, dailyCheck, caseId) {
  const caseItem = (state.cases || []).find((item) => item.id === caseId);
  if (!caseItem) throw new Error("Fall nicht gefunden");
  const property = state.property || {};
  const gmail = caseItem.gmail || {};
  const checklist = caseItem.checklist || {};
  const missing = missingChecklist(caseItem);
  const communicationEvidence = caseItem.communicationEvidence || [];
  const caseSuggestions = (state.aiSuggestions || []).filter((suggestion) => suggestion.caseId === caseItem.id);
  const caseMaintenance = (state.maintenanceItems || []).filter((item) => !item.caseId || item.caseId === caseItem.id || item.status !== "done");
  const cleaningProjects = state.cleaning?.projects || [];
  const casePayments = (state.payments?.items || []).filter((payment) => payment.caseId === caseItem.id);
  const caseDailyItems = (dailyCheck.items || []).filter((item) => !item.caseId || item.caseId === caseItem.id);
  const calendarEvent = (calendar.events || []).find((event) => event.uid === caseItem.calendarUid || (event.start === caseItem.start && event.end === caseItem.end));
  const generatedAt = `${todayISO()} America/Panama`;

  const lines = [
    `# Airbnb HOA Support Dossier - ${caseItem.guestName}`,
    "",
    `Generated: ${generatedAt}`,
    "",
    "## Case",
    "",
    `- Guest: ${caseItem.guestName}`,
    `- Stay: ${formatDate(caseItem.start)} to ${formatDate(caseItem.end)}`,
    `- Airbnb reservation: ${caseItem.reservationCode || "unknown"}`,
    `- Guest email: ${caseItem.email || "unknown"}`,
    `- Adults: ${caseItem.adults || "unknown"}`,
    `- Current status: ${caseItem.status}`,
    `- Check-in locked: ${checklistText(caseItem.checkInLocked)}`,
    "",
    "## Property / HOA",
    "",
    `- Listing: ${property.listingName || "-"}`,
    `- Unit: ${property.unit || "-"}`,
    `- Address: ${property.address || "-"}`,
    `- HOA / Association: ${property.hoaName || "-"}`,
    `- Management: ${property.management || "-"}`,
    `- HOA email: ${property.hoaEmail || "-"}`,
    `- Tenant Evaluation code: ${property.tenantEvaluationCode || "-"}`,
    `- Fee instruction: ${property.fee || "-"}`,
    "",
    "## Deadlines",
    "",
    `- Document packet sent: ${formatDate(caseItem.documentPacketSentAt)}`,
    `- Documents due: ${formatDate(caseItem.deadlineDocuments)}`,
    `- Cancellation review: ${formatDate(caseItem.cancellationReviewAt)}`,
    `- Airbnb support escalation: ${formatDate(caseItem.airbnbSupportAt)}`,
    `- Decision by: ${formatDate(caseItem.decisionBy)}`,
    "",
    "## Checklist",
    "",
    `- Airbnb initial message sent: ${checklistText(checklist.airbnbInitialMessage)}`,
    `- Guest acknowledged HOA process: ${checklistText(checklist.guestAcknowledged)}`,
    `- Document packet sent: ${checklistText(checklist.packetSent)}`,
    `- Lease Application received: ${checklistText(checklist.leaseApplication)}`,
    `- Secure Tenant Evaluation vendor handoff completed: ${checklistText(checklist.vendorHandoff)}`,
    `- Vendor completion/status confirmed: ${checklistText(checklist.vendorStatus)}`,
    `- Short-Term Lease tenant signed: ${checklistText(checklist.shortTermLeaseTenantSigned)}`,
    `- Short-Term Lease owner signed: ${checklistText(checklist.shortTermLeaseOwnerSigned)}`,
    `- Rules and Regulations sent: ${checklistText(checklist.rulesSent)}`,

    `- Fee tracked: ${checklistText(checklist.feeTracked)}`,
    `- Submitted to HOA: ${checklistText(checklist.submittedToHoa)}`,
    `- Board Approval received: ${checklistText(checklist.boardApproval)}`,
    "",
    "## Missing / blocking items",
    "",
    ...(missing.length ? missing.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Gmail / evidence summary",
    "",
    `- Last Gmail review: ${formatDate(gmail.lastCheckedAt || state.automation?.lastGmailReviewAt)}`,
    `- Gmail reply status: ${gmail.replyStatus || "unknown"}`,
    `- HOA status: ${gmail.hoaStatus || "unknown"}`,
    `- Gmail draft id: ${gmail.outboundDraftId || caseItem.reminderDraftId || "-"}`,
    `- Search terms: ${(gmail.searchTerms || []).join(" | ") || "-"}`,
    "",
    "## Communication channel evidence",
    "",
    ...(communicationEvidence.length
      ? communicationEvidence.map((entry) => `- [${String(entry.channel || "").toUpperCase()}] ${formatDate(entry.date)}${entry.contact ? ` / ${entry.contact}` : ""}: ${entry.summary}${entry.impact ? ` Impact: ${entry.impact}` : ""}`)
      : ["- No WhatsApp/iMessage/Airbnb communication evidence stored for this case"]),
    "",
    "## AI suggestions",
    "",
    ...(caseSuggestions.length
      ? caseSuggestions.map((suggestion) => {
          const evidence = Array.isArray(suggestion.evidence) && suggestion.evidence.length ? ` Evidence: ${suggestion.evidence.join(" | ")}` : "";
          return `- [${String(suggestion.status || "").toUpperCase()}] ${suggestion.title || suggestion.id} (${suggestion.source || "-"}, ${formatDate(suggestion.generatedAt)}): ${suggestion.detail || "-"}${evidence}`;
        })
      : ["- No AI suggestions stored for this case"]),
    "",
    "## Apartment maintenance / defects",
    "",
    ...(caseMaintenance.length
      ? caseMaintenance.map((item) => {
          const due = item.dueDate ? ` Due: ${formatDate(item.dueDate)}.` : "";
          const linked = item.caseId ? ` Linked case: ${item.caseId}.` : "";
          return `- [${String(item.status || "").toUpperCase()} / ${String(item.priority || "").toUpperCase()}] ${item.item || "-"} - ${item.title || "-"} (${item.room || "-"}). Reported: ${formatDate(item.reportedAt)}.${due}${linked} ${item.description || ""}`;
        })
      : ["- No apartment maintenance items stored"]),
    "",
    "## Turno cleaning",
    "",
    `- Provider: ${state.cleaning?.provider || "-"}`,
    `- Primary cleaner: ${state.cleaning?.primaryCleaner?.name || state.cleaning?.primaryCleaner?.displayName || "-"}`,
    `- Last cleaning email review: ${formatDate(state.cleaning?.lastEmailReviewAt)}`,
    ...(cleaningProjects.length
      ? cleaningProjects.slice(0, 5).map((project) => `- [${String(project.status || "").toUpperCase()}] Turno #${project.projectId || "-"} on ${formatDate(project.date)}: ${project.cleaner || "-"}, ${project.amount || project.rate || "-"}${project.problems !== undefined ? `, problems ${project.problems}` : ""}`)
      : ["- No Turno cleaning projects stored"]),
    "",
    "## Airbnb payments",
    "",
    ...(casePayments.length
      ? casePayments.map((payment) => {
          const expected = payment.expectedPayout ? `${payment.expectedPayout} ${payment.currency || ""}`.trim() : "not entered";
          const received = payment.receivedPayout ? `${payment.receivedPayout} ${payment.currency || ""}`.trim() : "not entered";
          const receivedAt = payment.receivedAt ? ` Received at: ${formatDate(payment.receivedAt)}.` : "";
          const transaction = payment.airbnbTransactionId ? ` Airbnb transaction: ${payment.airbnbTransactionId}.` : "";
          return `- [${String(payment.status || "").toUpperCase()}] ${payment.guestName || caseItem.guestName}: expected ${expected}, received ${received}.${receivedAt}${transaction} Notes: ${payment.notes || "-"}`;
        })
      : ["- No Airbnb payment entry stored for this tenant/case"]),
    "",
    "## Daily risk items",
    "",
    ...(caseDailyItems.length
      ? caseDailyItems.map((item) => `- [${String(item.level || "").toUpperCase()}] ${item.title}${item.due ? ` (${formatDate(item.due)})` : ""}: ${item.detail}`)
      : ["- No daily risk items for this case"]),
    "",
    "## Timeline",
    "",
    ...((caseItem.timeline || []).map((entry) => `- ${formatDate(entry.date)}: ${entry.text}`)),
    "",
    "## Airbnb calendar signal",
    "",
    calendarEvent
      ? `- Calendar event: ${calendarEvent.summary || "-"} from ${formatDate(calendarEvent.start)} to ${formatDate(calendarEvent.end)}; uid ${calendarEvent.uid || "-"}`
      : "- No matching calendar event found",
    "",
    "## Operational recommendation",
    "",
    caseItem.hermesRecommendation
      ? `- ${caseItem.hermesRecommendation}`
      : "- Do not release check-in details until HOA / Board Approval is documented. If documents remain missing after the document deadline, contact Airbnb Support with this dossier before any cancellation decision.",
    "",
    "## Guardrails",
    "",
    "- This dossier intentionally stores evidence pointers and status only.",
    "- Do not include raw IDs, passports, completed HOA forms, iCal URLs, OAuth tokens, or other secrets.",
    "- Do not send this dossier externally without reviewing it first.",
  ];

  return `${lines.join("\n")}\n`;
}

async function refreshCalendar() {
  return new Promise((resolve, reject) => {
    execFile("python3", ["tools/import_airbnb_ical.py", "--output", "data/airbnb-florida-calendar-snapshot.json"], { cwd: root }, (error, stdout, stderr) => {
      if (error) {
        error.message = [error.message, stderr].filter(Boolean).join("\n");
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function syncAppleCalendar() {
  return new Promise((resolve, reject) => {
    execFile("python3", ["tools/sync_apple_calendar.py", "--calendar-name", "Florida", "--sync-apple-calendar"], { cwd: root }, (error, stdout, stderr) => {
      if (error) {
        error.message = [error.message, stderr].filter(Boolean).join("\n");
        reject(error);
        return;
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

async function runDailyCheck() {
  return new Promise((resolve, reject) => {
    execFile("python3", ["tools/daily_watch.py", "--today", todayISO(), "--json"], { cwd: root }, (error, stdout, stderr) => {
      if (error) {
        error.message = [error.message, stderr].filter(Boolean).join("\n");
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        parseError.message = `Daily check JSON ungueltig: ${parseError.message}`;
        reject(parseError);
      }
    });
  });
}

async function runIntegrationStatus() {
  return new Promise((resolve, reject) => {
    execFile("python3", ["tools/integration_status.py", "--json"], { cwd: root, timeout: 35000 }, (error, stdout, stderr) => {
      if (error) {
        error.message = [error.message, stderr].filter(Boolean).join("\n");
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        parseError.message = `Integrationsstatus JSON ungueltig: ${parseError.message}`;
        reject(parseError);
      }
    });
  });
}

async function runGbrainSync() {
  return new Promise((resolve, reject) => {
    execFile("python3", ["tools/gbrain_sync.py", "--json"], { cwd: root, timeout: 300000 }, (error, stdout, stderr) => {
      if (error) {
        error.message = [error.message, stderr].filter(Boolean).join("\n");
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (parseError) {
        parseError.message = `GBrain-Sync JSON ungueltig: ${parseError.message}`;
        reject(parseError);
      }
    });
  });
}

async function pullHermesSync() {
  return new Promise((resolve, reject) => {
    const remoteCommand = `test -f ${JSON.stringify(hermesSyncPath)} && cat ${JSON.stringify(hermesSyncPath)}`;
    execFile("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", hermesHost, remoteCommand], { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        error.message = [error.message, stderr].filter(Boolean).join("\n");
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

async function api(req, res, url) {
  if (!requestAllowed(req, url.pathname)) {
    denyRemote(res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    const health = await buildHealth();
    // Remote callers get a minimal non-sensitive answer; loopback gets details.
    const payload = isLocalRequest(req)
      ? health
      : { ok: health.ok, status: health.status, app: health.app, generatedAt: health.generatedAt };
    json(res, health.ok ? 200 : 503, payload);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    const state = await readStateStrict();
    const [calendar, operationsManifest] = await Promise.all([
      readJson(calendarFile, { events: [] }),
      readJson(operationsManifestFile, { version: 1, domains: [], sharedCapabilities: [] }),
    ]);
    let dailyCheck = { items: [], summary: { red: 0, amber: 0, openCases: 0, reservedEvents: 0 } };
    try {
      dailyCheck = await runDailyCheck();
    } catch (error) {
      dailyCheck = { ok: false, error: error.message, items: [], summary: { red: 0, amber: 0, openCases: 0, reservedEvents: 0 } };
    }
    json(res, 200, { today: todayISO(), state, calendar, dailyCheck, displayInfo: displayInfo(), operationsManifest });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/operations-manifest") {
    const operationsManifest = await readJson(operationsManifestFile, { version: 1, domains: [], sharedCapabilities: [] });
    json(res, 200, { ok: true, operationsManifest });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/display-info") {
    json(res, 200, { ok: true, display: displayInfo(), requestIsLocal: isLocalRequest(req) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/display-state") {
    const state = await readStateStrict();
    const calendar = await readJson(calendarFile, { events: [] });
    let dailyCheck = { items: [], summary: { red: 0, amber: 0, openCases: 0, reservedEvents: 0 } };
    try {
      dailyCheck = await runDailyCheck();
    } catch (error) {
      dailyCheck = { ok: false, error: error.message, items: [], summary: { red: 0, amber: 0, openCases: 0, reservedEvents: 0 } };
    }
    json(res, 200, { ok: true, displayState: buildDisplayState(state, calendar, dailyCheck) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/voice-brief") {
    const state = await readStateStrict();
    const calendar = await readJson(calendarFile, { events: [] });
    let dailyCheck = { items: [], summary: { red: 0, amber: 0, openCases: 0, reservedEvents: 0 } };
    try {
      dailyCheck = await runDailyCheck();
    } catch (error) {
      dailyCheck = { ok: false, error: error.message, items: [], summary: { red: 0, amber: 0, openCases: 0, reservedEvents: 0 } };
    }
    json(res, 200, { ok: true, brief: buildVoiceBrief(state, calendar, dailyCheck) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/state") {
    try {
      const body = await readBody(req);
      const { backupFile, nextState } = await writeStateAtomic(body);
      json(res, 200, { ok: true, state: nextState, backupFile });
    } catch (error) {
      if (error.statusCode) {
        const detail = error.statusCode === 409 ? "Der Stand ist veraltet. Bitte neu laden und erneut speichern." : undefined;
        json(res, error.statusCode, { ok: false, error: error.message, ...(detail ? { detail } : {}) });
        return;
      }
      if (error instanceof StateReadError) {
        json(res, 503, { ok: false, error: "state_unreadable" });
        return;
      }
      json(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/refresh-calendar") {
    try {
      await refreshCalendar();
      const calendar = await readJson(calendarFile, { events: [] });
      json(res, 200, { ok: true, calendar });
    } catch (error) {
      json(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/sync-apple-calendar") {
    try {
      const result = await syncAppleCalendar();
      json(res, 200, { ok: true, result });
    } catch (error) {
      json(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/daily-check") {
    try {
      const report = await runDailyCheck();
      json(res, 200, { ok: true, report });
    } catch (error) {
      json(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/integration-status") {
    try {
      const report = await runIntegrationStatus();
      json(res, 200, { ok: true, report });
    } catch (error) {
      json(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/gbrain-sync") {
    try {
      const report = await runGbrainSync();
      json(res, 200, { ok: true, report });
    } catch (error) {
      json(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/hermes-sync") {
    try {
      const raw = await pullHermesSync();
      const report = JSON.parse(raw);
      json(res, 200, { ok: true, report });
    } catch (error) {
      json(res, 404, { ok: false, error: error.message });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cancellation-dossier") {
    try {
      const caseId = url.searchParams.get("caseId");
      if (!caseId) throw new Error("caseId fehlt");
      const state = await readStateStrict();
      const calendar = await readJson(calendarFile, { events: [] });
      let dailyCheck = { items: [], summary: { red: 0, amber: 0, openCases: 0, reservedEvents: 0 } };
      try {
        dailyCheck = await runDailyCheck();
      } catch {
        // Dossier should still be usable if the daily check fails.
      }
      const dossier = buildCancellationDossier(state, calendar, dailyCheck, caseId);
      res.writeHead(200, {
        "content-type": "text/markdown; charset=utf-8",
        "content-disposition": `attachment; filename="${caseId}-airbnb-hoa-dossier.md"`,
      });
      res.end(dossier);
    } catch (error) {
      json(res, 400, { ok: false, error: error.message });
    }
    return;
  }

  notFound(res);
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname === "/display" ? "/display.html" : decodeURIComponent(url.pathname);
  const filePath = normalize(join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) {
    notFound(res);
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": mimeTypes[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    notFound(res);
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await api(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    if (error instanceof StateReadError) {
      json(res, 503, { ok: false, error: "state_unreadable" });
      return;
    }
    json(res, 500, { error: error.message });
  }
}).listen(port, host, () => {
  const shownHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  console.log(`Airbnb HOA Operations running at http://${shownHost}:${port}`);
  if (host === "0.0.0.0" || host === "::") {
    console.log(`Display mode for trusted LAN devices: ${displayInfo().lanDisplayUrls.join(", ") || "no LAN address found"}`);
  }
});
