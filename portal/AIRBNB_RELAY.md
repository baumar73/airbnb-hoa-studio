# Airbnb reply relay — staged implementation

2026-09-05. Code and synthetic tests only. Not deployed, enabled or accepted for
unattended production use. No real guest messages were sent.

## Existing mechanism and trust boundary

Hermes already documents replies through Gmail to the conversation-specific
`@reply.airbnb.com` destination in an Airbnb notification. This implementation
reuses that mechanism, not a new messaging provider or browser automation.
It is not a claim of an official Airbnb API integration or guaranteed delivery.

The mailbox scanner records a **candidate**, never permission to send: a single
strict Reply-To, single valid Message-ID, recent date, non-confirmation subject
and one uniquely matching booking code are required. Names alone do not match.
From/Reply-To headers and booking codes are untrusted; these checks do not prove
sender authenticity. A matching email cannot approve an HOA application either.

Under `/admin/cases`, the owner must check the original message, sender,
conversation, recipient and stay, enter the booking code and attest to that
check. Saving requires owner authentication, same origin and current case
revision. Saving does not send. A candidate can be revoked. Concurrent owner
forms cannot assign the same destination to two cases.

The verified destination is bound to the current stay context and source. A
changed destination/context revokes its usability. A source older than 30 days
is not used; this is a local safety limit, **not** an Airbnb validity guarantee.
Newer mail does not silently renew verification. Fully automatic initial
attribution remains open until actual notification formats and authenticated
message provenance are verified. Thus this stage still requires owner work.

## Delivery and storage

- `AIRBNB_RELAY_CAPTURE=yes` enables candidate capture only.
- `AIRBNB_RELAY_REMINDERS=yes` additionally allows a verified relay as fallback
  when no usable direct email exists; it also enables capture.
- Delivery still requires `AUTO_GUEST_REMINDERS=yes`, mandatory atomic storage
  and the verified canonical HTTPS `.com` origin. No flag is set by this change.
- `AIRBNB_RELAY_MAILBOX` is optional; if used, its exact folder name must be
  verified on the account. The following HOA scan restores its own configured
  folder or INBOX. No mailbox filters or folders are created here.
- Reply-To, original subject and inbound identifier are encrypted under the
  case-specific application key. Guest prose is not copied into relay state.
  The store retains only a one-way destination hash for cross-case uniqueness.
  Relay data must not be exposed in gbrain projections, logs or public pages.
- One persistent claim covers both channels. Before sending, tasks and current
  recipient are rechecked. The message has the original reply subject,
  `In-Reply-To`, `References`, and a stable outbound Message-ID for reconciliation.
  No guest attachments, bearer portal links, source prose or payment claims are
  added. Existing fee-authorization checks remain in force.
- SMTP operations have bounded waits. Final DATA acceptance is success even if
  QUIT later fails. Timeout/uncertainty remains blocked: no blind resend and no
  fallback to another channel. SMTP acceptance is not Airbnb delivery/read proof.

## Structured delivery notices

`REMINDER_DELIVERY_MONITOR=yes` can inspect a separately verified mailbox for
RFC 3464 `multipart/report` messages. Configure an exact comma-separated
allowlist in `REMINDER_DELIVERY_SENDERS` and the exact mailbox in
`REMINDER_DELIVERY_MAILBOX`. The monitor requires the atomic case store, reads
messages without marking them seen, and restores the normal HOA mailbox after
inspection. It matches the historical outbound Message-ID and a one-way
recipient hash, stores only action/status/source-hash metadata and opens an
owner review hold. Malformed, ambiguous, stale, duplicate or wrong-recipient
reports are ignored. Nothing is classified as a confirmed bounce, and no retry,
channel switch, cancellation or HOA decision is triggered automatically.

## Before live activation

Obtain explicit operational approval; confirm the existing deployment and
atomic-store readiness, Gmail sender and folders without moving services.
Validate the actual listing/privacy disclosures and notification structure.
With an explicitly authorized controlled recipient, verify that the reply
appears in the correct Airbnb conversation. Check rejection/bounce behavior and
reconcile an uncertain result by outbound Message-ID without resending blindly.
Automatic bounce reconciliation is not implemented by this change. Missing,
expired or revoked routes remain owner exceptions through automation health.

Local tests cover candidate parsing, owner authorization, stale forms, encryption,
thread headers/injection, concurrent claims and recipient ownership, opt-out,
revocation, changed sources, mailbox order/cursor failures and SMTP stalls.
They do not substitute for real-service acceptance.

Verification: 216 JavaScript tests and 34 Python tests pass, syntax checks and
Pages build pass, and dependency audit reports zero known vulnerabilities.
