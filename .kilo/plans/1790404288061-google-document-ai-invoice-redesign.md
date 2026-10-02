# Google Cloud Invoice Processing Redesign

## Goal
Replace the current heuristic invoice reader in `supabase/functions/finance-intake/index.ts` with a production-grade hybrid OCR + LLM pipeline that can handle diverse invoice layouts, multi-item tables, poor scans, and audit/review requirements.

## Scope Decisions
- V1 document scope: invoices and bills only.
- Deferred to later phases: receipts, purchase orders, credit notes, and other AP document classes.
- Google Cloud is the primary implementation ecosystem.
- The processing runtime should move to a dedicated async worker/queue service.
- Supabase remains the app-facing system of record for finance state and review history.

## Research Summary
- Pure regex/MIME parsing is not sufficient for invoice variability, especially for line items, multi-page layouts, and low-quality scans.
- Google Document AI is the best fit for this repo because Gmail is already part of the intake flow and Document AI has strong invoice + layout extraction, confidence metadata, and custom extractor support.
- Azure Document Intelligence and AWS Textract are both viable competitors, but the Google stack is the cleanest operational fit here.
- The right pattern is hybrid: deterministic OCR/document extraction first, LLM-based normalization and repair second, human review for low-confidence or conflicting outputs last.
- The LLM should validate and normalize. It should not be the sole source of truth for totals, dates, or line items.

## Recommended Target Architecture
1. Intake
   - Support Gmail, manual upload, and API ingestion.
   - Store raw documents and metadata separately from extracted data.
   - Create a job record immediately and enqueue processing asynchronously.

2. Orchestration
   - Move heavy processing out of Supabase Edge Functions into Google Cloud Run workers behind Pub/Sub or Cloud Tasks.
   - Use a queue-backed design for retries, dead-letter handling, backpressure, and parallel processing.
   - Keep Supabase as the system of record for app-visible finance records and review state.

3. OCR / document extraction
   - Use Google Document AI Invoice Parser for standard invoices.
   - Use Document AI Layout / OCR on scanned or malformed documents.
   - Add a custom extractor for recurring school-specific fields if needed.

4. LLM layer
   - Use a vision-capable model (Gemini) to repair ambiguous fields, resolve vendor naming variants, and normalize messy line items.
   - Use structured-output prompting only, with schema validation and bounded retries.
   - Never allow the LLM to invent totals or line items without source evidence.

5. Validation and scoring
   - Validate subtotal + tax = total within tolerance.
   - Enforce currency, date, duplicate, and invoice-number checks.
   - Score field confidence per document and per line item.
   - Route mismatches and low-confidence fields to review.

6. Review and posting
   - Keep a human review queue for exceptions, not for all documents.
   - Preserve citations, bounding boxes, and source page references in the review UI.
   - Post only validated outputs to downstream finance records and Xero.

## Data Model Plan
- Keep current finance domain tables as the business-facing contract where possible.
- Add processing tables for the new pipeline:
  - document jobs / batch records
  - raw document artifacts
  - extraction runs
  - field-level observations with provenance
  - line-item confidence and corrections
  - review actions and reviewer decisions
- Preserve field provenance for every extracted value, including page number, bounding box, source processor, and confidence.
- Retire the old heuristic-only payload path after the new pipeline is stable.

## Migration Plan
1. Baseline the current system
   - Capture current success rate, failure modes, and document mix.
   - Build a labeled test set of invoices covering PDFs, scans, email attachments, multi-page docs, and multi-item invoices.
   - Include hard cases: skewed scans, faint text, merged cells, repeated suppliers, and invoices with mixed tax lines.

2. Build the new pipeline in parallel
   - Implement ingestion, queueing, OCR, LLM normalization, validation, and review.
   - Run it in shadow mode against existing production inputs.

3. Compare outputs
   - Compare header fields, line items, totals, and posting readiness against human-labeled ground truth.
   - Measure straight-through processing, review rate, and correction rate.

4. Cut over
   - Switch new invoices to the new pipeline.
   - Keep the old function as a fallback only until the new path is stable.

5. Decommission
   - Remove or disable the old heuristic extraction path.
   - Keep only compatibility shims if any downstream code still reads legacy records.

## Implementation Workstreams
- Ingestion service
  - Gmail fetch / attachment ingest
  - manual upload ingest
  - API ingest endpoint
  - document deduplication and source fingerprinting

- Processing service
  - OCR/document parsing
  - LLM normalization
  - validation engine
  - duplicate detection
  - fallback retry path for OCR failures

- Review UI
  - confidence display
  - citations / bounding boxes
  - line-item correction flow
  - approve / reject / send-back actions

- Integration layer
  - Xero posting after validation
  - event logging and status updates

- Observability
  - structured logs
  - retry metrics
  - queue depth
  - document latency
  - field-level accuracy metrics

## Validation Plan
- Offline benchmark against the labeled invoice set.
- Shadow-mode run on live traffic before cutover.
- Required checks:
  - invoice number accuracy
  - supplier accuracy
  - invoice date and due date accuracy
  - totals and tax consistency
  - line-item count and row alignment
  - duplicate detection precision
  - review routing correctness
  - citation coverage for low-confidence fields
  - straight-through processing rate by vendor cluster

## Recommended V1 Delivery Shape
- Front door: Gmail, manual upload, and API.
- Processing: Google Cloud Run worker + queue.
- OCR: Document AI Invoice Parser and Layout/OCR fallback.
- LLM: Gemini only for normalization, repair, and schema completion.
- Storage: raw docs in object storage, metadata in Supabase, review state in Supabase.
- Output: validated invoice records and line items only.

## Risks
- Vendor lock-in if the extraction schema is too tightly coupled to one provider.
- LLM hallucination if validation and citation checks are weak.
- Poor scan quality still needs image preprocessing and human review.
- Cost growth if every document goes through multiple model passes.
- Migration risk if legacy tables are changed before the new pipeline is stable.

## Explicitly Out of Scope For This Phase
- Rebuilding the entire finance dashboard.
- Changing unrelated app routes or auth behavior.
- Receipts, purchase orders, credit notes, and other non-invoice AP documents.
- Replacing the finance data model unless the new processing tables require it.

## Decommission Criteria
- New pipeline meets benchmark accuracy on the labeled corpus.
- Shadow-mode mismatches are understood and acceptably low.
- Review volume is reduced to exceptions only.
- Downstream posting continues to work without legacy extraction logic.
