# Hybrid reviewer: prepared, not activated

The portal and authoritative reservation records stay on their existing
Cloudflare deployment. The reviewer stays on its existing host. No service,
database, DNS, host or model migration is included. No new VM is required.

## Recovery contract

- The queue is derived from durable reservation content/context/package revisions.
  Nothing depends on a local task list surviving a power failure.
- `REVIEW_RELIABILITY=yes` on BOTH Pages and cron enables protocol 2 and reviewer
  health checks. It requires the approved atomic case-store cutover first.
  The older protocol remains available only while this flag is absent.
- A review claim is a case-version-checked write, with a random fencing token
  and a 15-minute lease. Other workers cannot claim the same revision. After a
  crash, the lease plus retry delay expires without any manual lock clearing.
- Failures retry after 5, 10, 20, 40, 80, 160, 320, then at most 360 minutes.
  Expired claims add that delay after lease expiry. There is no retry limit that
  silently abandons a guest. Three attempts or a day waiting raises an exception.
  Changed review inputs start a fresh attempt series; canceled cases never resume.
- A lost result acknowledgement is retried once with the same token and report.
  The server acknowledges an already-recorded result without overwriting it.
  A crash before recording a result may repeat a read-only model call later.
- E-MAIL DELIVERY IS DIFFERENT: no reviewer retry clears submission/reminder
  locks. Unknown SMTP outcomes require reconciliation, never blind resending.
- Each scan processes other cases even if one fails. Order is nearest arrival
  first. Runtime logs contain no names, applicant findings, URLs or credentials.
- Cloud cron checks reviewer heartbeats and unfinished work. No completed scan
  or no contact for 90 minutes is unhealthy. Seven-day arrival proximity is an
  operational warning, not a verified HOA deadline. No HOA approval is inferred.
- Health uses eventually consistent diagnostic KV, not the authorization lock.
  Existing 24-hour best-effort notification cooldown still applies. A completely
  stopped cloud scheduler needs the separate external health monitor planned in
  `REPAIR_STATUS.md`; this change does not configure that monitor.

## Existing-host service preparation

`scripts/reviewer_service.py` is a POSIX supervisor. It starts a scan immediately,
then checks every five minutes. Whole-scan failures back off up to thirty minutes.
It requires protocol 2, so a server missing the flag cannot silently run in the
less-protected mode. No packages are kept as a local queue.

Use the existing host's verified Python environment with PyMuPDF and the verified
Hermes CLI on PATH. This patch neither installs dependencies nor changes the model
or Hermes configuration. The command after approved installation is:

```text
/absolute/venv/bin/python /existing/portal/scripts/reviewer_service.py \
  --config /private/approved/reviewer.json \
  --state-dir /private/approved/isla-reviewer
```

`reviewer.json` must be a regular file owned by the service account, mode 0600.
Its JSON keys are `ISLA_PORTAL_ORIGIN`, `ISLA_REVIEW_API_TOKEN`, and optionally
`ISLA_AI_MODEL` and `PATH`. Use the existing canonical HTTPS origin and a dedicated
review-only token from the approved private secrets store, never admin credentials.
No actual credential belongs in this repository. No shell sourcing/evaluation.

The state directory must have the exact final component `isla-reviewer`, an
absolute symlink-free path, owner permissions 0700. It holds an OS file lock and
private scratch only. The OS releases the lock when a process dies. At startup,
under that lock, only owner-private `scratch/isla-ai-*` directories are removed.
Symlinks and unrelated files are not recursively followed or removed. This is
ordinary temporary-file cleanup, not secure erasure of disk remnants.

The example plist is an UNINSTALLED LaunchDaemon template for macOS, not a
LaunchAgent dependent on an interactive login. Resolve every placeholder from
the existing host inventory and verify the service user/Hermes private home and
unattended authentication before installing it. Do not reuse the unrelated
existing portal UI service. Confirm old reviewer schedules are disabled in the
approved cutover. Review protocol claims still protect against overlap.

Before live activation, verify automatic power-on after outage, disk/FileVault
unlock requirements, network recovery, daemon execution before login, interpreter
and PATH, credential expiry, and retained Hermes transcript policy. A daemon
template alone proves none of these. Do not disable disk encryption or enable
automatic login merely to make the test pass.

## Required isolated acceptance drill

