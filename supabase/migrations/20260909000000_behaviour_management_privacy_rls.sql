-- Behaviour management privacy/RLS foundation (NZ Privacy Act 2020 aligned)

-- Canonical role source
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (
    role in (
      'site_admin',
      'finance_admin',
      'finance_read_only',
      'board_member',
      'it_admin',
      'it_staff',
      'property_manager',
      'property_staff',
      'teacher',
      'counsellor'
    )
  ),
  active boolean not null default true,
  effective_from date null,
  effective_to date null,
  granted_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  unique (profile_id, role, effective_from)
);

create index if not exists user_roles_profile_idx on public.user_roles(profile_id);
create index if not exists user_roles_role_idx on public.user_roles(role);

-- Access metadata
create table if not exists public.class_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  staff_profile_id uuid not null references public.profiles(id) on delete cascade,
  assignment_role text not null check (assignment_role in ('primary_teacher', 'co_teacher', 'dean', 'pastoral_support')),
  effective_from date null,
  effective_to date null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to >= effective_from),
  unique (class_id, staff_profile_id, assignment_role)
);

create index if not exists class_staff_assignments_staff_idx on public.class_staff_assignments(staff_profile_id);

create table if not exists public.teacher_student_scope (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  source text not null,
  is_excluded boolean not null default false,
  effective_from date null,
  effective_to date null,
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create unique index if not exists teacher_student_scope_history_uniq
  on public.teacher_student_scope(teacher_id, student_id, source, coalesce(effective_from, '-infinity'::date), is_excluded);

create index if not exists teacher_student_scope_lookup_idx on public.teacher_student_scope(teacher_id, student_id);

-- Behaviour domain
create table if not exists public.incident_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_positive boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  category_id uuid not null references public.incident_categories(id),
  created_by uuid not null references public.profiles(id),
  assigned_to uuid null references public.profiles(id),
  occurred_at timestamptz not null,
  reported_at timestamptz not null default now(),
  severity text not null default 'low' check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'in_review', 'resolved', 'closed')),
  visibility text not null default 'standard' check (visibility in ('standard', 'sensitive')),
  sensitivity_review_requested boolean not null default false,
  description text not null,
  action_taken text null,
  resolution_summary text null,
  is_deleted boolean not null default false,
  deleted_at timestamptz null,
  deleted_by uuid null references public.profiles(id),
  deleted_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.incident_comments (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.incidents(id) on delete restrict,
  author_id uuid not null references public.profiles(id),
  content text not null,
  visibility text not null default 'standard' check (visibility in ('standard', 'sensitive')),
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.incident_audit_log (
  id bigserial primary key,
  incident_id uuid not null references public.incidents(id) on delete restrict,
  action text not null,
  changed_by uuid null references public.profiles(id),
  changed_at timestamptz not null default now(),
  before_data jsonb null,
  after_data jsonb null,
  context jsonb null
);

create table if not exists public.incident_retention_rules (
  id uuid primary key default gen_random_uuid(),
  category_id uuid null references public.incident_categories(id) on delete cascade,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  retain_for_interval interval not null,
  archive_after_interval interval not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category_id, severity)
);

create table if not exists public.incident_emergency_access_grants (
  id uuid primary key default gen_random_uuid(),
  grantee_user_id uuid not null references public.profiles(id) on delete cascade,
  student_id uuid null references public.students(id) on delete cascade,
  incident_id uuid null references public.incidents(id) on delete cascade,
  reason text not null,
  granted_by uuid not null references public.profiles(id),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  check (student_id is not null or incident_id is not null),
  check (expires_at > granted_at)
);

create table if not exists public.incident_export_audit_log (
  id bigserial primary key,
  requested_by uuid not null references public.profiles(id),
  student_id uuid not null references public.students(id),
  case_reference text not null,
  reason text not null,
  exported_at timestamptz not null default now(),
  row_count integer not null default 0,
  payload jsonb not null
);

