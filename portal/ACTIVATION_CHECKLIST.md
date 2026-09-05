# Controlled activation checklist

## One-command local verification

Run `npm run verify` from `portal/` (installed npm dependencies and Python 3
required). It stops on the first failed gate: JavaScript tests, syntax checks,
Python tests, local workerd/restart/backup recovery, Pages compilation, cron
dry-run and case-store dry-run. It does not deploy, read guest records or send
mail. Run `npm audit --json` separately for the network-backed dependency audit.

## Repeatable local runtime recovery drill

Run `npm run test:runtime` from `portal/`. This executes the existing atomic-store
integration test and `scripts/test_restart_runtime.mjs` against local workerd.
The restart test creates a unique temporary directory, explicitly enables disk
persistence, disposes the runtime and starts a new runtime twice against that
same directory. It removes only its generated temporary storage on completion.

Verified with synthetic records on 2026-09-05:

- Encrypted drafts, cancellation status and a 150-KB immutable archive survive.
- Unresolved HOA and reminder claims survive and remain visible to monitoring;
  the reminder worker performs no resend after restart.
- Review leases remain exclusive, expire with their existing backoff and can be
  reclaimed with a new token. A stale pre-restart writer receives a conflict.
- Knowledge-export epoch/cursor and deletions survive the next restart.
- A wrong encryption key is rejected; the actor has no public case endpoint.
- A cold snapshot restores into a separate temporary directory. All four
  synthetic cases, exact archive bytes, original review lease, export cursor
  and send holds are checked independently of the changed original store.

The drill uses orderly local runtime shutdown, not abrupt host power loss. It
does not exercise a production host, send real mail or change production bindings.
Its backup is local and synthetic, not an offsite production recovery. Keep the
real operational acceptance gates open below.

This is a runbook for the existing deployment. It authorizes no deployment,
service move, mailbox change or real message by itself. Use synthetic records and
preview bindings until every gate below has an owner and evidence.

## Required configuration gates

Keep all new transport flags disabled while preparing:

```text
AIRBNB_RELAY_CAPTURE=no
AIRBNB_RELAY_REMINDERS=no
REMINDER_DELIVERY_MONITOR=no
AUTO_GUEST_REMINDERS=no
AUTO_HOA_SUBMIT=no
```

Before enabling any flag, verify the existing canonical HTTPS `.com` origin,
atomic case store, encryption key, Gmail sender and exact mailbox names through
the approved private secrets/inventory locations. Never copy values into this
repository. `AIRBNB_RELAY_MAILBOX` and `REMINDER_DELIVERY_MAILBOX` are exact
folder names; no folder is created or guessed by the worker.

## Synthetic acceptance sequence

1. Create a synthetic reservation with incomplete paperwork and a seven-day-plus
   future check-in. Run the mail poll and confirm that only a draft case appears.
2. Capture a synthetic Airbnb reply candidate. Confirm it is encrypted, remains
   unusable until the owner verifies the original conversation, and never enters
   the public guest page or gbrain projection.
3. Verify the candidate in the owner portal with the current reservation code.
   Run two reminder workers concurrently; confirm one claim and one outbound
   message only. A second run must not resend it.
4. Return a synthetic structured delivery report. Confirm only a review hold is
   recorded. No retry, channel switch, cancellation, payment status or HOA
   approval may change. Acknowledging the notice must not queue a resend.
5. Replay a booking confirmation with changed dates or adult count. Confirm old
   steps/packages become stale, the booking remains active, reminders pause and
   the owner must confirm the new context.
6. Interrupt a worker after claiming and restart it. Confirm the durable claim
   remains blocked until reconciliation; interrupting an SMTP connection after
   `DATA` acceptance must not cause a blind resend.
7. Simulate a canceled reservation during each step. Confirm guest access closes
   and no new delivery or HOA action starts.

Local package-dispatch coverage (2026-09-05): `test/atomic-storage.test.js`
exercises the actual dispatcher with archived synthetic bytes and fake mail
transport, including concurrent workers, connection uncertainty, accepted mail
with failed receipt persistence, cancellation/payment changes before dispatch,
cancellation/deletion during dispatch, notification failure and interruption
after a durable claim. Accepted mail without a durable receipt is reported as
requiring reconciliation, not successful completion. `test/smtp.test.js` covers
protocol timeouts and disconnects after DATA acceptance. These tests do not prove
delivery through a real mailbox or restart behavior on the production host.

Before dispatch, also test switching `submit-live` off while the archive is
loading, removing/replacing the standing authorization and revoking the green
package review after the release claim. All must stop before SMTP and keep the
claim for reconciliation. A claimed automatic release must not silently become
a test email. This final recheck cannot recall mail already handed to SMTP, and
the existing KV switch is not a transactionally consistent emergency stop.

Also change the booking dates while a package transport is in flight, then
acknowledge the new dates. The unresolved release lock and prior package
reference must remain visible for reconciliation. An old receipt must not mark
the new stay's paperwork complete. The local tests cover this race, repeated
booking updates, and attempts to persist a receipt against replaced review or
package hashes. A booking-change acknowledgement is never a resend permission.

For unchanged paperwork with a verified prior send, the owner-only
[package reconciliation form](PACKAGE_RECONCILIATION.md) records the original
Message-ID/send time after archive verification and a minimum 15-minute release
age. Test stale forms, cross-origin requests, archive/storage failures and replay.
Saving must send no mail, preserve cancellations, leave HOA/check-in decisions
untouched and retain the release fence. Uncertain non-delivery and superseded
packages are not resolved by this form.

## Staged enablement

Only after the synthetic sequence is recorded may the owner enable one function
at a time, in this order: reminder worker with direct email, candidate capture,
owner-verified Airbnb relay fallback, then structured delivery monitoring. Keep
HOA submission separately disabled until the actual association packet,
recipient list, secure ID handoff and payment evidence are accepted.

For the first controlled real case, use an explicitly authorized recipient and
the existing Airbnb conversation. Check the outbound Message-ID in Gmail and the
Airbnb conversation before considering delivery successful. A Gmail `250` means
transport acceptance only; it does not prove Airbnb delivery or guest reading.

## Abort and rollback

If any check is ambiguous, set the relevant flag to `no`, leave the durable claim
blocked, and record the case for owner reconciliation. Do not delete claims,
change reservation status, resend manually from another channel, or infer HOA
approval. Restore the previously verified configuration and rerun the synthetic
sequence before another attempt. Keep the independent external heartbeat and
power/reboot drill separate; this checklist does not install either one.

Evidence to retain outside GitHub: configuration review date, synthetic run IDs,
worker/cron logs with private data removed, outbound Message-ID reconciliation,
mailbox-folder verification and the owner who approved each gate. Never retain
guest bearer links, IDs, screening data, passwords or raw message bodies here.
