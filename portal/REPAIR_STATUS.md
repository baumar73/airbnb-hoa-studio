# Reliability repair and automation target

## Status

Local implementation in the sanitized studio only. Not deployed,
not copied to the private production tree or the existing runner. No real guest
messages, HOA submissions, payment transactions or production data changes.
Pre-existing landing-page edits are preserved and are not part of this repair.

The user clarified the product goal: routine guest onboarding must require no
owner intervention. A dashboard that merely reminds the owner is insufficient.
The opt-in scheduler now supports release under standing owner authorization.
It is not activated. Do not describe the live installation as fully automated.

During this implementation the user explicitly authorized use of the existing
landlord signature for this purpose without per-case release. This authority
covers the guest/HOA paperwork workflow, not unrelated documents or transactions.
It must be represented in the activation audit; it does not assert HOA approval.

## Implemented locally

- `functions/lib/parse.js`: retain complete guest names; normalize lookup names,
  including apostrophes, accents and suffixes, without truncating middle names.
- `case-store/src/index.js`, `functions/lib/storage.js`: encrypted per-reservation
  records, atomic version checks, tombstones and merge of independent updates.
  Stale updates fail instead of overwriting cancellations or resurrecting cases.
- `functions/[[path]].js`, `cron/src/index.js`: retain snapshot metadata through
  normalization and filtering; storage errors return controlled responses.
- `functions/lib/review.js`, authenticated review routes,
  `scripts/run_local_ai_review.py`: review encrypted records through the portal;
  accept only bounded structured results for the current document/context hash.
  Incomplete paperwork cannot become green solely on an AI assertion. The runner
  no longer overwrites the complete KV dataset or needs its encryption key.
- `scripts/generate_review_bundle.mjs`: include the current compliance settings
  and annual-rental flood document in legacy/manual local review generation.
  The revised reviewer instead downloads the exact server-generated PDF archive.
- `functions/lib/delivery.js`, `functions/lib/submit.js`: persist a delivery
  receipt against a fresh record without overwriting concurrent cancellation or
  notes. Retry persistence only, never delivery. Preserve a live delivery lock
  when the result is uncertain; notification failure is not a resend trigger.
- `functions/lib/journey.js`, `functions/lib/guest-reminders.js`: compute concrete
  remaining guest tasks and send direct guest reminders through an opt-in cron
  path. Draft updates recompute missing fields. A 24-hour initial grace period
  and 72-hour repeat interval avoid immediate/repeated nags. Atomic claims avoid
  concurrent duplicate attempts. Canceled/completed cases stop reminders; an
  online application does not trigger duplicate local paperwork/paper payment.
  Owner-chase reminders are suppressed when direct reminders are enabled.
  Payment reminders link to the existing payment instructions without inventing
  accepted methods or treating a guest report as receipt evidence.
- `functions/lib/package-archive.js`: immutable encrypted PDF snapshots, SHA-256
  manifests, chunked storage below the Durable Object per-value limit, atomic
  association with the current case version, and deletion with the case. Signed
  document downloads use archived originals even after signature/config changes.
- `functions/lib/auto-submit.js`: opt-in scheduled delivery under recorded
  standing authorization, only with complete paperwork, current green review,
  exact reviewed archive, verified prerequisites and compliance configuration.
  The owner receives the existing submission copy; routine success does not
  generate another Telegram to-do. Concurrent release attempts do not resend.
- Review-only bearer credentials cannot access owner controls. The runner no
  longer receives the reusable owner signature or raw wizard fields. It reviews
  exact archived PDFs, verifies their hashes and sends only bounded results.
  Applicant text goes to the model on stdin; file tools, plugins, MCP and user
  context injection are disabled using the inspected Hermes CLI behavior.
- Fee disclosure is now distinct from a recorded external-payment authorization
  reference. Missing authorization blocks automatic payment instructions, not
  an excuse to add an owner surcharge. Documented legal holds prevent auto-purge.
- Owner case overview includes workflow state, last actual guest reminder,
  outstanding evidence and standing-authority release status.
- Atomic-mode guest forms now carry their case revision. An older tab, missing
  revision or booking change returns 409 before any wizard mutation. Concurrent
  changes during the POST remain protected by the existing atomic store. With
  JavaScript enabled, conflict/network errors keep current entries in the DOM and
  offer a separate tab for comparison; no private browser storage is added.
  Legacy KV mode intentionally retains its old behavior until approved cutover.
