# Booking notice and HOA payment decision — 2026-09-05

## Changes and evidence

The owner requested prominent seven-day advance notice, HOA approval before
check-in, and prompt application/payment cooperation in the listing and portal.
Instant Book stays enabled; bookings may precede HOA approval.

- Saved and reopened the German AND English “Other things to note” fields of
  the correct Florida Airbnb listing. They now ask guests to book at least
  seven days ahead, start immediately, supply outstanding documents promptly,
  and arrange required payment once verified instructions are available.
- The text explicitly says seven days does not guarantee approval within a week
  and retains the existing allowance of up to 15 days after a complete file.
- Existing fee/electricity paragraphs, prices, payment method, cancellation
  policy and all unrelated settings were preserved. Their presence in the
  listing is NOT a new verification of fee-field or external-collection compliance.
- The local portal homepage and private status page now show the same core
  distinction. `booking-notice.js` respects payment authorization, same-lessee
  renewal, selected route, existing reports/receipts and recorded approval.
  It never requests duplicate paper/online payment or automatically assigns
  responsibility for a cancellation. No portal deployment occurred.
- No guest/HOA email, cancellation, payment request, bank transaction or new
  payment mandate was sent or executed.

Seven days is the owner's chosen booking rule, not an HOA statutory deadline.
An existing reservation must not be closed because it predates this notice.
No new fixed application/payment deadline was invented.

## Payment route still requires an owner decision

Private HOA correspondence reviewed on 2026-09-05 confirms two routes (management
email dated 2026-08-10): paper application paid by check or money order only;
online application and payment through Tenant Evaluation. It does not confirm
an ACH/wire from the owner for the paper application's fee. Another management
email dated 2026-08-18 confirms receipt of a fee while still requesting a missing
screening form: payment and completeness must remain separate evidence states.
No private guest identity or message content is copied into this source tree.

Condominium Associates advertises [electronic payment capabilities](https://www.condominiumassociates.com/accounting-insurance-services-for-hoa-condos),
but that does not establish that the specific rental application fee can be
paid through the ordinary owner-assessment account. Obtain management's explicit
confirmation of permitted payer/method, beneficiary, application reference,
allocation and processing time before offering owner remittance.

Airbnb's [professional additional fees](https://www.airbnb.com/help/article/3625)
include a community/HOA fee collected at booking. Availability on this account
has NOT been checked and no fee was added. The [Resolution Center policy](https://www.airbnb.com/help/article/767)
says mandatory fees belong in the appropriate fee field or nightly price;
description-only disclosure is insufficient, with limited exceptions for
select software-connected hosts. The portal is not automatically such a host.

Airbnb's [monthly payout timing](https://www.airbnb.com/help/article/285) means
owner remittance before HOA approval normally needs advance funding rather
than waiting for the Airbnb payout. Bank of America's [Bill Pay agreement](https://www.bankofamerica.com/online-banking/service-agreement.go)
allows electronic or check delivery depending on the payee; this is not evidence
that this HOA accepts the application fee by ACH, or that postal delivery and
HOA processing fit a seven-day booking window. No bank access was used.

## Nonpayment is evidence, not automatic guest fault

Airbnb's [valid cancellation reasons](https://www.airbnb.com/help/article/2022)
allow consideration of evidence that a guest intends to break a listing rule.
Its [host cancellation policy](https://www.airbnb.com/help/article/990) leaves
waiver decisions to Airbnb after evaluation. A valid, pre-booking disclosed
requirement, documented delivery of usable instructions, reasonable opportunity
to comply and evidence of refusal can support review; a missing receipt alone
does not prove nonpayment, refusal, fault, forfeiture or an approved cancellation.
Do not pressure the guest to cancel to protect the host. No non-refundable-stay
promise or automatic cancellation was added. Existing policies remain in force.

## Local verification

- Six new notice tests and one route-level test, including paper screening
  completion without payment, authorization blocked, renewal and duplicate payment.
- `npm test`: 155 passed; `npm run check`: passed.
- `npm run build`: compiled successfully; `npm audit --json`: zero vulnerabilities.
- These tests prove local rendering/guards, not a live portal deployment.
