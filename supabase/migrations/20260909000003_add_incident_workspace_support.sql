-- Incident workspace support: tagging, follow-ups, reporting, and email dispatch logs

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

create table if not exists public.incident_follow_ups (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  assigned_to uuid null references public.profiles(id),
  due_at timestamptz null,
  completed_at timestamptz null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  notes text not null,
  next_action text null,
  visibility text not null default 'standard' check (visibility in ('standard', 'sensitive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists incident_follow_ups_incident_idx on public.incident_follow_ups(incident_id);
create index if not exists incident_follow_ups_due_idx on public.incident_follow_ups(due_at);
create index if not exists incident_follow_ups_status_idx on public.incident_follow_ups(status);

create table if not exists public.incident_email_dispatch_log (
  id bigserial primary key,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  recipients jsonb not null default '[]'::jsonb,
  template_key text not null,
  subject text not null,
  merged_payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'preview', 'sent', 'failed')),
  error text null,
  provider_message_id text null,
  sent_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists incident_email_dispatch_log_incident_idx on public.incident_email_dispatch_log(incident_id, created_at desc);
create index if not exists incident_email_dispatch_log_sender_idx on public.incident_email_dispatch_log(sender_id, created_at desc);

create or replace function public.list_incident_assignees()
returns table (
  profile_id uuid,
  email text,
  full_name text,
  org_unit_path text,
  roles jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_counsellor_or_leadership(auth.uid()) then
    raise exception 'insufficient_privilege';
  end if;

  return query
  select
    p.id as profile_id,
    p.email,
    p.full_name,
    p.org_unit_path,
    coalesce(jsonb_agg(distinct ur.role) filter (where ur.role is not null), '[]'::jsonb) as roles
  from public.profiles p
  join public.user_roles ur on ur.profile_id = p.id
  where ur.active = true
    and ur.role = any(array['site_admin', 'it_admin', 'counsellor']::text[])
    and (ur.effective_from is null or ur.effective_from <= current_date)
    and (ur.effective_to is null or ur.effective_to >= current_date)
  group by p.id, p.email, p.full_name, p.org_unit_path
  order by p.full_name nulls last, p.email;
end;
$$;

create or replace function public.incident_management_report(p_as_of timestamptz default now())
returns table (
  total_count bigint,
  open_count bigint,
  in_review_count bigint,
  resolved_count bigint,
  closed_count bigint,
  status_counts jsonb,
  severity_counts jsonb,
  visibility_counts jsonb,
  assignment_counts jsonb,
  tagged_student_count bigint,
  overdue_follow_up_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_counsellor_or_leadership(auth.uid()) then
    raise exception 'insufficient_privilege';
  end if;

  return query
  with incident_base as (
    select *
    from public.incidents
    where is_deleted = false
  ),
  status_rollup as (
    select coalesce(jsonb_object_agg(status, ct), '{}'::jsonb) as payload
    from (
      select status, count(*) as ct
      from incident_base
      group by status
    ) grouped_status
  ),
  severity_rollup as (
    select coalesce(jsonb_object_agg(severity, ct), '{}'::jsonb) as payload
    from (
      select severity, count(*) as ct
      from incident_base
      group by severity
    ) grouped_severity
  ),
  visibility_rollup as (
    select coalesce(jsonb_object_agg(visibility, ct), '{}'::jsonb) as payload
    from (
      select visibility, count(*) as ct
      from incident_base
      group by visibility
    ) grouped_visibility
  ),
  assignment_rollup as (
    select jsonb_build_object(
      'assigned', count(*) filter (where assigned_to is not null),
      'unassigned', count(*) filter (where assigned_to is null)
    ) as payload
    from incident_base
  ),
  summary as (
    select
      count(*) as total_count,
      count(*) filter (where status = 'open') as open_count,
      count(*) filter (where status = 'in_review') as in_review_count,
      count(*) filter (where status = 'resolved') as resolved_count,
      count(*) filter (where status = 'closed') as closed_count
    from incident_base
  ),
  tagged as (
    select count(*) as tagged_student_count
    from public.incident_students
  ),
  overdue as (
    select count(*) as overdue_follow_up_count
    from public.incident_follow_ups fu
    join public.incidents i on i.id = fu.incident_id
    where fu.status <> 'done'
      and fu.due_at is not null
      and fu.due_at < p_as_of
      and i.is_deleted = false
  )
  select
    s.total_count,
    s.open_count,
    s.in_review_count,
    s.resolved_count,
    s.closed_count,
    coalesce((select payload from status_rollup), '{}'::jsonb),
    coalesce((select payload from severity_rollup), '{}'::jsonb),
    coalesce((select payload from visibility_rollup), '{}'::jsonb),
    coalesce((select payload from assignment_rollup), '{}'::jsonb),
    t.tagged_student_count,
    o.overdue_follow_up_count
  from summary s, tagged t, overdue o;
end;
$$;

alter table public.incident_students enable row level security;
alter table public.incident_follow_ups enable row level security;
alter table public.incident_email_dispatch_log enable row level security;

drop policy if exists "Counsellor leadership read incident students" on public.incident_students;
drop policy if exists "Teacher insert incident students" on public.incident_students;
drop policy if exists "Teacher delete incident students" on public.incident_students;
drop policy if exists "Counsellor leadership manage incident students" on public.incident_students;
drop policy if exists "Counsellor leadership read follow ups" on public.incident_follow_ups;
drop policy if exists "Counsellor leadership manage follow ups" on public.incident_follow_ups;
drop policy if exists "Leadership read email dispatch log" on public.incident_email_dispatch_log;

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

create policy "Counsellor leadership read follow ups"
on public.incident_follow_ups
for select
using (
  public.is_counsellor_or_leadership(auth.uid())
  or exists (
    select 1
    from public.incidents i
    where i.id = incident_follow_ups.incident_id
      and i.is_deleted = false
      and i.visibility = 'standard'
      and public.is_student_in_effective_scope(auth.uid(), i.student_id)
  )
);

create policy "Counsellor leadership manage follow ups"
on public.incident_follow_ups
for all
using (public.is_counsellor_or_leadership(auth.uid()))
with check (public.is_counsellor_or_leadership(auth.uid()));

create policy "Leadership read email dispatch log"
on public.incident_email_dispatch_log
for select
using (public.is_counsellor_or_leadership(auth.uid()));

drop trigger if exists incident_students_updated_at on public.incident_students;
create trigger incident_students_updated_at
before update on public.incident_students
for each row execute function public.update_updated_at_column();

drop trigger if exists incident_follow_ups_updated_at on public.incident_follow_ups;
create trigger incident_follow_ups_updated_at
before update on public.incident_follow_ups
for each row execute function public.update_updated_at_column();
