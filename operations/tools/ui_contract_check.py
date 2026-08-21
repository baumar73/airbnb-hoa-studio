#!/usr/bin/env python3
"""UI/server contract regression checks for the Airbnb HOA operations app.

Local and read-only. Guards against three concrete past defects:

1. server.mjs containing literal ``***`` placeholder corruption that breaks
   Node's parser (the whole owner dashboard went dark because of it).
2. public/index.html missing element IDs that app.js dereferences at
   bootstrap/render time (a missing ID throws and kills the whole UI).
3. public/display.html missing element IDs that display.js dereferences.

These checks intentionally use only the Python standard library.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
SERVER_FILE = ROOT / "server.mjs"

JS_ID_PATTERN = re.compile(r'\$\(\s*"([A-Za-z0-9_-]+)"\s*\)')
HTML_ID_PATTERN = re.compile(r'id="([A-Za-z0-9_-]+)"')
# IDs that app.js itself injects into rendered HTML (e.g. nextCopyText,
# nextCopyDossier inside the next-action card). They must NOT also exist
# statically in index.html, or getElementById would hit duplicates.
JS_CREATED_ID_PATTERN = re.compile(r'id="([A-Za-z0-9_-]+)"')


def check(condition: bool, message: str, failures: list[str]) -> None:
    if not condition:
        failures.append(message)


def js_ids(source: str) -> set[str]:
    return set(JS_ID_PATTERN.findall(source))


def html_ids(source: str) -> set[str]:
    return set(HTML_ID_PATTERN.findall(source))


def server_checks(failures: list[str]) -> None:
    check(SERVER_FILE.exists(), "server.mjs must exist", failures)
    if not SERVER_FILE.exists():
        return
    source = SERVER_FILE.read_text(encoding="utf-8")
    # Regression: literal *** placeholder corruption previously broke parsing.
    for line_number, line in enumerate(source.splitlines(), start=1):
        if "***" in line:
            failures.append(f"server.mjs:{line_number}: literal *** corruption found")
    braces = source.count("{") - source.count("}")
    check(braces == 0, f"server.mjs braces unbalanced (delta {braces})", failures)
    parens = source.count("(") - source.count(")")
    check(parens == 0, f"server.mjs parentheses unbalanced (delta {parens})", failures)
    check("createServer(" in source, "server.mjs must create an HTTP server", failures)
    check('"/api/state"' in source, "server.mjs must expose POST /api/state", failures)
    check("assertValidState" in source, "server.mjs must validate state before writes", failures)
    check("backupCurrentState" in source, "server.mjs must back up state before replacement", failures)


def js_created_ids(source: str) -> set[str]:
    """IDs that the script itself writes into generated markup."""
    return set(JS_CREATED_ID_PATTERN.findall(source))


def page_checks(html_file: Path, js_file: Path, label: str, failures: list[str]) -> None:
    check(html_file.exists(), f"{html_file.name} must exist", failures)
    check(js_file.exists(), f"{js_file.name} must be present", failures)
    if not html_file.exists() or not js_file.exists():
        return
    js_source = js_file.read_text(encoding="utf-8")
    html_source = html_file.read_text(encoding="utf-8")
    required = js_ids(js_source) - js_created_ids(js_source)
    present = html_ids(html_source)
    missing = sorted(required - present)
    check(not missing, f"{label}: {html_file.name} missing IDs used by {js_file.name}: {', '.join(missing)}", failures)
    duplicated = sorted(required & js_created_ids(js_source) & present)
    check(
        not duplicated,
        f"{label}: {html_file.name} must not statically duplicate dynamic IDs from {js_file.name}: {', '.join(duplicated)}",
        failures,
    )


def approval_transition_checks(failures: list[str]) -> None:
    app_file = PUBLIC / "app.js"
    check(app_file.exists(), "public/app.js must exist", failures)
    if not app_file.exists():
        return
    source = app_file.read_text(encoding="utf-8")
    branch = source.find('if (key === "boardApproval")')
    approval_assignment = source.find("caseItem.checklist.boardApproval = approved;", branch)
    early_return = source.find("return;", approval_assignment)
    generic_assignment = source.find("caseItem.checklist[key] = completedDocumentStatuses.has(status);", branch)
    check(branch >= 0, "app.js must special-case Board Approval document status", failures)
    check(
        approval_assignment > branch,
        "app.js must set Board Approval true only from the explicit approved predicate",
        failures,
    )
    check(
        early_return > approval_assignment and generic_assignment > early_return,
        "app.js must return from the Board Approval branch before generic completed-status handling",
        failures,
    )
    evidence_function = source[source.find("function promptBoardApprovalEvidence"):source.find("function updateDocumentStatus")]
    for required_field in ("authority", "date: approvalDate", "referenceId", "namedParty"):
        check(
            required_field in evidence_function,
            f"app.js Board Approval prompt must collect server-required evidence field {required_field}",
            failures,
        )
    check(
        'new Set(["Board", "Board designee"])' in evidence_function,
        "app.js Board Approval prompt must restrict authority to Board or Board designee",
        failures,
    )
    check(
        "namedParty !== String(caseItem.guestName" in evidence_function,
        "app.js Board Approval prompt must bind the named party to the case guest",
        failures,
    )


def build_report() -> dict:
    failures: list[str] = []
    server_checks(failures)
    page_checks(PUBLIC / "index.html", PUBLIC / "app.js", "dashboard", failures)
    page_checks(PUBLIC / "display.html", PUBLIC / "display.js", "display", failures)
    approval_transition_checks(failures)
    return {
        "ok": not failures,
        "check": "ui_contract",
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Check server syntax markers and HTML/JS ID contract")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    report = build_report()
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    elif report["ok"]:
        print("UI contract check passed: server.mjs intact, dashboard and display HTML cover all script-referenced IDs.")
    else:
        print("UI contract check failed:")
        for failure in report["failures"]:
            print(f"- {failure}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
