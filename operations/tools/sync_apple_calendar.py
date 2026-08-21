#!/usr/bin/env python3
"""Export/sync Airbnb HOA deadlines to calendar.

The script is intentionally deterministic: it writes an .ics file and, when
requested, replaces generated `[Airbnb HOA]` events in a chosen Apple Calendar.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STATE_FILE = ROOT / "data" / "airbnb-hoa-state.json"
ICS_FILE = ROOT / "data" / "airbnb-hoa-deadlines.ics"
PANAMA = timezone(timedelta(hours=-5))


CHECKLIST_LABELS = {
    "leaseApplication": "Lease Application",
    "backgroundAuthorization": "Background Authorization",
    "shortTermLeaseTenantSigned": "Short-Term Lease Tenant-Signatur",
    "shortTermLeaseOwnerSigned": "Short-Term Lease Owner-Signatur",
    "photoIds": "Photo IDs / supporting documents",
    "feeTracked": "USD 100 Fee / Check",
    "submittedToHoa": "Einreichung bei HOA",
    "boardApproval": "Board Approval",
}


@dataclass(frozen=True)
class CalendarEvent:
    case_id: str
    kind: str
    title: str
    day: date
    hour: int
    minute: int
    duration_minutes: int
    description: str
    alarms: tuple[int, ...]

    @property
    def uid(self) -> str:
        return f"airbnb-hoa-{self.case_id}-{self.kind}@markus-local"

    @property
    def start_local(self) -> datetime:
        return datetime.combine(self.day, time(self.hour, self.minute), tzinfo=PANAMA)

    @property
    def end_local(self) -> datetime:
        return self.start_local + timedelta(minutes=self.duration_minutes)


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value[:10])


def load_state() -> dict:
    return json.loads(STATE_FILE.read_text(encoding="utf-8"))


def missing_items(case: dict) -> list[str]:
    checklist = case.get("checklist") or {}
    return [label for key, label in CHECKLIST_LABELS.items() if not checklist.get(key)]


def event_description(case: dict, action: str) -> str:
    missing = missing_items(case)
    lines = [
        action,
        "",
        f"Guest: {case.get('guestName', '-')}",
        f"Reservation: {case.get('reservationCode') or 'unknown'}",
        f"Stay: {case.get('start', '-')} to {case.get('end', '-')}",
        f"Email: {case.get('email') or 'unknown'}",
        f"Status: {case.get('status', '-')}",
        f"Check-in locked: {case.get('checkInLocked')}",
        "",
        "Missing / blocking:",
        *(f"- {item}" for item in (missing or ["none"])),
        "",
        "Open the local app: http://127.0.0.1:4327/",
        "Do not release check-in details until Board Approval is documented.",
    ]
    return "\n".join(lines)


def build_events(state: dict) -> list[CalendarEvent]:
    events: list[CalendarEvent] = []
    for case in state.get("cases") or []:
        checklist = case.get("checklist") or {}
        approved = case.get("status") == "approved" or bool(checklist.get("boardApproval"))
        if approved:
            continue

        guest = case.get("guestName", "Gast")
        short_guest = guest.split("/")[0].strip()
        case_id = case.get("id", short_guest.lower().replace(" ", "-"))
        submitted = bool(checklist.get("submittedToHoa"))

        docs_due = parse_date(case.get("deadlineDocuments"))
        if docs_due and missing_items(case):
            events.append(
                CalendarEvent(
                    case_id,
                    "documents-due",
                    f"[Airbnb HOA] GELB: {short_guest} - Unterlagen faellig",
                    docs_due,
                    9,
                    0,
                    30,
                    event_description(case, "Reminder/Follow-up: completed HOA documents are still missing."),
                    (-1440, -120),
                )
            )

        cancellation_review = parse_date(case.get("cancellationReviewAt"))
        if cancellation_review and not submitted:
            events.append(
                CalendarEvent(
                    case_id,
                    "cancellation-review",
                    f"[Airbnb HOA] ROT: {short_guest} - Cancellation Review",
                    cancellation_review,
                    9,
                    30,
                    30,
                    event_description(case, "Review cancellation / Airbnb Support risk before the reservation continues."),
                    (-1440, -60),
                )
            )

        airbnb_support = parse_date(case.get("airbnbSupportAt"))
        if airbnb_support and not submitted:
            events.append(
                CalendarEvent(
                    case_id,
                    "airbnb-support",
                    f"[Airbnb HOA] ROT: {short_guest} - Airbnb Support einschalten",
                    airbnb_support,
                    9,
                    30,
                    30,
                    event_description(case, "Contact Airbnb Support with the generated HOA dossier if documents are still missing."),
                    (-1440, -60),
                )
            )

        decision_by = parse_date(case.get("decisionBy"))
        if decision_by and not submitted:
            events.append(
                CalendarEvent(
                    case_id,
                    "decision-by",
                    f"[Airbnb HOA] ROT: {short_guest} - Entscheidung faellig",
                    decision_by,
                    10,
                    0,
                    30,
                    event_description(case, "Make host-safe decision: proceed only with complete HOA path or escalate/cancel through Airbnb."),
                    (-1440, -60),
                )
            )

        check_in = parse_date(case.get("start"))
        if check_in and not checklist.get("boardApproval"):
            events.append(
                CalendarEvent(
                    case_id,
                    "check-in-lock",
                    f"[Airbnb HOA] ROT: {short_guest} - Check-in nur mit Board Approval",
                    check_in,
                    8,
                    0,
                    30,
                    event_description(case, "Final guardrail: do not release access unless Board Approval is documented."),
                    (-4320, -1440, -120),
                )
            )

    return sorted(events, key=lambda event: (event.day, event.hour, event.minute, event.title))


def ics_escape(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace("\n", "\\n")
        .replace(",", "\\,")
        .replace(";", "\\;")
    )


def fold_line(line: str) -> list[str]:
    if len(line) <= 74:
        return [line]
    chunks = [line[:74]]
    rest = line[74:]
    while rest:
        chunks.append(" " + rest[:73])
        rest = rest[73:]
    return chunks


def fmt_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def write_ics(events: list[CalendarEvent], path: Path) -> None:
    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    raw_lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Property Owner//Airbnb HOA Operations//DE",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Airbnb HOA",
        "X-WR-TIMEZONE:America/Panama",
    ]
    for event in events:
        raw_lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{event.uid}",
                f"DTSTAMP:{now}",
                f"DTSTART:{fmt_utc(event.start_local)}",
                f"DTEND:{fmt_utc(event.end_local)}",
                f"SUMMARY:{ics_escape(event.title)}",
                f"DESCRIPTION:{ics_escape(event.description)}",
                "CATEGORIES:Airbnb,HOA",
            ]
        )
        for alarm in event.alarms:
            raw_lines.extend(
                [
                    "BEGIN:VALARM",
                    f"TRIGGER:-PT{abs(alarm)}M",
                    "ACTION:DISPLAY",
                    f"DESCRIPTION:{ics_escape(event.title)}",
                    "END:VALARM",
                ]
            )
        raw_lines.append("END:VEVENT")
    raw_lines.append("END:VCALENDAR")

    folded: list[str] = []
    for line in raw_lines:
        folded.extend(fold_line(line))
    path.write_text("\r\n".join(folded) + "\r\n", encoding="utf-8")


def applescript_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\r", "").replace("\n", "\\n") + '"'


def date_script(var_name: str, dt: datetime) -> str:
    local = dt.astimezone(PANAMA)
    return "\n".join(
        [
            f"set {var_name} to current date",
            f"set year of {var_name} to {local.year}",
            f"set month of {var_name} to {local.month}",
            f"set day of {var_name} to {local.day}",
            f"set hours of {var_name} to {local.hour}",
            f"set minutes of {var_name} to {local.minute}",
            f"set seconds of {var_name} to 0",
        ]
    )


def build_applescript(events: list[CalendarEvent], calendar_name: str) -> str:
    lines = [
        'tell application "Calendar"',
        f"  set targetCalendarName to {applescript_string(calendar_name)}",
        "  if not (exists calendar targetCalendarName) then",
        "    set targetCalendar to make new calendar with properties {name:targetCalendarName}",
        "  else",
        "    set targetCalendar to calendar targetCalendarName",
        "  end if",
        '  delete (every event of targetCalendar whose summary starts with "[Airbnb HOA]")',
    ]
    for index, event in enumerate(events, start=1):
        start_var = f"startDate{index}"
        end_var = f"endDate{index}"
        lines.append("  " + date_script(start_var, event.start_local).replace("\n", "\n  "))
        lines.append("  " + date_script(end_var, event.end_local).replace("\n", "\n  "))
        lines.extend(
            [
                "  tell targetCalendar",
                f"    set newEvent to make new event with properties {{summary:{applescript_string(event.title)}, start date:{start_var}, end date:{end_var}, description:{applescript_string(event.description)}}}",
                "    tell newEvent",
            ]
        )
        for alarm in event.alarms:
            lines.append(f"      make new display alarm with properties {{trigger interval:{alarm}}}")
        lines.extend(["    end tell", "  end tell"])
    lines.extend(["end tell", f'return "synced {len(events)} events to {calendar_name}"'])
    return "\n".join(lines) + "\n"


def sync_apple_calendar(events: list[CalendarEvent], calendar_name: str) -> str:
    script = build_applescript(events, calendar_name)
    result = subprocess.run(["osascript"], input=script, text=True, capture_output=True, check=False)
    if result.returncode:
        raise SystemExit(result.stderr.strip() or result.stdout.strip() or "Apple Calendar sync failed")
    return result.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Export/sync Airbnb HOA deadlines to calendar")
    parser.add_argument("--state", type=Path, default=STATE_FILE)
    parser.add_argument("--output", type=Path, default=ICS_FILE)
    parser.add_argument("--calendar-name", default="Florida")
    parser.add_argument("--sync-apple-calendar", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    state = json.loads(args.state.read_text(encoding="utf-8"))
    events = build_events(state)
    write_ics(events, args.output)

    if args.dry_run:
        print(json.dumps({"events": [event.__dict__ | {"day": event.day.isoformat()} for event in events], "ics": str(args.output)}, indent=2, ensure_ascii=False))
        return 0

    if args.sync_apple_calendar:
        message = sync_apple_calendar(events, args.calendar_name)
        print(message)
    else:
        print(f"wrote {len(events)} events to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
