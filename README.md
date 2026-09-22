# Airbnb HOA Studio – Isla 405D

Private workshop for the HOA (condominium) guest-registration and lease-approval
workflow of Unit 405D, Isla del Sol, St. Petersburg, FL (Airbnb monthly rentals).

**Status:** private · owner-operated · not a public product.
This repo is the single, versioned home for the Isla 405D portal so the owner
and helpers can keep improving it without re-searching scattered copies.

## Purpose

The association requires every Airbnb guest to register with the condo and get
lease approval before check-in. This system removes the manual email/paper chase:

- Guests enter only their Airbnb confirmation code + last name.
- The system resolves the booking, shows exactly what to submit, lets them fill
  and sign the required association forms online, and tracks status.
- The owner gets one place to review, approve, and archive submissions.

## Infrastructure

- **`portal/`** — Cloudflare Workers app served at `https://isladelsol405d.com/`.
  - Guest self-service: `/find` (code + last name) → `/v/<token>` personal page.
  - Owner admin area + read-only API `/api/ro/*` for Hermes/GBrain.
  - **`cron/`** — `isla-cron` worker: every 30 min AND daily scans a Gmail
    (IMAP) inbox, parses Airbnb booking confirmations, cancellations, HOA
    replies, and writes cases / send Telegram alerts. Runs on Cloudflare KV.
  - Airbnb host-confirmation letters are parsed in their real year-less format
    (`…ARRIVES OCT 15…` + later date); a checkout is never invented.
- **`operations/`** — local Node dashboard + tools (daily watch, calendar
  snapshot, integration status, Gmail/Hermes sync). Runs on the owner's home
  stack (Mac mini worker).
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

All 313 tests pass; audit 0 high/critical.

---

_Isla del Sol 405D · bay-view one-bedroom · Boca Ciega Bay, St. Petersburg, FL._