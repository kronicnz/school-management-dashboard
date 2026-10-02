-- -----------------------------------------------------------------------------
-- Retarget the last retired-`teacher` incident policy
--
-- `20260931600000_retarget_incident_policies_to_capabilities.sql` converted the
-- incident policies that gated on `user_has_role(auth.uid(), 'teacher')` to the
-- `incidents.*` capabilities, but it left one behind: the SELECT policy on
-- `incident_comments` named "Teacher read visible comments".
--
-- Because `teacher` was retired into `staff`, `user_has_role(auth.uid(),
-- 'teacher')` is now false for every user, so that branch of the policy matched
-- nobody. A `staff` member in scope could read the incident itself (that policy
-- was retargeted) but not its comments, which is an inconsistency rather than an
-- intended restriction.
--
-- The sibling SELECT policy "Counsellor leadership read comments" already grants
-- full read to `counsellor` and `site_admin`, so replacing the role test with
-- capability checks cannot widen access for those roles.
--
-- `auth.uid()` is pinned as an InitPlan `(select auth.uid())` to match the rest of
-- the retargeted policies and keep the planner from re-evaluating it per row.
-- -----------------------------------------------------------------------------

drop policy if exists "Teacher read visible comments" on public.incident_comments;

create policy "Scoped staff read visible comments"
  on public.incident_comments
  for select to authenticated
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
            has_permission((select auth.uid()), 'incidents.view_own')
            and not has_permission((select auth.uid()), 'incidents.view_all')
            and (
              is_student_in_effective_scope((select auth.uid()), i.student_id)
              or (
                i.created_by = (select auth.uid())
                and teacher_scope_ended_within_grace(
                  (select auth.uid()), i.student_id, 90
                )
              )
            )
          )
          or has_active_emergency_access(
            (select auth.uid()), i.student_id, i.id
          )
        )
    )
  );
