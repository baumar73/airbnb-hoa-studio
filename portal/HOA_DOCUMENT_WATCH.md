# HOA document inventory, archive and knowledge indexing

Status 2026-09-05: **local building blocks only; no unattended collector enabled**.
The owner requested periodic checks of the existing Condominium Associates
account, downloading new/revised documents and vector indexing in gbrain.
No new service, host, account, credential, deployment or scheduler was created.

## Implemented and locally tested

- `functions/lib/hoa-document-watch.js` compares complete, authenticated inventory
  snapshots for one fixed source. New content is identified by SHA-256, not only
  a filename or portal modification date. Versions remain referenced when files
  change or disappear. Returning and renamed files generate explicit events.
- Unchanged inventories emit no new change events. Unconfirmed index work remains
  in the queue. `indexedHashes` must only contain hashes whose exact content and
  embedding completion were verified at the destination; a request attempt is
  not confirmation.
- Authentication failure, partial listings, malformed hashes, duplicate/unsafe
  IDs, account mismatch and stale timestamps reject the inventory without
  modifying the previous baseline. Missing files do not mean revoked rules.
- `hoaDocumentWatchStatus` calculates weekly due dates and six-hour retries after
  recorded errors. It reports overdue work and login-required state. It does not
  install a scheduler or send alerts.
- `scripts/hoa_document_archive.py` accepts explicitly named downloaded PDFs,
  archives byte-identical originals outside Git, extracts text by page and uses
  local Tesseract for pages with fewer than 80 extractable characters. Each run
  retains its own extraction evidence. Existing different objects and symlinks
  are refused. Page payloads include source library, original hash, page number,
  extraction method and `unreviewed-source` status for gbrain.
- Extraction is not validation of every word or diagram. Existing text layers
  may themselves contain OCR mistakes. Empty and low-quality content need review.
  Site plans remain PDFs; text embeddings cannot reproduce their geometry.
- `functions/lib/hoa-document-index.js` adds a destination-adapter importer core.
  It validates the entire page set before writing, refuses conflicting existing
  versions, reconciles uncertain writes by exact read-back, checks complete chunk
  coverage and non-null embeddings, and awaits a durable page receipt before
  continuing. A document receipt is returned only after all pages pass. Thirteen
  synthetic tests cover retries, conflicts, partial chunks and receipt failures.
  This is not an activated account collector or restricted guest-sync client.

Example local archival command (no network writes):

```sh
python3 scripts/hoa_document_archive.py \
  --output-root /private/hoa-archive \
  --source-url https://example.com/document-library/ \
  /private/downloads/Rules.pdf /private/downloads/Lease.pdf
```

Dependencies: `pypdf`, `pdftotext`, `pdftoppm`, `tesseract` with English data.
Do not put originals, extraction JSON, account IDs, session cookies or credentials
in this repository. No SSNs, ID scans, screening reports or medical records belong
in this general HOA-document collection. Filled guest documents use the separate
scoped guest-knowledge design, not this source archive.

## Required production integration, still open

1. Connect a read-only collector on the **existing confirmed runtime**, using the
   existing authenticated account through a supported browser/session mechanism.
   Never export Safari cookies or bypass a password-manager prompt to automate it.
2. Enumerate the configured library and all selected subfolders, with stable remote
   document IDs, filenames, timestamps and authenticated account context. Only
   mark `complete: true` after every configured folder and page was read. A local
   downloads directory alone is not a complete remote inventory.
3. Download changed files, verify actual PDF bytes and archive them privately.
   Reconcile with single-writer locking and durable atomic state. Record failures
   separately; never turn a failed login into a successful empty inventory.
4. Use the existing gbrain connection to store exact extracted pages and verify
   them by read-back and indexed chunks/embedding evidence. Use immutable
   hash-addressed versions and deduplicate identical originals. Keep failed or
   uncertain jobs pending, checking existing destination state before retrying.
5. Run weekly, with bounded six-hour retries for temporary failures and a visible
   login-required/overdue alert. Deduplicate alerts; notify on meaningful change,
   failure or required action rather than every unchanged run. Test the alarm and
   process-restart behavior before activating the existing scheduler.
6. Display changed documents for owner review, including conflicts with approved
   requirements. Do not automatically rewrite fees, lease limits, cancellation
   rules, eligibility, approval state or live compliance attestations from PDFs.

## Actual retrieval and indexing state

Thirty PDF entries (255 pages, including one byte-identical three-page duplicate)
were downloaded through the owner's logged-in Safari session and archived outside
Git on 2026-09-05: 17 governing documents, five Tenant Evaluation documents, seven
updated property forms and the 2026 hurricane plan. This is **not** the entire
historical account archive: financials, insurance, minutes and other folders remain
outside this first retrieved set. The manifests deliberately say
`inventoryComplete: false`.

The original files and all extracted pages are preserved locally. The first two
MCP checks failed; a later owner-authorized retry found gbrain available and
began page imports. A private receipt preserves the first 24 verified pages;
additional pages were processed, but the full 252-unique-page batch is **not
confirmed complete**. Before resuming, inspect each existing destination page;
do not blindly overwrite it or equate a request attempt with indexing success.
No service restart or credential change was needed. Source-document imports do
not establish that the separate restricted guest-data sync is ready.

See [documentary comparison](HOA_DOCUMENT_AUDIT_2026-09-05.md) for findings that
need to be resolved before any unattended activation.
