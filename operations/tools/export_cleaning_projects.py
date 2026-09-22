#!/usr/bin/env python3
"""Export Turno cleaning projects from the operations state into the compact
JSON shape the portal's progress board consumes, and optionally push it into
the portal KV (cleaning-projects).

The board derives the Reinigung date automatically from these projects
(0-2 days after checkout).

Usage:
    # 1) print the payload to stdout
    python3 export_cleaning_projects.py

    # 2) print AND push into Cloudflare KV (real creds via env only)
    export CF_API_TOKEN="<your-token>"
    export CF_ACCOUNT_ID="<your-account>"
    export KV_NAMESPACE_ID="<your-namespace>"      # optional; falls dich, --namespace
    python3 export_cleaning_projects.py --push

    # --namespace / --key override the KV key (default cleaning-projects)
    python3 export_cleaning_projects.py --push --key cleaning-projects \\
        --namespace "<ns-id-or-binding>"

Secrets and live KV ids never go into this repository (see ARCHITECTURE.md).
"""
import argparse
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_STATE = os.path.join(ROOT, "data", "airbnb-hoa-state.json")


def load_state(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def compact_projects(state):
    projects = (state.get("cleaning") or {}).get("projects") or []
    # Only the fields the matching logic in portal/functions/lib/cleaning.js uses.
    return [
        {
            "projectId": p.get("projectId"),
            "date": p.get("date") or (p.get("scheduledStart") or "")[:10],
            "status": p.get("status"),
        }
        for p in projects
    ]


def push_payload(payload, key, namespace_arg):
    """Push the payload into Cloudflare KV via wrangler. Real creds from env."""
    # Exactly one of: --namespace value or KV_NAMESPACE_ID env.
    ns = namespace_arg or os.environ.get("KV_NAMESPACE_ID") or os.environ.get("KV_NAMESPACE")
    token = os.environ.get("CF_API_TOKEN")
    if not ns:
        print("Fehler: KV-Namespace fehlt. Setze --namespace <id> oder Env KV_NAMESPACE_ID.", file=sys.stderr)
        sys.exit(2)
    cmd = ["npx", "--yes", "wrangler", "kv", "key", "put",
           "--namespace-id", ns, key, payload, "--remote"]
    env = dict(os.environ)
    if token:
        env["CLOUDFLARE_API_TOKEN"] = token
    print("wrangler kv key put --namespace-id <id>", key, "--remote", file=sys.stderr)
    return subprocess.run(cmd, env=env)


def main():
    ap = argparse.ArgumentParser(description="Export Turno cleaning projects to the portal KV.")
    ap.add_argument("--push", action="store_true", help="push into Cloudflare KV after printing")
    ap.add_argument("--key", default="cleaning-projects")
    ap.add_argument("--namespace", default=None, help="KV namespace id (or use env KV_NAMESPACE_ID)")
    args = ap.parse_args()

    state = load_state(os.environ.get("AIRBNB_HOA_STATE", DEFAULT_STATE))
    compact = compact_projects(state)
    payload = json.dumps(compact)
    print(payload)
    print(f"{len(compact)} Turno projects exported ({args.key})", file=sys.stderr)

    if args.push:
        result = push_payload(payload, args.key, args.namespace)
        if result.returncode != 0:
            print(f"Push fehlgeschlagen (rc={result.returncode}). Payload oben ausgeben.", file=sys.stderr)
            sys.exit(result.returncode or 1)
        print("OK: cleaning-projects in KV geschrieben.", file=sys.stderr)


if __name__ == "__main__":
    main()