Use preview bindings and synthetic records only; do not reconstruct real HOA
templates or send real email.

1. Stop the reviewer between claim, package fetch, model completion and result
   acknowledgement. Restart and verify reclaim/current-result deduplication.
2. Run two reviewers. Verify exactly one claimant for a revision, stale worker
   rejection, no delivery unlock and no guest-save email side effect.
3. Fail one model request and complete another reservation. Verify backoff and
   no starvation. Change dates/cancel during review and reject old results.
4. Simulate lost network and reboot on the actual target host, then restore it.
   Verify before-login startup, private scratch cleanup and cloud health recovery.
5. Leave the reviewer offline while preview cloud cron runs. Verify health and
   technical alert, including the approaching-arrival count. Repeat with cloud
   cron stopped to exercise the independent external monitor.

Offline regression tests cover claims/replay, conflict/cancellation, private
scratch, process locking, retries and diagnostics. A physical outage/reboot,
real-template model execution and production delivery have NOT been tested.

## gbrain / Hermes boundary and requested follow-up

User requested connection to the EXISTING shared gbrain so Hermes can retrieve
project context, operate the workflow through defined tools and prepare software
repairs. This is additive; neither gbrain nor Hermes should become a prerequisite
for guest draft saving, mail intake or deterministic delivery checks.

Verified on 2026-09-05: the existing Hermes VM has active gbrain HTTP MCP and
Hermes gateway services. Direct Codex MCP access is now registered locally through
the existing SSH connection; authenticated initialization, the filtered 24-tool
inventory and `whoami` succeeded end-to-end. A fresh native Codex app-server also
connected and discovered all 24 tools. After client refresh, this active Codex
session also exposed all 24 tools and authenticated `whoami` succeeded directly.
No server installation, token/scope
change, content import or service restart occurred. Actual host details and
credentials stay outside this sanitized repository. `GBRAIN_MCP.md` documents the
reusable bridge and its client-side limits. The protected revisioned portal export
is now implemented locally (`GBRAIN_SYNC.md`); the destination writer, isolated
source, expiry/deletion enforcement and live guest synchronization are NOT active.

Proposed split, not yet integrated:

- **Project knowledge:** sanitized architecture, repair status, runbook, commit
  references and test evidence in a dedicated existing-brain project source.
- **Guest knowledge (explicitly requested):** a separately protected reservation
  source for names, booking/stay details, application progress, missing items and
  relevant correspondence, with stable case IDs, provenance, source timestamps
  and authenticated links to original records. Hermes should answer questions
  such as “what is still missing for this guest?” using current portal facts.
  No blanket exclusion of guest information. Do not silently grant access to
  unrelated agents, other household users or a public knowledge source.
- **Sensitive originals:** identity and screening material need deliberately
  scoped retrieval, not broad default embedding. Reusable owner signatures,
  passwords and access tokens must not be indexed. Portal links must not contain
  guest bearer tokens. Guest form retrieval requires the same case-level access
  boundaries, not full-form copies in general project documentation.
- **Synchronization:** portal state remains authoritative; gbrain is a searchable
  projection. An outage queues revisioned updates without blocking guest work.
  Late updates cannot overwrite newer versions. Deletions and retention expiry
  need durable tombstones/retry, removal from search AND embeddings, and verified
  handling of backups and documented legal holds. Do not enable guest-data sync
  until source isolation and the deletion/retention path are tested.
- **Operations:** separate authenticated portal tools for status and bounded
  actions. gbrain is retrieval, not the authoritative booking state or proof of
  payment/approval. Documents and emails are untrusted evidence, not executable
  instructions. Each permitted mutation needs fresh state, validation and audit.
- **Repairs:** Hermes can work in this sanitized source tree, add regression tests
  and prepare a reviewed Git change on user instruction. Knowledge access alone
  must not grant production deploy, shell-on-server, signature or sending authority.
  Preserve unrelated user edits. Production activation remains separately approved.

Next integration work: establish dedicated source permissions, test scoped access with synthetic guest
records and deletion replay, then connect the user-requested guest source and
project knowledge through revisioned synchronization. Do
not bulk-import real guest records during connection diagnostics. Never
initialize a second brain because a local CLI is absent.
Any Codex/client restart or consequential live scope change must be confirmed.
