#!/usr/bin/env python3
"""Read-only integration status for the Airbnb HOA dashboard."""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import textwrap
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
CALENDAR_SNAPSHOT = DATA_DIR / "airbnb-florida-calendar-snapshot.json"
DEADLINES_ICS = DATA_DIR / "airbnb-hoa-deadlines.ics"
DAILY_REMINDER_STATUS = DATA_DIR / "daily-reminder-status.json"
DAILY_REMINDER_PLIST = Path(
    os.environ.get(
        "AIRBNB_HOA_DAILY_REMINDER_PLIST",
        str(Path.home() / "Library" / "LaunchAgents" / "com.markusbauer.airbnb-hoa.daily-reminder.plist"),
    )
).expanduser()

HERMES_HOST = os.environ.get("HERMES_HOST", "").strip()
HERMES_REMOTE_STATE_PATH = os.environ.get("HERMES_REMOTE_STATE_PATH", "").strip()
HERMES_REMOTE_HOME = os.environ.get("HERMES_REMOTE_HOME", "").strip()
MACMINI_HOST = os.environ.get("HERMES_IMESSAGE_HOST", "").strip()
IMESSAGE_BRIDGE_PATH = os.environ.get("HERMES_IMESSAGE_BRIDGE_PATH", "").strip()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def run(command: list[str], timeout: int = 15) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
        )
        return {
            "ok": completed.returncode == 0,
            "returncode": completed.returncode,
            "stdout": completed.stdout.strip(),
            "stderr": completed.stderr.strip(),
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "returncode": None,
            "stdout": (exc.stdout or "").strip() if isinstance(exc.stdout, str) else "",
            "stderr": f"timeout after {timeout}s",
        }
    except Exception as exc:  # pragma: no cover - defensive CLI boundary.
        return {"ok": False, "returncode": None, "stdout": "", "stderr": str(exc)}


def load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def file_timestamp(path: Path) -> str:
    if not path.exists():
        return ""
    return datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")


def item(
    item_id: str,
    label: str,
    status: str,
    title: str,
    detail: str = "",
    action: str = "",
) -> dict[str, str]:
    return {
        "id": item_id,
        "label": label,
        "status": status,
        "title": title,
        "detail": detail,
        "action": action,
    }


def local_calendar_items() -> list[dict[str, str]]:
    calendar = load_json(CALENDAR_SNAPSHOT, {"events": []})
    events = calendar.get("events") if isinstance(calendar, dict) else []
    generated = calendar.get("generated_at", "") if isinstance(calendar, dict) else ""
    calendar_count = len(events) if isinstance(events, list) else 0
    calendar_status = "ok" if calendar_count else "warn"
    calendar_title = f"{calendar_count} Airbnb-Kalendereintraege" if calendar_count else "Airbnb-Kalender leer"
    calendar_detail = generated or f"Datei: {file_timestamp(CALENDAR_SNAPSHOT) or 'fehlt'}"

    ics_text = DEADLINES_ICS.read_text(encoding="utf-8", errors="replace") if DEADLINES_ICS.exists() else ""
    deadline_count = ics_text.count("BEGIN:VEVENT")
    ics_status = "ok" if deadline_count else "warn"
    ics_title = f"{deadline_count} HOA-Fristen vorbereitet" if deadline_count else "Keine HOA-Fristen vorbereitet"
    ics_detail = f"Letzte Dateiaktualisierung: {file_timestamp(DEADLINES_ICS) or 'fehlt'}"

    return [
        item(
            "airbnbIcal",
            "Airbnb iCal",
            calendar_status,
            calendar_title,
            calendar_detail,
            "Buchungen aktualisieren, wenn Airbnb im Kalender nicht aktuell wirkt.",
        ),
        item(
            "appleCalendar",
            "iPhone-Kalender",
            ics_status,
            ics_title,
            ics_detail,
            "iPhone-Kalender sync schreibt diese Fristen in den Mac-Kalender Florida.",
        ),
    ]