-- Supporting indexes
create index if not exists incidents_scope_idx on public.incidents(student_id, is_deleted, visibility);
create index if not exists incidents_created_by_idx on public.incidents(created_by);
create index if not exists incidents_status_idx on public.incidents(status);
create index if not exists incident_comments_incident_idx on public.incident_comments(incident_id);
create index if not exists incident_audit_incident_idx on public.incident_audit_log(incident_id);
create index if not exists incident_emergency_grantee_idx on public.incident_emergency_access_grants(grantee_user_id, expires_at, revoked_at);
create index if not exists incident_emergency_student_idx on public.incident_emergency_access_grants(student_id);
create index if not exists incident_emergency_incident_idx on public.incident_emergency_access_grants(incident_id);

-- Shared helper functions
create or replace function public.user_has_role(p_user_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.profile_id = p_user_id
      and ur.role = p_role
      and ur.active = true
      and (ur.effective_from is null or ur.effective_from <= current_date)
      and (ur.effective_to is null or ur.effective_to >= current_date)
  );
$$;

create or replace function public.user_has_any_role(p_user_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.profile_id = p_user_id
      and ur.role = any(p_roles)
      and ur.active = true
      and (ur.effective_from is null or ur.effective_from <= current_date)
      and (ur.effective_to is null or ur.effective_to >= current_date)
  );
$$;

create or replace function public.is_access_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_has_any_role(
    p_user_id,
    array['site_admin', 'it_admin']::text[]
  );
$$;

