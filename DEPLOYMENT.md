# Isla del Sol 405D deployment runbook

This repository is prepared as a deployment candidate for the private HOA coordination portal for **Palma del Mar No. 2, Unit 405D**.

## Fixed release boundary

The website may be deployed only after every preflight and acceptance gate below is green.

The following capabilities intentionally remain unavailable after deployment:

- automated live delivery to the HOA or its vendor;
- binary uploads before content-level DLP exists;
- receipt email export before an explicit recipient allowlist is reviewed;
- check-in release without documented, case-specific Board Approval.

A deployment does not authorize any external email, HOA submission, guest message, or production-data migration.

This runbook covers the **Cloudflare Pages project only**. The separate worker under `portal/cron/` performs mailbox polling and Telegram notifications when deployed and configured; it is outside this release boundary. Do not run a Worker deployment from `portal/cron/` without a separate explicit approval for that automation and its outbound messages.

## Canonical target

- **Canonical origin:** `https://isladelsol405d.com`
- **Cloudflare Pages project:** `isla-405d`
- **Airbnb listing:** `1097686557541958107`
- **Production CASES namespace:** `d14475cc0abe4834b1ac60daca8567b0`
- **Preview CASES namespace:** `fdd598833b26455bab745d6d135d547a`

Production and preview KV namespaces must remain distinct.

## Secrets

Only the names belong in documentation. Values stay in the configured secret store and must never be committed or printed:

- `ADMIN_PASSWORD`
- `GMAIL_APP_PASSWORD`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

Before deployment, verify the required secret names exist in the target environment without reading or displaying their values.

## Optional Operations integrations

The Operations dashboard starts safely without remote integrations. Remote Hermes and Mac-mini checks remain unavailable unless their locations are explicitly configured in the runtime environment:

- `HERMES_HOST`
- `HERMES_SYNC_PATH`
- `HERMES_REMOTE_STATE_PATH`
- `HERMES_REMOTE_HOME`
- `HERMES_IMESSAGE_HOST`
- `HERMES_IMESSAGE_BRIDGE_PATH`
- `AIRBNB_HOA_GBRAIN_HOST`
- `AIRBNB_HOA_GBRAIN_REMOTE_BASE`
- `AIRBNB_HOA_GBRAIN_REMOTE_CWD`
- `AIRBNB_ICAL_SECRET_FILE`
- `AIRBNB_HOA_PROJECT_DIR`

These are locations or host references, not credentials. Keep credential values in the configured secret store. An unset variable must produce an unavailable/warning state, never a guessed host, guessed home directory or automatic send.

## Mandatory preflight

From the repository root:

```sh
cd portal
npm ci
npm test
npm run check
npm run build
npm audit --audit-level=high
npm run preflight:production
cd ../operations
python3 tools/server_contract_test.py
python3 tools/ui_contract_check.py
node --check server.mjs
node --check public/app.js
cd ..
sha256sum -c SHA256SUMS
```

The release is blocked by any failure, any runtime placeholder, any secret finding, a non-empty clean Operations seed, or any path that can enable live HOA delivery from mutable state.

## Preview acceptance

1. Back up the target preview namespace if it contains useful test data.
2. Deploy the exact reviewed commit to a non-production branch/preview only.
3. Confirm the preview uses the preview KV namespace.
4. Run desktop, 390 px and 320 px browser UAT.
5. Verify skip links, focus, labels, Reduced Motion, no horizontal overflow and WCAG-AA CTA contrast.
6. Verify `<30`, `30`, and `>30` rental-night behavior and the separate non-counting maintenance nights.
7. Verify Board, vendor, fee and check-in gates with synthetic data only.
8. Verify upload, receipt export and live-submission routes return fail-closed responses.

No preview test may send real email or modify production KV.

## Production deployment gate

Production deployment requires a separate explicit instruction naming the production target after the exact commit has passed Linux, independent review and isolated Mac-mini verification.

Immediately before deployment:

1. Read back the current production deployment and record its ID.
2. Export/backup the production KV namespace without exposing its contents in chat or logs.
3. Verify the reviewed Git commit and SHA-256 manifest.
4. Verify Cloudflare secret names exist.
5. Confirm the custom domain still points to the `isla-405d` project.
6. Deploy the exact commit, not the working tree.
7. Run smoke tests against the canonical origin without sending messages or creating real cases.
8. Read back the deployment ID, commit and custom-domain status.

## Rollback

The production deployment observed before this candidate was:

- **Deployment ID:** `dc39211d-9b53-4367-8918-8747415a6924`
- **Source:** `19d2b05`
- **Pages URL:** `https://dc39211d.isla-405d.pages.dev`

If smoke tests fail, roll back the Pages deployment first. Restore KV only from the pre-deployment backup and only if the deployment made a verified state change. Never replace newer production data speculatively.

## Post-deployment evidence

Record and verify:

- exact Git commit and tree;
- Cloudflare deployment ID and URL;
- custom-domain health;
- production and preview KV bindings;
- test totals and timestamps;
- live-submission, upload and receipt-export disabled status;
- rollback handle.
