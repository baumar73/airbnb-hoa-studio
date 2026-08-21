#!/usr/bin/env python3
"""Import Airbnb iCal events without exposing the private calendar URL."""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from datetime import UTC, datetime
from pathlib import Path


DEFAULT_SECRET_FILE = Path.home() / ".codex/secrets/inbox/airbnb-florida-ical-2026-06-26.toml"


def read_secret_url(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    match = re.search(r'^url\s*=\s*"([^"]+)"', text, re.MULTILINE)
    if not match:
        raise SystemExit(f"No url entry found in {path}")
    return match.group(1)


def unfold_ics(text: str) -> str:
    return re.sub(r"\r?\n[ \t]", "", text)


def parse_ics_date(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    if re.fullmatch(r"\d{8}", value):
        return datetime.strptime(value, "%Y%m%d").date().isoformat()
    if re.fullmatch(r"\d{8}T\d{6}Z?", value):
        fmt = "%Y%m%dT%H%M%S" + ("Z" if value.endswith("Z") else "")
        parsed = datetime.strptime(value, fmt)
        return parsed.isoformat()
    return value


def parse_events(ics_text: str) -> list[dict[str, str]]:
    ics_text = unfold_ics(ics_text)
    events: list[dict[str, str]] = []

    for raw_block in ics_text.split("BEGIN:VEVENT")[1:]:
        block = raw_block.split("END:VEVENT", 1)[0]

        def field(name: str) -> str:
            match = re.search(r"^" + re.escape(name) + r"(?:;[^:]*)?:(.*)$", block, re.MULTILINE)
            return match.group(1).strip() if match else ""

        events.append(
            {
                "start": parse_ics_date(field("DTSTART")),
                "end": parse_ics_date(field("DTEND")),
                "summary": field("SUMMARY"),
                "uid": field("UID"),
            }
        )

    events.sort(key=lambda event: (event["start"], event["end"], event["summary"]))
    return events


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Airbnb iCal events.")
    parser.add_argument("--secret-file", type=Path, default=DEFAULT_SECRET_FILE)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    url = read_secret_url(args.secret_file)
    with urllib.request.urlopen(url, timeout=20) as response:
        ics_text = response.read().decode("utf-8", errors="replace")

    payload = {
        "source": "airbnb_ical",
        "listing_id": "DEMOID0002",
        "listing_name": "Example Island, Meerblick",
        "generated_at": datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "events": parse_events(ics_text),
    }

    rendered = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
