#!/usr/bin/env python3
"""Build a compact read-only operations context for Hermes.

This script intentionally contains no secrets and does not send messages. It
combines app state, the token-free Airbnb calendar snapshot, the daily check,
deadline calendar events, payments, cleaning, and maintenance into one JSON
payload Hermes can read before doing Gmail work.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
STATE_FILE = ROOT / "data" / "airbnb-hoa-state.json"
CALENDAR_FILE = ROOT / "data" / "airbnb-florida-calendar-snapshot.json"
OPERATIONS_MANIFEST_FILE = ROOT / "data" / "markus-operations-manifest.json"
DEFAULT_OUTPUT = ROOT / "hermes-sync" / "context.json"

sys.path.insert(0, str(ROOT / "tools"))
import daily_watch  # noqa: E402
import integration_status  # noqa: E402
import sync_apple_calendar  # noqa: E402


REQUIRED_DOCUMENT_KEYS = {
    "leaseApplication": "Lease Application",
    "vendorHandoff": "Sicherer Vendor-Handoff",
    "vendorStatus": "Vendor-Bestaetigung",
    "shortTermLeaseTenantSigned": "Short-Term Lease Tenant-Signatur",
    "shortTermLeaseOwnerSigned": "Short-Term Lease Owner-Signatur",
}


def load_json(path: Path, fallback: dict) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback


def today_panama() -> date:
    return datetime.now(ZoneInfo("America/Panama")).date()


def parse_day(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value[:10])


def run_calendar_refresh() -> dict:
    result = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "import_airbnb_ical.py"), "--output", str(CALENDAR_FILE)],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    return {
        "attempted": True,
        "ok": result.returncode == 0,
        "stdout": result.stdout.strip(),
        "stderr": result.stderr.strip(),
    }


def matching_case(event: dict, cases: list[dict]) -> dict | None:
    for case in cases:
        if case.get("calendarUid") and case.get("calendarUid") == event.get("uid"):
            return case
        if case.get("start") == event.get("start") and case.get("end") == event.get("end"):
            return case
    return None


def missing_required_docs(case: dict) -> list[str]:
    checklist = case.get("checklist") or {}
    return [label for key, label in REQUIRED_DOCUMENT_KEYS.items() if not checklist.get(key)]


def payment_for_case(case: dict, payments: list[dict]) -> dict | None:
    reservation_code = case.get("reservationCode")
    for payment in payments:
        if payment.get("caseId") == case.get("id"):
            return payment
        if reservation_code and payment.get("reservationCode") == reservation_code:
            return payment
    return None


def cleaning_for_checkout(case: dict, cleaning_projects: list[dict]) -> dict | None:
    checkout = parse_day(case.get("end"))
    if not checkout:
        return None
    return daily_watch.cleaning_project_for_checkout(checkout, cleaning_projects)


def maintenance_for_case(case: dict, maintenance_items: list[dict]) -> list[dict]:
    case_id = case.get("id")
    return [
        {
            "id": item.get("id"),
            "item": item.get("item"),
            "room": item.get("room"),
            "title": item.get("title"),
            "priority": item.get("priority"),
            "status": item.get("status"),
            "dueDate": item.get("dueDate"),
            "description": item.get("description"),
            "procurement": item.get("procurement") or {},
            "hoaCompliance": item.get("hoaCompliance") or {},
            "nextActions": item.get("nextActions") or [],
        }
        for item in maintenance_items
        if item.get("status") not in {"done", "cancelled"} and item.get("caseId") == case_id
    ]


def telephony_context(state: dict) -> dict:
    telephony = state.get("telephony") or {}
    calls = telephony.get("callLog") or []
    open_statuses = {"planned", "failed", "left_message"}
    return {
        "provider": telephony.get("provider"),
        "primaryUse": telephony.get("primaryUse"),
        "webCallsUrl": telephony.get("webCallsUrl"),
        "guardrail": telephony.get("guardrail"),
        "wifiCallingRule": telephony.get("wifiCallingRule"),
        "contacts": [
            {
                "id": contact.get("id"),
                "label": contact.get("label"),
                "phone": contact.get("phone"),
                "context": contact.get("context"),
            }
            for contact in telephony.get("contacts") or []
        ],
        "openCalls": [
            {
                "id": call.get("id"),
                "date": call.get("date"),
                "contact": call.get("contact"),
                "phone": call.get("phone"),
                "project": call.get("project"),
                "topic": call.get("topic"),
                "status": call.get("status"),
                "nextAction": call.get("nextAction"),
                "caseId": call.get("caseId"),
            }
            for call in calls
            if (call.get("status") or "planned") in open_statuses
        ],
        "policy": "Hermes may prepare call notes and summarize outcomes, but must not place calls automatically.",
    }


def case_context(case: dict, payments: list[dict], cleaning_projects: list[dict], maintenance_items: list[dict]) -> dict:
    payment = payment_for_case(case, payments)
    cleaning = cleaning_for_checkout(case, cleaning_projects)
    return {
        "id": case.get("id"),
        "guestName": case.get("guestName"),
        "reservationCode": case.get("reservationCode"),
        "email": case.get("email"),
        "start": case.get("start"),
        "end": case.get("end"),
        "status": case.get("status"),
        "checkInLocked": case.get("checkInLocked"),
        "boardApproval": bool((case.get("checklist") or {}).get("boardApproval")),
        "deadlines": {
            "documents": case.get("deadlineDocuments"),
            "cancellationReview": case.get("cancellationReviewAt"),
            "airbnbSupport": case.get("airbnbSupportAt"),
            "decisionBy": case.get("decisionBy"),
        },
        "gmail": case.get("gmail") or {},
        "missingRequiredDocs": missing_required_docs(case),
        "payment": {
            "id": payment.get("id"),
            "status": payment.get("status"),
            "expectedPayout": payment.get("expectedPayout"),
            "expectedPayoutDate": payment.get("expectedPayoutDate"),
            "receivedPayout": payment.get("receivedPayout"),
            "receivedAt": payment.get("receivedAt"),
            "lastCheckedAt": payment.get("lastCheckedAt"),
            "reservationCode": payment.get("reservationCode"),
        }
        if payment
        else None,
        "cleaningAfterCheckout": {
            "projectId": cleaning.get("projectId"),
            "date": cleaning.get("date"),
            "status": cleaning.get("status"),
            "cleaner": cleaning.get("cleaner"),
            "amount": cleaning.get("amount") or cleaning.get("rate"),
        }
        if cleaning
        else None,
        "openMaintenance": maintenance_for_case(case, maintenance_items),
        "recommendation": case.get("hermesRecommendation"),
    }


def calendar_context(calendar: dict, cases: list[dict]) -> dict:
    events = calendar.get("events") or []
    reserved = [event for event in events if event.get("summary") == "Reserved"]
    reservations = []
    missing = []
    for event in reserved:
        case = matching_case(event, cases)
        item = {
            "start": event.get("start"),
            "end": event.get("end"),
            "summary": event.get("summary"),
            "uid": event.get("uid"),
            "caseId": case.get("id") if case else None,
            "guestName": case.get("guestName") if case else None,
            "status": case.get("status") if case else "case_missing",
        }
        reservations.append(item)
        if not case:
            missing.append(item)
    return {
        "source": calendar.get("source"),
        "snapshotGeneratedAt": calendar.get("generated_at"),
        "eventsCount": len(events),
        "reservedEvents": len(reserved),
        "reservations": reservations,
        "missingCaseEvents": missing,
    }


def deadline_calendar_context(state: dict) -> list[dict]:
    events = sync_apple_calendar.build_events(state)
    return [
        {
            "caseId": event.case_id,
            "kind": event.kind,
            "title": event.title,
            "day": event.day.isoformat(),
            "startLocal": event.start_local.isoformat(),
            "alarmsMinutesBefore": [abs(value) for value in event.alarms],
        }
        for event in events
    ]


def build_context(refresh_calendar: bool, today_value: date) -> dict:
    refresh = run_calendar_refresh() if refresh_calendar else {"attempted": False, "ok": None, "stdout": "", "stderr": ""}
    state = load_json(STATE_FILE, {"cases": []})
    calendar = load_json(CALENDAR_FILE, {"events": []})
    operations_manifest = load_json(OPERATIONS_MANIFEST_FILE, {"version": 1, "domains": []})
    cases = state.get("cases") or []
    maintenance_items = state.get("maintenanceItems") or []
    cleaning = state.get("cleaning") or {}
    cleaning_projects = cleaning.get("projects") or []
    payments = (state.get("payments") or {}).get("items") or []
    daily = daily_watch.analyze(state, calendar, today_value)

    return {
        "version": 1,
        "source": "hermes-airbnb-hoa-context",
        "generatedAt": datetime.now(ZoneInfo("America/Panama")).isoformat(timespec="seconds"),
        "today": today_value.isoformat(),
        "workspace": str(ROOT),
        "operationsTree": {
            "architecture": "ops/markus-operations-architecture.md",
            "manifest": "data/markus-operations-manifest.json",
            "runtimePolicy": operations_manifest.get("runtimePolicy") or {},
            "domains": [
                {
                    "id": domain.get("id"),
                    "label": domain.get("label"),
                    "status": domain.get("status"),
                    "sourceOfTruth": domain.get("sourceOfTruth"),
                    "plannedOnly": domain.get("plannedOnly", False),
                    "deployment": domain.get("deployment") or domain.get("deploymentPlan") or {},
                }
                for domain in operations_manifest.get("domains", [])
            ],
            "rule": "Use private Proxmox VM as the default runtime target for new software. Use the active domain context for Airbnb HOA. Planned domains are structural placeholders only until Owner explicitly starts them.",
        },
        "calendarRefresh": refresh,
        "calendar": calendar_context(calendar, cases),
        "deadlineCalendar": {
            "targetCalendar": "Florida",
            "appleCalendarSyncAvailable": sys.platform == "darwin",
            "events": deadline_calendar_context(state),
        },
        "dailyCheck": daily,
        "integrationStatus": integration_status.build_report(),
        "display": {
            "editingDashboard": "http://127.0.0.1:4327/",
            "readOnlyDisplay": "http://127.0.0.1:4327/display",
            "displayStateApi": "GET /api/display-state",
            "displayInfoApi": "GET /api/display-info",
            "voiceBriefApi": "GET /api/voice-brief",
            "designSource": "DESIGN.md",
            "designRule": "Keep the UI as a calm premium operations cockpit: first show today's action, risk, affected guest, deadline, and check-in lock state; avoid generic SaaS decoration.",
            "localOpenCommand": "npm run open:display",
            "lanOpenCommand": "npm run open:display:lan",
            "formats": ["HTML/PWA display", "JSON display-state", "iCalendar deadlines", "voice/TTS summary"],
            "routingLayers": ["Home Assistant", "Browser Mod", "WallPanel", "Anthias/Screenly OSE", "MagicMirror2", "catt/PyChromecast"],
            "securityPolicy": "Do not expose the app publicly; use LAN only when explicitly enabled, and use VPN/Tailscale/private relay for remote access.",
            "iosPolicy": "iPhone/iPad cannot be forced to open arbitrary pages unless a PWA, Shortcut, Home Assistant Companion automation, or controlled browser is configured.",
        },
        "cases": [case_context(case, payments, cleaning_projects, maintenance_items) for case in cases],
        "payments": {
            "source": (state.get("payments") or {}).get("source"),
            "lastAirbnbReviewAt": (state.get("payments") or {}).get("lastAirbnbReviewAt"),
            "items": len(payments),
            "needsReview": [payment for payment in payments if payment.get("status") in {"needs_airbnb_review", "partial", "disputed"}],
        },
        "cleaning": {
            "provider": cleaning.get("provider"),
            "primaryCleaner": cleaning.get("primaryCleaner"),
            "projects": len(cleaning_projects),
            "lastEmailReviewAt": cleaning.get("lastEmailReviewAt"),
        },
        "maintenance": {
            "open": [item for item in maintenance_items if item.get("status") not in {"done", "cancelled"}],
        },
        "telephony": telephony_context(state),
        "communication": {
            "whatsapp": {
                "owner": "Hermes Gateway on hermes-gbrain-ai",
                "expectedTools": ["whatsapp_recent", "whatsapp_contact", "send_message(action='list')"],
                "statusCommand": "npm run integration:status",
                "rule": "Use WhatsApp tools when the bridge is active and paired; report downtime or whatsapp_not_paired instead of guessing.",
                "sendPolicy": "No WhatsApp send without Owner approving exact recipient and exact text.",
            },
            "imessage": {
                "owner": "Mac mini in same house",
                "host": "192.0.2.11",
                "user": "demo-user",
                "bridgePath": "~/hermes-bridges/apple-messages/macmini_imessage_bridge.py",
                "healthCommand": "ssh demo-user@192.0.2.11 'python3 ~/hermes-bridges/apple-messages/macmini_imessage_bridge.py --redact health'",
                "searchCommandTemplate": "ssh demo-user@192.0.2.11 'python3 ~/hermes-bridges/apple-messages/macmini_imessage_bridge.py search \"SEARCH_TERM\" --limit 20 --since-days 365'",
                "sendDefault": "disabled",
                "sendPolicy": "No iMessage send unless HERMES_IMESSAGE_ALLOW_SEND=1 is deliberately set for an approved exact message and --approval-token SEND-IMESSAGE is supplied.",
            },
            "evidencePolicy": "Store compact pointers only: date, channel, contact/sender, and case impact. Do not copy long private chat transcripts into state, GBrain, or sync JSON.",
        },
        "guardrails": [
            "Do not send Gmail, Airbnb, WhatsApp, or HOA messages without Owner approval.",
            "Do not set Board Approval or unlock check-in from Hermes context.",
            "Do not store iCal URLs, tokens, passports, completed forms, or raw attachments.",
            "Use calendar reservations to create/flag missing case files before Gmail work.",
            "Use WhatsApp and Mac mini iMessage as evidence channels, not automatic outbound channels.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build read-only Airbnb HOA context for Hermes")
    parser.add_argument("--today", default=None, help="Override current date as YYYY-MM-DD")
    parser.add_argument("--refresh-calendar", action="store_true", help="Refresh token-free Airbnb calendar snapshot first")
    parser.add_argument("--output", type=Path, default=None, help="Write JSON to this path instead of stdout")
    parser.add_argument("--default-output", action="store_true", help=f"Write JSON to {DEFAULT_OUTPUT}")
    args = parser.parse_args()

    today_value = parse_day(args.today) if args.today else today_panama()
    if not today_value:
        raise SystemExit("Invalid --today")

    payload = build_context(args.refresh_calendar, today_value)
    rendered = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    output_path = DEFAULT_OUTPUT if args.default_output else args.output
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(rendered, encoding="utf-8")
        print(str(output_path))
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
