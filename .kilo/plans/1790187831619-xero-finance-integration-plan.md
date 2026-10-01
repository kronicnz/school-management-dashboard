# Xero Finance Integration Plan

## Goal
Integrate Xero accounting with an AI-driven invoice intake pipeline that processes both Gmail emails labeled `Invoices to process` and manually uploaded invoices through one unified queue, then surfaces a finance-first dashboard inside the existing `/` dashboard so finance users can review bills, approvals, cash position, budget variance, and school-specific financial insights without opening Xero.

## Locked Decisions
- Keep finance inside the existing dashboard route and presentation shell.
- Use a scheduled Gmail pull job as the primary intake mechanism.
- Treat Gmail-labeled emails and manual uploads as one queue with the same dedupe, extraction, confidence scoring, and Xero write path.
- Use Xero as the system of record for bill creation and approval state.
- Persist a local Supabase finance mirror for dashboard reporting and auditability.
- Maintain a local school budget/forecast table for budget-vs-actual reporting and short-term forecasting.
- Map high-confidence bills to Xero `ACCPAY` invoices with `SUBMITTED` status (`Awaiting Approval` in Xero UI).
- Map uncertain bills to Xero `ACCPAY` invoices with `DRAFT` status.

## Relevant Xero Rules
- Authenticate with OAuth2 and request the accounting scopes needed for invoice/bill creation and readback.
- Use the `Invoices` endpoint for purchase bills by setting `Type = ACCPAY`.
- Use `Status = SUBMITTED` for bills that should land in `Awaiting Approval`.
- Use `Status = DRAFT` when extraction, price matching, or tax confidence is not strong enough.
- Send an idempotency key with create requests so retries do not create duplicates.
- Before create, search for possible duplicates using normalized contact, reference, date, total, and source fingerprint.

## Proposed Architecture
1. Add a finance intake edge function, modeled on the existing Google Workspace sync patterns, that runs on a cron schedule and also accepts manual replays.
2. Store all intake items in a unified queue table with a normalized source fingerprint, source type, extraction status, confidence scores, and Xero linkage fields.
3. Use an AI extraction adapter to convert source PDFs, images, and email bodies into a standard invoice payload with header fields, supplier, dates, totals, tax, and multi-line items.
4. Run validation and duplicate detection before any Xero write.
5. Write the final bill to Xero, then persist the Xero IDs and status back into the local mirror.
6. Only move Gmail mail from `Invoices to process` to `Invoices processed` after the Xero write and local persistence both succeed.
7. Drive the dashboard from the local mirror, budget table, and summary snapshots, not directly from browser-side Xero calls.

## Data Model
Add finance-specific tables or equivalent mirrored records in Supabase:
- `finance_intake_items`: one row per Gmail message, attachment, or manual upload.
- `finance_intake_batches`: batch-level run metadata, schedule source, and retry state.
- `finance_invoice_candidates`: parsed invoice header, line items JSON, validation flags, confidence, and duplicate check results.
- `finance_xero_links`: Xero tenant, invoice ID, invoice number, status, and sync timestamps.
- `finance_processing_events`: audit trail for extraction, validation, create, label move, retry, and failure events.
- `finance_budgets`: local school budget lines by term, department, category, or tracking dimension.
- `finance_forecast_snapshots`: rolling forecast values derived from Xero actuals plus local budget assumptions.
- Budget rows should be editable in-app and importable from CSV so finance users can maintain them without leaving the dashboard.
- Optional lookup tables for supplier aliases and account/category mappings if needed for better matching.

## Processing Flow
1. Cron job starts and loads new Gmail messages with the `Invoices to process` label plus any manual upload rows still pending.
2. The intake worker normalizes each source into a common canonical document bundle.
3. OCR/document parsing and AI extraction produce structured invoice data and a confidence score.
4. Validation checks compare header totals, line totals, tax calculations, supplier match, duplicate fingerprints, and any stored school accounting rules; if the supplier cannot be matched confidently to an existing Xero contact or approved alias, hold the item for manual review instead of auto-creating a new contact.
5. If confidence is high and validations pass, create an `ACCPAY` bill in Xero with `SUBMITTED` status.
6. If confidence is medium or there are reading/price-matching uncertainties, create the Xero bill as `DRAFT`.
7. If confidence is too low or duplicate risk is unresolved, do not create a Xero bill; place the item in an exception queue for review.
8. After a successful Xero write, persist the Xero IDs, update the local mirror, and move the Gmail message to `Invoices processed`.
9. On failure, leave the source labeled for retry, record the error, and avoid changing Gmail labels.

## Duplicate Prevention
- Generate a deterministic fingerprint from supplier name, supplier invoice number, invoice date, currency, gross total, and normalized line-item hash.
- Check the local mirror first so repeated runs do not reprocess the same source.
- Check Xero before create using normalized contact/reference/amount matching and any available source document metadata.
- Send a stable idempotency key per canonical fingerprint to Xero create requests.
- Store the Xero invoice ID immediately on success and mark the intake item closed.

