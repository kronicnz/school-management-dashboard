-- Add org_unit_path column to staff table for Google Workspace sync
alter table public.staff add column if not exists org_unit_path text;

create index if not exists staff_org_unit_path_idx on public.staff (org_unit_path);