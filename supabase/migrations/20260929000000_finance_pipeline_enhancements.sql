-- Finance intake pipeline enhancements: async queue retry drain, strict validation
-- error surface, immutable field-level audit log, and Xero static-data cache.

create extension if not exists pg_cron;
create extension if not exists pgmq;

-- ---------------------------------------------------------------------------
-- 1. Validation error surface (Task 3)
-- ---------------------------------------------------------------------------

alter table public.finance_invoice_candidates
  add column if not exists validation_errors jsonb not null default '[]'::jsonb;

alter table public.finance_intake_items
  add column if not exists validation_errors jsonb not null default '[]'::jsonb;

-- The intake lane now distinguishes "extracted but the numbers do not add up"
-- (needs_review) from "the extractor exhausted its retries" (failed_review).
-- Both previously collapsed into the single 'failed' value, which made a
-- transient Gemini outage indistinguishable from a bad read.
alter table public.finance_intake_items
  drop constraint if exists finance_intake_items_status_check;

alter table public.finance_intake_items
  add constraint finance_intake_items_status_check
  check (status = any (array[
    'pending', 'extracting', 'review', 'needs_review', 'draft',
    'submitted', 'synced', 'exception', 'failed', 'failed_review'
  ]::text[]));

create index if not exists finance_invoice_candidates_validation_errors_idx
  on public.finance_invoice_candidates ((validation_errors <> '[]'::jsonb))
  where validation_errors <> '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 2. Immutable field-level audit log (Task 5)
-- ---------------------------------------------------------------------------

