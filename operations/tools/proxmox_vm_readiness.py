#!/usr/bin/env python3
"""Validate that the project is ready for a Proxmox VM dry run."""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_FILE = ROOT / "data" / "markus-operations-manifest.json"
PACKAGE_FILE = ROOT / "package.json"


REQUIRED_FILES = [
    "AGENTS.md",
    "deploy/proxmox/README.md",
    "deploy/proxmox/airbnb-hoa.env.example",
    "deploy/proxmox/airbnb-hoa.service.example",
    "deploy/proxmox/nginx-airbnb-hoa.conf.example",
    "deploy/proxmox/preflight-airbnb-hoa.sh",
    "deploy/proxmox/install-airbnb-hoa.sh",
    "deploy/proxmox/backup-airbnb-hoa.sh",
    "deploy/proxmox/restore-drill-airbnb-hoa.sh",
    "ops/new-domain-playbook.md",
    "tools/health_check.py",
    "tools/operations_tree_check.py",
    "tools/smoke_check.py",
    "server.mjs",
    "data/markus-operations-manifest.json",
]


REQUIRED_SCRIPTS = [
    "health:check",
    "operations:check",
    "test:smoke",
    "proxmox:readiness",
    "proxmox:preflight",
    "proxmox:install:dry-run",
    "proxmox:backup:dry-run",
    "proxmox:restore:dry-run",
]


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def add(items: list[dict[str, str]], status: str, label: str, detail: str) -> None:
    items.append({"status": status, "label": label, "detail": detail})


def check_health(base_url: str) -> dict[str, Any]:
    with urllib.request.urlopen(base_url.rstrip("/") + "/api/health", timeout=15) as response:
        return json.load(response)


def build_report(base_url: str | None = None) -> dict[str, Any]:
    items: list[dict[str, str]] = []

    for relative in REQUIRED_FILES:
        path = ROOT / relative
        add(items, "ok" if path.exists() else "error", f"file:{relative}", "present" if path.exists() else "missing")

    manifest = load_json(MANIFEST_FILE)
    runtime = manifest.get("runtimePolicy") or {}
    add(
        items,
        "ok" if runtime.get("defaultTarget") == "proxmox_vm" else "error",
        "runtime default",
        str(runtime.get("defaultTarget")),
    )
    add(
        items,
        "ok" if runtime.get("healthApi") == "/api/health" else "error",
        "runtime health api",
        str(runtime.get("healthApi")),
    )

    domains = manifest.get("domains") or []
    for domain in domains:
        deployment = domain.get("deployment") or domain.get("deploymentPlan") or {}
        expected = deployment.get("target") == "proxmox_vm"
        add(items, "ok" if expected else "error", f"domain:{domain.get('id')}", f"target={deployment.get('target')}")

    package = load_json(PACKAGE_FILE)
    scripts = package.get("scripts") or {}
    for script in REQUIRED_SCRIPTS:
        add(items, "ok" if script in scripts else "error", f"script:{script}", scripts.get(script, "missing"))

    if base_url:
        try:
            health = check_health(base_url)
            runtime_info = health.get("runtime") or {}
            add(
                items,
                "ok" if health.get("ok") else "error",
                "health endpoint",
                f"status={health.get('status')} target={runtime_info.get('target')} mode={runtime_info.get('deploymentMode')}",
            )
        except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
            add(items, "error", "health endpoint", str(exc))

    overall = "ok" if all(item["status"] == "ok" for item in items) else "error"
    return {"ok": overall == "ok", "overall": overall, "items": items}


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Proxmox VM readiness")
    parser.add_argument("--base-url", default="http://127.0.0.1:4327", help="Optional running app URL for health validation")
    parser.add_argument("--skip-health", action="store_true", help="Do not call /api/health")
    parser.add_argument("--json", action="store_true", help="Print JSON report")
    args = parser.parse_args()

    report = build_report(None if args.skip_health else args.base_url)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(f"Proxmox VM readiness: {report['overall']}")
        for item in report["items"]:
            prefix = "OK" if item["status"] == "ok" else "FAIL"
            print(f"{prefix} {item['label']}: {item['detail']}")
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
