-- ---------------------------------------------------------------------------
-- Align every "is this today?" comparison on the school's calendar.
-- ---------------------------------------------------------------------------
--
-- The problem
-- -----------
-- Role windows (`user_roles.effective_from` / `effective_to`), class and
-- student scope windows, and `attendance.date` are plain `YYYY-MM-DD` calendar
-- dates. Every read of them compared against `current_date`, which resolves in
-- the *session* timezone. The database shipped in UTC while the school is in
-- Pacific/Auckland, so for the twelve hours after local midnight the server
-- believed the date was still yesterday.
--
-- The visible symptom: an admin sets a `staff` grant to start on the current
-- date. The Admin directory renders the role as in force, because the browser
-- asked "is today within this window" and got a local answer. `user_has_role`
-- says no, `fetchCurrentUserRoles` filters the row out, and the signed-in user
-- is told they hold no roles at all. The navigation then collapses to a bare
-- Dashboard because `capabilitiesForRoles([])` resolves to nothing.
--
-- Why setting the timezone alone is not enough
-- -------------------------------------------
-- The timezone is a property of the deployment, not of the repository. A
-- hosted project, a restored dump, a CI job, or anyone who runs `SET timezone
-- to 'UTC'` on a pooled connection reintroduces the exact same off-by-one with
-- no diff to show for it. So the timezone is set *and* every comparison is
-- rewritten to call `public.school_current_date()`, which pins the zone in the
-- query. The setting is the correct default; the function is the guarantee.
--
-- The frame of reference
-- ----------------------
-- Pacific/Auckland rather than a fixed `+12:00`. New Zealand daylight saving
-- moves the offset by an hour twice a year, so a hardcoded offset is an hour
-- wrong for a fortnight every March and every November. A named zone tracks it.
--
-- This mirrors `SCHOOL_TIME_ZONE` in `src/lib/school-time.ts`, which is what the
-- client now uses for the same comparisons. The two must agree; the parity is
-- asserted in `src/lib/school-time.test.ts`.

-- ---------------------------------------------------------------------------
-- 1. The single source of truth for the school calendar day
-- ---------------------------------------------------------------------------
--
-- STABLE, not IMMUTABLE, because the answer changes once a day. Pinned to
-- `search_path` so a hostile schema cannot shadow it inside a SECURITY DEFINER
-- function or a view.

create or replace function public.school_current_date()
returns date
language sql
stable
set search_path = public
as $$
  select (now() at time zone 'Pacific/Auckland')::date;
$$;

comment on function public.school_current_date() is
  'The current calendar date at the school, in Pacific/Auckland. Use this rather than current_date for any role, scope, or attendance window comparison. Mirrors SCHOOL_TIME_ZONE in src/lib/school-time.ts.';

-- ---------------------------------------------------------------------------
-- 2. Set the database timezone so ad-hoc SQL, reports, and psql agree too
-- ---------------------------------------------------------------------------
--
-- The database-level setting covers new connections. Per-role settings cover
-- the connections that already exist, including anything the pooler handed out
-- before this migration ran.
--
-- Each role is attempted inside its own exception block because Supabase
-- reserves `supabase_admin` and refuses to let a superuser alter it. A reserved
-- role is already correctly configured, so skipping it is the desired outcome
-- rather than a failure, and one role refusing must not abandon the rest.

do $$
declare
  target_role text;
begin
  execute 'alter database ' || quote_ident(current_database()) || ' set timezone to ''Pacific/Auckland''';

  foreach target_role in array array[
    'anon',
    'authenticated',
    'service_role',
    'authenticator',
    'supabase_admin',
    'postgres'
  ] loop
    if exists (select 1 from pg_roles where rolname = target_role) then
      begin
        execute format('alter role %I set timezone to %L', target_role, 'Pacific/Auckland');
      exception
        when insufficient_privilege then
          raise notice 'skipping role %: reserved and not alterable', target_role;
      end;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Role-window lookups
-- ---------------------------------------------------------------------------
--
-- These four are the access decisions. `user_has_role` gates every RLS policy
-- through `is_access_admin` and the capability helpers, so getting its frame
-- wrong silently denies access rather than raising an error.

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
      and (ur.effective_from is null or ur.effective_from <= public.school_current_date())
      and (ur.effective_to is null or ur.effective_to >= public.school_current_date())
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
      and (ur.effective_from is null or ur.effective_from <= public.school_current_date())
      and (ur.effective_to is null or ur.effective_to >= public.school_current_date())
  );
$$;

