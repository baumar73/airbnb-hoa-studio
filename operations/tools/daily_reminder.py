#!/usr/bin/env python3
"""Local macOS daily reminder for the Airbnb HOA operations app.

This is intentionally a local reminder layer. It runs the read-only daily
analysis, writes a compact status file, and can raise a macOS notification.
It does not send email, Airbnb messages, WhatsApp, iMessage, or HOA messages.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import daily_watch


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
STATUS_FILE = DATA_DIR / "daily-reminder-status.json"
TEXT_FILE = DATA_DIR / "daily-reminder-latest.txt"
DASHBOARD_URL = "http://127.0.0.1:4327/"


def now_panama() -> str:
    return datetime.now(ZoneInfo("America/Panama")).isoformat(timespec="seconds")


def load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def status_level(summary: dict[str, Any]) -> str:
    if int(summary.get("red") or 0) > 0:
        return "red"
    if int(summary.get("amber") or 0) > 0:
        return "amber"
    return "green"


def should_notify(level: str, notify_level: str) -> bool:
    if notify_level == "never":
        return False
    if notify_level == "always":
        return True
    if notify_level == "red":
        return level == "red"
    return level in {"red", "amber"}


def compact_message(report: dict[str, Any]) -> str:
    summary = report.get("summary") or {}
    red = int(summary.get("red") or 0)
    amber = int(summary.get("amber") or 0)
    items = reminder_items(report)
    if red:
        prefix = f"{red} rote Punkte, {amber} gelbe Punkte"
    elif amber:
        prefix = f"Keine roten Punkte, aber {amber} gelbe Punkte"
    else:
        prefix = "Keine offenen roten oder gelben Punkte"
    if not items:
        return prefix
    top = items[0]
    due = f" bis {top.get('due')}" if top.get("due") else ""
    return f"{prefix}. Heute zuerst: {top.get('title')}{due}."


def reminder_items(report: dict[str, Any]) -> list[dict[str, Any]]:
    items = list(report.get("items") or [])
    today = daily_watch.parse_date(report.get("today"))
    level_rank = {"red": 0, "amber": 1, "blue": 2}
    kind_rank = {
        "telephony": 0,
        "maintenance": 1,
        "case": 2,
        None: 2,
        "cleaning": 3,
        "payment": 4,
    }

    def priority(item: dict[str, Any]) -> tuple[int, int, int, str]:
        due = daily_watch.parse_date(item.get("due"))
        days = (due - today).days if due and today else 9999
        due_rank = 0 if days <= 0 else days
        return (
            level_rank.get(item.get("level"), 9),
            kind_rank.get(item.get("kind"), 2),
            due_rank,
            str(item.get("title") or ""),
        )

    return sorted(items, key=priority)


def text_report(report: dict[str, Any]) -> str:
    lines = [
        f"Airbnb HOA Tageswecker ({report.get('today')})",
        compact_message(report),
        "",
        "Dashboard:",
        DASHBOARD_URL,
        "",
    ]
    items = reminder_items(report)
    if not items:
        lines.append("Keine offenen Risiken gefunden.")
    for index, item in enumerate(items[:8], start=1):
        level = str(item.get("level") or "").upper()
        due = f" ({item.get('due')})" if item.get("due") else ""
        owner = item.get("guestName") or item.get("kind") or "Airbnb HOA"
        lines.append(f"{index}. [{level}] {item.get('title')}{due} - {owner}")
        lines.append(f"   {item.get('detail') or ''}")
    return "\n".join(lines).rstrip() + "\n"


def applescript_string(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", " ") + '"'


def notify_mac(title: str, subtitle: str, message: str) -> dict[str, Any]:
    script = (
        "display notification "
        f"{applescript_string(message[:220])} "
        f"with title {applescript_string(title)} "
        f"subtitle {applescript_string(subtitle[:80])}"
    )
    try:
        completed = subprocess.run(
            ["/usr/bin/osascript", "-e", script],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
        return {
            "ok": completed.returncode == 0,
            "returncode": completed.returncode,
            "stdout": completed.stdout.strip(),
            "stderr": completed.stderr.strip(),
        }
    except Exception as exc:
        return {"ok": False, "returncode": None, "stdout": "", "stderr": str(exc)}


def build_status(report: dict[str, Any], notification: dict[str, Any]) -> dict[str, Any]:
    summary = report.get("summary") or {}
    items = reminder_items(report)
    return {
        "ok": True,
        "generatedAt": now_panama(),
        "today": report.get("today"),
        "level": status_level(summary),
        "message": compact_message(report),
        "summary": summary,
        "topItem": items[0] if items else None,
        "dashboardUrl": DASHBOARD_URL,
        "textFile": str(TEXT_FILE),
        "notification": notification,
    }


def notification_key(report: dict[str, Any]) -> str:
    summary = report.get("summary") or {}
    top = (reminder_items(report) or [{}])[0]
    return "|".join(
        [
            str(report.get("today") or ""),
            f"red={summary.get('red') or 0}",
            f"amber={summary.get('amber') or 0}",
            str(top.get("title") or ""),
            str(top.get("due") or ""),
        ]
    )


def run_reminder(args: argparse.Namespace) -> dict[str, Any]:
    state = daily_watch.load_json(args.state, {"cases": []})
    calendar = daily_watch.load_json(args.calendar, {"events": []})
    current_day = daily_watch.parse_date(args.today) if args.today else daily_watch.today_panama()
    report = daily_watch.analyze(state, calendar, current_day or daily_watch.today_panama())
    level = status_level(report.get("summary") or {})
    key = notification_key(report)
    previous = load_json(args.status_file, {})
    previous_key = ((previous.get("notification") or {}).get("key") if isinstance(previous, dict) else None)
    duplicate = previous_key == key and not args.force_notify

    notification: dict[str, Any] = {
        "requested": bool(args.notify),
        "sent": False,
        "suppressedDuplicate": bool(args.notify and duplicate),
        "key": key,
        "notifyLevel": args.notify_level,
    }
    if args.notify and should_notify(level, args.notify_level) and not duplicate:
        result = notify_mac(
            "Airbnb HOA Tagescheck",
            f"{report.get('today')} - {level.upper()}",
            compact_message(report),
        )
        notification.update(
            {
                "sent": bool(result.get("ok")),
                "sentAt": now_panama() if result.get("ok") else None,
                "error": "" if result.get("ok") else result.get("stderr") or result.get("stdout") or "notification failed",
            }
        )

    status = build_status(report, notification)
    args.status_file.parent.mkdir(parents=True, exist_ok=True)
    args.status_file.write_text(json.dumps(status, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    args.text_file.write_text(text_report(report), encoding="utf-8")
    return status


def main() -> int:
    parser = argparse.ArgumentParser(description="Run local Airbnb HOA daily reminder")
    parser.add_argument("--state", type=Path, default=daily_watch.DEFAULT_STATE)
    parser.add_argument("--calendar", type=Path, default=daily_watch.DEFAULT_CALENDAR)
    parser.add_argument("--status-file", type=Path, default=STATUS_FILE)
    parser.add_argument("--text-file", type=Path, default=TEXT_FILE)
    parser.add_argument("--today", default=None)
    parser.add_argument("--notify", action="store_true", help="Send a local macOS notification when attention is needed")
    parser.add_argument("--notify-level", choices=["red", "amber", "always", "never"], default="amber")
    parser.add_argument("--force-notify", action="store_true", help="Do not suppress duplicate notifications for the same daily status")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    status = run_reminder(args)
    if args.json:
        print(json.dumps(status, indent=2, ensure_ascii=False))
    else:
        print(status["message"])
        print(f"Status: {args.status_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
