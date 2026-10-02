-- Enforce assigned scope on students, classes, and attendance.
--
-- Until now all three tables carried a blanket `auth.role() = 'authenticated'`
-- read policy, so "only see the students assigned to you" was a UI convention
-- with no database support. This replaces the read side with capability checks
-- over the existing scope layer, which is what `is_student_in_effective_scope`
-- has always used for incidents.
--
-- The scope layer is role-agnostic: `class_staff_assignments.staff_profile_id`
-- and `teacher_student_scope.teacher_id` both point at `profiles.id`, so this
-- works unchanged for the base `staff` role. Only the column names are
-- teacher-flavoured.
--
-- Why the blanket `for all` policies are narrowed rather than deleted
-- ------------------------------------------------------------------
-- A permissive `for all` policy also grants SELECT, and Postgres ORs permissive
-- policies together. Leaving them in place would have silently defeated every
-- scoped read policy added below, because `auth.role() = 'authenticated'` is true
-- for exactly the users this migration is meant to restrict. They are therefore
-- recast as INSERT/UPDATE/DELETE so the write behaviour is preserved unchanged
-- while SELECT becomes scoped.
--
-- Writes are deliberately left as they are. The agreed matrix has no
-- `students.update` / `attendance.record` capability to gate them on, and
-- inventing one here would either lock every staff member out of recording
-- attendance or require a matrix change that is not in scope. Narrowing writes
-- is tracked as remaining work, not done quietly.
--
-- Verified locally: a `staff` profile selecting a student outside its scope
-- returns 0 rows, and the Workspace sync path is unaffected because it runs as
-- a site admin.

-- ---------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can view students" on public.students;
drop policy if exists "Authenticated users can manage students" on public.students;

create policy students_select_scoped
  on public.students
  for select
  to authenticated
  using (
    public.has_permission(auth.uid(), 'students.view_all')
    or (
      public.has_permission(auth.uid(), 'students.view_assigned')
      and public.is_student_in_effective_scope(auth.uid(), students.id)
    )
  );

create policy students_insert
  on public.students
  for insert
  to authenticated
  with check (auth.role() = 'authenticated');

create policy students_update
  on public.students
  for update
  to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy students_delete
  on public.students
  for delete
  to authenticated
  using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- classes
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can view classes" on public.classes;
drop policy if exists "Authenticated users can manage classes" on public.classes;

create policy classes_select_scoped
  on public.classes
  for select
  to authenticated
  using (
    public.has_permission(auth.uid(), 'classes.view_all')
    or (
      public.has_permission(auth.uid(), 'classes.view_assigned')
      and exists (
        select 1
        from public.class_staff_assignments csa
        where csa.class_id = classes.id
          and csa.staff_profile_id = auth.uid()
          and (csa.effective_from is null or csa.effective_from <= current_date)
          and (csa.effective_to is null or csa.effective_to >= current_date)
      )
    )
  );

create policy classes_insert
  on public.classes
  for insert
  to authenticated
  with check (auth.role() = 'authenticated');

create policy classes_update
  on public.classes
  for update
  to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy classes_delete
  on public.classes
  for delete
  to authenticated
  using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- attendance
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can view attendance" on public.attendance;
drop policy if exists "Authenticated users can manage attendance" on public.attendance;

-- Attendance rows are per student, so the same scope join applies. Rows with no
-- student are visible only to module-wide readers.
create policy attendance_select_scoped
  on public.attendance
  for select
  to authenticated
  using (
    public.has_permission(auth.uid(), 'attendance.view_all')
    or (
      public.has_permission(auth.uid(), 'attendance.view_assigned')
      and attendance.student_id is not null
      and public.is_student_in_effective_scope(auth.uid(), attendance.student_id)
    )
  );

create policy attendance_insert
  on public.attendance
  for insert
  to authenticated
  with check (auth.role() = 'authenticated');

create policy attendance_update
  on public.attendance
  for update
  to authenticated
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

create policy attendance_delete
  on public.attendance
  for delete
  to authenticated
  using (auth.role() = 'authenticated');
