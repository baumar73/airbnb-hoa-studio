#!/usr/bin/env python3
"""Read-only iMessage bridge wrapper with explicit runtime configuration."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
from typing import Any


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only configured iMessage bridge access")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("health")
    search = subparsers.add_parser("search")
    search.add_argument("query")
    search.add_argument("--limit", type=int, default=20)
    search.add_argument("--since-days", type=int, default=365)
    args = parser.parse_args()

    host = os.environ.get("HERMES_IMESSAGE_HOST", "").strip()
    bridge_path = os.environ.get("HERMES_IMESSAGE_BRIDGE_PATH", "").strip()
    if not host or not bridge_path:
        emit({
            "ok": False,
            "configured": False,
            "status": "disabled",
            "reason": "HERMES_IMESSAGE_HOST and HERMES_IMESSAGE_BRIDGE_PATH must both be configured",
        })
        return 0

    bridge_args = ["python3", bridge_path, "--redact", args.command]
    if args.command == "search":
        bridge_args.extend([args.query, "--limit", str(max(1, args.limit)), "--since-days", str(max(0, args.since_days))])
    remote_command = shlex.join(bridge_args)
    try:
        completed = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", host, remote_command],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        emit({"ok": False, "configured": True, "status": "unavailable", "error": str(exc)})
        return 1

    if completed.returncode != 0:
        emit({
            "ok": False,
            "configured": True,
            "status": "unavailable",
            "returncode": completed.returncode,
            "error": completed.stderr.strip()[:1000],
        })
        return 1
    print(completed.stdout, end="" if completed.stdout.endswith("\n") else "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
