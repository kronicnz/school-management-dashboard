-- Supplier alias & Xero account-code mapping table.
--
-- Invoices posted without a known vendor mapping either fail in Xero or land on a default
-- GL code that does not match the purchase type. This table lets the intake pipeline:
--   * fuzzy-match a raw AI supplier name against a known Xero contact, and
--   * default the per-line account code from the supplier's historical purchase categories.
--
-- The mapping is seeded with the recurring school vendors and their typical account codes,
-- and grows as bills are posted and reviewed.

create table if not exists public.finance_supplier_aliases (
  id uuid primary key default gen_random_uuid(),
  supplier_name text not null,
  normalized_name text not null,
  nzbn text null,
  xero_contact_id text null,
  xero_contact_name text null,
  default_account_code text null,
  category text null,
  active boolean not null default true,
  usage_count integer not null default 0,
  notes text null,
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_name)
);

create index if not exists finance_supplier_aliases_normalized_idx on public.finance_supplier_aliases (normalized_name);
create index if not exists finance_supplier_aliases_xero_contact_idx on public.finance_supplier_aliases (xero_contact_id);
create index if not exists finance_supplier_aliases_category_idx on public.finance_supplier_aliases (category);

alter table public.finance_supplier_aliases enable row level security;

drop policy if exists "Finance users can view supplier aliases" on public.finance_supplier_aliases;
create policy "Finance users can view supplier aliases"
  on public.finance_supplier_aliases for select
  using (public.finance_can_view());

drop policy if exists "Finance users can manage supplier aliases" on public.finance_supplier_aliases;
create policy "Finance users can manage supplier aliases"
  on public.finance_supplier_aliases for all
  using (public.finance_can_manage())
  with check (public.finance_can_manage());

drop trigger if exists finance_supplier_aliases_updated_at on public.finance_supplier_aliases;
create trigger finance_supplier_aliases_updated_at
  before update on public.finance_supplier_aliases
  for each row execute function public.update_updated_at_column();

-- Seed the recurring school vendors. Account codes follow the Xero default chart mapping
-- used elsewhere in the app (Office Supplies 429, Utilities 445, etc.).

insert into public.finance_supplier_aliases (supplier_name, normalized_name, default_account_code, category) values
  ('Stationery Pack', 'stationery pack', '429', 'Office Supplies'),
  ('Paper Co', 'paper co', '429', 'Office Supplies'),
  ('Printer Ink', 'printer ink', '429', 'Office Supplies'),
  ('BrightSpark Ltd', 'brightspark ltd', '429', 'Office Supplies'),
  ('Computer Fusion', 'computer fusion', '429', 'Office Supplies'),
  ('Repco', 'repco', '429', 'Office Supplies'),
  ('MYOB', 'myob', '429', 'Office Supplies'),
  ('TELA+', 'tela', '445', 'Utilities'),
  ('Electricity New Zealand', 'electricity new zealand', '445', 'Utilities'),
  ('Watercare', 'watercare', '445', 'Utilities'),
  ('Gas New Zealand', 'gas new zealand', '445', 'Utilities'),
  ('School Travel Trust', 'school travel trust', '440', 'Transport'),
  ('Cotton On Whakatane', 'cotton on whakatane', '429', 'Office Supplies')
on conflict (normalized_name) do nothing;