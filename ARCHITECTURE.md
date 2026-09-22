# Architecture – Isla 405D Portal

This document is the precise, searchable reference for any AI or human
maintaining this repository. Each file, route and data flow is described so a
reader can trace every step and spot defects. Everything here is verified
against the current `main` unless marked TODO.

## Repository layout

- `portal/` – Cloudflare Workers app (private, `isladelsol405d.com`).
- `portal/functions/[[path]].js` – the single Pages-Functions entry: routes,
  admin, read-only API, guest wizard.
- `portal/functions/lib/*.js` – business logic (parsing, storage, forms, mail).
- `portal/cron/` – `isla-cron` worker (every 30 min + daily).
- `portal/case-store/` – Durable Object that owns reservation records.
- `portal/public/forms/` – **versioned, byte-verified HOA form PDFs**.
- `operations/` – local Node dashboard (owner's home stack; out of scope here).

## Routes (subset; authoritative source is `[[path]].js`)

- `GET /` – landing. `GET /find` – guest enters code + last name.
- `POST /find` – resolves reservation, redirects to `/v/<token>`.
- `GET/POST /v/<token>` – guest personal page (status, forms).
- `GET/POST /w/<token>` – guest wizard forms; `POST /w/<token>/occupancy`
  sets adults/minors via `confirmHoaOccupancy`.
- `GET /api/ro/*` – read-only, token-gated (X-RO-Token); no mutations.
- `/admin/*` – Basic-auth owner admin area.

## Booking parsing data flow

Airbnb host confirmation -> `isla-cron` (cron/src/index.js) -> `pollMail`
(lib/mailpoll.js) -> `parseBooking` (lib/parse.js) -> case record -> KV/Durable
Object. Year-less host format handled by `parseYearlessArrival` (lib/parse.js);
a checkout is never invented. -> Telegram alert on `complete:false`.

## Forms & form-data fidelity

- Templates: `portal/public/forms/lease-application.pdf` (SHA-256 `256cb293…`),
  `guest-registration.pdf` (SHA-256 `d40d0012…`), byte-verified originals,
  versioned in git. Served at `/forms/<name>.pdf` via `env.ASSETS`.
- Filling: `lib/fill.js` paints validated guest data over the exact template
  via a coordinate overlay (`templates/png/*.png` reference renders). No data is
  guessed into blank fields; wrong values fail the fill-layout regression tests.
- Occupancy: `confirmHoaOccupancy` (`lib/guest-form.js`) fixes adults/minors and
  rejects impossible counts (1-2 adults, 0-2 minors, max 4 total).
- Template updates go through TDD: add the new original here, re-run fill
  layout tests, commit with the SHA-256. No silent substitution against live
  signed documents.

## Deploy & production boundaries

- The repo's `wrangler.toml` KV ids are placeholders by design. Real KV ids and
  secrets live in the secret store, never in git. Deployment is done from the
  verified owner wrangler account (Mac mini), not from a workspace run.
- `STUDIO_BRIEF.md` forbids deploying or calling production from a workspace
  run, sending mail, submitting an HOA package, or inferring approval from
  inbound email. Guest save persists a draft only.

## Verification (per commit)

`npm test` · `npm run check` · `npm run build` · `npm audit --json` — all green
on `main` (344 tests, audit 0 high/critical).