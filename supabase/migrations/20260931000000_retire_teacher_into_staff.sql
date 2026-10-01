-- Retire the `teacher` role into `staff`.
--
-- `teacher` was the operational classroom role. It is replaced by `staff`, which
-- carries the same scope concept (assigned students, assigned classes, own
-- incidents, own ICT and R&M tickets). See the role matrix in
-- 20260930150000_permission_matrix.sql: `staff` holds every capability `teacher`
-- ever resolved to, and nothing is lost.
--
-- The old grants are deactivated rather than deleted, and their date windows are
-- copied onto the new `staff` grant, so:
--   * a backout is a single update setting `active = true` on those rows;
--   * a teacher grant that had already ended does not resurrect as a live
--     `staff` grant, because the window is carried across.
--
-- `teacher` remains legal in the `user_roles` CHECK and is kept in `app_roles`
-- with `is_retired = true` for that backout window.

-- 1. Copy each active teacher grant to a staff grant, preserving the window.
--    A profile that already holds `staff` keeps its own grant untouched.
insert into public.user_roles (profile_id, role, active, effective_from, effective_to, granted_by)
select
  t.profile_id,
  'staff',
  t.active,
  t.effective_from,
  t.effective_to,
  t.granted_by
from public.user_roles t
where t.role = 'teacher'
  and t.active = true
  and not exists (
    select 1
    from public.user_roles existing
    where existing.profile_id = t.profile_id
      and existing.role = 'staff'
      and existing.active = true
      and (existing.effective_from is null or existing.effective_from <= current_date)
      and (existing.effective_to is null or existing.effective_to >= current_date)
  );

-- 2. Retire the teacher grants. Deliberately a soft retire: the rows stay for
--    the backout window and for the audit trail.
update public.user_roles
set active = false,
    updated_at = now()
where role = 'teacher'
  and active = true;
