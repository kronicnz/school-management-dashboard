-- Finance mirror for Gmail/Xero invoice intake and dashboard reporting.

create or replace function public.finance_can_view()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where profile_id = auth.uid()
      and active = true
      and role in ('site_admin', 'finance_admin', 'finance_read_only', 'board_member')
  );
$$;

create or replace function public.finance_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles
    where profile_id = auth.uid()
      and active = true
      and role in ('site_admin', 'finance_admin')
  );
$$;

create table if not exists public.finance_intake_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('gmail', 'manual_upload', 'manual_replay', 'scheduled_job')),
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'partial', 'failed')),
  source_label text null,
  message_count integer not null default 0,
  item_count integer not null default 0,
  processed_count integer not null default 0,
  error_count integer not null default 0,
  scheduled_for timestamptz null,
  started_at timestamptz null,
  finished_at timestamptz null,
  retry_of uuid null references public.finance_intake_batches(id) on delete set null,
  notes text null,
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_intake_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid null references public.finance_intake_batches(id) on delete set null,
  source_type text not null check (source_type in ('gmail', 'manual_upload')),
  source_fingerprint text not null unique,
  source_key text null,
  gmail_message_id text null,
  gmail_thread_id text null,
  label_name text null,
  subject text null,
  sender_email text null,
  received_at timestamptz null,
  file_name text null,
  mime_type text null,
  storage_path text null unique,
  status text not null default 'pending' check (status in ('pending', 'extracting', 'review', 'draft', 'submitted', 'synced', 'exception', 'failed')),
  confidence numeric(5,2) not null default 0,
  duplicate_risk text not null default 'unknown' check (duplicate_risk in ('clear', 'possible', 'confirmed', 'unknown')),
  xero_link_id uuid null,
  candidate_id uuid null,
  processed_at timestamptz null,
  failed_at timestamptz null,
  failure_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_invoice_candidates (
  id uuid primary key default gen_random_uuid(),
  intake_item_id uuid not null unique references public.finance_intake_items(id) on delete cascade,
  supplier_name text not null,
  supplier_alias text null,
  xero_contact_id text null,
  invoice_number text null,
  invoice_date date null,
  due_date date null,
  currency text not null default 'NZD',
  subtotal numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  gross_total numeric(14,2) not null default 0,
  line_items jsonb not null default '[]'::jsonb,
  extraction_payload jsonb not null default '{}'::jsonb,
  validation_flags jsonb not null default '{}'::jsonb,
  confidence numeric(5,2) not null default 0,
  duplicate_fingerprint text not null unique,
  match_state text not null default 'manual_review' check (match_state in ('high', 'medium', 'low', 'manual_review', 'blocked')),
  status text not null default 'new' check (status in ('new', 'validated', 'rejected', 'written')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_xero_links (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null unique references public.finance_invoice_candidates(id) on delete cascade,
  xero_tenant_id text not null,
  xero_invoice_id text not null unique,
  xero_invoice_number text null,
  xero_status text not null,
  xero_type text not null default 'ACCPAY',
  xero_url text null,
  idempotency_key text not null unique,
  create_status text not null default 'draft' check (create_status in ('draft', 'submitted', 'synced', 'failed')),
  last_synced_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_processing_events (
  id bigserial primary key,
  batch_id uuid null references public.finance_intake_batches(id) on delete cascade,
  intake_item_id uuid null references public.finance_intake_items(id) on delete cascade,
  candidate_id uuid null references public.finance_invoice_candidates(id) on delete cascade,
  event_type text not null check (event_type in ('queued', 'extracted', 'validated', 'duplicate_blocked', 'written', 'label_moved', 'retry_scheduled', 'failed', 'manual_review')),
  severity text not null default 'info' check (severity in ('info', 'warning', 'error')),
  details jsonb not null default '{}'::jsonb,
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.finance_budgets (
  id uuid primary key default gen_random_uuid(),
  budget_code text not null unique,
  fiscal_year text not null,
  term text not null,
  department text not null,
  category text not null,
  tracking_dimension text null,
  budget_amount numeric(14,2) not null default 0,
  actual_amount numeric(14,2) not null default 0,
  forecast_amount numeric(14,2) not null default 0,
  notes text null,
  is_active boolean not null default true,
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  horizon_weeks integer not null default 13,
  cash_balance numeric(14,2) not null default 0,
  projected_inflow numeric(14,2) not null default 0,
  projected_outflow numeric(14,2) not null default 0,
  budget_variance numeric(14,2) not null default 0,
  open_ap_count integer not null default 0,
  draft_bill_count integer not null default 0,
  awaiting_approval_count integer not null default 0,
  exception_count integer not null default 0,
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (snapshot_date, horizon_weeks)
);

create index if not exists finance_intake_batches_status_idx on public.finance_intake_batches(status, created_at desc);
create index if not exists finance_intake_batches_source_idx on public.finance_intake_batches(source, created_at desc);
create index if not exists finance_intake_items_batch_idx on public.finance_intake_items(batch_id, created_at desc);
create index if not exists finance_intake_items_status_idx on public.finance_intake_items(status, created_at desc);
create index if not exists finance_invoice_candidates_status_idx on public.finance_invoice_candidates(status, created_at desc);
create index if not exists finance_xero_links_status_idx on public.finance_xero_links(create_status, created_at desc);
create index if not exists finance_processing_events_item_idx on public.finance_processing_events(intake_item_id, created_at desc);
create index if not exists finance_processing_events_batch_idx on public.finance_processing_events(batch_id, created_at desc);
create index if not exists finance_budgets_period_idx on public.finance_budgets(fiscal_year, term, department, category);
create index if not exists finance_forecast_snapshots_date_idx on public.finance_forecast_snapshots(snapshot_date desc, horizon_weeks desc);

alter table public.finance_intake_batches enable row level security;
alter table public.finance_intake_items enable row level security;
alter table public.finance_invoice_candidates enable row level security;
alter table public.finance_xero_links enable row level security;
alter table public.finance_processing_events enable row level security;
alter table public.finance_budgets enable row level security;
alter table public.finance_forecast_snapshots enable row level security;

drop policy if exists "Finance users can view intake batches" on public.finance_intake_batches;
create policy "Finance users can view intake batches"
  on public.finance_intake_batches for select
  using (public.finance_can_view());

drop policy if exists "Finance users can manage intake batches" on public.finance_intake_batches;
create policy "Finance users can manage intake batches"
  on public.finance_intake_batches for all
  using (public.finance_can_manage())
  with check (public.finance_can_manage());

drop policy if exists "Finance users can view intake items" on public.finance_intake_items;
create policy "Finance users can view intake items"
  on public.finance_intake_items for select
  using (public.finance_can_view());

drop policy if exists "Finance users can manage intake items" on public.finance_intake_items;
create policy "Finance users can manage intake items"
  on public.finance_intake_items for all
  using (public.finance_can_manage())
  with check (public.finance_can_manage());

drop policy if exists "Finance users can view candidates" on public.finance_invoice_candidates;
create policy "Finance users can view candidates"
  on public.finance_invoice_candidates for select
  using (public.finance_can_view());

drop policy if exists "Finance users can manage candidates" on public.finance_invoice_candidates;
create policy "Finance users can manage candidates"
  on public.finance_invoice_candidates for all
  using (public.finance_can_manage())
  with check (public.finance_can_manage());

drop policy if exists "Finance users can view xero links" on public.finance_xero_links;
create policy "Finance users can view xero links"
  on public.finance_xero_links for select
  using (public.finance_can_view());

drop policy if exists "Finance users can manage xero links" on public.finance_xero_links;
create policy "Finance users can manage xero links"
  on public.finance_xero_links for all
  using (public.finance_can_manage())
  with check (public.finance_can_manage());

drop policy if exists "Finance users can view events" on public.finance_processing_events;
create policy "Finance users can view events"
  on public.finance_processing_events for select
  using (public.finance_can_view());

drop policy if exists "Finance users can manage events" on public.finance_processing_events;
create policy "Finance users can manage events"
  on public.finance_processing_events for all
  using (public.finance_can_manage())
  with check (public.finance_can_manage());

drop policy if exists "Finance users can view budgets" on public.finance_budgets;
create policy "Finance users can view budgets"
  on public.finance_budgets for select
  using (public.finance_can_view());

drop policy if exists "Finance users can manage budgets" on public.finance_budgets;
create policy "Finance users can manage budgets"
  on public.finance_budgets for all
  using (public.finance_can_manage())
  with check (public.finance_can_manage());

drop policy if exists "Finance users can view forecast snapshots" on public.finance_forecast_snapshots;
create policy "Finance users can view forecast snapshots"
  on public.finance_forecast_snapshots for select
  using (public.finance_can_view());

drop policy if exists "Finance users can manage forecast snapshots" on public.finance_forecast_snapshots;
create policy "Finance users can manage forecast snapshots"
  on public.finance_forecast_snapshots for all
  using (public.finance_can_manage())
  with check (public.finance_can_manage());

drop trigger if exists finance_intake_batches_updated_at on public.finance_intake_batches;
create trigger finance_intake_batches_updated_at
  before update on public.finance_intake_batches
  for each row execute function public.update_updated_at_column();

drop trigger if exists finance_intake_items_updated_at on public.finance_intake_items;
create trigger finance_intake_items_updated_at
  before update on public.finance_intake_items
  for each row execute function public.update_updated_at_column();

drop trigger if exists finance_invoice_candidates_updated_at on public.finance_invoice_candidates;
create trigger finance_invoice_candidates_updated_at
  before update on public.finance_invoice_candidates
  for each row execute function public.update_updated_at_column();

drop trigger if exists finance_xero_links_updated_at on public.finance_xero_links;
create trigger finance_xero_links_updated_at
  before update on public.finance_xero_links
  for each row execute function public.update_updated_at_column();

drop trigger if exists finance_budgets_updated_at on public.finance_budgets;
create trigger finance_budgets_updated_at
  before update on public.finance_budgets
  for each row execute function public.update_updated_at_column();

drop trigger if exists finance_forecast_snapshots_updated_at on public.finance_forecast_snapshots;
create trigger finance_forecast_snapshots_updated_at
  before update on public.finance_forecast_snapshots
  for each row execute function public.update_updated_at_column();

alter table public.finance_intake_items
  add constraint finance_intake_items_xero_link_id_fkey
  foreign key (xero_link_id) references public.finance_xero_links(id) on delete set null;

alter table public.finance_intake_items
  add constraint finance_intake_items_candidate_id_fkey
  foreign key (candidate_id) references public.finance_invoice_candidates(id) on delete set null;