- `functions/lib/automation-health.js` and cron record the last successful cycle,
  current/failed stage and consecutive failures. Mail must succeed before any
  downstream sends. Persistent failures and stranded/uncertain delivery claims
  produce a technical exception notification, with a best-effort 24-hour cooldown.
  Claims remain locked, including after cancellation; no blind resend or invented
  receipt reconciliation is introduced. Diagnostics retain only allowlisted
  numeric job counts, timestamps and flags, never transport error strings.
- `/automation-healthz` returns only `ok`/`unavailable` (200/503). No successful
  cycle within 90 minutes, stage failure or stranded delivery is unhealthy.
  Owner-authenticated `/admin/automation-health` supplies details and separate
  enabled flags; reviewer-only credentials cannot access it. The original
  `/healthz` remains a basic web liveness check. A healthy cron heartbeat does not
  mean guest communications are enabled or the product is release-ready.
- HOA email monitoring now uses the existing half-hourly poller as its return
  channel; the association needs no portal account or software integration.
  `functions/lib/hoa-mail.js` classifies new prose as package receipt, possible
  payment receipt, missing items, possible approval, adverse response or other.
  These are explicitly unverified triage categories, NEVER confirmed workflow
  steps. Exact booking codes take precedence; without a code, full name AND both
  stay dates must identify one case. Unknown/multiple codes, conflicting dates,
  surname-only matches and non-allowlisted senders remain unassigned. A canceled
  reservation may retain later correspondence but is never reopened.
- `functions/lib/mailpoll.js` no longer assigns approval candidates by loose
  surname matching or suppresses separate same-subject/same-day replies. Each
  source excerpt has a stable content hash, encrypted storage and a processed
  marker separate from the short news index. Case linkage is saved before the
  processed marker. A failed case save is retried, not silently acknowledged.
  General news and notifications contain metadata, not the email body.
- `functions/lib/imap.js` adds Message-ID capture with header/body separation,
  read-only mailbox selection, bounded transport waits and redacted login errors.
  `HOA_MAIL_SENDERS` is a comma-separated list of verified exact sender addresses.
  `HOA_MAILBOX`, if supplied, selects a verified ASCII/IMAP-encoded archive folder
  AFTER processing Airbnb messages in INBOX. No folder name, address or mailbox
  filter is inferred/configured on the real account. The HOA lookback is 90 days.
- `functions/[[path]].js`: owner-only `/admin/hoa-mail/:hash` decrypts and renders
  a plain-text excerpt with no-store headers; email HTML cannot execute. News and
  case views link to these excerpts. Reviewer credentials cannot access them.
  `automation-health.js` exposes numeric linked/unassigned email counts only.

New email-monitoring tests live in `test/hoa-mail.test.js`; status counters are
covered in `test/automation-health.test.js`. The investigate workflow drove the
failing regressions for duplicate replies, unsafe matching, source access, missing
sender configuration, transport stalls and credential-containing IMAP failures.

The legacy storage fallback deliberately remains active until an approved
cutover. Therefore, adding this code alone does NOT repair live KV concurrency.
Existing guest records with already truncated names also need reconciliation;
the parser fix does not reconstruct missing names from nothing.

## Verification

- `npm test` / `node --test --test-reporter=dot test/*.test.js`: 125 tests pass.
  Seven new regressions cover stale browser revisions/changed booking dates,
  retained form inputs on conflict and connection loss, stage-specific failure,
  recovery, alert cooldown, stranded claims, safe counters and authenticated
    health access. The rendered form script is exercised in a minimal DOM adapter,
  not represented as a real mobile/browser end-to-end test.
- Fourteen additional HOA-mail regressions cover triage categories, quoted
  history, repeat guests, ambiguous/suspicious senders, duplicate replay,
  same-day replies, failed persistence, encrypted retention/holds, owner-only
  safe display, archive-folder ordering and IMAP deadline/error redaction.
- `python3 -m unittest discover -s test -p 'test_*.py'`: 7 tests pass.
- `node scripts/test_atomic_runtime.mjs`: passes in local Miniflare/workerd with
  SQLite Durable Objects, synthetic encrypted records and no cloud account.
  Verified explicit import, independent concurrent writes, same-case conflict,
  encryption at rest, multi-chunk immutable archive roundtrip and no public API.
- `npm run check`: passes.
- `WRANGLER_LOG_PATH=/private/tmp/isla-studio-build.log npm run build`: passes.
- Wrangler dry-run builds for cron and case-store: pass; nothing deployed.
- `git diff --check`: passes.
- `npm audit --json`: succeeds after network access became available; zero
  reported vulnerabilities (96 dependencies). This is not a full security audit.