create table if not exists public.finance_intake_logs (
  id bigserial primary key,
  intake_item_id uuid null references public.finance_intake_items(id) on delete cascade,
  candidate_id uuid null references public.finance_invoice_candidates(id) on delete cascade,
  extraction_run_id uuid null references public.finance_extraction_runs(id) on delete set null,
  job_id uuid null references public.finance_intake_jobs(id) on delete set null,
  batch_id uuid null references public.finance_intake_batches(id) on delete set null,
  event_type text not null check (event_type = any (array[
    'created', 'ocr_processed', 'user_edited', 'xero_pushed',
    'xero_failed', 'validation_failed', 'retry_scheduled', 'review_opened'
  ]::text[])),
  -- Populated for user_edited: one row per altered field.
  field_name text null,
  original_value jsonb null,
  updated_value jsonb null,
  -- The full before/after map for a multi-field edit in a single request.
  diff jsonb not null default '[]'::jsonb,
  actor_id uuid null references public.profiles(id) on delete set null,
  actor_label text null,
  source text not null default 'system' check (source = any (array[
    'system', 'worker', 'user', 'scheduler'
  ]::text[])),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists finance_intake_logs_item_idx
  on public.finance_intake_logs(intake_item_id, created_at desc);
create index if not exists finance_intake_logs_candidate_idx
  on public.finance_intake_logs(candidate_id, created_at desc);
create index if not exists finance_intake_logs_event_idx
  on public.finance_intake_logs(event_type, created_at desc);
-- Extraction accuracy reporting: which fields the model gets wrong most often.
create index if not exists finance_intake_logs_field_idx
  on public.finance_intake_logs(field_name, event_type, created_at desc)
  where field_name is not null;

alter table public.finance_intake_logs enable row level security;

-- Immutability is enforced in the database, not in application code, so a bug in
-- the edge function or a direct PostgREST call still cannot rewrite history.
create or replace function public.finance_intake_logs_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'finance_intake_logs is append-only (attempted %)', tg_op
    using errcode = '0A000';
end;
$$;

drop trigger if exists finance_intake_logs_immutable on public.finance_intake_logs;
create trigger finance_intake_logs_immutable
  before update or delete on public.finance_intake_logs
  for each row execute function public.finance_intake_logs_block_mutation();

drop policy if exists "Finance users can view intake logs" on public.finance_intake_logs;
create policy "Finance users can view intake logs"
  on public.finance_intake_logs for select
  using (public.finance_can_view());

-- Managers may append (the edge function runs as service role and bypasses RLS;
-- this policy exists so an authenticated finance admin can record a manual
-- correction directly from the client). There is deliberately no update or
-- delete policy.
drop policy if exists "Finance managers can append intake logs" on public.finance_intake_logs;
create policy "Finance managers can append intake logs"
  on public.finance_intake_logs for insert
  with check (public.finance_can_manage());

-- ---------------------------------------------------------------------------
-- 3. Xero static-data cache (Task 4)
-- ---------------------------------------------------------------------------

create table if not exists public.finance_xero_cache (
  cache_key text primary key,
  tenant_id text not null,
  resource text not null,
  payload jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create index if not exists finance_xero_cache_expiry_idx
  on public.finance_xero_cache(expires_at);

alter table public.finance_xero_cache enable row level security;

drop policy if exists "Finance users can view xero cache" on public.finance_xero_cache;
create policy "Finance users can view xero cache"
  on public.finance_xero_cache for select
  using (public.finance_can_view());

drop policy if exists "Finance users can manage xero cache" on public.finance_xero_cache;
create policy "Finance users can manage xero cache"
  on public.finance_xero_cache for all
  using (public.finance_can_manage())
  with check (public.finance_can_manage());

-- ---------------------------------------------------------------------------
-- 4. Realtime CDC (Task 1)
-- ---------------------------------------------------------------------------
-- The dashboard subscribes to postgres_changes for these tables. Without a
-- publication entry the subscription connects successfully and then never
-- receives an event, which is indistinguishable from "no work is happening".

do $$
declare
  target text;
begin
  foreach target in array array[
    'finance_intake_items',
    'finance_invoice_candidates',
    'finance_intake_jobs',
    'finance_xero_links',
    'finance_intake_logs'
  ] loop
    if not exists (
      select 1
      from pg_publication p
      join pg_publication_rel pr on pr.prpubid = p.oid
      join pg_class c on c.oid = pr.prrelid
      join pg_namespace n on n.oid = c.relnamespace
      where p.pubname = 'supabase_realtime'
        and n.nspname = 'public'
        and c.relname = target
    ) then
      execute format('alter publication supabase_realtime add table public.%I', target);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Scheduled retry drain (Task 1)
-- ---------------------------------------------------------------------------
-- The queue is the existing finance_intake_jobs table: a worker claims a row by
-- flipping it to 'processing' and stamping locked_at/locked_by. A failed
-- extraction is re-queued as 'retrying' with a scheduled_for set by exponential
-- backoff, and this job is what promotes those rows back to 'queued' once their
-- backoff window has elapsed. The drain is pure SQL so it keeps working when no
-- client tab is open, which is the whole point of moving off client polling.

create or replace function public.finance_intake_promote_due_retries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  promoted integer;
  reclaimed integer;
begin
  update public.finance_intake_jobs
  set status = 'queued',
      scheduled_for = null,
      locked_at = null,
      locked_by = null,
      updated_at = now()
  where status = 'retrying'
    and (scheduled_for is null or scheduled_for <= now());

  get diagnostics promoted = row_count;

  -- A job that was claimed but never finished (worker killed mid-extraction)
  -- would otherwise sit in 'processing' forever. Reclaim it after ten minutes.
  update public.finance_intake_jobs
  set status = 'retrying',
      attempt_count = attempt_count + 1,
      scheduled_for = now(),
      locked_at = null,
      locked_by = null,
      last_error = coalesce(last_error, 'Worker lock expired before completion'),
      updated_at = now()
  where status = 'processing'
    and locked_at is not null
    and locked_at < now() - interval '10 minutes'
    and attempt_count < 3;

  get diagnostics reclaimed = row_count;

  return promoted + reclaimed;
end;
$$;

revoke all on function public.finance_intake_promote_due_retries() from public;

-- pg_cron is not available on every hosted plan and cannot be created inside a
-- transaction on some versions, so the schedule is registered defensively.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'finance-intake-retry-drain') then
      perform cron.schedule(
        'finance-intake-retry-drain',
        '* * * * *',
        'select public.finance_intake_promote_due_retries()'
      );
    end if;
  end if;
exception
  when others then
    raise notice 'pg_cron schedule skipped: %', sqlerrm;
end $$;