create or replace function public.has_permission(p_user_id uuid default auth.uid(), p_capability text default null::text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_has_role(p_user_id, 'site_admin')
    or exists (
      select 1
      from public.user_roles ur
      join public.role_permissions rp on rp.role = ur.role
      where ur.profile_id = p_user_id
        and rp.capability = p_capability
        and ur.active = true
        and (ur.effective_from is null or ur.effective_from <= public.school_current_date())
        and (ur.effective_to is null or ur.effective_to >= public.school_current_date())
    );
$$;

create or replace function public.user_capabilities(p_user_id uuid default auth.uid())
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select rp.capability
  from public.user_roles ur
  join public.role_permissions rp on rp.role = ur.role
  where ur.profile_id = p_user_id
    and ur.active = true
    and (ur.effective_from is null or ur.effective_from <= public.school_current_date())
    and (ur.effective_to is null or ur.effective_to >= public.school_current_date())
  union
  -- site_admin bypasses the matrix, so it resolves the full catalogue rather
  -- than whatever the matrix happens to grant.
  select ac.capability
  from public.app_capabilities ac
  where public.user_has_role(p_user_id, 'site_admin')
  order by 1;
$$;

-- ---------------------------------------------------------------------------
-- 4. The student-scope view
-- ---------------------------------------------------------------------------
--
-- `CURRENT_DATE` inside a view is evaluated per query, not per view definition,
-- so it tracked the session timezone. `school_current_date()` is stable, so it
-- still folds to a constant within a single statement and the planner is not
-- forced to re-evaluate the scope per row.

create or replace view public.effective_teacher_student_scope
as
  with class_scope as (
    select csa.staff_profile_id as teacher_id, s.id as student_id
    from public.class_staff_assignments csa
    join public.students s on s.class_id = csa.class_id
    where (csa.effective_from is null or csa.effective_from <= public.school_current_date())
      and (csa.effective_to is null or csa.effective_to >= public.school_current_date())
  ),
  manual_scope as (
    select tss.teacher_id, tss.student_id, tss.is_excluded
    from public.teacher_student_scope tss
    where (tss.effective_from is null or tss.effective_from <= public.school_current_date())
      and (tss.effective_to is null or tss.effective_to >= public.school_current_date())
  ),
  candidate_scope as (
    select class_scope.teacher_id, class_scope.student_id
    from class_scope
    union
    select manual_scope.teacher_id, manual_scope.student_id
    from manual_scope
    where manual_scope.is_excluded = false
  )
  select distinct candidate_scope.teacher_id, candidate_scope.student_id
  from candidate_scope
  where not (
    exists (
      select 1
      from manual_scope ex
      where ex.teacher_id = candidate_scope.teacher_id
        and ex.student_id = candidate_scope.student_id
        and ex.is_excluded = true
    )
  );

-- ---------------------------------------------------------------------------
-- 5. Reporting and directory reads
-- ---------------------------------------------------------------------------
--
-- `list_staff_directory` is what the Admin screen renders, and it is the one
-- that disagreed with the access decision: it showed the grant as active while
-- `user_has_role` denied it. Both now ask the same question in the same frame.

create or replace function public.list_staff_directory()
returns table(
  id uuid,
  profile_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  role text,
  department text,
  hire_date date,
  status text,
  org_unit_path text,
  created_at timestamp without time zone,
  updated_at timestamp without time zone,
  roles jsonb,
  primary_role text,
  account_status text,
  account_invited_at timestamp with time zone,
  dated_roles jsonb,
  pending_roles jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_access_admin(auth.uid()) then
    raise exception 'insufficient_privilege';
  end if;

  return query
  select
    s.id,
    s.profile_id,
    s.first_name,
    s.last_name,
    s.email,
    s.phone,
    s.role,
    s.department,
    s.hire_date,
    s.status,
    s.org_unit_path,
    s.created_at,
    s.updated_at,
    coalesce(
      jsonb_agg(distinct ur.role) filter (where ur.role is not null),
      '[]'::jsonb
    ) as roles,
    max(ur.role) filter (where ur.role is not null) as primary_role,
    case
      when s.profile_id is null then 'none'
      else coalesce(ar.status, 'active')
    end as account_status,
    ar.invited_at as account_invited_at,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'role', dur.role,
            'effective_from', dur.effective_from,
            'effective_to', dur.effective_to
          ) order by dur.effective_from nulls last, dur.role
        ),
        '[]'::jsonb
      )
      from public.user_roles dur
      where dur.profile_id = s.profile_id
        and dur.active = true
        and not (
          (dur.effective_from is null or dur.effective_from <= public.school_current_date())
          and (dur.effective_to is null or dur.effective_to >= public.school_current_date())
        )
    ) as dated_roles,
    s.pending_roles as pending_roles
  from public.staff s
  left join public.user_roles ur
    on ur.profile_id = s.profile_id
   and ur.active = true
   and (ur.effective_from is null or ur.effective_from <= public.school_current_date())
   and (ur.effective_to is null or ur.effective_to >= public.school_current_date())
  left join public.account_registrations ar
    on ar.profile_id = s.profile_id
  group by
    s.id,
    s.profile_id,
    s.first_name,
    s.last_name,
    s.email,
    s.phone,
    s.role,
    s.department,
    s.hire_date,
    s.status,
    s.org_unit_path,
    s.created_at,
    s.updated_at,
    ar.status,
    ar.invited_at,
    s.pending_roles
  order by s.last_name, s.first_name;
