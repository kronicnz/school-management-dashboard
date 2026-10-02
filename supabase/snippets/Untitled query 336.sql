-- Finance intake pipeline scaffolding for async jobs and field provenance.

create table if not exists public.finance_document_artifacts (
  id uuid primary key default gen_random_uuid(),
  intake_item_id uuid not null unique references public.finance_intake_items(id) on delete cascade,
  source_type text not null check (source_type in ('gmail', 'manual_upload', 'manual_replay', 'scheduled_job')),
  source_fingerprint text not null,
  file_name text null,
  mime_type text null,
  storage_path text null,
  artifact_hash text null,
  page_count integer null,
  raw_excerpt text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_fingerprint)
);

create table if not exists public.finance_intake_jobs (
  id uuid primary key default gen_random_uuid(),
  intake_item_id uuid not null unique references public.finance_intake_items(id) on delete cascade,
  document_artifact_id uuid null references public.finance_document_artifacts(id) on delete set null,
  queue_name text not null default 'finance-intake',
  job_type text not null default 'extract' check (job_type in ('extract', 'review', 'post_xero')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'retrying', 'completed', 'failed')),
  scheduled_for timestamptz null,
  locked_at timestamptz null,
  locked_by text null,
  attempt_count integer not null default 0,
  last_error text null,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  intake_item_id uuid not null references public.finance_intake_items(id) on delete cascade,
  document_artifact_id uuid null references public.finance_document_artifacts(id) on delete set null,
  job_id uuid null references public.finance_intake_jobs(id) on delete set null,
  processor_name text not null,
  processor_chain jsonb not null default '[]'::jsonb,
  status text not null default 'completed' check (status in ('queued', 'processing', 'completed', 'failed')),
  confidence numeric(5,2) not null default 0,
  review_required boolean not null default false,
  review_reason text null,
  source_payload jsonb not null default '{}'::jsonb,
  normalized_payload jsonb not null default '{}'::jsonb,
  validation_payload jsonb not null default '{}'::jsonb,
  error_message text null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_field_observations (
  id bigserial primary key,
  extraction_run_id uuid not null references public.finance_extraction_runs(id) on delete cascade,
  field_name text not null,
  field_value jsonb null,
  source_processor text not null,
  confidence numeric(5,2) not null default 0,
  source_page integer null,
  bounding_box jsonb null,
  evidence_text text null,
  created_at timestamptz not null default now()
);

alter table public.finance_intake_items
  add column if not exists document_artifact_id uuid null references public.finance_document_artifacts(id) on delete set null;

alter table public.finance_intake_items
  add column if not exists active_job_id uuid null references public.finance_intake_jobs(id) on delete set null;

alter table public.finance_intake_items
  add column if not exists extraction_run_id uuid null references public.finance_extraction_runs(id) on delete set null;

alter table public.finance_intake_items
  add column if not exists extraction_summary jsonb not null default '{}'::jsonb;

alter table public.finance_invoice_candidates
  add column if not exists extraction_run_id uuid null references public.finance_extraction_runs(id) on delete set null;

alter table public.finance_invoice_candidates
  add column if not exists source_artifact_id uuid null references public.finance_document_artifacts(id) on delete set null;

alter table public.finance_invoice_candidates
  add column if not exists provenance jsonb not null default '{}'::jsonb;

alter table public.finance_invoice_candidates
  add column if not exists validation_summary jsonb not null default '{}'::jsonb;

create index if not exists finance_document_artifacts_item_idx on public.finance_document_artifacts(intake_item_id);
create index if not exists finance_document_artifacts_source_idx on public.finance_document_artifacts(source_fingerprint);
create index if not exists finance_intake_jobs_status_idx on public.finance_intake_jobs(status, created_at desc);
create index if not exists finance_intake_jobs_queue_idx on public.finance_intake_jobs(queue_name, status, created_at desc);
create index if not exists finance_extraction_runs_item_idx on public.finance_extraction_runs(intake_item_id, created_at desc);
create index if not exists finance_extraction_runs_status_idx on public.finance_extraction_runs(status, created_at desc);
create index if not exists finance_field_observations_run_idx on public.finance_field_observations(extraction_run_id, created_at asc);
create index if not exists finance_field_observations_field_idx on public.finance_field_observations(field_name, created_at desc);

alter table public.finance_document_artifacts enable row level security;
alter table public.finance_intake_jobs enable row level security;
alter table public.finance_extraction_runs enable row level security;
alter table public.finance_field_observations enable row level security;

drop policy if exists "Finance users can view document artifacts" on public.finance_document_artifacts;
create policy "Finance users can view document artifacts"
  on public.finance_document_artifacts for select
  using (public.finance_can_view());

drop policy if exists "Finance users can manage document artifacts" on public.finance_document_artifacts;
create policy "Finance users can manage document artifacts"
  on public.finance_document_artifacts for all
  using (public.finance_can_manage())
  with check (public.finance_can_manage());

drop policy if exists "Finance users can view intake jobs" on public.finance_intake_jobs;
create policy "Finance users can view intake jobs"
  on public.finance_intake_jobs for select
  using (public.finance_can_view());

drop policy if exists "Finance users can manage intake jobs" on public.finance_intake_jobs;
create policy "Finance users can manage intake jobs"
  on public.finance_intake_jobs for all
  using (public.finance_can_manage())
  with check (public.finance_can_manage());

drop policy if exists "Finance users can view extraction runs" on public.finance_extraction_runs;
create policy "Finance users can view extraction runs"
  on public.finance_extraction_runs for select
  using (public.finance_can_view());

drop policy if exists "Finance users can manage extraction runs" on public.finance_extraction_runs;
create policy "Finance users can manage extraction runs"
  on public.finance_extraction_runs for all
  using (public.finance_can_manage())
  with check (public.finance_can_manage());

drop policy if exists "Finance users can view field observations" on public.finance_field_observations;
create policy "Finance users can view field observations"
  on public.finance_field_observations for select
  using (public.finance_can_view());

drop policy if exists "Finance users can manage field observations" on public.finance_field_observations;
create policy "Finance users can manage field observations"
  on public.finance_field_observations for all
  using (public.finance_can_manage())
  with check (public.finance_can_manage());

drop trigger if exists finance_document_artifacts_updated_at on public.finance_document_artifacts;
create trigger finance_document_artifacts_updated_at
  before update on public.finance_document_artifacts
  for each row execute function public.update_updated_at_column();

drop trigger if exists finance_intake_jobs_updated_at on public.finance_intake_jobs;
create trigger finance_intake_jobs_updated_at
  before update on public.finance_intake_jobs
  for each row execute function public.update_updated_at_column();

drop trigger if exists finance_extraction_runs_updated_at on public.finance_extraction_runs;
create trigger finance_extraction_runs_updated_at
  before update on public.finance_extraction_runs
  for each row execute function public.update_updated_at_column();
