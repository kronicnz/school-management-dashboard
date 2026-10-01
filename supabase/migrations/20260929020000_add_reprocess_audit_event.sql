-- Adds the audit event type emitted when a finance user asks the worker to
-- re-read an invoice from the review panel. The append-only log table blocks
-- updates and deletes, so the CHECK constraint is the only place the allowed
-- vocabulary lives; adding a value here is what makes the new event_type
-- insertable rather than a constraint violation.

alter table public.finance_intake_logs
  drop constraint if exists finance_intake_logs_event_type_check;

alter table public.finance_intake_logs
  add constraint finance_intake_logs_event_type_check
  check (event_type = any (array[
    'created', 'ocr_processed', 'user_edited', 'xero_pushed',
    'xero_failed', 'validation_failed', 'retry_scheduled', 'review_opened',
    'reprocess_requested'
  ]::text[]));