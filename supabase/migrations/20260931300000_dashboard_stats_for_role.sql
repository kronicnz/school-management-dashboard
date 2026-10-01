-- -----------------------------------------------------------------------------
-- dashboard_stats_for_tier -> dashboard_stats_for_role
-- -----------------------------------------------------------------------------
-- Replaces the tier + operational-subtype RPC with one keyed on capabilities, so
-- the server and the client agree on which section a viewer may see. The sections
-- are gated on capability lookups against the same `role_permissions` matrix the
-- rest of the app uses, instead of on tier names that no role resolves to.
--
-- Three further corrections carried over from the client-side fix:
--
-- 1. Scope counts were read from the base tables with no window filter.
--    `class_staff_assignments` and `teacher_student_scope` are both windowed, so
--    a staff member kept counting last year's classes and students. The student
--    count also disagreed with `is_student_in_effective_scope` because it omitted
--    the class-derived rows. Both now read the effective sources: the windowed
--    assignment table, and the `effective_teacher_student_scope` view.
--
-- 2. `activeItStaff` counted `staff.role = 'it_staff'`, while `assign_ticket`
--    validates against `user_roles`. Two definitions of the same question. It is
--    now counted from window-filtered `user_roles`.
--
-- 3. R&M volume was invisible. `tickets` was counted without `rm_tickets`, so an
--    R&M-only role saw an empty queue. Both queues are counted now.
--
-- `p_role` is deliberately still ignored. It is caller-supplied and this function
-- is SECURITY DEFINER: honouring it would let any signed-in user ask for the
-- school-wide section. The role is echoed back for display only, and every
-- capability is resolved from the caller's own window-filtered grants.

create or replace function public.dashboard_stats_for_role(p_role text default null)
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
      and (effective_from is null or effective_from <= current_date)
      and (effective_to is null or effective_to >= current_date);

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
    -- Assigned scope. Reads the effective sources so the counts agree with
    -- is_student_in_effective_scope; see note 1 above.
    'assigned', case when v_assigned then jsonb_build_object(
      'classesInScope', (
        select count(distinct csa.class_id)::int
        from public.class_staff_assignments csa
        where csa.staff_profile_id = v_user_id
          and (csa.effective_from is null or csa.effective_from <= current_date)
          and (csa.effective_to is null or csa.effective_to >= current_date)
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
          and (effective_from is null or effective_from <= current_date)
          and (effective_to is null or effective_to >= current_date)
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
            and (effective_from is null or effective_from <= current_date)
            and (effective_to is null or effective_to >= current_date)
          group by 1
        ) as role_counts
      ), '{}'::jsonb)
    ) end
  );
end;
$$;

comment on function public.dashboard_stats_for_role(text) is
  'Capability-gated dashboard sections. schoolWide needs access.manage, assigned needs a *.view_assigned capability, itAdmin needs ict.view_all or rm.view_all. p_role is display-only and never widens access.';

-- The tier-based RPC has no remaining caller, and leaving it in place invites a
-- second reader re-gating on a tier name.
drop function if exists public.dashboard_stats_for_tier(text);