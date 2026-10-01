-- -----------------------------------------------------------------------------
-- Retarget the incident policies from the retired `teacher` role to capabilities
-- -----------------------------------------------------------------------------
-- `teacher` is retired into `staff`, and the retirement migration grants
-- `staff` exactly the incident capabilities the old policies were gating:
-- `incidents.create_own`, `incidents.update_own`, `incidents.view_own`.
--
-- But the incident RLS policies were never retargeted. They still read
-- `user_has_role(auth.uid(), 'teacher')`, which is now false for everyone,
-- because a `teacher` row no longer resolves to any grant. The effect was that
-- six policies silently stopped matching anybody:
--
--   incidents            Teacher insert / update / read standard in scope /
--                         read own incidents grace period
--   incident_students    Teacher insert / delete
--   incident_comments    Teacher insert comments
--   incident_audit_log   Incident changes can write audit log
--
-- Nobody could record an incident, tag a student to one, comment on one, or write
-- the audit entry for one. This is the exact failure the retirement was supposed
-- to avoid, so it is fixed here rather than left as a rollout note.
--
-- The `NOT is_counsellor_or_leadership(...)` guard becomes
-- `NOT has_permission(..., 'incidents.view_all')`. Both exclude a reader who
-- already sees every incident from the narrower scoped branch. Keeping the guard
-- matters because `counsellor` holds both `view_all` and `view_own`: without it a
-- counsellor who raised an incident would also match the "own incidents" path,
-- which was not the previous behaviour.
--
-- `incident_export_audit_log` was gated on `user_has_any_role(ARRAY['site_admin',
-- 'it_admin'])`. That becomes `incidents.export`, which the matrix grants to
-- `counsellor` and `site_admin`. `it_admin` loses read of this log: the matrix
-- deliberately withholds incident capabilities from IT admin, and a role-name
-- check here contradicted that. Called out rather than papered over.

-- incidents ------------------------------------------------------------------

drop policy if exists "Teacher insert incidents" on public.incidents;
create policy "Scoped staff insert incidents"
  on public.incidents
  for insert to authenticated
  with check (
    has_permission((select auth.uid()), 'incidents.create_own')
    and not has_permission((select auth.uid()), 'incidents.view_all')
    and created_by = (select auth.uid())
    and visibility = 'standard'
    and is_student_in_effective_scope((select auth.uid()), student_id)
  );

drop policy if exists "Teacher update incidents" on public.incidents;
create policy "Scoped staff update incidents"
  on public.incidents
  for update to authenticated
  using (
    has_permission((select auth.uid()), 'incidents.update_own')
    and not has_permission((select auth.uid()), 'incidents.view_all')
    and is_deleted = false
    and visibility = 'standard'
    and is_student_in_effective_scope((select auth.uid()), student_id)
  )
  with check (
    has_permission((select auth.uid()), 'incidents.update_own')
    and not has_permission((select auth.uid()), 'incidents.view_all')
    and is_deleted = false
    and visibility = 'standard'
    and is_student_in_effective_scope((select auth.uid()), student_id)
  );

drop policy if exists "Teacher read standard incidents in scope" on public.incidents;
create policy "Scoped staff read standard incidents in scope"
  on public.incidents
  for select to authenticated
  using (
    has_permission((select auth.uid()), 'incidents.view_own')
    and not has_permission((select auth.uid()), 'incidents.view_all')
    and is_deleted = false
    and visibility = 'standard'
    and is_student_in_effective_scope((select auth.uid()), student_id)
  );

drop policy if exists "Teacher read own incidents grace period" on public.incidents;
create policy "Scoped staff read own incidents grace period"
  on public.incidents
  for select to authenticated
  using (
    has_permission((select auth.uid()), 'incidents.view_own')
    and not has_permission((select auth.uid()), 'incidents.view_all')
    and is_deleted = false
    and visibility = 'standard'
    and created_by = (select auth.uid())
    and teacher_scope_ended_within_grace((select auth.uid()), student_id, 90)
  );

-- incident_students ----------------------------------------------------------

drop policy if exists "Teacher insert incident students" on public.incident_students;
create policy "Scoped staff insert incident students"
  on public.incident_students
  for insert to authenticated
  with check (
    has_permission((select auth.uid()), 'incidents.create_own')
    and not has_permission((select auth.uid()), 'incidents.view_all')
    and tagged_by = (select auth.uid())
    and exists (
      select 1
      from public.incidents i
      where i.id = incident_students.incident_id
        and i.is_deleted = false
        and i.visibility = 'standard'
        and is_student_in_effective_scope((select auth.uid()), i.student_id)
    )
    and is_student_in_effective_scope((select auth.uid()), student_id)
  );

drop policy if exists "Teacher delete incident students" on public.incident_students;
create policy "Scoped staff delete incident students"
  on public.incident_students
  for delete to authenticated
  using (
    has_permission((select auth.uid()), 'incidents.update_own')
    and not has_permission((select auth.uid()), 'incidents.view_all')
    and exists (
      select 1
      from public.incidents i
      where i.id = incident_students.incident_id
        and i.is_deleted = false
        and i.visibility = 'standard'
        and is_student_in_effective_scope((select auth.uid()), i.student_id)
    )
    and is_student_in_effective_scope((select auth.uid()), student_id)
  );

-- incident_comments ----------------------------------------------------------

drop policy if exists "Teacher insert comments" on public.incident_comments;
create policy "Scoped staff insert comments"
  on public.incident_comments
  for insert to authenticated
  with check (
    has_permission((select auth.uid()), 'incidents.create_own')
    and not has_permission((select auth.uid()), 'incidents.view_all')
    and author_id = (select auth.uid())
    and visibility = 'standard'
    and exists (
      select 1
      from public.incidents i
      where i.id = incident_comments.incident_id
        and i.is_deleted = false
        and i.visibility = 'standard'
        and is_student_in_effective_scope((select auth.uid()), i.student_id)
    )
  );

-- incident_audit_log ---------------------------------------------------------

drop policy if exists "Incident changes can write audit log" on public.incident_audit_log;
create policy "Incident changes can write audit log"
  on public.incident_audit_log
  for insert to authenticated
  with check (
    has_permission((select auth.uid()), 'incidents.view_all')
    or (
      has_permission((select auth.uid()), 'incidents.view_own')
      and exists (
        select 1
        from public.incidents i
        where i.id = incident_audit_log.incident_id
          and i.is_deleted = false
          and i.visibility = 'standard'
          and (
            is_student_in_effective_scope((select auth.uid()), i.student_id)
            or (i.created_by = (select auth.uid())
              and teacher_scope_ended_within_grace((select auth.uid()), i.student_id, 90))
          )
      )
    )
  );

-- incident_export_audit_log --------------------------------------------------

drop policy if exists "Leadership read export audit" on public.incident_export_audit_log;
create policy "Export holders read export audit"
  on public.incident_export_audit_log
  for select to authenticated
  using (has_permission((select auth.uid()), 'incidents.export'));

-- No grant changes are needed here. Every policy above is `to authenticated`, and
-- the capability functions it calls are already granted to `authenticated` and
-- revoked from `anon` in 20260931500000.