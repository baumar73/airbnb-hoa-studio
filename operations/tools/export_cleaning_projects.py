#!/usr/bin/env python3
"""Export Turno cleaning projects from the operations state into the compact
JSON shape the portal's progress board consumes.

The board derives the Reinigung date automatically from these projects
(0-2 days after checkout). This script only extracts + prints the payload;
writing it into the portal KV (cleaning-projects) is done separately with a
real token, e.g.:

    export CLEANING_JSON="$(python3 export_cleaning_projects.py)"
    wrangler kv key put --binding=CASES --namespace-id=<ID> \
        "cleaning-projects" "$CLEANING_JSON" --remote

Secrets and live KV ids never go into this repository (see ARCHITECTURE.md).
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_STATE = os.path.join(ROOT, "data", "airbnb-hoa-state.json")


def load_state(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def main():
    path = os.environ.get("AIRBNB_HOA_STATE", DEFAULT_STATE)
    state = load_state(path)
    projects = (state.get("cleaning") or {}).get("projects") or []
    # Only the fields the matching logic in portal/functions/lib/cleaning.js uses.
    compact = [
        {"projectId": p.get("projectId"), "date": p.get("date") or (p.get("scheduledStart") or "")[:10],
         "status": p.get("status")}
        for p in projects
    ]
    print(json.dumps(compact))
    print(f"{len(compact)} Turno projects exported", file=sys.stderr)


if __name__ == "__main__":
    main()