## Confidence And Status Rules
- `SUBMITTED` only when the supplier, totals, tax, and line items all validate cleanly and the duplicate risk is clear.
- `DRAFT` when the AI read is usable but any price, tax, or line matching issue remains.
- Exception queue when the document is unreadable, ambiguous, below the minimum confidence threshold, or lacks a confident supplier/contact match.
- Keep the threshold values configurable in env or settings so the finance team can tune them without code changes.

## Dashboard Design
Keep the finance experience inside the existing dashboard route, but add a finance-specific layout and drill-down panels for finance roles.

### Summary Strip
- Cash on hand
- Accounts payable due in 7/30 days
- Month-to-date spend vs budget
- Bills awaiting approval
- Draft bills needing review
- Processing exceptions

### Drill-Down Panels
- Intake card: inline drag-and-drop upload surface with file validation, batch counts, and immediate queue feedback.
- Invoice intake queue: Gmail uploads, manual uploads, processing state, confidence, and source traceability.
- AP aging: current, 1-30, 31-60, 61-90, 90+ days.
- Budget vs actual: by month and by school-relevant category or tracking dimension, backed by local budget lines when Xero budgets are unavailable.
- Budget maintenance: editable budget grid with CSV import/export and validation for term/category totals.
- Expense composition: curriculum, property, ICT, payroll-related, transport, utilities, subscriptions, and general admin where available from Xero data.
- Cash movement: rolling 13-week forecast or closest available cashflow view.
- Supplier concentration: top vendors by spend and open bill exposure.
- Exception and approval review: bills with low confidence, duplicates blocked, and items awaiting approval.

### School-Specific Framing
- Use terminology that fits intermediate school finance workflows: term-to-date spend, department spend, property maintenance, ICT replacement, curriculum resources, and grant or activity fund visibility where the underlying data exists.
- Treat local budget categories as editable finance metadata rather than invented accounting data.
- Show NZD only.
- Avoid Xero jargon in the top-level copy; keep Xero-specific details in drill-downs and tooltips.

## UI And Shell Impact
- Preserve the current route structure and protected-route behavior.
- Update dashboard copy and section ordering so finance roles land on a finance-first summary.
- Add finance-focused tabs or cards within the existing dashboard instead of introducing a new route.
- Put manual upload entry into an inline drag-and-drop intake card inside the finance dashboard so uploads and queue status stay in one place.
- Reuse existing shared UI primitives for tables, badges, dialogs, and cards.
- Keep mobile/tablet behavior compact, with horizontal scroll or stacked cards where tables would otherwise overflow.

## Implementation Steps
1. Inspect and extend the existing Google Workspace sync pattern to create a finance intake edge function and a supporting cron entry.
2. Add the finance queue and mirror tables, plus any indexes and uniqueness constraints needed for fingerprint-based dedupe.
3. Implement Gmail label lookup, message fetch, attachment download, and label transition helpers.
4. Add a provider-agnostic AI extraction layer that returns structured invoice JSON and confidence metadata.
5. Implement validation and duplicate detection before any Xero create call.
6. Integrate Xero OAuth2 token handling and tenant selection, then create `ACCPAY` invoices with `DRAFT` or `SUBMITTED` status based on confidence.
7. Persist Xero results, source fingerprints, and event history in the local mirror.
8. Add budget import/edit support for finance users, including CSV validation, to provide the local source of truth for budget-vs-actual and forecast panels.
9. Build the inline intake card for manual uploads and wire it into the same queue and validation path as Gmail items.
10. Extend the dashboard data loader to read finance mirror data and render the finance-specific summary and drill-down panels.
11. Add a manual replay path for failed items and a review state for low-confidence or duplicate-ambiguous documents.
12. Update mock personas and finance-role test fixtures so finance admin, finance read-only, and board member flows can be verified.

## Failure Modes To Guard Against
- Gmail labels move before the Xero write completes.
- A retry creates a duplicate bill because idempotency and local fingerprinting are missing.
- Low-confidence extractions are auto-posted as approved bills.
- A supplier gets auto-created in Xero when the match is uncertain, fragmenting the contact list.
- Draft bills are mistaken for final approved entries in the dashboard.
- The dashboard falls back to fake finance numbers instead of the mirrored source of truth.
- Manual uploads and Gmail items diverge into separate logic paths.

## Validation Plan
- Run `npm run build`.
- Run `npm run lint`.
- Extend or add edge-function tests for Gmail intake, dedupe, Xero payload shaping, label transitions, and failure retries.
- Verify finance dashboard rendering for finance_admin, finance_read_only, and board_member personas.
- Verify budget import/edit, forecast snapshots, and budget-vs-actual rendering for finance_admin and read-only finance roles.
- Smoke test the full path with one Gmail-labeled invoice, one manual upload, one duplicate source, and one low-confidence sample.

## Out Of Scope For This Pass
- Payments, bank reconciliation, and direct Xero payment posting.
- Multi-tenant finance separation beyond the current school workspace model.
- Replacing the existing dashboard shell or introducing a separate finance route.
- Full accounting-policy automation beyond bill ingestion, approval-state selection, and reporting.
