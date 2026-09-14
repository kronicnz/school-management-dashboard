-- Add Google Workspace sync columns to students table
alter table public.students add column if not exists org_unit_path text;
alter table public.students add column if not exists room_number text;
alter table public.students add column if not exists year_group text;

-- Index for faster filtering by org unit and year group
create index if not exists students_org_unit_path_idx on public.students (org_unit_path);
create index if not exists students_year_group_idx on public.students (year_group);