def daily_reminder_item() -> dict[str, str]:
    status = load_json(DAILY_REMINDER_STATUS, {})
    today_local = datetime.now(ZoneInfo("America/Panama")).date().isoformat()
    installed = DAILY_REMINDER_PLIST.exists()
    if not installed:
        return item(
            "dailyReminder",
            "Tageswecker",
            "warn",
            "Nicht installiert",
            "Lokaler macOS-LaunchAgent fehlt.",
            "Mit `npm run install:daily-reminder` installieren.",
        )
    if not isinstance(status, dict) or not status:
        return item(
            "dailyReminder",
            "Tageswecker",
            "warn",
            "Installiert, noch kein Status",
            f"LaunchAgent: {DAILY_REMINDER_PLIST}",
            "Einmal `python3 tools/daily_reminder.py` ausfuehren oder naechsten Morgen abwarten.",
        )
    summary = status.get("summary") or {}
    status_day = status.get("today") or ""
    level = status.get("level") or "unknown"
    notification = status.get("notification") or {}
    notification_text = "Benachrichtigung gesendet" if notification.get("sent") else "Benachrichtigung nicht gesendet"
    if notification.get("suppressedDuplicate"):
        notification_text = "Doppelte Benachrichtigung unterdrueckt"
    title = f"Heute gelaufen: {summary.get('red', 0)} rot / {summary.get('amber', 0)} gelb"
    status_value = "ok" if status_day == today_local else "warn"
    if status_value == "warn":
        title = "Status nicht von heute"
    detail = f"{status.get('generatedAt', '-')}; Level {level}; {notification_text}; LaunchAgent: {DAILY_REMINDER_PLIST}"
    action = "" if status_value == "ok" else "Mit `npm run daily:reminder` manuell pruefen."
    return item("dailyReminder", "Tageswecker", status_value, title, detail, action)


def remote_status() -> dict[str, Any] | None:
    if not HERMES_HOST:
        return {"error": "HERMES_HOST is not configured"}
    remote_script = textwrap.dedent(
        f"""
        import getpass
        import json
        import os
        import pathlib
        import shlex
        import socket
        import subprocess
        from datetime import datetime, timezone

        def run(cmd, timeout=8):
            try:
                completed = subprocess.run(
                    cmd,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=timeout,
                )
                return {{
                    "ok": completed.returncode == 0,
                    "returncode": completed.returncode,
                    "stdout": completed.stdout.strip()[:4000],
                    "stderr": completed.stderr.strip()[:1000],
                }}
            except subprocess.TimeoutExpired:
                return {{"ok": False, "returncode": None, "stdout": "", "stderr": f"timeout after {{timeout}}s"}}
            except Exception as exc:
                return {{"ok": False, "returncode": None, "stdout": "", "stderr": str(exc)}}

        def tcp_open(host, port, timeout=2):
            try:
                with socket.create_connection((host, port), timeout=timeout):
                    return True
            except OSError:
                return False

        out = {{
            "checkedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "host": socket.gethostname(),
            "user": getpass.getuser(),
        }}

        state_path_value = {json.dumps(HERMES_REMOTE_STATE_PATH)}
        state_path = pathlib.Path(state_path_value) if state_path_value else None
        out["statePath"] = str(state_path) if state_path else ""
        out["statePathExists"] = bool(state_path and state_path.exists())
        if state_path and state_path.exists():
            try:
                out["state"] = json.loads(state_path.read_text())
            except Exception as exc:
                out["stateError"] = str(exc)

        remote_home_value = {json.dumps(HERMES_REMOTE_HOME)}
        remote_home = pathlib.Path(remote_home_value).expanduser() if remote_home_value else None
        hermes_home = remote_home / ".hermes" if remote_home else None
        out["homeLink"] = {{
            "configured": bool(remote_home),
            "path": str(hermes_home) if hermes_home else "",
            "exists": bool(hermes_home and hermes_home.exists()),
            "isSymlink": bool(hermes_home and hermes_home.is_symlink()),
            "target": os.path.realpath(hermes_home) if hermes_home else "",
            "targetExists": bool(hermes_home and pathlib.Path(os.path.realpath(hermes_home)).exists()),
        }}
        out["gatewayProcess"] = run(["pgrep", "-af", "hermes_cli.main gateway run"])
        out["gbrainStats"] = run(["gbrain", "stats"], timeout=12)
        out["gbrainProject"] = run(["gbrain", "get", "projects/airbnb-hoa-operations"], timeout=15)
        out["gbrainListProbe"] = run(["gbrain", "list", "--tag", "airbnb", "-n", "5"], timeout=15)
        out["whatsappBridgePortOpen"] = tcp_open("127.0.0.1", 3000)
        imessage_host = {json.dumps(MACMINI_HOST)}
        imessage_bridge_path = {json.dumps(IMESSAGE_BRIDGE_PATH)}
        if imessage_host and imessage_bridge_path:
            out["imessageHealth"] = run([
                "ssh",
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=5",
                imessage_host,
                f"python3 {{shlex.quote(imessage_bridge_path)}} --redact health",
            ], timeout=15)
        else:
            out["imessageHealth"] = {{
                "ok": False,
                "returncode": None,
                "stdout": "",
                "stderr": "HERMES_IMESSAGE_HOST or HERMES_IMESSAGE_BRIDGE_PATH is not configured",
            }}
        print(json.dumps(out, ensure_ascii=False))
        """
    ).strip()
    result = run(
        ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", HERMES_HOST, f"python3 - <<'PY'\n{remote_script}\nPY"],
        timeout=60,
    )
    if not result["ok"]:
        return {"error": result["stderr"] or result["stdout"] or "Hermes SSH unavailable", "command": result}
    try:
        return json.loads(result["stdout"])
    except json.JSONDecodeError as exc:
        return {"error": f"Hermes status JSON ungueltig: {exc}", "command": result}


