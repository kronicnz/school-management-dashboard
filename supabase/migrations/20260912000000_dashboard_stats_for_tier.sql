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
    select coalesce(array_agg(role), array[]::text[])
    into v_roles
    from public.user_roles
    where profile_id = v_user_id
      and active = true;
  end if;

  if 'it_admin' = any(v_roles) then
    v_tier := 'it_admin';
  elsif exists (
    select 1
    from unnest(v_roles) as role
    where role in ('principal', 'deputy_principal', 'counsellor_delegate', 'leadership_delegate')
  ) then
    v_tier := 'leadership';
  elsif exists (
    select 1
    from unnest(v_roles) as role
    where role in ('teacher', 'counsellor', 'it_staff')
  ) then
    v_tier := 'operational_staff';
  end if;

  if exists (select 1 from unnest(v_roles) as role where role = 'teacher') then
    v_operational_subtype := 'teacher';
  elsif exists (select 1 from unnest(v_roles) as role where role = 'counsellor') then
    v_operational_subtype := 'counsellor';
  elsif exists (select 1 from unnest(v_roles) as role where role = 'it_staff') then
    v_operational_subtype := 'it_staff';
  end if;

  return jsonb_build_object(
    'tier', v_tier,
    'operationalSubtype', v_operational_subtype,
    'leadership', case when v_tier = 'leadership' then jsonb_build_object(
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
          select role as role_key, count(*)::int as role_count
          from public.user_roles
          where active = true
          group by 1
        ) as role_counts
      ), '{}'::jsonb)
    ) end
  );
end;
$$;
