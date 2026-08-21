#!/usr/bin/env python3
"""Check the local Owner Operations app health endpoint."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser(description="Check app health endpoint")
    parser.add_argument("--base-url", default="http://127.0.0.1:4327", help="Running app base URL")
    parser.add_argument("--json", action="store_true", help="Print raw health JSON")
    args = parser.parse_args()

    url = args.base_url.rstrip("/") + "/api/health"
    with urllib.request.urlopen(url, timeout=15) as response:
        payload = json.load(response)

    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        runtime = payload.get("runtime") or {}
        print(
            "Health OK:"
            f" status={payload.get('status')}"
            f" target={runtime.get('target')}"
            f" mode={runtime.get('deploymentMode')}"
            f" domains={len(payload.get('domains') or [])}"
        )
    return 0 if payload.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
