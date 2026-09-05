# Guest reminder contact and delivery

Local implementation, 2026-09-05. Not deployed or enabled by this change.

## Guest-requested email

The authenticated-by-link status page offers an optional email reminder request,
including for Tenant Evaluation applicants who have no local paper forms.
The guest must enter the same valid address twice and expressly request HOA
reminders for this stay. This checks spelling consistency, **not mailbox ownership**.
No contact address is required as a condition of approval. No new account is needed.

The preference is separate from application data. Saving it does not create a
wizard, change signatures, confirm an application/payment/approval, or send a
message. Mutations require same origin, an active reservation, an atomic store,
and the current case revision. Conflicting changes require reloading the page.

The explicit preference takes precedence over the paper form's existing address.
Opting out removes the reminder address and prevents fallback to the older paper
address. An in-flight email may already have been accepted and cannot be recalled.
Without an explicit preference, existing paper-form recipient behavior is unchanged.

`guestContact` is encrypted at rest using the configured application key and a
case-specific authenticated encryption purpose. The private case-store API refuses
plaintext contact fields. Contact data is not added to the gbrain projection or
AI review payload. Existing case retention and legal holds apply. No credentials,
real addresses or guest records belong in this repository.

## Delivery and exceptions

- The existing `AUTO_GUEST_REMINDERS=yes` and mandatory atomic storage gates remain.
  This change does not set them or change production configuration.
- Workers re-evaluate current tasks and recipient before sending. Concurrent runs
  share a persistent claim; a completed or canceled case does not receive a new
  reminder. A guest opt-out before the recipient recheck suppresses that attempt.
- Messages contain task instructions and the canonical HTTPS `.com` lookup URL,
  not bearer links, booking details, source emails, IDs or attachments.
- Missing recipients are not replaced with the owner's email. Failing to reach a
  due guest now makes enabled automation health report `guest_contact_unavailable`.
  The owner dashboard identifies cases with open tasks and no usable address.
  The existing exception notifier uses its cooldown; failed alerts remain retryable.
- Ambiguous SMTP results stay blocked for delivery reconciliation. A successful
  SMTP send records transport acceptance, not proof that a guest read the message.

## Airbnb boundary and remaining acceptance

No Airbnb messaging transport is implemented or configured in this repository.
The warning is **not** a delivery queue and does not claim an Airbnb message was
sent. Until an approved messaging integration is identified and tested, guests
without a usable email still require follow-up in the existing Airbnb conversation.
Do not mark the entire reachability TODO complete on the basis of these changes.

Airbnb permits a guest-requested alternative communication method after booking;
requirements for additional contact information have separate compliance and
listing-disclosure conditions. The portal option is voluntary and does not request
moving a booking or payment off Airbnb. Source checked 2026-09-05:
[Airbnb Off-Platform and Fee Transparency Policy](https://www.airbnb.com/help/article/2799).
This is an implementation constraint, not an Airbnb approval of the deployment.

Before live activation: verify the actual listing/privacy disclosures, determine
the supported Airbnb messaging path, test with a controlled recipient, check email
deliverability/bounces and ambiguous outcomes, and obtain explicit operational
approval. No real email, Airbnb message or HOA submission was used for local tests.

## Local verification

Regression tests cover independent online-route contact, explicit request, repeated
address entry, malformed input, stale revisions, cross-origin rejection, canceled
access, encrypted storage/corruption, plaintext rejection, legacy storage, disabled
delivery disclosure, opt-out/old-address precedence, pre-send opt-out, parallel
workers, late completion/cancellation, missing-contact health and alert cooldown.

`npm test`: 189 passing JavaScript tests. `python3 -m unittest discover -s test -p
'test_*.py'`: 34 passing tests. Syntax check and Pages build pass; `npm audit --json`
reports zero vulnerabilities. These are local/mock tests, not live delivery proof.
