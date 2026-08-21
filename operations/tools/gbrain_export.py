#!/usr/bin/env python3
"""Export safe Airbnb HOA knowledge pages for GBrain.

The export is intentionally summary-first. It captures operational knowledge
without copying raw private transcripts, IDs, completed HOA forms, tokens, or
attachments into GBrain.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
STATE_FILE = ROOT / "data" / "airbnb-hoa-state.json"
CALENDAR_FILE = ROOT / "data" / "airbnb-florida-calendar-snapshot.json"
OPERATIONS_MANIFEST_FILE = ROOT / "data" / "markus-operations-manifest.json"
OPERATIONS_ARCHITECTURE_FILE = ROOT / "ops" / "markus-operations-architecture.md"
NEW_DOMAIN_PLAYBOOK_FILE = ROOT / "ops" / "new-domain-playbook.md"
PROXMOX_DEPLOYMENT_FILE = ROOT / "deploy" / "proxmox" / "README.md"
PROXMOX_DRY_RUN_REPORT_FILE = ROOT / "ops" / "proxmox-vm-dry-run-report.md"
DESIGN_FILE = ROOT / "DESIGN.md"
PRODUCT_READINESS_FILE = ROOT / "ops" / "product-readiness.md"
PACKAGE_DIR = ROOT / "gbrain-import" / "airbnb-hoa-operations"
GENERATED_DIR = PACKAGE_DIR / "generated"

sys.path.insert(0, str(ROOT / "tools"))
import daily_watch  # noqa: E402
import integration_status  # noqa: E402


def load_json(path: Path, fallback: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def today_panama() -> date:
    return datetime.now(ZoneInfo("America/Panama")).date()


def parse_day(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value[:10])


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "item"


def yaml_list(values: list[str]) -> str:
    return "\n".join(f"  - {value}" for value in values)


def frontmatter(title: str, page_type: str, tags: list[str]) -> str:
    return f"---\ntitle: {json.dumps(title, ensure_ascii=False)}\ntype: {page_type}\ntags:\n{yaml_list(tags)}\n---\n"


def line(value: Any) -> str:
    text = str(value if value is not None and value != "" else "-")
    return text.replace("\n", " ").strip()


def format_bool(value: Any) -> str:
    return "ja" if value else "nein"


def checklist_missing(case: dict[str, Any]) -> list[str]:
    labels = {
        "airbnbInitialMessage": "Airbnb-Erstnachricht",
        "guestAcknowledged": "Gast hat HOA-Prozess bestaetigt",
        "packetSent": "Dokumentpaket gesendet",
        "leaseApplication": "Lease Application",
        "backgroundAuthorization": "Background Authorization",
        "shortTermLeaseTenantSigned": "Short-Term Lease Tenant-Signatur",
        "shortTermLeaseOwnerSigned": "Short-Term Lease Owner-Signatur",
        "rulesSent": "Rules and Regulations gesendet",
        "photoIds": "Photo IDs / supporting documents",
        "feeTracked": "USD 100 Fee / Check",
        "submittedToHoa": "Einreichung bei HOA",
        "boardApproval": "Board Approval",
    }
    checklist = case.get("checklist") or {}
    return [label for key, label in labels.items() if not checklist.get(key)]


DOCUMENT_LABELS = {
    "leaseApplication": "Lease Application",
    "backgroundAuthorization": "Background Authorization",
    "shortTermLeaseTenantSigned": "Short-Term Lease Tenant",
    "shortTermLeaseOwnerSigned": "Short-Term Lease Owner",
    "rulesSent": "Rules and Regulations",
    "photoIds": "Photo IDs / Supporting Docs",
    "feeTracked": "USD 100 HOA Fee",
    "submittedToHoa": "Submitted to HOA",
    "boardApproval": "Board Approval",
}


def document_status_lines(case: dict[str, Any]) -> list[str]:
    document_status = case.get("documentStatus") or {}
    checklist = case.get("checklist") or {}
    lines: list[str] = []
    for key, label in DOCUMENT_LABELS.items():
        entry = document_status.get(key) or {}
        status = entry.get("status")
        if not status:
            status = "complete" if checklist.get(key) else "missing"
        lines.append(f"- {label}: {line(status)}" + (f", updated {line(entry.get('updatedAt'))}" if entry.get("updatedAt") else ""))
    return lines


def payment_for_case(case: dict[str, Any], payments: list[dict[str, Any]]) -> dict[str, Any] | None:
    for payment in payments:
        if payment.get("caseId") == case.get("id"):
            return payment
        if case.get("reservationCode") and payment.get("reservationCode") == case.get("reservationCode"):
            return payment
    return None


def section(title: str, lines: list[str]) -> str:
    body = "\n".join(lines) if lines else "- Keine Daten"
    return f"## {title}\n\n{body}\n"


def bullet(label: str, value: Any) -> str:
    return f"- {label}: {line(value)}"


def write_page(path: Path, content: str) -> dict[str, str]:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.rstrip() + "\n", encoding="utf-8")
    relative = path.relative_to(PACKAGE_DIR)
    slug = path.stem.replace("-", "/", 1)
    return {"path": str(relative), "slugGuess": slug}


def case_page(case: dict[str, Any], payments: list[dict[str, Any]], generated_at: str) -> str:
    guest = case.get("guestName") or case.get("id") or "Airbnb guest"
    page_title = f"Airbnb HOA Case - {guest}"
    payment = payment_for_case(case, payments) or {}
    gmail = case.get("gmail") or {}
    missing = checklist_missing(case)
    timeline = case.get("timeline") or []
    communication = case.get("communicationEvidence") or []

    lines: list[str] = [
        frontmatter(page_title, "airbnb-hoa-case", ["airbnb", "hoa", "case", "palma-del-mar", "rental-approval"]),
        f"# {page_title}",
        "",
        "Source of truth: [[projects/airbnb-hoa-operations]]. This page is generated from the local app state and should not contain raw forms, IDs, full attachments, tokens, or long chat transcripts.",
        "",
        section(
            "Case",
            [
                bullet("Generated", generated_at),
                bullet("Case ID", case.get("id")),
                bullet("Guest", guest),
                bullet("Stay", f"{case.get('start')} to {case.get('end')}"),
                bullet("Reservation", case.get("reservationCode") or "unknown"),
                bullet("Adults", case.get("adults") or "unknown"),
                bullet("Status", case.get("status")),
                bullet("Check-in locked", format_bool(case.get("checkInLocked"))),
                bullet("Board Approval", format_bool((case.get("checklist") or {}).get("boardApproval"))),
            ],
        ),
        section(
            "Deadlines",
            [
                bullet("Document packet sent", case.get("documentPacketSentAt")),
                bullet("Documents due", case.get("deadlineDocuments")),
                bullet("Cancellation review", case.get("cancellationReviewAt")),
                bullet("Airbnb support target", case.get("airbnbSupportAt")),
                bullet("Decision by", case.get("decisionBy")),
            ],
        ),
        section("Missing / Blocking", [f"- {item}" for item in missing] or ["- None"]),
        section("Document Status", document_status_lines(case)),
        section(
            "Gmail / HOA Status",
            [
                bullet("Last checked", gmail.get("lastCheckedAt")),
                bullet("Reply status", gmail.get("replyStatus")),
                bullet("HOA status", gmail.get("hoaStatus")),
                bullet("Draft ID", gmail.get("outboundDraftId") or case.get("reminderDraftId") or "-"),
                bullet("Search terms", " | ".join(gmail.get("searchTerms") or [])),
            ],
        ),
        section(
            "Airbnb Payment",
            [
                bullet("Payment status", payment.get("status") or "not stored"),
                bullet("Expected payout", f"{payment.get('expectedPayout') or '-'} {payment.get('currency') or ''}".strip()),
                bullet("Expected date", payment.get("expectedPayoutDate")),
                bullet("Received payout", f"{payment.get('receivedPayout') or '-'} {payment.get('currency') or ''}".strip()),
                bullet("Received at", payment.get("receivedAt")),
                bullet("Cleaning cost", payment.get("cleaningCostAmount")),
                bullet("Notes", payment.get("notes")),
            ],
        ),
        section(
            "Communication Evidence",
            [
                f"- {entry.get('date')} / {entry.get('channel')} / {entry.get('direction', 'unknown')}: {line(entry.get('summary'))}"
                + (f" Impact: {line(entry.get('impact'))}" if entry.get("impact") else "")
                for entry in communication
            ]
            or ["- No compact WhatsApp/iMessage/Airbnb evidence stored for this case."],
        ),
        section(
            "Timeline",
            [f"- {entry.get('date')}: {line(entry.get('text'))}" for entry in timeline] or ["- No timeline entries stored."],
        ),
        section(
            "Recommendation",
            [f"- {line(case.get('hermesRecommendation') or 'Do not release check-in before Board Approval is documented.')}"],
        ),
    ]
    return "\n".join(lines)


def current_state_page(state: dict[str, Any], calendar: dict[str, Any], daily: dict[str, Any], generated_at: str) -> str:
    cases = state.get("cases") or []
    open_cases = [case for case in cases if case.get("status") != "approved"]
    property_info = state.get("property") or {}
    calendar_events = calendar.get("events") or []
    return "\n".join(
        [
            frontmatter(
                "Airbnb HOA Current Operating State",
                "project-index",
                ["airbnb", "hoa", "current-state", "palma-del-mar", "operations"],
            ),
            "# Airbnb HOA Current Operating State",
            "",
            "Generated summary for GBrain. Use it to recover the latest operational state without reading raw app JSON.",
            "",
            section(
                "Property",
                [
                    bullet("Unit", property_info.get("unit")),
                    bullet("Address", property_info.get("address")),
                    bullet("HOA", property_info.get("hoaName")),
                    bullet("Management", property_info.get("management")),
                    bullet("HOA email", property_info.get("hoaEmail")),
                    bullet("Tenant Evaluation code", property_info.get("tenantEvaluationCode")),
                ],
            ),
            section(
                "Snapshot",
                [
                    bullet("Generated", generated_at),
                    bullet("Cases", len(cases)),
                    bullet("Open cases", len(open_cases)),
                    bullet("Calendar events", len(calendar_events)),
                    bullet("Daily red", (daily.get("summary") or {}).get("red")),
                    bullet("Daily amber", (daily.get("summary") or {}).get("amber")),
                ],
            ),
            section(
                "Cases",
                [
                    f"- [[cases/airbnb-hoa-{case.get('id')}]]: {line(case.get('guestName'))}, {case.get('start')} to {case.get('end')}, status {case.get('status')}, check-in locked {format_bool(case.get('checkInLocked'))}"
                    for case in cases
                ],
            ),
            section(
                "Hard Guardrail",
                [
                    "- Check-in/access information must stay locked until Board Approval is documented.",
                    "- Hermes/GBrain may remember evidence and recommendations, but must not mark Board Approval or send messages automatically.",
                ],
            ),
        ]
    )


def daily_page(daily: dict[str, Any], generated_at: str) -> str:
    items = daily.get("items") or []
    return "\n".join(
        [
            frontmatter("Airbnb HOA Daily Risk Queue", "operations", ["airbnb", "hoa", "daily-check", "risk"]),
            "# Airbnb HOA Daily Risk Queue",
            "",
            f"Generated: {generated_at}",
            "",
            section(
                "Summary",
                [bullet(key, value) for key, value in sorted((daily.get("summary") or {}).items())],
            ),
            section(
                "Risk Items",
                [
                    f"- [{line(item.get('level')).upper()}] {line(item.get('title'))}: {line(item.get('detail'))} Due: {line(item.get('due'))} Case: {line(item.get('caseId'))}"
                    for item in items
                ]
                or ["- No red or amber items."],
            ),
        ]
    )


def integration_page(report: dict[str, Any], generated_at: str) -> str:
    items = report.get("items") or []
    return "\n".join(
        [
            frontmatter("Airbnb HOA Integration Status", "operations", ["airbnb", "hoa", "integrations", "hermes", "gbrain"]),
            "# Airbnb HOA Integration Status",
            "",
            f"Generated: {generated_at}",
            "",
            section(
                "Overall",
                [
                    bullet("Status", report.get("overall")),
                    bullet("Report generated at", report.get("generatedAt")),
                ],
            ),
            section(
                "Items",
                [
                    f"- [{line(item.get('status')).upper()}] {line(item.get('label'))}: {line(item.get('title'))}. {line(item.get('detail'))}"
                    + (f" Action: {line(item.get('action'))}" if item.get("action") else "")
                    for item in items
                ],
            ),
        ]
    )


def inbox_page(state: dict[str, Any], generated_at: str) -> str:
    items = state.get("inboxItems") or []
    open_items = [item for item in items if item.get("status", "new") not in {"applied", "ignored"}]
    return "\n".join(
        [
            frontmatter("Airbnb HOA Inbox / New Inputs", "operations", ["airbnb", "hoa", "inbox", "hermes", "communication"]),
            "# Airbnb HOA Inbox / New Inputs",
            "",
            f"Generated: {generated_at}",
            "",
            section(
                "Rule",
                [
                    "- New Gmail, Hermes, WhatsApp, iMessage, Airbnb, HOA, payment, cleaning, or maintenance findings should first become compact review items.",
                    "- Inbox items are evidence pointers, not automatic case approval.",
                    "- Do not store raw transcripts, completed forms, passports, IDs, tokens, or long attachments.",
                ],
            ),
            section(
                "Open Items",
                [
                    f"- [{line(item.get('priority') or 'medium').upper()}] {line(item.get('title'))}: {line(item.get('summary'))}. Case: {line(item.get('caseId'))}. Channel: {line(item.get('channel'))}. Status: {line(item.get('status') or 'new')}"
                    for item in open_items
                ]
                or ["- No open inbox items."],
            ),
        ]
    )


def display_surfaces_page(generated_at: str) -> str:
    return "\n".join(
        [
            frontmatter("Airbnb HOA Display And Device Surfaces", "operations", ["airbnb", "hoa", "display", "voice", "home-assistant"]),
            "# Airbnb HOA Display And Device Surfaces",
            "",
            f"Generated: {generated_at}",
            "",
            section(
                "Formats",
                [
                    "- Editing dashboard: `http://127.0.0.1:4327/`.",
                    "- Large read-only display: `http://127.0.0.1:4327/display`.",
                    "- Machine status for Hermes and display controllers: `GET /api/display-state`.",
                    "- Device URL/status discovery: `GET /api/display-info`.",
                    "- Voice/TTS short brief for Hermes: `GET /api/voice-brief`.",
                    "- Calendar deadlines: `[Airbnb HOA]` events in the Mac/iPhone `Florida` calendar.",
                ],
            ),
            section(
                "Recommended Open Source Layers",
                [
                    "- Home Assistant for voice/device orchestration and Cast/browser automations.",
                    "- Browser Mod for registered browsers/tablets.",
                    "- WallPanel for Android/Fire tablets.",
                    "- Anthias/Screenly OSE for TV or monitor signage.",
                    "- MagicMirror2 for fixed information displays.",
                    "- catt/PyChromecast for direct Chromecast targets when configured.",
                ],
            ),
            section(
                "Security",
                [
                    "- Do not expose the app through a router port forwarding rule.",
                    "- LAN display is optional and should only be enabled deliberately in a trusted private network.",
                    "- Remote viewing should use VPN, Tailscale, another private overlay, or an explicitly approved Hermes relay.",
                    "- Display voice intents must not edit cases, send messages, mark Board Approval, or unlock check-in.",
                ],
            ),
        ]
    )


def design_system_page(generated_at: str) -> str:
    design_text = DESIGN_FILE.read_text(encoding="utf-8") if DESIGN_FILE.exists() else ""
    return "\n".join(
        [
            frontmatter("Airbnb HOA Design System", "operations", ["airbnb", "hoa", "design", "ui", "display"]),
            "# Airbnb HOA Design System",
            "",
            f"Generated: {generated_at}",
            "",
            "This page preserves the safe UI/design rules for future AI work. It contains no secrets or private guest documents.",
            "",
            design_text.strip() if design_text.strip() else "No DESIGN.md found.",
        ]
    )


def product_readiness_page(generated_at: str) -> str:
    readiness_text = PRODUCT_READINESS_FILE.read_text(encoding="utf-8") if PRODUCT_READINESS_FILE.exists() else ""
    return "\n".join(
        [
            frontmatter("Airbnb HOA Product Readiness", "operations", ["airbnb", "hoa", "product", "readiness", "qa"]),
            "# Airbnb HOA Product Readiness",
            "",
            f"Generated: {generated_at}",
            "",
            "Safe product readiness summary for future AI work. It contains no secrets or private guest documents.",
            "",
            readiness_text.strip() if readiness_text.strip() else "No product-readiness.md found.",
        ]
    )


def operations_tree_page(generated_at: str) -> str:
    manifest = load_json(OPERATIONS_MANIFEST_FILE, {"domains": [], "sharedCapabilities": []})
    architecture_text = OPERATIONS_ARCHITECTURE_FILE.read_text(encoding="utf-8") if OPERATIONS_ARCHITECTURE_FILE.exists() else ""
    domains = manifest.get("domains") or []
    shared = manifest.get("sharedCapabilities") or []
    runtime_policy = manifest.get("runtimePolicy") or {}
    lifecycle = manifest.get("domainLifecycle") or []
    template = manifest.get("newDomainTemplate") or {}
    return "\n".join(
        [
            frontmatter("Owner Operations Arbeitsbaum", "operations", ["markus", "operations", "architecture", "hermes", "gbrain"]),
            "# Owner Operations Arbeitsbaum",
            "",
            f"Generated: {generated_at}",
            "",
            "This page preserves the cross-domain structure for future AI work. Planned Panama house and Panama vehicle domains are placeholders only; they contain no real private data.",
            "",
            section(
                "Domains",
                [
                    f"- {line(domain.get('id'))} / {line(domain.get('label'))}: status {line(domain.get('status'))}, runtime {line((domain.get('deployment') or domain.get('deploymentPlan') or {}).get('target') or runtime_policy.get('defaultTarget'))}, source {line(domain.get('sourceOfTruth') or 'not started')}. {line(domain.get('scope'))}"
                    for domain in domains
                ]
                or ["- No domains registered."],
            ),
            section(
                "Runtime Policy",
                [
                    bullet("Default target", runtime_policy.get("defaultTarget")),
                    bullet("Health API", runtime_policy.get("healthApi")),
                    bullet("Deployment docs", runtime_policy.get("deploymentDocs")),
                    bullet("Readiness command", runtime_policy.get("readinessCommand")),
                    bullet("Install dry run", runtime_policy.get("installDryRunCommand")),
                    bullet("Backup dry run", runtime_policy.get("backupDryRunCommand")),
                    bullet("Restore dry run", runtime_policy.get("restoreDryRunCommand")),
                    *[f"- Requirement: {line(item)}" for item in runtime_policy.get("requirements") or []],
                ],
            ),
            section(
                "Shared Capabilities",
                [
                    f"- {line(item.get('id'))}: {line(item.get('label'))}. Rule: {line(item.get('rule'))}"
                    for item in shared
                ]
                or ["- No shared capabilities registered."],
            ),
            section(
                "Domain Contract",
                [f"- {line(item)}" for item in manifest.get("domainContract") or []],
            ),
            section(
                "Domain Lifecycle",
                [
                    f"- {line(phase.get('id'))}: {line(phase.get('label'))}. Entry: {line(phase.get('entryRule'))} Exit: {line(phase.get('exitRule'))}"
                    for phase in lifecycle
                ]
                or ["- No lifecycle registered."],
            ),
            section(
                "New Domain Template",
                [
                    bullet("Playbook", template.get("doc")),
                    bullet("Acceptance checks", " | ".join(template.get("acceptanceChecks") or [])),
                    *[f"- Required decision: {line(item)}" for item in template.get("requiredDecisions") or []],
                ],
            ),
            "## Architecture Notes",
            "",
            architecture_text.strip() if architecture_text.strip() else "No architecture document found.",
        ]
    )


def new_domain_playbook_page(generated_at: str) -> str:
    playbook_text = NEW_DOMAIN_PLAYBOOK_FILE.read_text(encoding="utf-8") if NEW_DOMAIN_PLAYBOOK_FILE.exists() else ""
    return "\n".join(
        [
            frontmatter("Owner Operations New Domain Playbook", "operations", ["markus", "operations", "playbook", "domains", "proxmox"]),
            "# Owner Operations New Domain Playbook",
            "",
            f"Generated: {generated_at}",
            "",
            "Safe start template for future AI and Hermes work. It contains no secrets and does not authorize real integrations, migrations, or device moves by itself.",
            "",
            playbook_text.strip() if playbook_text.strip() else "No ops/new-domain-playbook.md found.",
        ]
    )


def proxmox_deployment_page(generated_at: str) -> str:
    proxmox_text = PROXMOX_DEPLOYMENT_FILE.read_text(encoding="utf-8") if PROXMOX_DEPLOYMENT_FILE.exists() else ""
    dry_run_text = PROXMOX_DRY_RUN_REPORT_FILE.read_text(encoding="utf-8") if PROXMOX_DRY_RUN_REPORT_FILE.exists() else ""
    return "\n".join(
        [
            frontmatter("Owner Operations Proxmox Deployment", "operations", ["markus", "operations", "proxmox", "deployment", "runtime"]),
            "# Owner Operations Proxmox Deployment",
            "",
            f"Generated: {generated_at}",
            "",
            "Safe deployment runbook for future AI work. It contains no secrets and does not authorize an actual migration by itself.",
            "",
            proxmox_text.strip() if proxmox_text.strip() else "No deploy/proxmox/README.md found.",
            "",
            "## Latest Dry Run Report",
            "",
            dry_run_text.strip() if dry_run_text.strip() else "No Proxmox dry-run report found.",
        ]
    )


def payments_page(state: dict[str, Any], generated_at: str) -> str:
    payments = (state.get("payments") or {}).get("items") or []
    return "\n".join(
        [
            frontmatter("Airbnb HOA Payments By Tenant", "operations", ["airbnb", "hoa", "payments", "payouts"]),
            "# Airbnb HOA Payments By Tenant",
            "",
            f"Generated: {generated_at}",
            "",
            section(
                "Payment Items",
                [
                    f"- {line(payment.get('guestName'))} / {line(payment.get('reservationCode'))}: status {line(payment.get('status'))}, expected {line(payment.get('expectedPayout'))} {line(payment.get('currency'))}, received {line(payment.get('receivedPayout'))}, checked {line(payment.get('lastCheckedAt'))}. Notes: {line(payment.get('notes'))}"
                    for payment in payments
                ]
                or ["- No payment items stored."],
            ),
            section(
                "Rule",
                [
                    "- Payout amounts must come from Airbnb financials or deliberate manual entry.",
                    "- HOA application fee is tenant-paid and is not a host payout.",
                ],
            ),
        ]
    )


def cleaning_page(state: dict[str, Any], generated_at: str) -> str:
    cleaning = state.get("cleaning") or {}
    projects = cleaning.get("projects") or []
    primary = cleaning.get("primaryCleaner") or {}
    return "\n".join(
        [
            frontmatter("Airbnb HOA Cleaning / Turno", "operations", ["airbnb", "hoa", "turno", "cleaning"]),
            "# Airbnb HOA Cleaning / Turno",
            "",
            f"Generated: {generated_at}",
            "",
            section(
                "Provider",
                [
                    bullet("Provider", cleaning.get("provider")),
                    bullet("Property", cleaning.get("property")),
                    bullet("Primary cleaner", primary.get("name") or primary.get("displayName")),
                    bullet("Default charge", cleaning.get("defaultCharge") or cleaning.get("defaultRate")),
                    bullet("Last email review", cleaning.get("lastEmailReviewAt")),
                ],
            ),
            section(
                "Projects",
                [
                    f"- Turno #{line(project.get('projectId'))}: {line(project.get('date'))}, {line(project.get('status'))}, cleaner {line(project.get('cleaner'))}, amount {line(project.get('amount') or project.get('rate'))}. {line(project.get('note'))}"
                    for project in projects
                ]
                or ["- No Turno projects stored."],
            ),
        ]
    )


def maintenance_page(state: dict[str, Any], generated_at: str) -> str:
    items = state.get("maintenanceItems") or []

    def maintenance_line(item: dict[str, Any]) -> str:
        procurement = item.get("procurement") or {}
        hoa_compliance = item.get("hoaCompliance") or {}
        existing_appliance = procurement.get("existingAppliance") or {}
        service_verification = procurement.get("homeDepotServiceVerification") or {}
        local_provider_search = procurement.get("localProviderSearch") or {}
        service_providers = procurement.get("serviceProviderShortlist") or []
        shortlist = procurement.get("vendorShortlist") or []
        recommended = next(
            (option for option in shortlist if option.get("id") == procurement.get("recommendedOptionId")),
            shortlist[0] if shortlist else None,
        )
        existing_bits = [
            f"Existing appliance: {line(existing_appliance.get('brand'))} {line(existing_appliance.get('model'))}".strip()
            if existing_appliance.get("model")
            else "",
            f"Serial: {line(existing_appliance.get('serialNumber'))}" if existing_appliance.get("serialNumber") else "",
            f"Existing dimensions reference: {line(existing_appliance.get('referenceDimensions'))}" if existing_appliance.get("referenceDimensions") else "",
        ]
        vendor_bits = []
        service_bits = [
            f"Home Depot service status: {line(service_verification.get('status'))}" if service_verification.get("status") else "",
            f"Home Depot service summary: {line(service_verification.get('summary'))}" if service_verification.get("summary") else "",
            "Home Depot open checks: " + " | ".join(line(check) for check in service_verification.get("openChecksBeforeOrder") or []) if service_verification.get("openChecksBeforeOrder") else "",
        ]
        service_provider_bits = [
            f"Local service search conclusion: {line(local_provider_search.get('conclusion'))}" if local_provider_search.get("conclusion") else "",
            "Service provider shortlist: "
            + " | ".join(
                " ".join(
                    line(part)
                    for part in [
                        provider.get("provider"),
                        provider.get("role"),
                        provider.get("phone"),
                    ]
                    if part
                )
                for provider in service_providers
            )
            if service_providers
            else "",
            "Must confirm before order: " + " | ".join(line(check) for check in local_provider_search.get("mustConfirmBeforeOrder") or []) if local_provider_search.get("mustConfirmBeforeOrder") else "",
        ]
        if recommended:
            vendor_bits.append(
                "Recommended appliance: "
                + " ".join(
                    line(part)
                    for part in [
                        recommended.get("retailer"),
                        recommended.get("model"),
                        recommended.get("estimatedTotalPretax"),
                    ]
                    if part
                )
            )
        if shortlist:
            vendor_bits.append(
                "Shortlist: "
                + " | ".join(
                    " ".join(
                        line(part)
                        for part in [
                            option.get("retailer"),
                            option.get("model"),
                            option.get("estimatedTotalPretax"),
                        ]
                        if part
                    )
                    for option in shortlist
                )
            )
        procurement_bits = [
            f"Need: {line(procurement.get('need'))}" if procurement.get("need") else "",
            f"Delivery: {line(procurement.get('deliveryWindow'))}" if procurement.get("deliveryWindow") else "",
            "Installation required" if procurement.get("installationRequired") else "",
            "Haul-away/disposal required" if procurement.get("haulAwayOldAppliance") or procurement.get("disposalRequired") else "",
            f"Procurement status: {line(procurement.get('purchaseStatus'))}" if procurement.get("purchaseStatus") else "",
            f"Notes: {line(procurement.get('notes'))}" if procurement.get("notes") else "",
            *existing_bits,
            *service_bits,
            *service_provider_bits,
            *vendor_bits,
        ]
        hoa_bits = [
            f"HOA status: {line(hoa_compliance.get('status'))}" if hoa_compliance.get("status") else "",
            f"HOA operating assumption: {line(hoa_compliance.get('operatingAssumption'))}" if hoa_compliance.get("operatingAssumption") else "",
            "HOA questions: " + " | ".join(line(question) for question in hoa_compliance.get("questionsForManagement") or []) if hoa_compliance.get("questionsForManagement") else "",
        ]
        procurement_text = " ".join(bit for bit in procurement_bits if bit)
        hoa_text = " ".join(bit for bit in hoa_bits if bit)
        actions = " Next actions: " + " | ".join(line(action) for action in item.get("nextActions") or []) if item.get("nextActions") else ""
        return f"- [{line(item.get('status')).upper()} / {line(item.get('priority')).upper()}] {line(item.get('item'))} ({line(item.get('room'))}): {line(item.get('title'))}. Due {line(item.get('dueDate'))}. Case {line(item.get('caseId'))}. {line(item.get('description'))} {procurement_text} {hoa_text}{actions}"

    return "\n".join(
        [
            frontmatter("Airbnb HOA Maintenance And Defects", "operations", ["airbnb", "hoa", "maintenance", "defects"]),
            "# Airbnb HOA Maintenance And Defects",
            "",
            f"Generated: {generated_at}",
            "",
            section(
                "Items",
                [maintenance_line(item) for item in items]
                or ["- No maintenance items stored."],
            ),
        ]
    )


def telephony_page(state: dict[str, Any], generated_at: str) -> str:
    telephony = state.get("telephony") or {}
    contacts = telephony.get("contacts") or []
    calls = telephony.get("callLog") or []
    open_statuses = {"planned", "failed", "left_message"}
    return "\n".join(
        [
            frontmatter("Airbnb HOA Telephony And Google Fi", "operations", ["airbnb", "hoa", "telephony", "google-fi", "calls"]),
            "# Airbnb HOA Telephony And Google Fi",
            "",
            f"Generated: {generated_at}",
            "",
            section(
                "Policy",
                [
                    bullet("Provider", telephony.get("provider")),
                    bullet("Primary use", telephony.get("primaryUse")),
                    bullet("Web calls URL", telephony.get("webCallsUrl")),
                    bullet("Wi-Fi calling rule", telephony.get("wifiCallingRule")),
                    bullet("Guardrail", telephony.get("guardrail")),
                    "- The app prepares numbers and call notes only. Owner must manually confirm every call.",
                    "- Do not embed call recordings, long transcripts, phone account secrets, SIP credentials, or device admin passwords.",
                ],
            ),
            section(
                "Contacts",
                [
                    f"- {line(contact.get('label'))}: {line(contact.get('phone'))}. Context: {line(contact.get('context'))}"
                    for contact in contacts
                ]
                or ["- No telephony contacts stored."],
            ),
            section(
                "Open Calls",
                [
                    f"- [{line(call.get('status') or 'planned').upper()}] {line(call.get('date'))} {line(call.get('contact'))} / {line(call.get('phone'))}: {line(call.get('topic'))}. Next: {line(call.get('nextAction'))}. Project: {line(call.get('project'))}. Case: {line(call.get('caseId'))}"
                    for call in calls
                    if (call.get("status") or "planned") in open_statuses
                ]
                or ["- No open calls."],
            ),
            section(
                "Recent Call Notes",
                [
                    f"- [{line(call.get('status') or 'planned').upper()}] {line(call.get('date'))} {line(call.get('contact'))}: {line(call.get('topic'))}. Notes: {line(call.get('notes'))}"
                    for call in calls[:8]
                ]
                or ["- No call notes stored."],
            ),
        ]
    )


def listing_page(state: dict[str, Any], generated_at: str) -> str:
    listing = state.get("listingKnowledge") or {}
    capacity = listing.get("capacity") or {}
    return "\n".join(
        [
            frontmatter("Airbnb HOA Listing Knowledge", "operations", ["airbnb", "hoa", "listing", "property"]),
            "# Airbnb HOA Listing Knowledge",
            "",
            f"Generated: {generated_at}",
            "",
            section(
                "Listing",
                [
                    bullet("Title", listing.get("title")),
                    bullet("Source URL", listing.get("sourceUrl")),
                    bullet("Reviewed at", listing.get("reviewedAt")),
                    bullet("Summary", listing.get("summary")),
                    bullet("Capacity", f"{capacity.get('guests')} guests, {capacity.get('bedrooms')} bedroom, {capacity.get('beds')} bed, {capacity.get('baths')} bath"),
                    bullet("Minimum stay / HOA rule", capacity.get("minimumStay")),
                ],
            ),
            section("Advertised Amenities", [f"- {line(item)}" for item in listing.get("advertisedAmenities") or []]),
            section("Cleaning Checklist", [f"- {line(item)}" for item in listing.get("cleaningChecklist") or []]),
            section("Defect Priority Rules", [f"- {line(item)}" for item in listing.get("defectPriorityRules") or []]),
        ]
    )


def sync_policy_page(generated_at: str) -> str:
    return "\n".join(
        [
            frontmatter("Airbnb HOA GBrain Sync Policy", "tool", ["airbnb", "hoa", "gbrain", "sync", "policy"]),
            "# Airbnb HOA GBrain Sync Policy",
            "",
            f"Generated: {generated_at}",
            "",
            "This project uses GBrain as the durable memory for safe operational knowledge.",
            "",
            section(
                "What To Embed",
                [
                    "- Case summaries and deadlines.",
                    "- Safe Gmail/Airbnb/WhatsApp/iMessage evidence pointers.",
                    "- Document status and form-version knowledge.",
                    "- HOA rules and Board Approval requirements.",
                    "- Turno cleaning facts.",
                    "- Maintenance/defect facts.",
                    "- Airbnb payment status per tenant/case.",
                    "- Safe telephony facts: contact, phone number, topic, status, and next action.",
                ],
            ),
            section(
                "What Not To Embed",
                [
                    "- Raw passports, IDs, driver license images, completed forms, or background-check contents.",
                    "- OAuth tokens, iCal URLs, passwords, API keys, or secrets.",
                    "- Long private chat transcripts.",
                    "- Call recordings or long call transcripts.",
                    "- Raw attachments unless Owner explicitly decides to store a redacted source document.",
                ],
            ),
            section(
                "Operating Rule",
                [
                    "- After adding new forms, emails, cases, payments, cleaning facts, or maintenance issues, run `npm run gbrain:sync`.",
                    "- Hermes should consult GBrain before making HOA workflow recommendations.",
                    "- GBrain can preserve knowledge, but it must not send messages or unlock check-in.",
                ],
            ),
        ]
    )


def export_pages(output_dir: Path = GENERATED_DIR, today_value: date | None = None) -> dict[str, Any]:
    today_value = today_value or today_panama()
    generated_at = datetime.now(ZoneInfo("America/Panama")).isoformat(timespec="seconds")
    state = load_json(STATE_FILE, {"cases": []})
    calendar = load_json(CALENDAR_FILE, {"events": []})
    daily = daily_watch.analyze(state, calendar, today_value)
    integrations = integration_status.build_report()
    payments = (state.get("payments") or {}).get("items") or []

    output_dir.mkdir(parents=True, exist_ok=True)
    for old_page in output_dir.glob("*.md"):
        old_page.unlink()

    pages: list[dict[str, str]] = []
    pages.append(write_page(output_dir / "operations-markus-operations-tree.md", operations_tree_page(generated_at)))
    pages.append(write_page(output_dir / "operations-markus-new-domain-playbook.md", new_domain_playbook_page(generated_at)))
    pages.append(write_page(output_dir / "operations-markus-proxmox-deployment.md", proxmox_deployment_page(generated_at)))
    pages.append(write_page(output_dir / "projects-airbnb-hoa-current-state.md", current_state_page(state, calendar, daily, generated_at)))
    pages.append(write_page(output_dir / "operations-airbnb-hoa-daily-risk-queue.md", daily_page(daily, generated_at)))
    pages.append(write_page(output_dir / "operations-airbnb-hoa-integration-status.md", integration_page(integrations, generated_at)))
    pages.append(write_page(output_dir / "operations-airbnb-hoa-inbox.md", inbox_page(state, generated_at)))
    pages.append(write_page(output_dir / "operations-airbnb-hoa-display-surfaces.md", display_surfaces_page(generated_at)))
    pages.append(write_page(output_dir / "operations-airbnb-hoa-design-system.md", design_system_page(generated_at)))
    pages.append(write_page(output_dir / "operations-airbnb-hoa-product-readiness.md", product_readiness_page(generated_at)))
    pages.append(write_page(output_dir / "operations-airbnb-hoa-payments-by-tenant.md", payments_page(state, generated_at)))
    pages.append(write_page(output_dir / "operations-airbnb-hoa-cleaning-turno.md", cleaning_page(state, generated_at)))
    pages.append(write_page(output_dir / "operations-airbnb-hoa-maintenance-defects.md", maintenance_page(state, generated_at)))
    pages.append(write_page(output_dir / "operations-airbnb-hoa-telephony-google-fi.md", telephony_page(state, generated_at)))
    pages.append(write_page(output_dir / "operations-airbnb-hoa-listing-knowledge.md", listing_page(state, generated_at)))
    pages.append(write_page(output_dir / "tools-airbnb-hoa-gbrain-sync-policy.md", sync_policy_page(generated_at)))

    for case in state.get("cases") or []:
        page_name = f"cases-airbnb-hoa-{slugify(case.get('id') or case.get('guestName') or 'case')}.md"
        pages.append(write_page(output_dir / page_name, case_page(case, payments, generated_at)))

    manifest = {
        "generatedAt": generated_at,
        "today": today_value.isoformat(),
        "outputDir": str(output_dir),
        "operationsManifest": str(OPERATIONS_MANIFEST_FILE),
        "pages": pages,
        "safety": {
            "rawAttachments": False,
            "rawTranscripts": False,
            "secrets": False,
            "completedForms": False,
        },
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Export safe Airbnb HOA GBrain pages")
    parser.add_argument("--today", default=None, help="Override date as YYYY-MM-DD")
    parser.add_argument("--output-dir", type=Path, default=GENERATED_DIR)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    today_value = parse_day(args.today) if args.today else today_panama()
    if not today_value:
        raise SystemExit("Invalid --today")
    manifest = export_pages(args.output_dir, today_value)
    if args.json:
        print(json.dumps(manifest, indent=2, ensure_ascii=False))
    else:
        print(f"Generated {len(manifest['pages'])} GBrain pages in {manifest['outputDir']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
