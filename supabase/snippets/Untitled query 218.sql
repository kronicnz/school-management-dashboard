create policy "Staff can view non-deleted incidents"

on public.incidents for select

using (

is_deleted = false and

exists (

select 1 from public.profiles

where profiles.id = auth.uid()

and profiles.role in ('admin', 'counselor', 'teacher')

)

);