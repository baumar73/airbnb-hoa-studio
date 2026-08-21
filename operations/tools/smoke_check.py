#!/usr/bin/env python3
"""Smoke checks for the Airbnb HOA operations app.

The checks are intentionally fast and local. They verify the core safety
invariants that should never regress, plus the read-only display/voice APIs
when the local server is running.
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
STATE_FILE = ROOT / "data" / "airbnb-hoa-state.json"
MANIFEST_FILE = ROOT / "data" / "markus-operations-manifest.json"

REQUIRED_ACTIVE_CAPABILITIES = {
    "runtime",
    "calendar",
    "reminders",
    "documents",
    "contacts",
    "inbox",
    "payments",
    "maintenance",
    "display",
    "voice",
    "hermes",
    "gbrain",
}

REQUIRED_LIFECYCLE_PHASES = {"intake", "planned", "prototype", "active", "vm_ready"}


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def check(condition: bool, message: str, failures: list[str]) -> None:
    if not condition:
        failures.append(message)


def state_checks(state: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    cases = state.get("cases") or []
    case_ids = [case.get("id") for case in cases]
    case_id_set = set(case_ids)
    check(len(case_ids) == len(case_id_set), "case IDs must be unique", failures)

    for case in cases:
      case_id = case.get("id") or "<missing>"
      checklist = case.get("checklist") or {}
      board_approval = bool(checklist.get("boardApproval"))
      check(bool(case.get("guestName")), f"{case_id}: guestName missing", failures)
      check(bool(case.get("start")) and bool(case.get("end")), f"{case_id}: stay dates missing", failures)
      check(case.get("status") != "approved" or board_approval, f"{case_id}: approved without Board Approval", failures)
      check(board_approval or case.get("checkInLocked") is not False, f"{case_id}: check-in unlocked without Board Approval", failures)
      if board_approval:
          check(case.get("checkInLocked") is False, f"{case_id}: Board Approval but check-in still locked", failures)

    payments = (state.get("payments") or {}).get("items") or []
    for payment in payments:
        payment_id = payment.get("id") or "<missing>"
        check(payment.get("caseId") in case_id_set, f"{payment_id}: payment caseId missing/invalid", failures)

    inbox_items = state.get("inboxItems") or []
    for item in inbox_items:
        item_id = item.get("id") or "<missing>"
        if item.get("caseId"):
            check(item.get("caseId") in case_id_set, f"{item_id}: inbox caseId missing/invalid", failures)

    telephony = state.get("telephony") or {}
    contacts = telephony.get("contacts") or []
    calls = telephony.get("callLog") or []
    contact_ids = [contact.get("id") for contact in contacts]
    check(len(contact_ids) == len(set(contact_ids)), "telephony contact IDs must be unique", failures)
    for contact in contacts:
        contact_id = contact.get("id") or "<missing>"
        check(bool(contact.get("label")), f"{contact_id}: telephony contact label missing", failures)
        check("password" not in json.dumps(contact, ensure_ascii=False).lower(), f"{contact_id}: telephony contact must not contain password material", failures)
    call_ids = [call.get("id") for call in calls]
    check(len(call_ids) == len(set(call_ids)), "telephony call IDs must be unique", failures)
    for call in calls:
        call_id = call.get("id") or "<missing>"
        check(bool(call.get("phone")), f"{call_id}: telephony phone missing", failures)
        check(call.get("status") in {"planned", "called", "reached", "left_message", "failed", "cancelled"}, f"{call_id}: invalid telephony status", failures)
        if call.get("caseId"):
            check(call.get("caseId") in case_id_set, f"{call_id}: telephony caseId missing/invalid", failures)

    return failures


def manifest_checks(manifest: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    runtime_policy = manifest.get("runtimePolicy") or {}
    check(runtime_policy.get("defaultTarget") == "proxmox_vm", "operations manifest must default to proxmox_vm runtime", failures)
    check(runtime_policy.get("healthApi") == "/api/health", "operations manifest must declare /api/health", failures)
    shared_capabilities = {
        capability.get("id")
        for capability in manifest.get("sharedCapabilities") or []
        if isinstance(capability, dict) and capability.get("id")
    }
    check("runtime" in shared_capabilities and "gbrain" in shared_capabilities, "operations manifest must declare shared runtime and gbrain capabilities", failures)
    lifecycle = {
        phase.get("id")
        for phase in manifest.get("domainLifecycle") or []
        if isinstance(phase, dict) and phase.get("id")
    }
    check(REQUIRED_LIFECYCLE_PHASES.issubset(lifecycle), "operations manifest must declare the full domain lifecycle", failures)
    template = manifest.get("newDomainTemplate") or {}
    check(template.get("doc") == "ops/new-domain-playbook.md", "operations manifest must point to new-domain playbook", failures)
    check("npm run operations:check" in (template.get("acceptanceChecks") or []), "new-domain template must include operations check", failures)
    domains = manifest.get("domains") or []
    domain_ids = [domain.get("id") for domain in domains]
    check("airbnb_hoa" in domain_ids, "operations manifest must include active airbnb_hoa domain", failures)
    check("panama_house" in domain_ids, "operations manifest must reserve panama_house domain", failures)
    check("panama_vehicle" in domain_ids, "operations manifest must reserve panama_vehicle domain", failures)
    for domain in domains:
        domain_id = domain.get("id") or "<missing>"
        status = domain.get("status")
        check(status in {"active", "planned"}, f"{domain_id}: invalid domain status", failures)
        if status == "active":
            check(bool(domain.get("sourceOfTruth")), f"{domain_id}: active domain sourceOfTruth missing", failures)
            deployment = domain.get("deployment") or {}
            check(deployment.get("target") == "proxmox_vm", f"{domain_id}: active domain must target proxmox_vm", failures)
            check(deployment.get("health") == "/api/health", f"{domain_id}: active domain health endpoint missing", failures)
            capabilities = set(domain.get("sharedCapabilities") or [])
            missing = REQUIRED_ACTIVE_CAPABILITIES - capabilities
            check(not missing, f"{domain_id}: active domain missing shared capabilities: {', '.join(sorted(missing))}", failures)
        if status == "planned":
            check(domain.get("plannedOnly") is True, f"{domain_id}: planned domain must be marked plannedOnly", failures)
            check(domain.get("sourceOfTruth") is None, f"{domain_id}: planned domain must not have sourceOfTruth yet", failures)
            deployment_plan = domain.get("deploymentPlan") or {}
            check(deployment_plan.get("target") == "proxmox_vm", f"{domain_id}: planned domain must reserve proxmox_vm target", failures)
    return failures


def get_json(url: str) -> dict[str, Any]:
    with urllib.request.urlopen(url, timeout=20) as response:
        return json.load(response)


def post_json_expect_error(url: str, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"content-type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        code = error.code
        try:
            body = json.loads(error.read().decode("utf-8"))
        finally:
            error.close()
        return code, body


def api_checks(base_url: str, state: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    bootstrap = get_json(f"{base_url}/api/bootstrap")
    health = get_json(f"{base_url}/api/health")
    display_state = get_json(f"{base_url}/api/display-state").get("displayState") or {}
    display_info = get_json(f"{base_url}/api/display-info").get("display") or {}
    voice_brief = get_json(f"{base_url}/api/voice-brief").get("brief") or {}
    operations_manifest = get_json(f"{base_url}/api/operations-manifest").get("operationsManifest") or {}

    check(bool(bootstrap.get("state")), "bootstrap must include state", failures)
    check(health.get("ok") is True, "health endpoint must report ok", failures)
    check((health.get("runtime") or {}).get("target") in {"proxmox_vm", "local_mac_dev"}, "health runtime target invalid", failures)
    check(bool(bootstrap.get("operationsManifest")), "bootstrap must include operations manifest", failures)
    check("airbnb_hoa" in [domain.get("id") for domain in operations_manifest.get("domains") or []], "operations manifest API must include airbnb_hoa", failures)
    check(bool(display_state.get("summary")), "display-state must include summary", failures)
    check(bool(display_state.get("workItems")) or display_state.get("summary", {}).get("dailyRed", 0) == 0, "display-state work items missing", failures)
    check(str(display_info.get("localDisplayUrl", "")).endswith("/display"), "display-info local display URL missing", failures)
    check("Keine Zugangsdaten" in voice_brief.get("guardrail", ""), "voice brief guardrail missing", failures)
    check(len(voice_brief.get("text", "")) > 80, "voice brief text too short", failures)

    invalid_state = copy.deepcopy(state)
    target = next((case for case in invalid_state.get("cases", []) if not (case.get("checklist") or {}).get("boardApproval")), None)
    if target:
        target["status"] = "approved"
        target["checkInLocked"] = False
        target.setdefault("checklist", {})["boardApproval"] = False
        status, payload = post_json_expect_error(f"{base_url}/api/state", invalid_state)
        check(status == 400, "invalid approved state must be rejected", failures)
        check("Board Approval" in payload.get("error", ""), "invalid-state rejection must mention Board Approval", failures)

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="Run local Airbnb HOA smoke checks")
    parser.add_argument("--base-url", default="http://127.0.0.1:4327", help="Running app base URL")
    parser.add_argument("--skip-api", action="store_true", help="Only check local files/state")
    args = parser.parse_args()

    state = load_json(STATE_FILE)
    manifest = load_json(MANIFEST_FILE)
    failures = state_checks(state)
    failures.extend(manifest_checks(manifest))
    if not args.skip_api:
        try:
            failures.extend(api_checks(args.base_url.rstrip("/"), state))
        except Exception as exc:
            failures.append(f"API smoke failed: {exc}")

    if failures:
        print("Smoke check failed:")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("Smoke check passed: state invariants, Proxmox runtime manifest, health endpoint, display APIs, voice brief, and Board Approval guardrail are OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
