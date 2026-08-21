#!/usr/bin/env python3
"""Daily Airbnb/HOA risk check.

This is intentionally read-only. It checks the local state file plus the
token-free Airbnb calendar snapshot and reports cases that need attention.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STATE = ROOT / "data" / "airbnb-hoa-state.json"
DEFAULT_CALENDAR = ROOT / "data" / "airbnb-florida-calendar-snapshot.json"

REQUIRED_DOCUMENT_KEYS = [
    "leaseApplication",
    "vendorHandoff",
    "vendorStatus",
    "shortTermLeaseTenantSigned",
    "shortTermLeaseOwnerSigned",
]


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value[:10])


def today_panama() -> date:
    if os.environ.get("APP_TODAY"):
        return parse_date(os.environ["APP_TODAY"]) or date.today()
    return datetime.now(ZoneInfo("America/Panama")).date()


def load_json(path: Path, fallback: dict) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback


def matching_case(event: dict, cases: list[dict]) -> dict | None:
    for case in cases:
        if case.get("calendarUid") and case.get("calendarUid") == event.get("uid"):
            return case
        if case.get("start") == event.get("start") and case.get("end") == event.get("end"):
            return case
    return None


def missing_documents(case: dict) -> list[str]:
    checklist = case.get("checklist") or {}
    return [key for key in REQUIRED_DOCUMENT_KEYS if not checklist.get(key)]


def cleaning_project_date(project: dict) -> date | None:
    return parse_date(project.get("date") or project.get("scheduledStart"))


def cleaning_project_for_checkout(checkout: date | None, cleaning_projects: list[dict]) -> dict | None:
    if not checkout:
        return None
    for project in cleaning_projects:
        if project.get("status") == "cancelled":
            continue
        project_day = cleaning_project_date(project)
        if not project_day:
            continue
        days_after_checkout = (project_day - checkout).days
        if 0 <= days_after_checkout <= 2:
            return project
    return None


def payments_for_case(case: dict, payment_items: list[dict]) -> list[dict]:
    case_id = case.get("id")
    reservation_code = case.get("reservationCode")
    return [
        payment
        for payment in payment_items
        if payment.get("caseId") == case_id or (reservation_code and payment.get("reservationCode") == reservation_code)
    ]


def case_in_payment_window(case: dict, today: date) -> bool:
    start = parse_date(case.get("start"))
    end = parse_date(case.get("end"))
    if start and (start - today).days > 90:
        return False
    if end and (today - end).days > 60:
        return False
    return True


def procurement_label(value: str | None) -> str:
    labels = {
        "weekdays_after_16:00": "werktags ab 16:00 Uhr",
        "under_counter_beneath_kitchen_countertop": "Unterbau unter Kuechenplatte",
        "needs_vendor_quote": "Angebot/Haendler pruefen",
        "replacement_appliance": "Ersatzgeraet",
        "dishwasher": "Geschirrspueler",
    }
    return labels.get(value or "", value or "")


def add_item(
    items: list[dict],
    level: str,
    case: dict | None,
    title: str,
    detail: str,
    due: str | None = None,
    kind: str = "case",
    maintenance_id: str | None = None,
    telephony_call_id: str | None = None,
) -> None:
    item = {
        "level": level,
        "kind": kind,
        "caseId": case.get("id") if case else None,
        "guestName": case.get("guestName") if case else None,
        "maintenanceId": maintenance_id,
        "title": title,
        "detail": detail,
        "due": due,
    }
    if telephony_call_id:
        item["telephonyCallId"] = telephony_call_id
    items.append(item)


def analyze(state: dict, calendar: dict, today: date) -> dict:
    cases = state.get("cases") or []
    maintenance_items = state.get("maintenanceItems") or []
    cleaning = state.get("cleaning") or {}
    cleaning_projects = cleaning.get("projects") or []
    payment_items = (state.get("payments") or {}).get("items") or []
    telephony_calls = (state.get("telephony") or {}).get("callLog") or []
    items: list[dict] = []

    for event in calendar.get("events") or []:
        if event.get("summary") != "Reserved":
            continue
        if not matching_case(event, cases):
            start = parse_date(event.get("start"))
            days_until = (start - today).days if start else None
            add_item(
                items,
                "red",
                None,
                "Airbnb-Reservierung ohne Fallakte",
                f"{event.get('start')} bis {event.get('end')} hat noch keine HOA-Akte.",
                event.get("start"),
            )
            if days_until is not None and days_until <= 21:
                add_item(
                    items,
                    "red",
                    None,
                    "Reservierung ohne Vorlauf",
                    f"Nur noch {days_until} Tage bis Check-in; Unterlagen sofort anstossen.",
                    event.get("start"),
                )

    for case in cases:
        checklist = case.get("checklist") or {}
        start = parse_date(case.get("start"))
        days_until_start = (start - today).days if start else None
        missing = missing_documents(case)
        approved = bool(checklist.get("boardApproval"))
        submitted = bool(checklist.get("submittedToHoa"))
        status = case.get("status")

        end = parse_date(case.get("end"))
        if end and end >= today and status not in {"cancelled", "cancellation_review"}:
            days_until_checkout = (end - today).days
            if days_until_checkout <= 45 and not cleaning_project_for_checkout(end, cleaning_projects):
                add_item(
                    items,
                    "amber",
                    case,
                    "Turno-Reinigung nach Aufenthalt nicht belegt",
                    f"Check-out am {case.get('end')}; in Gmail wurde kein Turno-Projekt innerhalb von 2 Tagen danach gefunden.",
                    case.get("end"),
                    "cleaning",
                )

        if case_in_payment_window(case, today):
            case_payments = payments_for_case(case, payment_items)
            if not case_payments:
                add_item(
                    items,
                    "amber",
                    case,
                    "Airbnb-Zahlung keinem Mieter zugeordnet",
                    "Fuer diese Buchung gibt es noch keinen Zahlungseintrag in der App.",
                    case.get("start"),
                    "payment",
                )
            for payment in case_payments:
                payment_status = payment.get("status")
                if payment_status == "needs_airbnb_review":
                    add_item(
                        items,
                        "amber",
                        case,
                        "Airbnb-Zahlung fuer Mieter pruefen",
                        "Der Zahlungseintrag ist dem Mieter zugeordnet, aber Betrag/Auszahlungsstatus muessen noch aus Airbnb geprueft werden.",
                        payment.get("expectedPayoutDate") or case.get("start"),
                        "payment",
                    )
                elif payment_status in {"partial", "disputed"}:
                    add_item(
                        items,
                        "red",
                        case,
                        "Airbnb-Zahlung problematisch",
                        f"Zahlungsstatus: {payment_status}. Erwartet: {payment.get('expectedPayout') or '-'}; erhalten: {payment.get('receivedPayout') or '-'}.",
                        payment.get("expectedPayoutDate") or case.get("start"),
                        "payment",
                    )
                elif payment_status == "expected":
                    expected_date = parse_date(payment.get("expectedPayoutDate"))
                    if expected_date and expected_date < today and not payment.get("receivedPayout"):
                        add_item(
                            items,
                            "amber",
                            case,
                            "Airbnb-Auszahlung ueberfaellig",
                            "Auszahlung war erwartet, aber kein Zahlungseingang ist eingetragen.",
                            payment.get("expectedPayoutDate"),
                            "payment",
                        )

        if approved:
            continue

        if case.get("checkInLocked") is not True:
            add_item(
                items,
                "red",
                case,
                "Check-in ist nicht gesperrt",
                "Kein Board Approval, aber checkInLocked ist nicht aktiv.",
                case.get("start"),
            )

        if days_until_start is not None:
            if days_until_start < 0:
                add_item(items, "red", case, "Aufenthalt ohne Board Approval gestartet", "Sofort pruefen.", case.get("start"))
            elif days_until_start <= 14:
                add_item(
                    items,
                    "red",
                    case,
                    "Check-in sehr nah ohne Board Approval",
                    f"Nur noch {days_until_start} Tage bis Check-in.",
                    case.get("start"),
                )
            elif days_until_start <= 30:
                add_item(
                    items,
                    "amber",
                    case,
                    "Check-in naehert sich ohne Board Approval",
                    f"Noch {days_until_start} Tage bis Check-in.",
                    case.get("start"),
                )

        deadline = parse_date(case.get("deadlineDocuments"))
        if missing and deadline:
            days_to_deadline = (deadline - today).days
            if days_to_deadline < 0:
                add_item(
                    items,
                    "red",
                    case,
                    "Dokumentenfrist verpasst",
                    f"Fehlend: {', '.join(missing)}.",
                    case.get("deadlineDocuments"),
                )
            elif days_to_deadline <= 1:
                add_item(
                    items,
                    "amber",
                    case,
                    "Dokumentenfrist faellig",
                    f"Fehlend: {', '.join(missing)}.",
                    case.get("deadlineDocuments"),
                )

        cancellation_review = parse_date(case.get("cancellationReviewAt"))
        if cancellation_review and today >= cancellation_review and not submitted:
            add_item(
                items,
                "red",
                case,
                "Cancellation Review faellig",
                "HOA-Paket ist noch nicht eingereicht.",
                case.get("cancellationReviewAt"),
            )

        airbnb_support = parse_date(case.get("airbnbSupportAt"))
        if airbnb_support and today >= airbnb_support and not submitted:
            add_item(
                items,
                "red",
                case,
                "Airbnb Support faellig",
                "Airbnb sollte wegen HOA-Anforderungen kontaktiert werden.",
                case.get("airbnbSupportAt"),
            )

        decision_by = parse_date(case.get("decisionBy"))
        if decision_by and today >= decision_by and not submitted:
            add_item(
                items,
                "red",
                case,
                "Storno-/Support-Entscheidung faellig",
                "Ohne Unterlagen sollte die Buchung nicht einfach weiterlaufen.",
                case.get("decisionBy"),
            )

        if status == "reminder_due":
            add_item(
                items,
                "amber",
                case,
                "Reminder faellig",
                "Gmail-/Airbnb-Erinnerung pruefen und senden lassen.",
                case.get("deadlineDocuments"),
            )

    for maintenance in maintenance_items:
        if maintenance.get("status") in {"done", "cancelled"}:
            continue
        due = parse_date(maintenance.get("dueDate"))
        priority = maintenance.get("priority") or "medium"
        title = maintenance.get("title") or maintenance.get("item") or "Mangel offen"
        item_name = maintenance.get("item") or "Gegenstand"
        room = maintenance.get("room") or "Wohnung"
        procurement = maintenance.get("procurement") or {}
        procurement_bits = []
        existing_appliance = procurement.get("existingAppliance") or {}
        if existing_appliance.get("model"):
            brand_model = " ".join(
                part
                for part in [existing_appliance.get("brand"), existing_appliance.get("model")]
                if part
            )
            procurement_bits.append(f"Bestandsgeraet: {brand_model}")
        if procurement.get("deliveryWindow"):
            procurement_bits.append(f"Lieferfenster: {procurement_label(procurement.get('deliveryWindow'))}")
        shortlist = procurement.get("vendorShortlist") or []
        recommended = next(
            (option for option in shortlist if option.get("id") == procurement.get("recommendedOptionId")),
            shortlist[0] if shortlist else None,
        )
        if recommended:
            recommendation = " ".join(
                part
                for part in [
                    recommended.get("retailer"),
                    recommended.get("model"),
                    f"({recommended.get('estimatedTotalPretax')})" if recommended.get("estimatedTotalPretax") else "",
                ]
                if part
            )
            procurement_bits.append(f"Empfehlung: {recommendation}")
        service_providers = procurement.get("serviceProviderShortlist") or []
        primary_service_provider = next(
            (provider for provider in service_providers if provider.get("rank") == 1),
            service_providers[0] if service_providers else None,
        )
        if primary_service_provider:
            provider_line = " ".join(
                part
                for part in [
                    primary_service_provider.get("provider"),
                    f"({primary_service_provider.get('phone')})" if primary_service_provider.get("phone") else "",
                ]
                if part
            )
            procurement_bits.append(f"Service zuerst: {provider_line}")
        if procurement.get("installationRequired"):
            procurement_bits.append("Einbau/Anschluss erforderlich")
        if procurement.get("haulAwayOldAppliance") or procurement.get("disposalRequired"):
            procurement_bits.append("Altgeraet entsorgen lassen")
        service_verification = procurement.get("homeDepotServiceVerification") or {}
        if service_verification.get("status"):
            procurement_bits.append("Home Depot bleibt Fallback; Checkout/ZIP/Terminbedingungen noch nicht final bestaetigt")
        hoa_compliance = maintenance.get("hoaCompliance") or {}
        if hoa_compliance.get("status") == "needs_management_confirmation":
            procurement_bits.append("HOA-/Management-Bestaetigung fuer Lieferung/Handwerker offen")
        procurement_text = f" {'; '.join(procurement_bits)}." if procurement_bits else ""
        detail = f"{room}: {item_name}. {maintenance.get('description') or 'Status pruefen.'}{procurement_text}"

        if due and due < today:
            add_item(items, "red", None, f"Mangel ueberfaellig: {title}", detail, maintenance.get("dueDate"), "maintenance", maintenance.get("id"))
        elif priority == "high":
            add_item(items, "amber", None, f"Dringender Mangel: {title}", detail, maintenance.get("dueDate"), "maintenance", maintenance.get("id"))
        elif due and (due - today).days <= 7:
            add_item(items, "amber", None, f"Mangel-Frist naht: {title}", detail, maintenance.get("dueDate"), "maintenance", maintenance.get("id"))

    for call in telephony_calls:
        status = call.get("status") or "planned"
        if status not in {"planned", "failed", "left_message"}:
            continue
        contact = call.get("contact") or call.get("phone") or "Telefonie"
        detail = " ".join(
            part
            for part in [
                call.get("topic"),
                call.get("nextAction"),
                call.get("notes"),
            ]
            if part
        ) or "Anruf vorbereiten und Ergebnis danach eintragen."
        add_item(
            items,
            "red" if status == "failed" else "amber",
            None,
            f"Anruf vorbereiten: {contact}",
            detail,
            call.get("date") or today.isoformat(),
            "telephony",
            telephony_call_id=call.get("id"),
        )

    severity_order = {"red": 0, "amber": 1, "blue": 2}
    items.sort(key=lambda item: (severity_order.get(item["level"], 9), item.get("due") or "9999-12-31", item.get("guestName") or ""))
    return {
        "generatedAt": datetime.now(ZoneInfo("America/Panama")).isoformat(timespec="seconds"),
        "today": today.isoformat(),
        "summary": {
            "red": sum(1 for item in items if item["level"] == "red"),
            "amber": sum(1 for item in items if item["level"] == "amber"),
            "openCases": sum(1 for case in cases if case.get("status") != "approved"),
            "reservedEvents": sum(1 for event in calendar.get("events") or [] if event.get("summary") == "Reserved"),
            "maintenanceOpen": sum(1 for item in maintenance_items if item.get("status") not in {"done", "cancelled"}),
            "cleaningProjects": len(cleaning_projects),
            "cleaningOpen": sum(1 for item in items if item.get("kind") == "cleaning"),
            "paymentsOpen": sum(1 for item in items if item.get("kind") == "payment"),
            "telephonyOpen": sum(1 for item in items if item.get("kind") == "telephony"),
        },
        "items": items,
    }


def print_human(report: dict) -> None:
    summary = report["summary"]
    print(f"Airbnb HOA Daily Check ({report['today']})")
    print(
        f"Rot: {summary['red']} | Gelb: {summary['amber']} | Offene Faelle: {summary['openCases']} | "
        f"Offene Maengel: {summary.get('maintenanceOpen', 0)} | Zahlungen pruefen: {summary.get('paymentsOpen', 0)} | "
        f"Telefonie: {summary.get('telephonyOpen', 0)}"
    )
    if not report["items"]:
        print("Keine offenen Risiken gefunden.")
        return
    for item in report["items"]:
        guest = f" - {item['guestName']}" if item.get("guestName") else ""
        due = f" ({item['due']})" if item.get("due") else ""
        print(f"[{item['level'].upper()}]{guest}: {item['title']}{due}")
        print(f"  {item['detail']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only daily Airbnb/HOA risk check")
    parser.add_argument("--state", type=Path, default=DEFAULT_STATE)
    parser.add_argument("--calendar", type=Path, default=DEFAULT_CALENDAR)
    parser.add_argument("--today", default=None)
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    args = parser.parse_args()

    state = load_json(args.state, {"cases": []})
    calendar = load_json(args.calendar, {"events": []})
    current_day = parse_date(args.today) if args.today else today_panama()
    report = analyze(state, calendar, current_day or today_panama())

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print_human(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
