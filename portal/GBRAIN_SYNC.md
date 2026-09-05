# Guest knowledge synchronization — export prepared, writer not activated

The direct Codex MCP connection is working. This increment implements only the
portal's protected, revisioned export. On 2026-09-05 the owner explicitly approved
creating a dedicated source and sync identity on the existing brain. They now
exist, with partial live access verification as recorded below. No real guest
data has been imported, no scheduler was installed, and no production portal
deployment occurred.

## Destination provisioning status — NOT activated

- Created the pathless `airbnb-hoa-guests` source, explicitly non-federated.
  There is no guest-data Git remote, clone, or filesystem write-through path.
- Created `airbnb-hoa-guest-sync`, an OAuth client-credentials identity with
  `read write` only, write source and read grant limited to that source,
  `guest-cases/` write prefix, 300-second access-token lifetime, and no admin
  grant. Existing Hermes clients and server configuration were left unchanged.
- Its runtime credential is stored only in the existing server's private
  credential directory (directory 0700, file 0600), not in this repository.
  The private infrastructure proposal records its location and revocation ID.
- Live verification passed identity/source/grant/lifetime checks, restricted
  source enumeration, and explicit denials for foreign-source read/delete,
  out-of-prefix write and an admin operation. The source still has zero pages.
- The run then STOPPED at the token-elevation check: the test expected HTTP
  rejection, while the installed OAuth provider intersects requested scopes
  with the registered grant. Read-only source inspection confirmed that behavior.
  The local verifier now checks actual granted scopes and admin denial for
  either response pattern, with a regression test. It has NOT been rerun live.
- Opposite-direction access, owner/Hermes access to synthetic content, and the
  own-source write/search/delete round trip remain unverified. No temporary
  verification client or synthetic page was created before that stop point.
- Non-federation is not protection against the owner's existing broad legacy
  administrator credentials or local database administrators. No such credential
  was revoked or silently narrowed. Ordinary OAuth grants remain explicit.

`scripts/gbrain_guest_scope.py` is an operator-only provisioning/check utility,
not the synchronization writer. Its `--provision` mode must never be repeated
against the existing source/client; continue later with verification mode only.
The setup-gbrain smoke-test stop gate was respected: no upgrade, migration,
restart, real import or activation followed the failed test assertion.

## Implemented interface

`GET /api/knowledge/changes?limit=50&cursor=...`

- Disabled (404) unless `GBRAIN_EXPORT_ENABLED=yes` is deliberately configured.
- Requires a separate `Authorization: Bearer ...` using `GBRAIN_EXPORT_TOKEN`
  (at least 32 characters, generated securely outside the repository).
- No owner Basic Auth, legacy `X-RO-Token`, guest link or reviewer-token fallback.
  Do not reuse one of those credentials for the new export token.
- Requires the existing atomic `CASE_STORE` binding. Never falls back to KV.
- GET only, private/no-store/noindex responses, no CORS grant, sanitized errors.
- Limit: 1–100 records. The continuation cursor is opaque to the consumer.
- Internal `/knowledge-changes` is available only through the private Durable
  Object binding. The worker's public fetch still returns 404.

An envelope has `protocol: 1`, a persisted `epoch`, `throughRevision`, `changes`,
`hasMore`, `nextCursor`, and a `generatedAt` retrieval timestamp. Each change has
`id`, `revision`, and `operation` (`upsert` or `delete`). Upserts include `record`;
deletes contain a fixed reason, never the former guest content.

The epoch is created transactionally on the first authenticated export and
persists across process restarts. It identifies the source dataset, not gbrain.
Changes are sorted by (case revision, case ID). Updates in the same transaction
cannot be skipped at a page boundary. Deleted-case version tombstones remain in
the atomic store and are exported even after a long consumer outage. This is a
latest-state feed, NOT a complete event log of every historical intermediate edit.
The source never waits for gbrain or performs outgoing requests when saving a
guest draft. There is no second queue containing copied guest forms.

## Data and evidence boundaries

The allowlist includes guest/applicant names, applicant email, booking reference,
stay dates, original adult slot indexes, workflow steps, missing-field labels,
payment/screening reports, recorded confirmations, last reminder time, and
metadata-only HOA correspondence references. This deliberately includes useful
guest data; it is not merely an anonymous technical-status export.

No reusable owner or guest signature, ID number/image, birth date, gender,
screening report, emergency/reference contact, minor identity, street address,
guest bearer link, arbitrary note, mail body or attachment is copied. HOA source
references point only at the existing owner-authenticated evidence viewer.
Full correspondence retrieval still needs a separately scoped, audited design.
The older `/api/ro/*` endpoints remain unchanged and are not this sync protocol.

### Booking first; HOA review afterward

The user's operating model is explicit: Airbnb Instant Book remains enabled.
A booking can already exist while HOA approval is pending. The export therefore
separates `booking.portalStatus` (active/canceled), `hoa.status`
(pending/approval_recorded), the paperwork workflow and a recorded cancellation.
Portal-active is not a claim that a fresh Airbnb API lookup was performed.
No HOA prerequisite is introduced into Airbnb booking acceptance.

An adverse HOA email is a review flag, not a verified final refusal and never an
automatic Airbnb cancellation. If a verified, unresolved refusal prevents the
stay, the exceptional workflow must obtain the HOA evidence, involve the owner
and Airbnb support, and reconcile the actual cancellation/refund outcome. This
increment does not implement that cancellation workflow or execute a cancellation.
Never label a requested cancellation as completed before platform confirmation.