def remote_items(remote: dict[str, Any] | None) -> list[dict[str, str]]:
    if not remote or remote.get("error"):
        message = (remote or {}).get("error", "Hermes konnte nicht erreicht werden")
        is_timeout = "timeout" in message.lower()
        return [
            item(
                "hermesGateway",
                "Hermes",
                "warn" if is_timeout else "error",
                "Hermes-Status unvollstaendig" if is_timeout else "Hermes nicht erreichbar",
                message,
                "Einzelstatus fuer Hermes, GBrain, WhatsApp und iMessage pruefen." if is_timeout else "Netzwerk/VPN und Hermes-Host pruefen.",
            ),
            item(
                "whatsapp",
                "WhatsApp",
                "warn",
                "Nicht pruefbar",
                "WhatsApp haengt am Hermes-Gateway und konnte deshalb nicht geprueft werden.",
                "Erst Hermes-Status klaeren.",
            ),
            item(
                "imessage",
                "iMessage",
                "warn",
                "Nicht pruefbar",
                "iMessage wird ueber den Mac mini von Hermes aus geprueft.",
                "Erst Hermes-Status klaeren.",
            ),
        ]

    state = remote.get("state") or {}
    platforms = state.get("platforms") if isinstance(state, dict) else {}
    gateway_process = remote.get("gatewayProcess") or {}
    gateway_running = state.get("gateway_state") == "running" or gateway_process.get("ok")
    gateway_detail = f"{remote.get('user', '-') }@{remote.get('host', '-')}; State-Datei: {remote.get('statePath', '-')}"
    gateway_status = "ok" if gateway_running else "error"
    gateway_title = "Gateway laeuft" if gateway_running else "Gateway laeuft nicht"

    email_state = platforms.get("email", {}) if isinstance(platforms, dict) else {}
    email_connected = email_state.get("state") == "connected"
    email_title = "Gmail verbunden" if email_connected else "Gmail nicht bestaetigt"
    email_detail = email_state.get("error_message") or email_state.get("state") or "Kein Plattformstatus gefunden"

    gbrain_stats = remote.get("gbrainStats") or {}
    gbrain_project = remote.get("gbrainProject") or {}
    gbrain_list = remote.get("gbrainListProbe") or {}
    stats_lines = [line.strip() for line in str(gbrain_stats.get("stdout") or "").splitlines() if line.strip()]
    stats_summary = "; ".join(stats_lines[:3])
    if gbrain_stats.get("ok") and gbrain_project.get("ok") and gbrain_list.get("ok"):
        gbrain_status = "ok"
        gbrain_title = "GBrain bereit"
        gbrain_detail = stats_summary or "Projektseite abrufbar"
        gbrain_action = "Neue sichere Wissensseiten mit GBrain-Sync einbetten."
    elif gbrain_stats.get("ok") and gbrain_project.get("ok"):
        gbrain_status = "warn"
        gbrain_title = "GBrain nutzbar, Listenpruefung auffaellig"
        gbrain_detail = (gbrain_list.get("stderr") or gbrain_list.get("stdout") or stats_summary or "Projektseite abrufbar")[:500]
        gbrain_action = "GBrain-Sync kann laufen; Listen-/Speicherwarnung separat beobachten."
    else:
        gbrain_status = "warn"
        gbrain_title = "GBrain nicht voll bestaetigt"
        gbrain_detail = (gbrain_stats.get("stderr") or gbrain_project.get("stderr") or gbrain_stats.get("stdout") or "GBrain-Projektseite nicht bestaetigt")[:500]
        gbrain_action = "GBrain auf hermes-gbrain-ai pruefen."

    whatsapp_state = platforms.get("whatsapp", {}) if isinstance(platforms, dict) else {}
    whatsapp_status_value = whatsapp_state.get("state") or "unknown"
    whatsapp_error = whatsapp_state.get("error_code") or whatsapp_state.get("error_message") or ""
    if whatsapp_status_value == "connected":
        whatsapp_status = "ok"
        whatsapp_title = "WhatsApp verbunden"
        whatsapp_action = ""
    elif whatsapp_error == "whatsapp_not_paired" or "not paired" in str(whatsapp_error).lower():
        whatsapp_status = "warn"
        whatsapp_title = "WhatsApp nicht gekoppelt"
        whatsapp_action = "QR-Kopplung mit deinem WhatsApp-Telefon ist erforderlich."
    else:
        whatsapp_status = "warn"
        whatsapp_title = f"WhatsApp: {whatsapp_status_value}"
        whatsapp_action = "Hermes WhatsApp-Status pruefen."
    bridge_suffix = "Bridge-Port offen" if remote.get("whatsappBridgePortOpen") else "Bridge-Port nicht offen"
    whatsapp_detail = "; ".join(part for part in [whatsapp_error or whatsapp_status_value, bridge_suffix] if part)

    imessage_result = remote.get("imessageHealth") or {}
    imessage_health = {}
    if imessage_result.get("ok") and imessage_result.get("stdout"):
        try:
            imessage_health = json.loads(imessage_result["stdout"])
        except json.JSONDecodeError:
            imessage_health = {}
    imessage_ready = bool(imessage_health.get("databaseReadable") or imessage_health.get("ok"))
    send_enabled = imessage_health.get("sendEnabled")
    if imessage_ready:
        imessage_status = "ok"
        imessage_title = "Mac mini iMessage bereit"
        latest = imessage_health.get("latestMessageLocal") or imessage_health.get("latestMessageLocalTime") or "-"
        imessage_detail = f"Lesbar; letzte Nachricht {latest}; Senden {'aktiv' if send_enabled else 'deaktiviert'}."
        imessage_action = "Nur kompakte Hinweise speichern, keine Roh-Chats."
    else:
        imessage_status = "warn"
        imessage_title = "iMessage nicht bestaetigt"
        imessage_detail = imessage_result.get("stderr") or imessage_result.get("stdout") or "Mac mini Bridge konnte nicht gelesen werden."
        imessage_action = "Mac mini und SSH-Verbindung pruefen."

    home_link = remote.get("homeLink") or {}
    configured_home = bool(home_link.get("configured"))
    home_exists = bool(home_link.get("exists"))
    home_status = "ok" if configured_home and home_exists else "warn"
    home_title = "Hermes-Ablage konfiguriert" if home_status == "ok" else "Hermes-Ablage nicht konfiguriert oder nicht erreichbar"
    home_detail = f"Konfigurierter Pfad: {home_link.get('path') or '-'}; existiert: {'ja' if home_exists else 'nein'}"
    home_action = "" if home_status == "ok" else "HERMES_REMOTE_HOME explizit setzen und den Pfad read-only erneut pruefen."

    return [
        item("hermesGateway", "Hermes", gateway_status, gateway_title, gateway_detail),
        item("gbrain", "GBrain", gbrain_status, gbrain_title, gbrain_detail, gbrain_action),
        item("gmailHermes", "Gmail/Hermes", "ok" if email_connected else "warn", email_title, email_detail),
        item("whatsapp", "WhatsApp", whatsapp_status, whatsapp_title, whatsapp_detail, whatsapp_action),
        item("imessage", "iMessage", imessage_status, imessage_title, imessage_detail, imessage_action),
        item("hermesHome", "Hermes-Ablage", home_status, home_title, home_detail, home_action),
    ]


def build_report() -> dict[str, Any]:
    items = local_calendar_items() + [daily_reminder_item()] + remote_items(remote_status())
    if any(entry["status"] == "error" for entry in items):
        overall = "error"
    elif any(entry["status"] == "warn" for entry in items):
        overall = "warn"
    else:
        overall = "ok"
    return {
        "ok": True,
        "generatedAt": utc_now(),
        "overall": overall,
        "items": items,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only Airbnb HOA integration status")
    parser.add_argument("--json", action="store_true", help="Write machine-readable JSON")
    args = parser.parse_args()

    report = build_report()
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0

    print(f"Integration status: {report['overall']} ({report['generatedAt']})")
    for entry in report["items"]:
        print(f"- [{entry['status'].upper()}] {entry['label']}: {entry['title']}")
        if entry.get("detail"):
            print(f"  {entry['detail']}")
        if entry.get("action"):
            print(f"  Next: {entry['action']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
