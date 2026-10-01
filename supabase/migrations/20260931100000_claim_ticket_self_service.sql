-- "Take ticket" as a real self-service action.
--
-- `claim_ticket` existed but was dead and `is_it_admin`-gated, and there was no
-- R&M equivalent, so the "Assign to me" button in Tickets.tsx could only ever
-- fail for anyone who was not an admin.
--
-- Both claim functions are capability-gated rather than role-gated, and both
-- refuse to overwrite an existing assignee with a distinct message so the UI can
-- tell "already taken" apart from "not permitted". The status transitions here
-- reuse the existing lifecycle vocabulary; no new state machine is introduced.

-- ---------------------------------------------------------------------------
-- ict.claim
-- ---------------------------------------------------------------------------

create or replace function public.claim_ticket(
  p_ticket_id uuid,
  p_reason text default null
)
returns public.tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets;
  v_assigned_to uuid;
begin
  if not public.has_permission(auth.uid(), 'ict.claim') then
    raise exception 'You do not have permission to take ICT tickets';
  end if;

  -- Read the current assignee first so "already taken" is distinguishable from
  -- "not permitted", and so the check and the write cannot race apart.
  select assigned_to into v_assigned_to
  from public.tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'Ticket not found';
  end if;

  if v_assigned_to is not null and v_assigned_to <> auth.uid() then
    raise exception 'Ticket is already assigned to someone else';
  end if;

  perform set_config('app.ticket_change_reason', coalesce(p_reason, 'Claimed by assignee'), true);

  update public.tickets
  set assigned_to = auth.uid(),
      assigned_by = auth.uid(),
      status = case when status = 'new' then 'assigned' else status end
  where id = p_ticket_id
  returning * into v_ticket;

  return v_ticket;
end;
$$;

-- ---------------------------------------------------------------------------
-- rm.claim
-- ---------------------------------------------------------------------------

create or replace function public.claim_rm_ticket(
  p_ticket_id uuid,
  p_reason text default null
)
returns public.rm_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.rm_tickets;
  v_assigned_to uuid;
begin
  if not public.has_permission(auth.uid(), 'rm.claim') then
    raise exception 'You do not have permission to take R&M tickets';
  end if;

  select assigned_to into v_assigned_to
  from public.rm_tickets
  where id = p_ticket_id
  for update;

  if not found then
    raise exception 'Ticket not found';
  end if;

  if v_assigned_to is not null and v_assigned_to <> auth.uid() then
    raise exception 'Ticket is already assigned to someone else';
  end if;

  perform set_config('app.rm_ticket_change_reason', coalesce(p_reason, 'Claimed by assignee'), true);

  update public.rm_tickets
  set assigned_to = auth.uid(),
      assigned_by = auth.uid(),
      status = case when status = 'new' then 'assigned' else status end
  where id = p_ticket_id
  returning * into v_ticket;

  return v_ticket;
end;
$$;

-- `claim_ticket` was previously `is_it_admin`-gated and overwrote any existing
-- assignee. Both problems are fixed above; these grants keep the callable
-- surface honest.
revoke all on function public.claim_ticket(uuid, text) from public, anon;
revoke all on function public.claim_rm_ticket(uuid, text) from public, anon;
grant execute on function public.claim_ticket(uuid, text) to authenticated;
grant execute on function public.claim_rm_ticket(uuid, text) to authenticated;
