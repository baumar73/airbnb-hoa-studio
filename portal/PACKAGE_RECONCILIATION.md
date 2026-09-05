# Owner verification of an uncertain package send

Local implementation, not activated or accepted in production. This action is
for an exceptional delivery with an existing release lock and no durable receipt.
It never sends an email, authorizes a retry or records HOA approval.

## Procedure

In `/admin/cases`, open **Reconcile an uncertain package delivery**. Wait at
least 15 minutes after release so the normal bounded SMTP attempt can finish.
Find the original message in Gmail Sent and inspect **Show original**. Verify
the HOA recipients, reservation, stay dates and every attachment against the
listed immutable package. Enter the original Message-ID, UTC send time and
reservation code; explicitly attest that these checks were completed.

The portal validates the owner session, request origin, case version, release
age, send time, package ID/hash, current paperwork digest and archived bytes.
It atomically records the prior send and owner attestation. A changed case needs
a new owner decision; saving is not retried against a newer case revision.

This is a recorded human verification, not an independent Gmail lookup. A valid
Message-ID format alone is not evidence. The source message remains in Gmail;
raw email, credentials and identity documents must not be pasted into the form.
No API key or message delivery permission is needed for the action itself.

## State and limits

- The receipt stores the verified send time, archive manifest and owner review
  timestamp/identity/Message-ID. The uncertain-error marker is removed.
- The release lock remains; the confirmed submission prevents automatic resend.
  The ordinary workflow may now process later HOA evidence separately.
- Payment, screening, HOA approval and check-in release are not inferred from
  sending the documents. Canceled reservations remain canceled.
- A changed booking, missing/replaced package, archive failure or recent release
  stays held. The form does not reconcile superseded packages or messages with
  uncertain recipients/attachments.
- An empty Sent folder is not proof of non-delivery. There is deliberately no
  “not sent / unlock / retry” action. These outcomes still require separate
  investigation; the current action only resolves a verified prior send for
  unchanged paperwork.

## Local verification

Nine tests in `test/atomic-storage.test.js` cover successful owner reconciliation,
no network send or HOA/check-in approval, auth/origin/version/package fences,
invalid attestations/IDs/times, changed or active releases, canceled bookings,
concurrent decisions, unavailable/tampered archives, concurrent case edits and
the prohibition on legacy storage fallback. The complete JavaScript suite has
254 passing tests; syntax checks and the Cloudflare Functions build pass.
Real Gmail evidence and production use remain to be accepted separately.