Airbnb does not provide a blanket HOA-refusal exemption in the reviewed policies;
waivers depend on its assessment of the evidence. A listing disclosure is not a
guarantee of penalty-free cancellation, and the guest must not be pressured to
cancel for the host. See [Host Cancellation Policy](https://www.airbnb.com/help/article/990)
and [valid cancellation reasons](https://www.airbnb.com/help/article/2022)
(reviewed 2026-09-05). This does not establish that cancellation is the only
possible remedy in every case.

### Requested seven-day advance notice

The user replaced the earlier 14-day proposal with SEVEN days. New bookings must
have at least seven calendar days before check-in, interpreted
in the property's `America/New_York` timezone. This is the user's operating
requirement, not a newly established HOA/legal deadline or a guarantee that an
application will be approved within seven days. Existing bookings must not be
automatically canceled, discarded from intake or denied paperwork access because
of this new rule. Do not use the later portal-import timestamp as the original
Airbnb booking timestamp.

Enforcement belongs in Airbnb availability BEFORE booking, with Instant Book
retained. The official [advance-notice documentation](https://www.airbnb.com/help/article/484)
and [availability guide](https://www.airbnb.com/resources/hosting-homes/a/updating-your-availability-708)
currently list same-day, 1, 2, 3 and 7 days (checked 2026-09-05). Seven days is now
the user's explicit choice, not a substitute imposed by the software. Verify and
save the native Airbnb setting, preserving Instant Book, existing reservations,
prices and unrelated calendar blocks. Do not treat a listing description as
enforcement or implement an unnecessary rolling calendar integration.

Verified in the authenticated Airbnb listing UI on 2026-09-05: advance notice
was ALREADY set to at least seven days, and requests with less than seven days'
notice were OFF. No save, calendar edit, price change, cancellation or Instant
Book toggle was necessary or performed. Actual listing/guest identifiers stay
out of this sanitized source tree.

Pending HOA approval and elapsed advance notice remain separate facts: no
check-in authorization may be inferred merely from an accepted Airbnb booking
or from seven days having passed. The current project does not control a
physical lock or issue an Airbnb booking hold.

Guest payment reports do not assert receipt. Email triage does not assert approval
or receipt. The projection grants no action authority and explicitly labels its
content as untrusted data and a non-live replica. Its workflow summary reflects
stored facts, not calendar aging; Hermes must obtain current authoritative state
before any consequential action.

The export uses the portal's EXISTING 90-day-after-checkout retention policy; it
does not claim this duration is a new legal requirement. Upserts carry an explicit
`retention.expiresAt`. Expired and invalid-date records emit content-free deletes.
Held records are withheld from the secondary search index while their originals
remain preserved under the portal's legal hold. No legal hold is lifted here.

## Required destination contract (not yet implemented)

Before any real import, complete verification of the newly prepared source in
the EXISTING brain and its dedicated, source-scoped sync identity. Verify with positive AND negative
authorization tests: allowed guest-source read/write/delete; denied other-source
read/write/admin; approved owner/Hermes read access; no unintended federation.
The existing broad Hermes token is unsuitable for unattended synchronization.
The current `put_page` MCP interface has no explicit `source_id` argument; source
selection must therefore be enforced by the authenticated server grant, not an
assumed slug prefix. The filtered Codex bridge does not expose deletion tools.

The consumer must implement and test all of the following:

1. Persist the source epoch, checkpoint, per-case revision and deletion fences.
   Start with an empty cursor. Never persist `nextCursor` until every change in
   that page has a confirmed durable destination outcome.
2. Fence writes at the destination. Older revisions must not overwrite newer
   records or deletion markers. Equal-revision replays must be idempotent; a
   delete takes precedence over an upsert at the same revision (expiry).
3. Resolve uncertain write/delete responses by reading destination state, not
   by blind replay. A single local process lock is insufficient if other writers
   can use the same source. Provenance/revision text alone is not a CAS guarantee.
4. Enforce `expiresAt` independently of new source changes, including when the
   source/consumer is offline. Ordinary incremental polling will not re-emit an
   unchanged record when its deadline passes. Until a tested destination expiry
   mechanism can hide/remove stale content without the local runner, real sync
   remains blocked. Never treat an unreadable source as an empty dataset.
5. Remove deleted content from pages, chunks, embeddings, version history and any
   extracted memory facts/links; address provider logs, backups and legal holds.
   Tombstone/journal records should retain only minimal non-content identifiers.
   Do not use `remember` with its broad default visibility for guest records.
6. Treat 409 as reconciliation required, not permission to reset the cursor and
   overwrite the index. After a source snapshot restore, deliberately establish
   a new epoch through an approved recovery procedure before resuming sync. A
   checkpoint behind the restored watermark alone cannot detect every rollback.
7. Bind the client to the existing verified HTTPS origin, reject redirects and
   mismatched epochs/protocols, bound responses, keep secrets outside Git and keep
   guest content out of logs. Failure notifications contain technical counts only.

Source isolation, destination version fencing, expiry/deletion behavior, privacy
notice/processor alignment and the actual host's reboot/outage drill are live
activation prerequisites. None is implied by passing the export tests.

## Verification

`node --test test/knowledge-export.test.js` covers the projection, credentials,
separate booking/HOA/cancellation states,
no-side-effect guest saves, same-version pagination, restart/replay, concurrent
updates, durable deletions, invalid/mismatched checkpoints, missing atomic storage,
corrupt ciphertext, redacted failures, retention and evidence distinctions.

`node scripts/test_atomic_runtime.mjs` additionally exercises pagination and
deletion checkpoints in local workerd/SQLite Durable Objects with synthetic data.
There are no real emails, HOA submissions, gbrain writes or production requests.
