# Florida and HOA compliance controls

This file documents the portal's operational controls. It is not a substitute
for advice from a Florida community-association or fair-housing lawyer.

## HOA source packet

The implementation was checked against the official HOA portal packet titled
`Lease.pdf` for Palma Del Mar Condominium No. 2:

- Portal document ID: `220785`
- Downloaded: `2026-08-21`
- SHA-256: `b521b4cb20a54f19801e24b600603a5436e9d0e95a7980b4f71dc7717b23d6fb`
- Confirmed operational requirements: one-month minimum lease, application for
  every occupant age 18 or older, signed application, executed lease, ID copy,
  screening, Board approval before possession, no renter pets, and a listed
  $100 paper-application fee.

The application packet itself does not prove that the association has authority
in the recorded Declaration, Articles, or Bylaws to require approval or charge a
fee. The portal therefore remains fail-closed until the owner records exact
citations from the current recorded governing documents and amendments.

## Controlling safeguards

- Florida Statutes section 718.112(2)(k): an association approval/transfer fee
  must be authorized by the Declaration, Articles, or Bylaws; the statutory cap
  applies, related applicants are grouped as prescribed, and no fee may be
  charged for a renewal with the same lessee.
- Florida Statutes section 404.056(5): the generated lease includes the required
  radon notice verbatim.
- Florida Statutes section 83.50: the owner must configure the landlord notice
  name/address before live delivery.
- Florida Statutes section 83.512: a separate flood disclosure and owner factual
  answers are required for a rental term of at least one year.
- Florida Statutes sections 760.23 and 760.27 and the federal Fair Housing Act:
  protected characteristics are excluded from decisions, reasonable-
  accommodation requests are handled separately, and assistance animals are not
  treated as pets. No animal fee is charged for an approved accommodation. The
  standard response does not require a particular certificate or registration
  and does not use breed, size, or weight alone as a denial criterion.
- Fair Credit Reporting Act: a human-reviewed adverse action based in whole or
  in part on a consumer report requires a separate notice naming the consumer
  reporting agency and explaining copy and dispute rights. The portal prepares a
  draft but never sends or makes the decision automatically.
- Florida Statutes section 501.171: applicant records and reusable signatures
  are encrypted at the application layer, raw IP addresses are not retained,
  retention is limited, and the owner must attest that the incident-response and
  breach-notice process has been reviewed.
- Florida Statutes section 668.50: electronic consent is explicit, per adult,
  purpose-bound, versioned, and accompanied by a content and event hash. The HOA
  must separately confirm that it accepts the portal signatures.

## Required production configuration

Both the Pages Functions deployment and scheduled worker that read the shared KV
must receive these secrets through the deployment platform, never through this
repository:

- `DATA_ENCRYPTION_KEY`: base64-encoded 32 random bytes.
- `AUDIT_HASH_SALT`: at least 16 random characters, independent of the key.

The admin Compliance screen must also contain the current governing-document
citations, rules version, owner notice address, e-sign confirmation date,
privacy/security review date, fair-housing review date, and (for annual leases)
the three owner flood-history answers. Editing the compliance record disables
LIVE mode until the owner explicitly enables it again.

The $100 fee workflow remains hidden and blocked until the owner records both
the governing-document authority and the date on which the mandatory HOA fee
was verified in Airbnb's price breakdown or appropriate fee field. Airbnb's
current policy says that description/house-rules disclosure alone is
insufficient and that off-platform collection is limited to expressly
authorized hosts.

## Consistent inquiry handling

Questions about race, national origin, disability, or other protected classes
must receive the same neutral response. Do not disclose demographic information
about guests or neighbors and do not infer that an inquiry is a trap. Assistance-
animal requests must be handled as accommodation requests even where the HOA has
a no-pets rule. Do not request a diagnosis or full medical records. When both the
disability and disability-related need are not apparent, request only reliable
supporting information permitted by law. Any direct-threat determination must be
specific to the animal and must consider risk-reducing alternatives.

Authoritative references:

- https://www.flsenate.gov/Laws/Statutes/2026/718.112
- https://www.flsenate.gov/Laws/Statutes/2026/404.056
- https://www.flsenate.gov/Laws/Statutes/2026/83.512
- https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0700-0799/0760/Sections/0760.23.html
- https://www.leg.state.fl.us/Statutes/index.cfm?App_mode=Display_Statute&URL=0700-0799/0760/Sections/0760.27.html
- https://www.hud.gov/helping-americans/assistance-animals
- https://www.airbnb.com/help/article/86
- https://www.airbnb.com/help/article/2799
