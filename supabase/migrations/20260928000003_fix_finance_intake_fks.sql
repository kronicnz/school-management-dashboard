-- Break the foreign-key circularity in the finance intake pipeline and preserve the
-- audit trail when staging rows are purged.
--
-- 1. finance_intake_items previously carried xero_link_id and candidate_id back-references,
--    creating a cycle: intake_items -> candidates -> intake_items and
--    intake_items -> xero_links -> candidates. The reverse links are redundant because
--    finance_invoice_candidates.intake_item_id (unique) and
--    finance_xero_links.candidate_id (unique) already point the other way. Dropping them
--    makes the graph strictly unidirectional and removes the migration deadlock risk.
-- 2. finance_processing_events used ON DELETE CASCADE on batch_id, intake_item_id and
--    candidate_id, so purging a batch also erased its compliance log. Switch to
--    ON DELETE SET NULL so the audit trail survives raw-staging cleanup.

alter table public.finance_intake_items
  drop column if exists xero_link_id;

alter table public.finance_intake_items
  drop column if exists candidate_id;

alter table public.finance_processing_events
  drop constraint if exists finance_processing_events_batch_id_fkey;

alter table public.finance_processing_events
  add constraint finance_processing_events_batch_id_fkey
  foreign key (batch_id) references public.finance_intake_batches(id) on delete set null;

alter table public.finance_processing_events
  drop constraint if exists finance_processing_events_intake_item_id_fkey;

alter table public.finance_processing_events
  add constraint finance_processing_events_intake_item_id_fkey
  foreign key (intake_item_id) references public.finance_intake_items(id) on delete set null;

alter table public.finance_processing_events
  drop constraint if exists finance_processing_events_candidate_id_fkey;

alter table public.finance_processing_events
  add constraint finance_processing_events_candidate_id_fkey
  foreign key (candidate_id) references public.finance_invoice_candidates(id) on delete set null;