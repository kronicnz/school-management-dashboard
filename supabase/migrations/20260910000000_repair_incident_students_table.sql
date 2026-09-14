-- Repair migration for environments where incident_students was never applied
-- or was dropped after the incident workspace support migration.

create table if not exists public.incident_students (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  tagged_by uuid not null references public.profiles(id),
  tagged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (incident_id, student_id)
);

create index if not exists incident_students_incident_idx on public.incident_students(incident_id);
create index if not exists incident_students_student_idx on public.incident_students(student_id);

alter table public.incident_students enable row level security;

drop policy if exists "Counsellor leadership read incident students" on public.incident_students;
drop policy if exists "Teacher insert incident students" on public.incident_students;
drop policy if exists "Teacher delete incident students" on public.incident_students;
drop policy if exists "Counsellor leadership manage incident students" on public.incident_students;

create policy "Counsellor leadership read incident students"
on public.incident_students
for select
using (
  public.is_counsellor_or_leadership(auth.uid())
  or exists (
    select 1
    from public.incidents i
    where i.id = incident_students.incident_id
      and i.is_deleted = false
      and i.visibility = 'standard'
      and public.is_student_in_effective_scope(auth.uid(), i.student_id)
  )
);

create policy "Teacher insert incident students"
on public.incident_students
for insert
with check (
  public.user_has_role(auth.uid(), 'teacher')
  and not public.is_counsellor_or_leadership(auth.uid())
  and tagged_by = auth.uid()
  and exists (
    select 1
    from public.incidents i
    where i.id = incident_students.incident_id
      and i.is_deleted = false
      and i.visibility = 'standard'
      and public.is_student_in_effective_scope(auth.uid(), i.student_id)
  )
  and public.is_student_in_effective_scope(auth.uid(), incident_students.student_id)
);

create policy "Teacher delete incident students"
on public.incident_students
for delete
using (
  public.user_has_role(auth.uid(), 'teacher')
  and not public.is_counsellor_or_leadership(auth.uid())
  and exists (
    select 1
    from public.incidents i
    where i.id = incident_students.incident_id
      and i.is_deleted = false
      and i.visibility = 'standard'
      and public.is_student_in_effective_scope(auth.uid(), i.student_id)
  )
  and public.is_student_in_effective_scope(auth.uid(), incident_students.student_id)
);

create policy "Counsellor leadership manage incident students"
on public.incident_students
for all
using (public.is_counsellor_or_leadership(auth.uid()))
with check (
  public.is_counsellor_or_leadership(auth.uid())
  and tagged_by = auth.uid()
);

drop trigger if exists incident_students_updated_at on public.incident_students;
create trigger incident_students_updated_at
before update on public.incident_students
for each row execute function public.update_updated_at_column();
