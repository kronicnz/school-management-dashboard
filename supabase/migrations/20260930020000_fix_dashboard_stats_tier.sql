-- -----------------------------------------------------------------------------
-- Fix dashboard_stats_for_tier: window roles, and give site_admin a section
-- -----------------------------------------------------------------------------
-- Three defects, all of which produced a dashboard with no role-scoped content.
--
-- 1. `leadership` was dead. The function gated the school-wide section on
--    `v_tier = 'leadership'`, but no role ever resolves to a `leadership` tier:
--    `getResolvedRoleTier` in src/lib/role-tier.ts returns only site_admin,
--    it_admin, operational_staff or minimal_access. A site_admin therefore matched
--    none of the three section guards and the function returned an entirely null
--    payload. Confirmed live: every one of leadership/operational/itAdmin came back
--    null for a site_admin.
--
--    `fetchDashboardStatsLocally` is the reference contract: it returns the
--    `leadership` section *for site_admin*. The section is named for the kind of
--    data, not the tier, and this function simply used the wrong guard. Fixed to
--    `v_tier = 'site_admin'` to match.
--
-- 2. Role windows were ignored. Roles were read with `active = true` only, while
--    every other read of `user_roles` filters on effective_from/effective_to (see
--    fetchCurrentUserRoles in supabaseApi.ts, the edge functions, and
--    `user_has_role`). A role starting next term therefore granted a full tier
--    here. Verified: a 2027-01-01 site_admin grant made the function return
--    site_admin for a teacher, and because no section guard matched, the payload
--    was empty as well.
--
-- 3. Subtype precedence disagreed with the client. The function ordered
--    teacher > counsellor > finance_admin, while
--    `operationalSubtypePrecedence` in src/lib/role-tier.ts orders
--    finance_admin > finance_read_only > board_member > property_manager >
--    property_staff > teacher > counsellor > it_staff. A teacher who is also a
--    finance admin got `teacher` in the sidebar and `finance_admin` dashboard
--    metrics. The mock persona "Mock Teacher Finance" exists specifically to check
--    that precedence, so this was a real disagreement and not a cosmetic one.
--
-- `p_tier` is deliberately still ignored. It is caller-supplied, and this function
-- is SECURITY DEFINER: honouring it would let any signed-in user ask for the
-- site_admin section and read school-wide counts. The tier is recomputed from the
-- caller's own window-filtered roles instead, so the value is authoritative.

create or replace function public.dashboard_stats_for_tier(p_tier text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_roles text[] := array[]::text[];
  v_tier text := 'minimal_access';
  v_operational_subtype text := 'unknown';
begin
  if v_user_id is not null then
    -- Window-filtered, matching the client and the other server-side readers.
    select coalesce(array_agg(role), array[]::text[])
    into v_roles
    from public.user_roles
    where profile_id = v_user_id
      and active = true
      and (effective_from is null or effective_from <= current_date)
      and (effective_to is null or effective_to >= current_date);
  end if;

  if 'site_admin' = any(v_roles) then
    v_tier := 'site_admin';
  elsif 'it_admin' = any(v_roles) then
    v_tier := 'it_admin';
  elsif exists (
    select 1
    from unnest(v_roles) as role
    where role in ('finance_admin', 'finance_read_only', 'board_member', 'property_manager', 'property_staff', 'teacher', 'counsellor', 'it_staff')
  ) then
    v_tier := 'operational_staff';
  end if;

  -- Precedence mirrors `operationalSubtypePrecedence` in src/lib/role-tier.ts.
  if exists (select 1 from unnest(v_roles) as role where role = 'finance_admin') then
    v_operational_subtype := 'finance_admin';
  elsif exists (select 1 from unnest(v_roles) as role where role = 'finance_read_only') then
    v_operational_subtype := 'finance_read_only';
  elsif exists (select 1 from unnest(v_roles) as role where role = 'board_member') then
    v_operational_subtype := 'board_member';
  elsif exists (select 1 from unnest(v_roles) as role where role = 'property_manager') then
    v_operational_subtype := 'property_manager';
  elsif exists (select 1 from unnest(v_roles) as role where role = 'property_staff') then
    v_operational_subtype := 'property_staff';
  elsif exists (select 1 from unnest(v_roles) as role where role = 'teacher') then
    v_operational_subtype := 'teacher';
  elsif exists (select 1 from unnest(v_roles) as role where role = 'counsellor') then
    v_operational_subtype := 'counsellor';
  elsif exists (select 1 from unnest(v_roles) as role where role = 'it_staff') then
    v_operational_subtype := 'it_staff';
  end if;

  return jsonb_build_object(
    'tier', v_tier,
    'operationalSubtype', v_operational_subtype,
    -- Keyed on site_admin, not on a 'leadership' tier. See note 1 above.
    'leadership', case when v_tier = 'site_admin' then jsonb_build_object(
      'totalStudents', (select count(*)::int from public.students),
      'totalClasses', (select count(*)::int from public.classes),
      'totalStaff', (select count(*)::int from public.staff),
      'activeIncidents', (select count(*)::int from public.incidents where is_deleted = false and status in ('open', 'in_review')),
      'openTickets', (select count(*)::int from public.tickets where is_deleted = false and status not in ('resolved', 'closed', 'archived')),
      'attendanceToday', (select count(*)::int from public.attendance where date = current_date),
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
    'operational', case when v_tier = 'operational_staff' then jsonb_build_object(
      'classesInScope', (select count(distinct class_id)::int from public.class_staff_assignments where staff_profile_id = v_user_id),
      'studentsInScope', (select count(distinct student_id)::int from public.teacher_student_scope where teacher_id = v_user_id and is_excluded = false),
      'incidentsInWork', (select count(*)::int from public.incidents where is_deleted = false and (created_by = v_user_id or assigned_to = v_user_id)),
      'openTickets', (select count(*)::int from public.tickets where is_deleted = false and (requester_id = v_user_id or assigned_to = v_user_id) and status not in ('resolved', 'closed', 'archived')),
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
    'itAdmin', case when v_tier = 'it_admin' then jsonb_build_object(
      'totalTickets', (select count(*)::int from public.tickets where is_deleted = false),
      'unassignedTickets', (select count(*)::int from public.tickets where is_deleted = false and assigned_to is null and status not in ('resolved', 'closed', 'archived')),
      'activeItStaff', (select count(*)::int from public.staff where status = 'active' and role = 'it_staff'),
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
            and (effective_from is null or effective_from <= current_date)
            and (effective_to is null or effective_to >= current_date)
          group by 1
        ) as role_counts
      ), '{}'::jsonb)
    ) end
  );
end;
$$;
