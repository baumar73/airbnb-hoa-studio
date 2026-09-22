# Airbnb HOA Studio – Isla 405D

Private workshop for the HOA (condominium) guest-registration and lease-approval
workflow of Unit 405D, Isla del Sol, St. Petersburg, FL (Airbnb monthly rentals).

**Status:** private · owner-operated · not a public product

## What this is

- **`portal/`** — Cloudflare Workers app served at `https://isladelsol405d.com/`.
  Guests find their personal paperwork page with their Airbnb confirmation code +
  last name (`/find`), complete the association forms online, sign, and track status.
  Includes a read-only API (`/api/ro/*`) for Hermes/GBrain and an owner admin area.
- **`operations/`** — local Node dashboard + tools (daily watch, calendar snapshot,
  integration status, Gmail/Hermes sync). Runs on the owner's home-server stack.
- Gmail (IMAP/SMTP) integration for Airbnb booking/express messages and for
  owner-approved submission emails. Telegram notify.

## Engineering rules (see `STUDIO_BRIEF.md`)

- Test-driven development; regression tests before behavioral changes.
- **Never deploy or call production from a workspace run.**
- **Never send email, submit an HOA package, approve a case, or infer approval
  from inbound email automatically.**
- Guest save persists a draft only; it never triggers HOA submission.
- No SSN / identity-document upload. No fabricated people or identifiers.
- Live submission stays blocked until secure IDs and fee evidence/waiver exist.

## Checks

```bash
npm test
npm run check
npm run build
npm audit --json
```

## Workflow status

Current branch: `ox-alpha/operations-hardening-20260821`.
Active integration (in progress): Hermes access to live portal API + Airbnb
messaging. See the integration plan in the workspace.

---

_Isla del Sol 405D · bay-view one-bedroom · Boca Ciega Bay, St. Petersburg, FL._