create or replace function public.assign_ticket(
  p_ticket_id uuid,
  p_assigned_to uuid,
  p_reason text default null
)
returns public.tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets;
begin
  if not public.is_it_admin(auth.uid()) then
    raise exception 'Only IT Admin can assign tickets';
  end if;

  if p_assigned_to is not null then
    if not exists (
      select 1
      from public.staff s
      where s.profile_id = p_assigned_to
        and s.status = 'active'
        and public.user_has_any_role(p_assigned_to, array['it_staff', 'it_admin']::text[])
    ) then
      raise exception 'Assignee must be an active IT staff member';
    end if;
  end if;

  perform set_config('app.ticket_change_reason', coalesce(p_reason, 'Assignment updated'), true);

  update public.tickets
  set assigned_to = p_assigned_to,
      assigned_by = auth.uid(),
      status = case when p_assigned_to is null then 'new' else case when status = 'new' then 'assigned' else status end end
  where id = p_ticket_id
  returning * into v_ticket;

  if not found then
    raise exception 'Ticket not found';
  end if;

  return v_ticket;
end;
$$;
