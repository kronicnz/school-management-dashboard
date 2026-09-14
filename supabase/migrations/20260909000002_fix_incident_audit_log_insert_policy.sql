-- Allow incident/comment triggers to append audit rows under RLS.

drop policy if exists "Incident changes can write audit log" on public.incident_audit_log;

create policy "Incident changes can write audit log"
on public.incident_audit_log
for insert
with check (
  public.is_counsellor_or_leadership(auth.uid())
  or (
    public.user_has_role(auth.uid(), 'teacher')
    and exists (
      select 1
      from public.incidents i
      where i.id = incident_id
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
  )
);