end;
$$;

create or replace function public.list_incident_assignees()
returns table(profile_id uuid, email text, full_name text, org_unit_path text, roles jsonb)
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
    and (ur.effective_from is null or ur.effective_from <= public.school_current_date())
    and (ur.effective_to is null or ur.effective_to >= public.school_current_date())
  group by p.id, p.email, p.full_name, p.org_unit_path
  order by p.full_name nulls last, p.email;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Dashboard stats and the scope grace period
-- ---------------------------------------------------------------------------
--
-- `attendanceToday` counted the UTC date. For half of every local day that
-- returned the previous day's roll, so the dashboard and the school disagreed
-- about what "today" meant. `teacher_scope_ended_within_grace` subtracts its
-- grace period from the same notion of today, so it moves with it.

create or replace function public.dashboard_stats_for_role(p_role text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_roles text[] := array[]::text[];
  v_active_role text := null;
  v_school_wide boolean := false;
  v_assigned boolean := false;
  v_queue boolean := false;
begin
  if v_user_id is not null then
    -- Window-filtered, matching has_permission and the client.
    select coalesce(array_agg(role), array[]::text[])
    into v_roles
    from public.user_roles
    where profile_id = v_user_id
      and active = true
      and (effective_from is null or effective_from <= public.school_current_date())
      and (effective_to is null or effective_to >= public.school_current_date());

    -- Display-only echo of the active role. Mirrors ROLE_PRECEDENCE in
    -- src/lib/access/registry.ts so the badge agrees with the client; it is not
    -- an access decision, so an ordering difference here cannot widen anything.
    select candidate.role into v_active_role
    from unnest(v_roles) as candidate(role)
    left join unnest(array['site_admin','finance_admin','finance_read_only','board_member','it_admin','property_manager','counsellor','staff','it_staff','property_staff']) with ordinality as ranking(role, precedence)
      on ranking.role = candidate.role
    order by ranking.precedence nulls last, candidate.role
    limit 1;
  end if;

  -- access.manage is the school-wide capability: site admin only, since no other
  -- role holds it.
  v_school_wide := public.has_permission(v_user_id, 'access.manage');

  -- Assigned scope: any of the scoped readers. Used for classroom-style counts.
  v_assigned := v_school_wide is false and (
    public.has_permission(v_user_id, 'students.view_assigned')
    or public.has_permission(v_user_id, 'classes.view_assigned')
    or public.has_permission(v_user_id, 'attendance.view_assigned')
    or public.has_permission(v_user_id, 'ict.view_assigned')
    or public.has_permission(v_user_id, 'rm.view_assigned')
  );

  -- Whole-queue triage, for roles that see every ticket rather than their own.
  v_queue := public.has_permission(v_user_id, 'ict.view_all')
    or public.has_permission(v_user_id, 'rm.view_all');

  return jsonb_build_object(
    'role', v_active_role,
    'roles', to_jsonb(v_roles),
    -- School-wide totals. Gated on access.manage rather than a tier name.
    'schoolWide', case when v_school_wide then jsonb_build_object(
      'totalStudents', (select count(*)::int from public.students),
      'totalClasses', (select count(*)::int from public.classes),
      'totalStaff', (select count(*)::int from public.staff),
      'activeIncidents', (select count(*)::int from public.incidents where is_deleted = false and status in ('open', 'in_review')),
      'openTickets', (
        (select count(*)::int from public.tickets where is_deleted = false and status not in ('resolved', 'closed', 'archived'))
        + (select count(*)::int from public.rm_tickets where is_deleted = false and status not in ('resolved', 'closed', 'archived'))
      ),
      'attendanceToday', (select count(*)::int from public.attendance where date = public.school_current_date()),
      'studentsByStatus', coalesce((
        select jsonb_object_agg(status_key, status_count)
        from (
          select coalesce(status, 'unknown') as status_key, count(*)::int as status_count
          from public.students
          group by 1
        ) as status_counts
      ), '{}'::jsonb),
      'ticketsByStatus', coalesce((
        select jsonb_object_agg(status_key, status_count)
        from (
          select coalesce(status, 'unknown') as status_key, count(*)::int as status_count
          from public.tickets
          where is_deleted = false
          group by 1
        ) as status_counts
      ), '{}'::jsonb)
    ) end,
    -- Assigned scope. Reads the effective sources so the counts agree with
    -- is_student_in_effective_scope; see note 1 above.
    'assigned', case when v_assigned then jsonb_build_object(
      'classesInScope', (
        select count(distinct csa.class_id)::int
        from public.class_staff_assignments csa
        where csa.staff_profile_id = v_user_id
          and (csa.effective_from is null or csa.effective_from <= public.school_current_date())
          and (csa.effective_to is null or csa.effective_to >= public.school_current_date())
      ),
      'studentsInScope', (
        select count(distinct etss.student_id)::int
        from public.effective_teacher_student_scope etss
        where etss.teacher_id = v_user_id
      ),
      'incidentsInWork', (select count(*)::int from public.incidents where is_deleted = false and (created_by = v_user_id or assigned_to = v_user_id)),
      'openTickets', (
        (select count(*)::int from public.tickets where is_deleted = false and (requester_id = v_user_id or assigned_to = v_user_id) and status not in ('resolved', 'closed', 'archived'))
        + (select count(*)::int from public.rm_tickets where is_deleted = false and (requester_id = v_user_id or assigned_to = v_user_id) and status not in ('resolved', 'closed', 'archived'))
      ),
      'followUpsDue', (select count(*)::int from public.incident_follow_ups where (assigned_to = v_user_id or author_id = v_user_id) and completed_at is null),
      'ticketsByStatus', coalesce((
        select jsonb_object_agg(status_key, status_count)
        from (
          select coalesce(status, 'unknown') as status_key, count(*)::int as status_count
          from public.tickets
          where is_deleted = false
            and (requester_id = v_user_id or assigned_to = v_user_id)
          group by 1
        ) as status_counts
      ), '{}'::jsonb)
    ) end,
    -- Whole-queue triage. `activeItStaff` counts role rows, not the legacy
    -- `staff.role` column; see note 2 above.
    'itAdmin', case when v_queue then jsonb_build_object(
      'totalTickets', (
        (select count(*)::int from public.tickets where is_deleted = false)
        + (select count(*)::int from public.rm_tickets where is_deleted = false)
      ),
      'unassignedTickets', (
        (select count(*)::int from public.tickets where is_deleted = false and assigned_to is null and status not in ('resolved', 'closed', 'archived'))
        + (select count(*)::int from public.rm_tickets where is_deleted = false and assigned_to is null and status not in ('resolved', 'closed', 'archived'))
      ),
      'activeItStaff', (
        select count(*)::int
        from public.user_roles
        where active = true
          and role = 'it_staff'
          and (effective_from is null or effective_from <= public.school_current_date())
          and (effective_to is null or effective_to >= public.school_current_date())
      ),
      'openIncidents', (select count(*)::int from public.incidents where is_deleted = false and status in ('open', 'in_review')),
      'pendingRoleUpdates', (select count(*)::int from public.user_roles where active = false),
      'roleDistribution', coalesce((
        select jsonb_object_agg(role_key, role_count)
        from (
          -- Window-filtered too: an out-of-window role is not a real assignment and
          -- must not appear in the distribution the IT admin is shown.
          select role as role_key, count(*)::int as role_count
          from public.user_roles
          where active = true
            and (effective_from is null or effective_from <= public.school_current_date())
            and (effective_to is null or effective_to >= public.school_current_date())
          group by 1
        ) as role_counts
      ), '{}'::jsonb)
    ) end
  );
end;
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

  return v_latest_scope_end >= (public.school_current_date() - p_grace_days);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Repair the grant that exposed this
-- ---------------------------------------------------------------------------
--
-- A window that opened on the UTC date at the time it was typed is one day
-- behind what the admin meant, and nothing is going to walk the server clock
-- forward to fix it. Re-anchor any window that started today-in-UTC to the
-- school date it actually referred to. Idempotent: the second run matches
-- nothing.

update public.user_roles ur
set effective_from = (ur.effective_from + 1)::date
where ur.effective_from is not null
  and ur.effective_from = ((now() at time zone 'UTC')::date);

update public.class_staff_assignments csa
set effective_from = (csa.effective_from + 1)::date
where csa.effective_from is not null
  and csa.effective_from = ((now() at time zone 'UTC')::date);

update public.teacher_student_scope tss
set effective_from = (tss.effective_from + 1)::date
where tss.effective_from is not null
  and tss.effective_from = ((now() at time zone 'UTC')::date);
