# HOA original-document comparison, 2026-09-05

This is a documentary and source-code comparison, **not a legal approval or a
live deployment audit**. Original PDFs are kept in the private source archive,
not GitHub. Portal modification dates are inventory metadata, not proof of the
date a rule became legally effective.

## Important findings

| Subject | Downloaded evidence | Software / required follow-up |
|---|---|---|
| Current rules | The portal file named `669-PDM R&R 2023 Revised mr 4.3.pdf` actually has a **3/2025** heading; portal modification date 2025-04-03. SHA-256 `156dc65750b35d04f3eef61d44d381435f2915aa8b82f84ad6e05da41d6a624d`. | Private checkout still contains the older 2018 rules PDF. Do not silently substitute a new original into a live signed-document process; validate mapping and version acknowledgment first. |
| Rental duration / frequency | Recorded amendment to Declaration 15.12, public records book 20665 pp.1831-1833, recorded 2019-08-22; amendment appears on PDF page 4. It states prior written Association approval, no more than 12 rentals per calendar year and no term shorter than 30 days. SHA-256 `75f519d0e822e538bc58bd9e680ed3774d7e783c8b6910d2b52c8f7125347966`. | Studio `validateRentalPath` already requires at least 30 nights for paid Airbnb rentals. Annual count and the precise contract/approval sequencing need a separately tested rule and documented interpretation; do not auto-cancel bookings. |
| Instant booking / approval timing | The 2016 enforcement notice repeats Declaration 15.01-15.08, including notice **before accepting an offer**, supplemental information and review periods. The 2019 amendment also requires prior written approval. | The user's desired book-first flow and past HOA acceptance cannot be declared fully validated merely from these PDFs. Preserve the seven-day setting and no-entry-without-approval safeguard; record this documentary conflict for clarification before live approval. |
| Screening lead time | Tenant Evaluation `Lease.pdf`, page 3, asks to allow **14 days for its report**, followed by the Association's own approval process. | Seven-day booking notice is not a guaranteed processing time. No confirmation that silence after seven days is approval. |
| Online source identity | Newly downloaded `Lease.pdf` has SHA-256 `b521b4cb20a54f19801e24b600603a5436e9d0e95a7980b4f71dc7717b23d6fb`, matching the source packet already pinned in `compliance.js`. | The packet identity is confirmed; that does not attest actual guest payment, completed uploads, delivery or approval. |
| Online payment / contract | Live Sheet directs applicants to the .com application site and describes a fee charged on submission. Lease packet contains a card-payment receipt, executed-lease requirement, electronic signing instructions and dashboard upload instructions. The handbook also describes lease/ID uploads. | Supports an online application/payment route. Does not establish which card types, the present checkout amount, PayPal availability, or that the online fee automatically discharges every separate HOA charge. Never require a second payment solely because the paper insert also says $100 check/money order. |
| Returning applicants | March 2025 rules E.3 say the $100 fee **may** be waived for a returning renter already approved and on file within the past 12 months. | Not a blanket automatic waiver. Keep evidence of an applicable confirmed waiver; do not equate every return visit with a same-lessee lease renewal. |
| Conflicting pets instructions | Tenant Evaluation Lease page 2 marks pets allowed (25 lb, one pet), while its own paper insert and the March 2025 rules prohibit renter pets. | Do not automatically resolve the contradiction by whichever page was indexed last. Assistance-animal/accommodation handling must remain distinct from the ordinary pets rule. |
| Accommodation process | Updated property forms include a two-page blank Reasonable Accommodation and/or Modification Request; examples include assistance animals and accessible parking. | Preserve the original and an appropriate private referral path. Do not collect diagnoses in the general guest portal, treat all assistance animals as ordinary pets, or automatically decide housing access. |
| Current paper application | Downloaded March 2025 lease form SHA-256 `256cb293bd2da6ed11a181223662a32abc9260eb020d9630f9793dca484c192b` is byte-identical to the private checkout's form. | No application-template update is needed merely because it was downloaded again. Synthetic visual fill testing remains open. |
| Guest registration | A current March 2025 guest-registration original was found. It is filled/submitted by the owner and explicitly certifies **no compensation**. | The private checkout requires `guest-registration.pdf` for this path but lacks that asset. Keep the template in private archive pending fill-layout tests; never use the nonpaying-guest route for paid Airbnb stays. |
| Rules delivered to guests | March 2025 rules change pool hours to 08:00-23:00 and contain parking updates, among other differences from the old copy. | Guests need the correct dated original and acknowledgment; stale rules should not continue to be attached unnoticed. |
| Hurricane guidance | A 2026 Hurricane Preparedness Action Plan is posted with modification date 2026-06-27. | Archived and text-extracted; operational instructions and all diagrams have not yet been reviewed for integration. |

## Private runtime comparison

The private local checkout is older than the studio in multiple workflow modules.
It is not a Git checkout. This does not establish what code currently runs in
Cloudflare. No production configuration was copied, no live deployment inspected
or altered, and no messages, payments, applications or signatures were submitted.

## Review limitations / remaining evidence

Key rule pages, recorded rental amendment and templates were read as originals,
with text extraction and visual inspection for the relevant findings. Extraction
of the whole 255-page set is **not** a legal review of every clause, handwritten
annotation, diagram or historical amendment. General account financials, minutes,
insurance and other archive folders have not all been retrieved. Existing
registration/lease mappings still need synthetic filled-PDF verification.

Keep approval-authority, fee-authority, e-signature, fair-housing and other live
attestations unconfirmed until their separate evidence is reviewed. No source
document or embedding can approve a guest or grant permission to bypass these
checks.