No real SMTP, actual HOA PDF-template package or production end-to-end flow has
been verified in this tranche. Studio PDF templates are intentionally absent.
The SMTP client is tested with synthetic streams: a lost QUIT after accepted
DATA remains success, and authentication errors do not expose credential bytes.

## Next product implementation

Track one authoritative state per reservation, plus a separate state per adult,
document, payment and HOA response. Events advance the state, not elapsed time
alone. Late replies or revised dates must not regress or overwrite newer facts.

1. Confirmed booking: create/link the correct case and deliver the guest's next
   action through a verified messaging channel. Repeated imports are idempotent.
2. Guest action: retain drafts and original adult slots; validate completeness;
   ask specifically for missing items instead of sending the full checklist again.
3. Payment: explain only the association's verified accepted methods, recipient,
   amount, reference and steps. Paper and external online routes differ. Never
   add an owner surcharge or claim a guest's “mailed/paid” click proves receipt.
4. Follow-up: direct reminders to the responsible guest, stop reminders for
   completed work, escalate approaching deadlines and genuine exceptions only.
5. Ready package: deterministic validation plus current review, immutable exact
   PDF snapshot, authorized signature policy and an idempotent delivery outbox.
   Deliver the correct documents to the HOA and copy the owner. Record transport
   acceptance separately from association receipt and approval.
6. External online application: do not ask for duplicate local screening/payment.
   Monitor verified completion evidence; never pretend the portal completed an
   external payment or third-party screening that it cannot actually observe.
7. Overview: show “waiting for guest / payment evidence / review / HOA / exception”
   with last event, next automatic action, due date and an audit trail.

Standing authorization to use the stored landlord signature without per-booking
release has been given in this conversation. Automatic HOA approval is NOT part of automatic
document delivery. Unknown payment evidence and ambiguous replies remain pending.
Current HOA/payment source documents and supported messaging integrations must be
verified before enabling a real automated workflow.

Direct reminders require `AUTO_GUEST_REMINDERS=yes`, `REQUIRE_ATOMIC_CASES=yes`,
the atomic binding and the verified canonical HTTPS `.com` `PORTAL_ORIGIN`.
None is activated by this change. The recipient is the lead guest email entered
in the existing form. Reminder emails contain no bearer token or sensitive field
values. A guest who has never provided an address still needs the Airbnb channel;
the runner explicitly reports `waitingForContact` rather than pretending delivery
or replacing it with an owner email. Airbnb follow-up integration and automated
receipt-evidence reconciliation are still pending. Automatic HOA dispatch is
implemented locally but not enabled or verified with actual HOA templates/SMTP.

Scheduled HOA delivery additionally requires `AUTO_HOA_SUBMIT=yes`, the existing
`submit-live=yes`, `OWNER_SIGNATURE_AUTHORIZATION=hoa-paperwork-v1` and a recorded
`OWNER_AUTHORIZATION_REFERENCE`. Configure these only after the approved rollout.
The runner uses `ISLA_PORTAL_ORIGIN` and `ISLA_REVIEW_API_TOKEN`; the matching
server secret is `REVIEW_API_TOKEN`. Do not give it full portal-admin credentials.

Relevant primary sources checked September 5, 2026:

- [Airbnb fee/contact policy](https://www.airbnb.com/help/article/2799): HOA rules
  may justify disclosed compliance information/registration, but external fee
  collection has separate exceptions. Verify the actual exception applicable to
  this listing before enabling fee instructions; disclosure alone is insufficient.
- [Airbnb scheduled quick replies](https://www.airbnb.com/help/article/2897): native
  reservation/check-in/check-out scheduling exists. This does not establish an
  integration with this portal's missing-field state.
- [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/):
  SQLite key/value entries have a 2 MB combined limit; archived ciphertext is
  split into 64 KiB chunks rather than put in the case record.

## Safe activation prerequisites — not executed

Stay in the existing Cloudflare account/project and keep the reviewer on its
existing machine. No migration to another host is proposed.

1. Obtain explicit approval for the consequential storage cutover and its brief
   writer pause. Inventory every writer, including Pages, cron and old scripts.
2. Prepare isolated preview bindings and synthetic end-to-end tests first.
3. Pause/drain all legacy writers. Export an encrypted private backup, compute its
   SHA-256, count, unique IDs and booking references, and validate decryption.
   Never put this backup or real IDs/secrets into this repository.
4. Deploy the separate private case-store actor with no public routes. During the
   import window only, bind the correct legacy KV as `LEGACY_CASES` and enable
   `ALLOW_CASE_IMPORT=yes`. The import does not delete or modify legacy data.
5. Bind Pages and cron `CASE_STORE` to the SAME production actor script/class.
   Use a separate preview actor script. Set `REQUIRE_ATOMIC_CASES=yes` in every
   writer so a missing binding fails closed rather than writing stale KV.
6. Explicitly initialize using the verified encrypted backup hash/count. The
   authenticated initialization route also requires the temporary import flag
   and `confirm=INITIALIZE`. It refuses a second initialization. A maintenance
   response during the writer pause is safer than split-brain reads/writes.
7. Verify actor counts/decryption and only then enable the revised reviewer with
   private HTTPS-origin and credential configuration. Remove the raw-KV runner.
8. Disable the import flag and legacy-import binding, verify every writer, then
   resume. Keep the legacy encrypted snapshot as a private rollback reference.
   NEVER simply switch back to stale KV after new actor writes; rollback requires
   a fresh encrypted export and another controlled writer pause.

Remaining release blockers include a tested activation/rollback mechanism,
deployment of dedicated review credentials, real-template and transport tests,
delivery-uncertainty reconciliation, date-change reconciliation, manual state guards and verified external
payment permission. Existing signed contracts must be backfilled from actual sent
originals; never regenerate them and represent them as historical executed copies.
The existing runner's Hermes version/zero-tool behavior and retained transcript
storage need verification and an explicit retention solution before sensitive
production input is processed. Local temporary-file cleanup does not itself purge
Hermes history. This is not yet a complete production rollout package.

Monitoring limitations: the heartbeat is diagnostic, eventually consistent KV,
not an atomic send/authorization lock. Overlapping cron runs can race the status
or notification cooldown; delivery safety remains in atomic case claims. Wire an
independent external monitor to `/automation-healthz` during approved rollout:
an entirely stopped scheduler cannot alert about its own outage. Neither that
monitor nor production heartbeat routes have been activated here. SMTP/IMAP
transport verification and verified delivery reconciliation remain pending;
SMTP timeouts remain unimplemented. A stalled claim is
detected, not automatically unlocked. A booking date change already recorded in
the portal invalidates an old form, but ingestion of Airbnb amendments is still
unimplemented. No actual HOA or payment acceptance is inferred by these repairs.

## HOA email activation and remaining boundaries

The user confirmed that the association responds only by email. Reuse the existing
Cloudflare mail-poll schedule; no second Codex task/monitor or new HOA account is
needed for this software feature. No production scheduler or mailbox was changed.
Before activation, verify the actual sender list, whether filters archive replies,
the correct selected mailbox and real reply/attachment formats. Without a sender
list, the historical domain query remains for intake, but replies stay unassigned.
Selecting an archive folder without verifying it on the account is not acceptable.

This is monitored intake and case-linked triage, NOT automatic evidence validation.
A From address is not proof of authenticity; DKIM/DMARC/provider-authentication
checks are not implemented. Keywords cannot establish HOA approval or fee receipt.
The current studio invariant forbids inferring approvals from inbound email, and
the implementation leaves `fee_sent`, `board_approved`, delivery locks and guest
messaging unchanged. Any adverse decision also remains a separate reviewed action.
Routine source review still requires the owner until a verified evidence-validation
workflow is agreed and tested against actual messages. Do not claim zero-touch HOA
reconciliation or activation of live monitoring from this change alone.

Only a decoded text excerpt (up to 24,000 characters) is archived, not a full MIME
original or attachments. Keep the mailbox originals. Complex multipart/HTML replies
and attachments need real-message tests before relying on extraction. Archived
excerpts expire 90 days after intake or the matched checkout, whichever is later.
The next successful scan extends retention for extended stays and removes expiry
for linked legal holds, including messages outside the query window. Releasing a
hold is not inferred. An outage at the expiry boundary, explicit erasure of an
individual case, and previously unassigned messages need a verified archive
retention/deletion runbook before rollout; deleting a case does not delete its
separate email archive or the original mailbox message.

Content-hash deduplication and processed markers use eventually consistent KV;
they prevent normal repeat scans but do not promise exactly-once owner alerts
under concurrent workers. Notifications are best effort after durable intake;
an interruption/failure there leaves the pending source visible in the portal.
No email input directly sends guest messages, grants workflow evidence, or causes
HOA dispatch. Import catch-up may surface historical correspondence for review.
