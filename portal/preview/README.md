# Owner-only acceptance preview

`guard.js` is a separate preview-only entry guard, not imported by the normal
Pages router. It is not a production configuration or a deployment command.

The private acceptance build supplies the real property copy and existing blank
PDF sources. It bundles the current application with this guard and a socket
adapter that always rejects connections. No real signatures, guest records,
Gmail/Telegram credentials or gbrain access are included.

## Isolation contract

- Require `PREVIEW_ONLY=yes`, the exact configured HTTPS `PREVIEW_HOST`, a
  dedicated username and a random password of at least 32 characters.
- Authenticate every allowed route, including guest links and PDF requests.
- Map only `PREVIEW_CASES` and `PREVIEW_CASE_STORE` into application storage.
  The provisioning step must independently verify their namespace identities
  differ from production. Names alone do not prove isolation.
- Construct the application environment from an explicit allowlist. Never
  forward the original environment. Disable all transport/automation flags and
  omit live transport, import and reviewer credentials.
- Allow only selected read routes and synthetic workflow mutations. Block
  submission, live-mode activation, mailbox polling, export and unknown actions.
- Apply no-store/noindex headers, a visible test banner and disable external
  HTML links and redirects. Do not distribute technical preview URLs to guests.
- Keep the case-store worker private, without workers.dev, preview URLs or cron
  schedules. Remove the one-time empty initialization binding after setup.
- Bundle private PDF assets behind the authenticated worker, not as static
  uploads. Cloudflare's project-level `fail_open` field must match production
  and preview. Do not change production to accommodate this preview. The only
  static fallback should be a neutral unavailable page with no private data.

The preview-specific state/initialization/cancellation harness lives outside Git
alongside the private build and is not part of the production application. Its
state endpoint contains synthetic data only and requires preview authentication.
Initialization must remain disabled after the initial empty test-store setup.

## Verified on 2026-09-05

An isolated preview was published in the existing Cloudflare Pages project with
a new test KV namespace and a private SQLite Durable Object. The production
deployment and production configuration fingerprint were checked before and
after and were unchanged. Real guest/HOA messages, payments and production data
mutations: none.

44 initial HTTP assertions passed against the deployed preview, including:

- authentication, no-store headers, private property copy and test banner;
- blocked send/poll/live-enable actions and cross-origin writes;
- two synthetic bookings using paper and Tenant Evaluation paths;
- encrypted partial draft persistence, incomplete status and stale-write rejection;
- guest-reported screening without fabricated payment or HOA approval;
- blocked approval toggle and closed access after synthetic cancellation.

After disabling initialization and redeploying only the test-store worker,
17 further HTTP assertions passed. Both synthetic cases and the encrypted draft
remained available; initialization was rejected. This is not a physical power-loss
test. Automation health intentionally returns 503 because no scheduler is active.

Local checks: 311 JavaScript tests, syntax checks and Pages build pass;
`npm audit --json` reports zero vulnerabilities across 96 dependencies. The prior
complete local verification also passed 38 Python tests and isolated restart /
backup restore tests. No browser visual inspection or real mail-delivery check
is implied by the HTTP acceptance results.

Private deployment IDs, source snapshots, credentials and detailed acceptance
receipts remain outside GitHub. The pre-existing router/UI diff remains outside
these commits; its current contents were preserved in the private preview build.

## Still not production acceptance

Real transport delivery, real HOA evidence matching, the production encryption
key distribution, production atomic-store cutover and operational alerts remain
separate gates. Keep Tenant Evaluation and the existing seven-day booking notice;
neither this preview nor passing tests guarantees HOA processing time.
