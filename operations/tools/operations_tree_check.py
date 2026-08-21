#!/usr/bin/env python3
"""Validate the Owner Operations domain tree.

This check is intentionally local and read-only. It protects the structure that
future domains such as Panama house or Panama vehicle should reuse.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
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

REQUIRED_PLANNED_FIELDS = {
    "id",
    "label",
    "status",
    "scope",
    "primaryObject",
    "plannedOnly",
    "deploymentPlan",
    "expectedData",
    "guardrails",
    "sharedCapabilities",
}

REQUIRED_LIFECYCLE_PHASES = [
    "intake",
    "planned",
    "prototype",
    "active",
    "vm_ready",
]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def add_failure(failures: list[str], message: str) -> None:
    failures.append(message)


def has_duplicates(values: list[str]) -> bool:
    return len(values) != len(set(values))


def validate_runtime(manifest: dict[str, Any], failures: list[str]) -> None:
    runtime = manifest.get("runtimePolicy") or {}
    if runtime.get("defaultTarget") != "proxmox_vm":
        add_failure(failures, "runtimePolicy.defaultTarget must be proxmox_vm")
    if runtime.get("healthApi") != "/api/health":
        add_failure(failures, "runtimePolicy.healthApi must be /api/health")
    if not runtime.get("requirements"):
        add_failure(failures, "runtimePolicy.requirements must not be empty")
    modes = runtime.get("allowedModes") or []
    mode_ids = [mode.get("id") for mode in modes if isinstance(mode, dict)]
    for required in ["standalone_vm", "hermes_connected_vm", "mac_companion"]:
        if required not in mode_ids:
            add_failure(failures, f"runtimePolicy.allowedModes missing {required}")


def validate_shared_capabilities(manifest: dict[str, Any], failures: list[str]) -> set[str]:
    shared = manifest.get("sharedCapabilities") or []
    ids = [item.get("id") for item in shared if isinstance(item, dict)]
    if has_duplicates(ids):
        add_failure(failures, "sharedCapabilities IDs must be unique")
    for item in shared:
        if not isinstance(item, dict):
            add_failure(failures, "sharedCapabilities entries must be objects")
            continue
        if not item.get("id") or not item.get("label") or not item.get("rule"):
            add_failure(failures, f"sharedCapability {item.get('id') or '<missing>'} needs id, label and rule")
    return set(ids)


def validate_active_domain(domain: dict[str, Any], capability_ids: set[str], failures: list[str]) -> None:
    domain_id = domain.get("id") or "<missing>"
    source = domain.get("sourceOfTruth")
    if not source:
        add_failure(failures, f"{domain_id}: active domain needs sourceOfTruth")
    elif not (ROOT / source).exists():
        add_failure(failures, f"{domain_id}: sourceOfTruth does not exist: {source}")

    deployment = domain.get("deployment") or {}
    if deployment.get("target") != "proxmox_vm":
        add_failure(failures, f"{domain_id}: deployment.target must be proxmox_vm")
    if deployment.get("health") != "/api/health":
        add_failure(failures, f"{domain_id}: deployment.health must be /api/health")
    for key in ["serviceName", "privatePort", "backupScript", "restoreDrillScript"]:
        if not deployment.get(key):
            add_failure(failures, f"{domain_id}: deployment.{key} missing")

    for key in ["dashboardUrl", "displayUrl", "apis", "checks", "guardrails"]:
        if not domain.get(key):
            add_failure(failures, f"{domain_id}: {key} must not be empty")

    capabilities = set(domain.get("sharedCapabilities") or [])
    missing = REQUIRED_ACTIVE_CAPABILITIES - capabilities
    if missing:
        add_failure(failures, f"{domain_id}: active domain missing capabilities: {', '.join(sorted(missing))}")
    unknown = capabilities - capability_ids
    if unknown:
        add_failure(failures, f"{domain_id}: unknown capabilities: {', '.join(sorted(unknown))}")

    gbrain = domain.get("gbrain") or {}
    hermes = domain.get("hermes") or {}
    if not gbrain.get("exportCommand") or not gbrain.get("syncCommand"):
        add_failure(failures, f"{domain_id}: gbrain export/sync commands missing")
    if not hermes.get("contextCommand"):
        add_failure(failures, f"{domain_id}: hermes context command missing")


def validate_planned_domain(domain: dict[str, Any], capability_ids: set[str], failures: list[str]) -> None:
    domain_id = domain.get("id") or "<missing>"
    for key in REQUIRED_PLANNED_FIELDS:
        if key not in domain:
            add_failure(failures, f"{domain_id}: planned domain missing {key}")
    if domain.get("plannedOnly") is not True:
        add_failure(failures, f"{domain_id}: planned domain must be marked plannedOnly")
    if domain.get("sourceOfTruth") is not None:
        add_failure(failures, f"{domain_id}: planned domain must not have real sourceOfTruth yet")
    deployment_plan = domain.get("deploymentPlan") or {}
    if deployment_plan.get("target") != "proxmox_vm":
        add_failure(failures, f"{domain_id}: deploymentPlan.target must be proxmox_vm")
    if not deployment_plan.get("startRule"):
        add_failure(failures, f"{domain_id}: deploymentPlan.startRule missing")
    if not domain.get("expectedData"):
        add_failure(failures, f"{domain_id}: expectedData must not be empty")
    if not domain.get("guardrails"):
        add_failure(failures, f"{domain_id}: guardrails must not be empty")
    capabilities = set(domain.get("sharedCapabilities") or [])
    unknown = capabilities - capability_ids
    if unknown:
        add_failure(failures, f"{domain_id}: unknown capabilities: {', '.join(sorted(unknown))}")
    if "runtime" not in capabilities or "gbrain" not in capabilities:
        add_failure(failures, f"{domain_id}: planned domain should reserve runtime and gbrain capabilities")


def validate_domains(manifest: dict[str, Any], capability_ids: set[str], failures: list[str]) -> None:
    domains = manifest.get("domains") or []
    ids = [domain.get("id") for domain in domains if isinstance(domain, dict)]
    if has_duplicates(ids):
        add_failure(failures, "domain IDs must be unique")
    if not any(domain.get("status") == "active" for domain in domains if isinstance(domain, dict)):
        add_failure(failures, "at least one active domain is required")

    for domain in domains:
        if not isinstance(domain, dict):
            add_failure(failures, "domain entries must be objects")
            continue
        domain_id = domain.get("id") or "<missing>"
        status = domain.get("status")
        if status == "active":
            validate_active_domain(domain, capability_ids, failures)
        elif status == "planned":
            validate_planned_domain(domain, capability_ids, failures)
        else:
            add_failure(failures, f"{domain_id}: status must be active or planned")


def validate_lifecycle(manifest: dict[str, Any], failures: list[str]) -> None:
    phases = manifest.get("domainLifecycle") or []
    phase_ids = [phase.get("id") for phase in phases if isinstance(phase, dict)]
    for required in REQUIRED_LIFECYCLE_PHASES:
        if required not in phase_ids:
            add_failure(failures, f"domainLifecycle missing phase {required}")
    for phase in phases:
        if not isinstance(phase, dict):
            add_failure(failures, "domainLifecycle entries must be objects")
            continue
        for key in ["id", "label", "entryRule", "exitRule"]:
            if not phase.get(key):
                add_failure(failures, f"domainLifecycle {phase.get('id') or '<missing>'}: {key} missing")

    template = manifest.get("newDomainTemplate") or {}
    for key in ["doc", "minimumManifestFields", "requiredDecisions", "firstArtifacts", "acceptanceChecks"]:
        if not template.get(key):
            add_failure(failures, f"newDomainTemplate.{key} missing")
    doc = template.get("doc")
    if doc and not (ROOT / doc).exists():
        add_failure(failures, f"newDomainTemplate.doc does not exist: {doc}")


def build_report() -> dict[str, Any]:
    manifest = load_json(MANIFEST_FILE)
    failures: list[str] = []
    validate_runtime(manifest, failures)
    capability_ids = validate_shared_capabilities(manifest, failures)
    validate_domains(manifest, capability_ids, failures)
    validate_lifecycle(manifest, failures)
    if not manifest.get("domainContract"):
        add_failure(failures, "domainContract must not be empty")
    return {
        "ok": not failures,
        "manifest": str(MANIFEST_FILE),
        "domains": [domain.get("id") for domain in manifest.get("domains") or []],
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Owner Operations tree")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    report = build_report()
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    elif report["ok"]:
        print(f"Operations tree check passed: {len(report['domains'])} domains, lifecycle and domain template are consistent.")
    else:
        print("Operations tree check failed:")
        for failure in report["failures"]:
            print(f"- {failure}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