create or replace function public.is_counsellor_or_leadership(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_has_any_role(
    p_user_id,
    array['site_admin', 'it_admin', 'counsellor']::text[]
  );
$$;

-- Effective scope layer used by RLS
create or replace view public.effective_teacher_student_scope as
with class_scope as (
  select
    csa.staff_profile_id as teacher_id,
    s.id as student_id
  from public.class_staff_assignments csa
  join public.students s on s.class_id = csa.class_id
  where (csa.effective_from is null or csa.effective_from <= current_date)
    and (csa.effective_to is null or csa.effective_to >= current_date)
),
manual_scope as (
  select
    tss.teacher_id,
    tss.student_id,
    tss.is_excluded
  from public.teacher_student_scope tss
  where (tss.effective_from is null or tss.effective_from <= current_date)
    and (tss.effective_to is null or tss.effective_to >= current_date)
),
candidate_scope as (
  select teacher_id, student_id from class_scope
  union
  select teacher_id, student_id from manual_scope where is_excluded = false
)
select distinct c.teacher_id, c.student_id
from candidate_scope c
where not exists (
  select 1
  from manual_scope ex
  where ex.teacher_id = c.teacher_id
    and ex.student_id = c.student_id
    and ex.is_excluded = true
);

create or replace function public.is_student_in_effective_scope(p_teacher_id uuid, p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.effective_teacher_student_scope ets
    where ets.teacher_id = p_teacher_id
      and ets.student_id = p_student_id
  );
$$;

create or replace function public.teacher_scope_ended_within_grace(
  p_teacher_id uuid,
  p_student_id uuid,
  p_grace_days integer default 90
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_latest_scope_end date;
begin
  if public.is_student_in_effective_scope(p_teacher_id, p_student_id) then
    return false;
  end if;

  select max(scope_end)
  into v_latest_scope_end
  from (
    select csa.effective_to as scope_end
    from public.class_staff_assignments csa
    join public.students s on s.class_id = csa.class_id
    where csa.staff_profile_id = p_teacher_id
      and s.id = p_student_id
      and csa.effective_to is not null
    union all
    select tss.effective_to as scope_end
    from public.teacher_student_scope tss
    where tss.teacher_id = p_teacher_id
      and tss.student_id = p_student_id
      and tss.is_excluded = false
      and tss.effective_to is not null
  ) ended_scopes;

  if v_latest_scope_end is null then
    return false;
  end if;

  return v_latest_scope_end >= (current_date - p_grace_days);
end;
$$;

create or replace function public.has_active_emergency_access(
  p_user_id uuid,
  p_student_id uuid,
  p_incident_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.incident_emergency_access_grants g
    where g.grantee_user_id = p_user_id
      and g.revoked_at is null
      and g.expires_at > now()
      and (
        (g.incident_id is not null and g.incident_id = p_incident_id)
        or (g.student_id is not null and g.student_id = p_student_id)
      )
  );
$$;

-- Audit + guard functions
create or replace function public.protect_incident_audit_log()
returns trigger
language plpgsql
as $$
begin
  raise exception 'incident_audit_log is append-only';
end;
$$;

create or replace function public.prevent_incident_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Hard delete is blocked for incidents. Use soft_delete_incident RPC.';
end;
$$;

create or replace function public.prevent_incident_comment_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Hard delete is blocked for incident comments.';
end;
$$;

create or replace function public.log_incident_change()
returns trigger
language plpgsql
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'incident_created';
  else
    if old.is_deleted = false and new.is_deleted = true then
      v_action := 'incident_soft_deleted';
    elsif old.is_deleted = true and new.is_deleted = false then
      v_action := 'incident_restored';
    elsif old.visibility is distinct from new.visibility then
      v_action := 'incident_visibility_changed';
    elsif old.status is distinct from new.status then
      v_action := 'incident_status_changed';
    else
      v_action := 'incident_updated';
    end if;
  end if;

  insert into public.incident_audit_log (
    incident_id,
    action,
    changed_by,
    before_data,
    after_data,
    context
  )
  values (
    coalesce(new.id, old.id),
    v_action,
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    jsonb_build_object(
      'transition_reason', nullif(current_setting('app.incident_transition_reason', true), ''),
      'trigger', tg_name
    )
  );

  return new;
end;
$$;

create or replace function public.log_incident_comment_change()
returns trigger
language plpgsql
as $$
begin
  insert into public.incident_audit_log (
    incident_id,
    action,
    changed_by,
    before_data,
    after_data,
    context
  )
  values (
    coalesce(new.incident_id, old.incident_id),
    case
      when tg_op = 'INSERT' then 'incident_comment_created'
      when old.is_deleted = false and new.is_deleted = true then 'incident_comment_soft_deleted'
      else 'incident_comment_updated'
    end,
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    jsonb_build_object('trigger', tg_name)
  );

  return new;
end;
$$;

create or replace function public.enforce_incident_mutation_rules()
returns trigger
language plpgsql
as $$
declare
  v_actor uuid := auth.uid();
  v_is_teacher boolean := public.user_has_role(v_actor, 'teacher');
  v_is_leadership boolean := public.is_counsellor_or_leadership(v_actor);
  v_transition_reason text := nullif(current_setting('app.incident_transition_reason', true), '');
begin
  if tg_op = 'INSERT' then
    if new.created_by is distinct from v_actor then
      raise exception 'created_by must match auth.uid()';
    end if;

    if v_is_teacher and not v_is_leadership and new.visibility <> 'standard' then
      raise exception 'teachers cannot create sensitive incidents directly';
    end if;

    return new;
  end if;

  if new.description is distinct from old.description then
    raise exception 'incidents.description is immutable after insert';
  end if;

  if v_is_teacher and not v_is_leadership then
    if new.student_id is distinct from old.student_id
      or new.category_id is distinct from old.category_id
      or new.created_by is distinct from old.created_by
      or new.assigned_to is distinct from old.assigned_to
      or new.occurred_at is distinct from old.occurred_at
      or new.reported_at is distinct from old.reported_at
      or new.severity is distinct from old.severity
      or new.visibility is distinct from old.visibility
      or new.is_deleted is distinct from old.is_deleted
      or new.deleted_at is distinct from old.deleted_at
      or new.deleted_by is distinct from old.deleted_by
      or new.deleted_reason is distinct from old.deleted_reason
    then
      raise exception 'teachers can only update operational incident fields';
    end if;
  end if;

  if old.is_deleted = false and new.is_deleted = true then
    if v_transition_reason is null and coalesce(new.deleted_reason, '') = '' then
      raise exception 'soft delete requires a reason';
    end if;

    new.deleted_at := coalesce(new.deleted_at, now());
    new.deleted_by := coalesce(new.deleted_by, v_actor);
    new.deleted_reason := coalesce(nullif(new.deleted_reason, ''), v_transition_reason);
  elsif old.is_deleted = true and new.is_deleted = false then
    if v_transition_reason is null then
      raise exception 'restore requires a reason';
    end if;

    new.deleted_at := null;
    new.deleted_by := null;
    new.deleted_reason := null;
  end if;

  if old.visibility is distinct from new.visibility and v_transition_reason is null then
    raise exception 'visibility change requires a reason via RPC';
  end if;

  return new;
end;
$$;

create or replace function public.default_emergency_grant_expiry()
returns trigger
language plpgsql
as $$
begin
  if new.expires_at is null then
    new.expires_at := coalesce(new.granted_at, now()) + interval '4 hours';
  end if;

  return new;
end;
$$;

create or replace function public.notify_emergency_access_alert()
returns trigger
language plpgsql
as $$
declare
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'event', tg_op,
    'grant_id', coalesce(new.id, old.id),
    'grantee_user_id', coalesce(new.grantee_user_id, old.grantee_user_id),
    'student_id', coalesce(new.student_id, old.student_id),
    'incident_id', coalesce(new.incident_id, old.incident_id),
    'granted_by', coalesce(new.granted_by, old.granted_by),
    'expires_at', coalesce(new.expires_at, old.expires_at),
    'revoked_at', coalesce(new.revoked_at, old.revoked_at),
    'at', now()
  );

  perform pg_notify('incident_emergency_access_alerts', v_payload::text);
  return coalesce(new, old);
end;
$$;

-- Privileged RPCs
create or replace function public.soft_delete_incident(p_incident_id uuid, p_reason text)
returns public.incidents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
begin
  if not public.is_counsellor_or_leadership(auth.uid()) then
    raise exception 'insufficient_privilege';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'soft delete reason is required';
  end if;

  perform set_config('app.incident_transition_reason', p_reason, true);

  update public.incidents
  set
    is_deleted = true,
    deleted_at = now(),
    deleted_by = auth.uid(),
    deleted_reason = p_reason
  where id = p_incident_id
  returning * into v_incident;

  if v_incident.id is null then
    raise exception 'incident_not_found';
  end if;

  return v_incident;
end;
$$;

create or replace function public.restore_incident(p_incident_id uuid, p_reason text)
returns public.incidents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
begin
  if not public.is_counsellor_or_leadership(auth.uid()) then
    raise exception 'insufficient_privilege';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'restore reason is required';
  end if;

  perform set_config('app.incident_transition_reason', p_reason, true);

  update public.incidents
  set
    is_deleted = false,
    deleted_at = null,
    deleted_by = null,
    deleted_reason = null
  where id = p_incident_id
  returning * into v_incident;

  if v_incident.id is null then
    raise exception 'incident_not_found';
  end if;

  return v_incident;
end;
$$;

create or replace function public.set_incident_visibility(
  p_incident_id uuid,
  p_visibility text,
  p_reason text
)
returns public.incidents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_incident public.incidents;
begin
  if not public.is_counsellor_or_leadership(auth.uid()) then
    raise exception 'insufficient_privilege';
  end if;

  if p_visibility not in ('standard', 'sensitive') then
    raise exception 'invalid_visibility';
  end if;

  if coalesce(trim(p_reason), '') = '' then
    raise exception 'visibility change reason is required';
  end if;

  perform set_config('app.incident_transition_reason', p_reason, true);

  update public.incidents
  set visibility = p_visibility
  where id = p_incident_id
  returning * into v_incident;

  if v_incident.id is null then
    raise exception 'incident_not_found';
  end if;

  return v_incident;
end;
$$;

create or replace function public.resolve_incident_retention_rule(
  p_category_id uuid,
  p_severity text
)
returns table (
  archive_after_interval interval,
  retain_for_interval interval
)
language sql
stable
security definer
set search_path = public
as $$
  select r.archive_after_interval, r.retain_for_interval
  from public.incident_retention_rules r
  where r.active = true
    and r.severity = p_severity
    and (r.category_id = p_category_id or r.category_id is null)
  order by
    case when r.category_id = p_category_id then 0 else 1 end,
    r.created_at asc
  limit 1;
$$;

create or replace function public.retention_due_report(p_as_of timestamptz default now())
returns table (
  incident_id uuid,
  category_id uuid,
  severity text,
  archive_due_at timestamptz,
  dispose_due_at timestamptz,
  should_archive boolean,
  should_dispose boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with scoped as (
    select
      i.id as incident_id,
      i.category_id,
      i.severity,
      i.reported_at,
      r.archive_after_interval,
      r.retain_for_interval
    from public.incidents i
    left join lateral public.resolve_incident_retention_rule(i.category_id, i.severity) r on true
    where i.is_deleted = false
  )
  select
    s.incident_id,
    s.category_id,
    s.severity,
    s.reported_at + coalesce(s.archive_after_interval, interval '0 days') as archive_due_at,
    s.reported_at + coalesce(s.retain_for_interval, interval '0 days') as dispose_due_at,
    p_as_of >= (s.reported_at + coalesce(s.archive_after_interval, interval '0 days')) as should_archive,
    p_as_of >= (s.reported_at + coalesce(s.retain_for_interval, interval '0 days')) as should_dispose
  from scoped s;
$$;

create or replace function public.export_student_incidents(
  p_student_id uuid,
  p_case_reference text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
  v_row_count integer;
begin
  if not public.user_has_any_role(
    auth.uid(),
    array['site_admin', 'it_admin']::text[]
  ) then
    raise exception 'insufficient_privilege';
  end if;

  if coalesce(trim(p_case_reference), '') = '' or coalesce(trim(p_reason), '') = '' then
    raise exception 'case_reference and reason are required';
  end if;

  select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb), count(*)
  into v_payload, v_row_count
  from public.incidents i
  where i.student_id = p_student_id;

  insert into public.incident_export_audit_log (
    requested_by,
    student_id,
    case_reference,
    reason,
    row_count,
    payload
  )
  values (
    auth.uid(),
    p_student_id,
    p_case_reference,
    p_reason,
    v_row_count,
    v_payload
  );

  return jsonb_build_object(
    'student_id', p_student_id,
    'case_reference', p_case_reference,
    'reason', p_reason,
    'row_count', v_row_count,
    'incidents', v_payload
  );
end;
$$;

-- Apply updated_at triggers
drop trigger if exists user_roles_updated_at on public.user_roles;
create trigger user_roles_updated_at
before update on public.user_roles
for each row execute function public.update_updated_at_column();

drop trigger if exists class_staff_assignments_updated_at on public.class_staff_assignments;
create trigger class_staff_assignments_updated_at
before update on public.class_staff_assignments
for each row execute function public.update_updated_at_column();

drop trigger if exists teacher_student_scope_updated_at on public.teacher_student_scope;
create trigger teacher_student_scope_updated_at
before update on public.teacher_student_scope
for each row execute function public.update_updated_at_column();

drop trigger if exists incident_categories_updated_at on public.incident_categories;
create trigger incident_categories_updated_at
before update on public.incident_categories
for each row execute function public.update_updated_at_column();

drop trigger if exists incidents_updated_at on public.incidents;
create trigger incidents_updated_at
before update on public.incidents
for each row execute function public.update_updated_at_column();

drop trigger if exists incident_comments_updated_at on public.incident_comments;
create trigger incident_comments_updated_at
before update on public.incident_comments
for each row execute function public.update_updated_at_column();

drop trigger if exists incident_retention_rules_updated_at on public.incident_retention_rules;
create trigger incident_retention_rules_updated_at
before update on public.incident_retention_rules
for each row execute function public.update_updated_at_column();

-- Mutation + audit triggers
drop trigger if exists incidents_enforce_mutation_rules on public.incidents;
create trigger incidents_enforce_mutation_rules
before insert or update on public.incidents
for each row execute function public.enforce_incident_mutation_rules();

drop trigger if exists incidents_audit_log on public.incidents;
create trigger incidents_audit_log
after insert or update on public.incidents
for each row execute function public.log_incident_change();

drop trigger if exists incident_comments_audit_log on public.incident_comments;
create trigger incident_comments_audit_log
after insert or update on public.incident_comments
for each row execute function public.log_incident_comment_change();

drop trigger if exists incidents_block_delete on public.incidents;
create trigger incidents_block_delete
before delete on public.incidents
for each row execute function public.prevent_incident_hard_delete();

drop trigger if exists incident_comments_block_delete on public.incident_comments;
create trigger incident_comments_block_delete
before delete on public.incident_comments
for each row execute function public.prevent_incident_comment_hard_delete();

drop trigger if exists incident_audit_log_block_update on public.incident_audit_log;
create trigger incident_audit_log_block_update
before update or delete on public.incident_audit_log
for each row execute function public.protect_incident_audit_log();

drop trigger if exists incident_export_audit_log_block_update on public.incident_export_audit_log;
create trigger incident_export_audit_log_block_update
before update or delete on public.incident_export_audit_log
for each row execute function public.protect_incident_audit_log();

drop trigger if exists incident_emergency_default_expiry on public.incident_emergency_access_grants;
create trigger incident_emergency_default_expiry
before insert on public.incident_emergency_access_grants
for each row execute function public.default_emergency_grant_expiry();

drop trigger if exists incident_emergency_alert_notify on public.incident_emergency_access_grants;
create trigger incident_emergency_alert_notify
after insert or update on public.incident_emergency_access_grants
for each row execute function public.notify_emergency_access_alert();

-- Seed baseline categories
insert into public.incident_categories (code, name, is_positive)
values
  ('disruption', 'Classroom Disruption', false),
  ('bullying', 'Bullying', false),
  ('violence', 'Violence or Threat', false),
  ('property_damage', 'Property Damage', false),
  ('non_compliance', 'Non-compliance', false),
  ('positive_behaviour', 'Positive Behaviour', true)
on conflict (code) do nothing;

-- Seed provisional retention defaults
insert into public.incident_retention_rules (category_id, severity, archive_after_interval, retain_for_interval, active)
select null, 'low', interval '12 months', interval '2 years', true
where not exists (
  select 1
  from public.incident_retention_rules r
  where r.category_id is null and r.severity = 'low'
);

insert into public.incident_retention_rules (category_id, severity, archive_after_interval, retain_for_interval, active)
select null, 'medium', interval '18 months', interval '5 years', true
where not exists (
  select 1
  from public.incident_retention_rules r
  where r.category_id is null and r.severity = 'medium'
);

insert into public.incident_retention_rules (category_id, severity, archive_after_interval, retain_for_interval, active)
select null, 'high', interval '24 months', interval '7 years', true
where not exists (
  select 1
  from public.incident_retention_rules r
  where r.category_id is null and r.severity = 'high'
);

insert into public.incident_retention_rules (category_id, severity, archive_after_interval, retain_for_interval, active)
select null, 'critical', interval '24 months', interval '7 years', true
where not exists (
  select 1
  from public.incident_retention_rules r
  where r.category_id is null and r.severity = 'critical'
);

-- RLS enablement
alter table public.user_roles enable row level security;
alter table public.class_staff_assignments enable row level security;
alter table public.teacher_student_scope enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_comments enable row level security;
alter table public.incident_audit_log enable row level security;
alter table public.incident_retention_rules enable row level security;
alter table public.incident_emergency_access_grants enable row level security;
alter table public.incident_export_audit_log enable row level security;

-- Drop/recreate policies for idempotent migration reruns
drop policy if exists "Users can read own roles" on public.user_roles;
drop policy if exists "Access admins can manage roles" on public.user_roles;
drop policy if exists "Users can read own class assignments" on public.class_staff_assignments;
drop policy if exists "Access admins manage class assignments" on public.class_staff_assignments;
drop policy if exists "Users can read own scope rows" on public.teacher_student_scope;
drop policy if exists "Access admins manage teacher scope" on public.teacher_student_scope;
drop policy if exists "Teacher read standard incidents in scope" on public.incidents;
drop policy if exists "Teacher read own incidents grace period" on public.incidents;
drop policy if exists "Emergency grant incident read" on public.incidents;
drop policy if exists "Counsellor leadership read incidents" on public.incidents;
drop policy if exists "Teacher insert incidents" on public.incidents;
drop policy if exists "Counsellor leadership insert incidents" on public.incidents;
drop policy if exists "Teacher update incidents" on public.incidents;
drop policy if exists "Counsellor leadership update incidents" on public.incidents;
drop policy if exists "Teacher read visible comments" on public.incident_comments;
drop policy if exists "Counsellor leadership read comments" on public.incident_comments;
drop policy if exists "Teacher insert comments" on public.incident_comments;
drop policy if exists "Counsellor leadership insert comments" on public.incident_comments;
drop policy if exists "Counsellor leadership update comments" on public.incident_comments;
drop policy if exists "Counsellor leadership read incident audit" on public.incident_audit_log;
drop policy if exists "Access admins read retention rules" on public.incident_retention_rules;
drop policy if exists "Access admins manage retention rules" on public.incident_retention_rules;
drop policy if exists "Users read own emergency grants" on public.incident_emergency_access_grants;
drop policy if exists "Access admins manage emergency grants" on public.incident_emergency_access_grants;
drop policy if exists "Leadership read export audit" on public.incident_export_audit_log;

-- user_roles
create policy "Users can read own roles"
on public.user_roles
for select
using (profile_id = auth.uid() or public.is_access_admin(auth.uid()));

create policy "Access admins can manage roles"
on public.user_roles
for all
using (public.is_access_admin(auth.uid()))
with check (public.is_access_admin(auth.uid()));

-- class_staff_assignments
create policy "Users can read own class assignments"
on public.class_staff_assignments
for select
using (staff_profile_id = auth.uid() or public.is_access_admin(auth.uid()));

create policy "Access admins manage class assignments"
on public.class_staff_assignments
for all
using (public.is_access_admin(auth.uid()))
with check (public.is_access_admin(auth.uid()));

-- teacher_student_scope
create policy "Users can read own scope rows"
on public.teacher_student_scope
for select
using (teacher_id = auth.uid() or public.is_access_admin(auth.uid()));

create policy "Access admins manage teacher scope"
on public.teacher_student_scope
for all
using (public.is_access_admin(auth.uid()))
with check (public.is_access_admin(auth.uid()));

-- incidents
create policy "Teacher read standard incidents in scope"
on public.incidents
for select
using (
  public.user_has_role(auth.uid(), 'teacher')
  and not public.is_counsellor_or_leadership(auth.uid())
  and is_deleted = false
  and visibility = 'standard'
  and public.is_student_in_effective_scope(auth.uid(), student_id)
);

create policy "Teacher read own incidents grace period"
on public.incidents
for select
using (
  public.user_has_role(auth.uid(), 'teacher')
  and not public.is_counsellor_or_leadership(auth.uid())
  and is_deleted = false
  and visibility = 'standard'
  and created_by = auth.uid()
  and public.teacher_scope_ended_within_grace(auth.uid(), student_id, 90)
);

create policy "Emergency grant incident read"
on public.incidents
for select
using (public.has_active_emergency_access(auth.uid(), student_id, id));

create policy "Counsellor leadership read incidents"
on public.incidents
for select
using (public.is_counsellor_or_leadership(auth.uid()));

create policy "Teacher insert incidents"
on public.incidents
for insert
with check (
  public.user_has_role(auth.uid(), 'teacher')
  and not public.is_counsellor_or_leadership(auth.uid())
  and created_by = auth.uid()
  and visibility = 'standard'
  and public.is_student_in_effective_scope(auth.uid(), student_id)
);

create policy "Counsellor leadership insert incidents"
on public.incidents
for insert
with check (
  public.is_counsellor_or_leadership(auth.uid())
  and created_by = auth.uid()
);

create policy "Teacher update incidents"
on public.incidents
for update
using (
  public.user_has_role(auth.uid(), 'teacher')
  and not public.is_counsellor_or_leadership(auth.uid())
  and is_deleted = false
  and visibility = 'standard'
  and public.is_student_in_effective_scope(auth.uid(), student_id)
)
with check (
  public.user_has_role(auth.uid(), 'teacher')
  and not public.is_counsellor_or_leadership(auth.uid())
  and is_deleted = false
  and visibility = 'standard'
  and public.is_student_in_effective_scope(auth.uid(), student_id)
);

create policy "Counsellor leadership update incidents"
on public.incidents
for update
using (public.is_counsellor_or_leadership(auth.uid()))
with check (public.is_counsellor_or_leadership(auth.uid()));

-- incident_comments
create policy "Teacher read visible comments"
on public.incident_comments
for select
using (
  is_deleted = false
  and visibility = 'standard'
  and exists (
    select 1
    from public.incidents i
    where i.id = incident_comments.incident_id
      and i.is_deleted = false
      and i.visibility = 'standard'
      and (
        (
          public.user_has_role(auth.uid(), 'teacher')
          and not public.is_counsellor_or_leadership(auth.uid())
          and (
            public.is_student_in_effective_scope(auth.uid(), i.student_id)
            or (
              i.created_by = auth.uid()
              and public.teacher_scope_ended_within_grace(auth.uid(), i.student_id, 90)
            )
          )
        )
        or public.has_active_emergency_access(auth.uid(), i.student_id, i.id)
      )
  )
);

create policy "Counsellor leadership read comments"
on public.incident_comments
for select
using (public.is_counsellor_or_leadership(auth.uid()));

create policy "Teacher insert comments"
on public.incident_comments
for insert
with check (
  author_id = auth.uid()
  and visibility = 'standard'
  and exists (
    select 1
    from public.incidents i
    where i.id = incident_comments.incident_id
      and i.is_deleted = false
      and i.visibility = 'standard'
      and (
        public.is_student_in_effective_scope(auth.uid(), i.student_id)
        or (
          i.created_by = auth.uid()
          and public.teacher_scope_ended_within_grace(auth.uid(), i.student_id, 90)
        )
      )
  )
);

create policy "Counsellor leadership insert comments"
on public.incident_comments
for insert
with check (
  public.is_counsellor_or_leadership(auth.uid())
  and author_id = auth.uid()
);

create policy "Counsellor leadership update comments"
on public.incident_comments
for update
using (public.is_counsellor_or_leadership(auth.uid()))
with check (public.is_counsellor_or_leadership(auth.uid()));

-- incident audit and controls
create policy "Counsellor leadership read incident audit"
on public.incident_audit_log
for select
using (public.is_counsellor_or_leadership(auth.uid()));

create policy "Access admins read retention rules"
on public.incident_retention_rules
for select
using (public.is_access_admin(auth.uid()));

create policy "Access admins manage retention rules"
on public.incident_retention_rules
for all
using (public.is_access_admin(auth.uid()))
with check (public.is_access_admin(auth.uid()));

create policy "Users read own emergency grants"
on public.incident_emergency_access_grants
for select
using (grantee_user_id = auth.uid() or public.is_access_admin(auth.uid()));

create policy "Access admins manage emergency grants"
on public.incident_emergency_access_grants
for all
using (public.is_access_admin(auth.uid()))
with check (public.is_access_admin(auth.uid()));

create policy "Leadership read export audit"
on public.incident_export_audit_log
for select
using (
  public.user_has_any_role(
    auth.uid(),
    array['site_admin', 'it_admin']::text[]
  )
);

-- Protected table policy guard: reject blanket authenticated policy patterns
do $$
declare
  v_bad_count integer;
begin
  select count(*)
  into v_bad_count
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in (
      'incidents',
      'incident_comments',
      'incident_audit_log',
      'teacher_student_scope',
      'user_roles',
      'class_staff_assignments',
      'incident_emergency_access_grants',
      'incident_export_audit_log'
    )
    and (
      coalesce(p.qual, '') ilike '%auth.role() = ''authenticated''%'
      or coalesce(p.with_check, '') ilike '%auth.role() = ''authenticated''%'
    );

  if v_bad_count > 0 then
    raise exception 'Protected table policy guard failed: blanket authenticated policy detected';
  end if;
end;
$$;
