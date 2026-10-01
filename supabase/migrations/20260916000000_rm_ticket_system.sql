-- R&M ticket domain

create table if not exists public.rm_ticket_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rm_ticket_templates (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.rm_ticket_categories(id) on delete restrict,
  code text not null unique,
  name text not null,
  description text null,
  active boolean not null default true,
  version integer not null default 1,
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rm_ticket_template_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.rm_ticket_templates(id) on delete cascade,
  step_key text not null,
  label text not null,
  sort_order integer not null default 0,
  config jsonb not null default '{}'::jsonb,
  required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, step_key)
);

create table if not exists public.rm_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  requester_id uuid not null references public.profiles(id),
  category_id uuid not null references public.rm_ticket_categories(id),
  template_id uuid not null references public.rm_ticket_templates(id),
  template_version integer not null default 1,
  template_snapshot jsonb not null default '{}'::jsonb,
  assigned_to uuid null references public.profiles(id),
  assigned_by uuid null references public.profiles(id),
  status text not null default 'new' check (status in ('new', 'assigned', 'in_progress', 'pending_user', 'resolved', 'closed', 'reopened', 'archived')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'critical')),
  close_requested_at timestamptz null,
  closed_by_requester_at timestamptz null,
  title text not null,
  summary text null,
  submission_payload jsonb not null default '{}'::jsonb,
  device_context jsonb not null default '{}'::jsonb,
  request_context jsonb not null default '{}'::jsonb,
  is_deleted boolean not null default false,
  deleted_at timestamptz null,
  deleted_by uuid null references public.profiles(id),
  deleted_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rm_ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.rm_tickets(id) on delete restrict,
  author_id uuid not null references public.profiles(id),
  comment_type text not null default 'public' check (comment_type in ('public', 'internal')),
  is_close_request boolean not null default false,
  content text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rm_ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.rm_tickets(id) on delete restrict,
  uploaded_by uuid not null references public.profiles(id),
  storage_path text not null unique,
  file_name text not null,
  mime_type text null,
  file_size bigint null,
  visibility text not null default 'public' check (visibility in ('public', 'internal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rm_ticket_audit_log (
  id bigserial primary key,
  ticket_id uuid not null references public.rm_tickets(id) on delete restrict,
  action text not null,
  changed_by uuid null references public.profiles(id),
  before_data jsonb null,
  after_data jsonb null,
  context jsonb null,
  changed_at timestamptz not null default now()
);

create table if not exists public.rm_ticket_notifications (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.rm_tickets(id) on delete restrict,
  recipient_id uuid not null references public.profiles(id),
  channel text not null check (channel in ('email', 'in_app')),
  event_type text not null,
  delivered_at timestamptz null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rm_ticket_number_counters (
  year integer primary key,
  last_sequence integer not null default 0
);

create index if not exists rm_ticket_categories_active_sort_idx on public.rm_ticket_categories(active, sort_order, name);
create index if not exists rm_ticket_templates_category_idx on public.rm_ticket_templates(category_id, active, name);
create index if not exists rm_ticket_template_steps_template_idx on public.rm_ticket_template_steps(template_id, sort_order);
create index if not exists rm_tickets_requester_idx on public.rm_tickets(requester_id, is_deleted, status, updated_at desc);
create index if not exists rm_tickets_assignee_idx on public.rm_tickets(assigned_to, is_deleted, status, updated_at desc);
create index if not exists rm_tickets_status_idx on public.rm_tickets(status, priority, is_deleted);
create index if not exists rm_ticket_comments_ticket_idx on public.rm_ticket_comments(ticket_id, created_at);
create index if not exists rm_ticket_attachments_ticket_idx on public.rm_ticket_attachments(ticket_id, created_at);
create index if not exists rm_ticket_audit_ticket_idx on public.rm_ticket_audit_log(ticket_id, changed_at desc);
create index if not exists rm_ticket_notifications_ticket_idx on public.rm_ticket_notifications(ticket_id, created_at desc);

create or replace function public.is_rm_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_has_any_role(p_user_id, array['it_admin']::text[]);
$$;

create or replace function public.is_rm_property_manager(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_has_any_role(p_user_id, array['property_manager']::text[]);
$$;

create or replace function public.is_rm_leadership(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_has_any_role(p_user_id, array['site_admin', 'it_admin']::text[]);
$$;

create or replace function public.is_rm_operator(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_rm_admin(p_user_id) or public.is_rm_property_manager(p_user_id);
$$;

create or replace function public.is_rm_ticket_requester(p_ticket_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rm_tickets t
    where t.id = p_ticket_id
      and t.requester_id = p_user_id
  );
$$;

create or replace function public.is_rm_ticket_assignee(p_ticket_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.rm_tickets t
    where t.id = p_ticket_id
      and t.assigned_to = p_user_id
  );
$$;

create or replace function public.can_access_rm_ticket(p_ticket_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_rm_operator(p_user_id)
    or public.is_rm_leadership(p_user_id)
    or public.is_rm_ticket_requester(p_ticket_id, p_user_id)
    or public.is_rm_ticket_assignee(p_ticket_id, p_user_id);
$$;

create or replace function public.next_rm_ticket_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from now())::integer;
  v_sequence integer;
begin
  insert into public.rm_ticket_number_counters(year, last_sequence)
  values (v_year, 1)
  on conflict (year)
  do update set last_sequence = public.rm_ticket_number_counters.last_sequence + 1
  returning last_sequence into v_sequence;

  return format('RM-%s-%05s', v_year, v_sequence);
end;
$$;

create or replace function public.rm_ticket_snapshot_from_template(p_template_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'template', to_jsonb(t),
    'steps', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'step_key', s.step_key,
          'label', s.label,
          'sort_order', s.sort_order,
          'config', s.config,
          'required', s.required
        ) order by s.sort_order
      ) filter (where s.id is not null),
      '[]'::jsonb
    )
  )
  from public.rm_ticket_templates t
  left join public.rm_ticket_template_steps s on s.template_id = t.id
  where t.id = p_template_id
  group by t.id;
$$;

create or replace function public.rm_ticket_audit_context()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'reason', nullif(current_setting('app.rm_ticket_change_reason', true), ''),
    'override', nullif(current_setting('app.rm_ticket_override', true), ''),
    'trigger', current_setting('app.trigger_name', true)
  );
$$;

create or replace function public.set_rm_ticket_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.ticket_number := coalesce(new.ticket_number, public.next_rm_ticket_number());
  new.requester_id := coalesce(new.requester_id, auth.uid());
  new.template_version := coalesce(new.template_version, 1);
  new.template_snapshot := coalesce(new.template_snapshot, '{}'::jsonb);
  new.submission_payload := coalesce(new.submission_payload, '{}'::jsonb);
  new.device_context := coalesce(new.device_context, '{}'::jsonb);
  new.request_context := coalesce(new.request_context, '{}'::jsonb);
  new.status := coalesce(new.status, 'new');
  new.priority := coalesce(new.priority, 'medium');
  new.is_deleted := coalesce(new.is_deleted, false);

  if new.assigned_to is not null and new.assigned_by is null then
    new.assigned_by := auth.uid();
  end if;

  return new;
end;
$$;

create or replace function public.guard_rm_ticket_template_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.ticket_number is distinct from new.ticket_number
     or old.requester_id is distinct from new.requester_id
     or old.category_id is distinct from new.category_id
     or old.template_id is distinct from new.template_id
     or old.template_version is distinct from new.template_version
     or old.template_snapshot is distinct from new.template_snapshot then
    raise exception 'rm ticket template fields are immutable';
  end if;

  return new;
end;
$$;

create or replace function public.log_rm_ticket_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'rm_ticket_created';
  elsif old.is_deleted = false and new.is_deleted = true then
    v_action := 'rm_ticket_archived';
  elsif old.is_deleted = true and new.is_deleted = false then
    v_action := 'rm_ticket_restored';
  elsif old.status is distinct from new.status then
    v_action := 'rm_ticket_status_changed';
  elsif old.assigned_to is distinct from new.assigned_to then
    v_action := 'rm_ticket_assigned';
  elsif old.priority is distinct from new.priority then
    v_action := 'rm_ticket_priority_changed';
  else
    v_action := 'rm_ticket_updated';
  end if;

  insert into public.rm_ticket_audit_log (
    ticket_id,
    action,
    changed_by,
    before_data,
    after_data,
    context
  )
  values (
    coalesce(new.id, old.id),
    v_action,
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    public.rm_ticket_audit_context()
  );

  return new;
end;
$$;

create or replace function public.log_rm_ticket_comment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.rm_ticket_audit_log (
    ticket_id,
    action,
    changed_by,
    before_data,
    after_data,
    context
  )
  values (
    coalesce(new.ticket_id, old.ticket_id),
    case
      when tg_op = 'INSERT' then 'rm_ticket_comment_created'
      when old.is_deleted = false and new.is_deleted = true then 'rm_ticket_comment_deleted'
      else 'rm_ticket_comment_updated'
    end,
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    jsonb_build_object('trigger', tg_name)
  );

  return new;
end;
$$;

create or replace function public.log_rm_ticket_attachment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.rm_ticket_audit_log (
    ticket_id,
    action,
    changed_by,
    before_data,
    after_data,
    context
  )
  values (
    coalesce(new.ticket_id, old.ticket_id),
    case when tg_op = 'INSERT' then 'rm_ticket_attachment_added' else 'rm_ticket_attachment_removed' end,
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    jsonb_build_object('trigger', tg_name)
  );

  return coalesce(new, old);
end;
$$;

create or replace function public.create_rm_ticket_from_template(
  p_template_code text,
  p_title text,
  p_summary text default null,
  p_priority text default null,
  p_submission_payload jsonb default '{}'::jsonb,
  p_device_context jsonb default '{}'::jsonb,
  p_request_context jsonb default '{}'::jsonb
)
returns public.rm_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.rm_ticket_templates%rowtype;
  v_snapshot jsonb;
  v_ticket public.rm_tickets;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to create an R&M ticket';
  end if;

  if not public.is_rm_operator(auth.uid()) then
    raise exception 'Only property managers and IT Admin can create R&M tickets';
  end if;

  select * into v_template
  from public.rm_ticket_templates
  where code = p_template_code
    and active = true
  limit 1;

  if not found then
    raise exception 'Template not found';
  end if;

  v_snapshot := public.rm_ticket_snapshot_from_template(v_template.id);

  insert into public.rm_tickets (
    requester_id,
    category_id,
    template_id,
    template_version,
    template_snapshot,
    title,
    summary,
    priority,
    submission_payload,
    device_context,
    request_context
  )
  values (
    auth.uid(),
    v_template.category_id,
    v_template.id,
    v_template.version,
    coalesce(v_snapshot, '{}'::jsonb),
    p_title,
    p_summary,
    coalesce(p_priority, 'medium'),
    coalesce(p_submission_payload, '{}'::jsonb),
    coalesce(p_device_context, '{}'::jsonb),
    coalesce(p_request_context, '{}'::jsonb)
  )
  returning * into v_ticket;

  return v_ticket;
end;
$$;

create or replace function public.assign_rm_ticket(
  p_ticket_id uuid,
  p_assigned_to uuid,
  p_reason text default null
)
returns public.rm_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.rm_tickets;
begin
  if not public.is_rm_operator(auth.uid()) then
    raise exception 'Only property managers and IT Admin can assign R&M tickets';
  end if;

  if p_assigned_to is not null and not public.is_rm_operator(p_assigned_to) then
    raise exception 'Assignee must be a property manager or IT Admin';
  end if;

  perform set_config('app.rm_ticket_change_reason', coalesce(p_reason, 'Assignment updated'), true);

  update public.rm_tickets
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

create or replace function public.transition_rm_ticket_status(
  p_ticket_id uuid,
  p_status text,
  p_reason text default null,
  p_override boolean default false
)
returns public.rm_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.rm_tickets;
  v_is_operator boolean := public.is_rm_operator(auth.uid());
  v_is_requester boolean := public.is_rm_ticket_requester(p_ticket_id, auth.uid());
  v_is_assignee boolean := public.is_rm_ticket_assignee(p_ticket_id, auth.uid());
begin
  select * into v_ticket
  from public.rm_tickets
  where id = p_ticket_id;

  if not found then
    raise exception 'Ticket not found';
  end if;

  if p_override and not public.is_rm_admin(auth.uid()) then
    raise exception 'Only IT Admin can override R&M ticket transitions';
  end if;

  if not v_is_operator then
    if v_is_requester then
      if not (v_ticket.status in ('resolved', 'pending_user') and p_status = 'closed') then
        raise exception 'Requester can only close a resolved or pending-user ticket';
      end if;
    elsif v_is_assignee then
      if v_ticket.status = 'assigned' and p_status not in ('in_progress', 'pending_user', 'resolved') then
        raise exception 'Invalid ticket transition';
      elsif v_ticket.status = 'in_progress' and p_status not in ('pending_user', 'resolved') then
        raise exception 'Invalid ticket transition';
      elsif v_ticket.status = 'pending_user' and p_status not in ('in_progress', 'resolved', 'closed') then
        raise exception 'Invalid ticket transition';
      elsif v_ticket.status = 'resolved' and p_status <> 'closed' then
        raise exception 'Invalid ticket transition';
      elsif v_ticket.status = 'closed' then
        raise exception 'Only IT Admin can reopen a closed ticket';
      end if;
    else
      raise exception 'You do not have access to change this ticket';
    end if;
  end if;

  perform set_config('app.rm_ticket_change_reason', coalesce(p_reason, 'Ticket status transition'), true);
  perform set_config('app.rm_ticket_override', case when p_override then 'true' else 'false' end, true);

  update public.rm_tickets
  set status = p_status,
      closed_by_requester_at = case when v_is_requester and p_status = 'closed' then now() else closed_by_requester_at end,
      close_requested_at = case when p_status = 'pending_user' then coalesce(close_requested_at, now()) else close_requested_at end
  where id = p_ticket_id
  returning * into v_ticket;

  return v_ticket;
end;
$$;

create or replace function public.request_rm_ticket_close(
  p_ticket_id uuid,
  p_comment text default null
)
returns public.rm_tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.rm_tickets;
  v_comment text;
begin
  if not public.is_rm_operator(auth.uid()) then
    raise exception 'Only property managers and IT Admin can request R&M ticket closure';
  end if;

  select * into v_ticket from public.rm_tickets where id = p_ticket_id;
  if not found then
    raise exception 'Ticket not found';
  end if;

  if v_ticket.status = 'closed' then
    return v_ticket;
  end if;

  perform set_config('app.rm_ticket_change_reason', 'Close requested', true);

  update public.rm_tickets
  set close_requested_at = now()
  where id = p_ticket_id
  returning * into v_ticket;

  v_comment := nullif(trim(coalesce(p_comment, '')), '');
  if v_comment is not null then
    insert into public.rm_ticket_comments (ticket_id, author_id, comment_type, is_close_request, content)
    values (p_ticket_id, auth.uid(), 'public', true, v_comment);
  end if;

  return v_ticket;
end;
$$;

create or replace function public.add_rm_ticket_comment(
  p_ticket_id uuid,
  p_content text,
  p_comment_type text default 'public',
  p_is_close_request boolean default false
)
returns public.rm_ticket_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comment public.rm_ticket_comments;
begin
  if not public.can_access_rm_ticket(p_ticket_id, auth.uid()) then
    raise exception 'You do not have access to this ticket';
  end if;

  if not public.is_rm_operator(auth.uid()) then
    raise exception 'Only property managers and IT Admin can add R&M ticket comments';
  end if;

  if p_comment_type = 'internal' and not public.is_rm_operator(auth.uid()) then
    raise exception 'Only property managers and IT Admin can add internal notes';
  end if;

  insert into public.rm_ticket_comments (
    ticket_id,
    author_id,
    comment_type,
    is_close_request,
    content
  )
  values (
    p_ticket_id,
    auth.uid(),
    coalesce(p_comment_type, 'public'),
    coalesce(p_is_close_request, false),
    p_content
  )
  returning * into v_comment;

  if p_is_close_request then
    update public.rm_tickets
    set close_requested_at = coalesce(close_requested_at, now())
    where id = p_ticket_id;
  end if;

  return v_comment;
end;
$$;

create or replace function public.archive_rm_ticket(
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
begin
  if not public.is_rm_operator(auth.uid()) then
    raise exception 'Only property managers and IT Admin can archive R&M tickets';
  end if;

  perform set_config('app.rm_ticket_change_reason', coalesce(p_reason, 'Archived ticket'), true);

  update public.rm_tickets
  set is_deleted = true,
      deleted_at = coalesce(deleted_at, now()),
      deleted_by = auth.uid(),
      deleted_reason = coalesce(p_reason, deleted_reason),
      status = 'archived'
  where id = p_ticket_id
  returning * into v_ticket;

  if not found then
    raise exception 'Ticket not found';
  end if;

  return v_ticket;
end;
$$;

create or replace function public.restore_rm_ticket(
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
begin
  if not public.is_rm_operator(auth.uid()) then
    raise exception 'Only property managers and IT Admin can restore R&M tickets';
  end if;

  perform set_config('app.rm_ticket_change_reason', coalesce(p_reason, 'Restored ticket'), true);

  update public.rm_tickets
  set is_deleted = false,
      deleted_at = null,
      deleted_by = null,
      deleted_reason = null,
      status = case when status = 'archived' then 'reopened' else status end
  where id = p_ticket_id
  returning * into v_ticket;

  if not found then
    raise exception 'Ticket not found';
  end if;

  return v_ticket;
end;
$$;

create or replace function public.rm_ticket_management_report(p_as_of timestamptz default now())
returns table (
  total_count integer,
  new_count integer,
  assigned_count integer,
  in_progress_count integer,
  pending_user_count integer,
  resolved_count integer,
  closed_count integer,
  archived_count integer,
  unassigned_count integer,
  status_counts jsonb,
  priority_counts jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with visible_tickets as (
    select *
    from public.rm_tickets
    where created_at <= p_as_of
  ),
  status_rollup as (
    select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) as payload
    from (
      select status, count(*) as cnt
      from visible_tickets
      group by status
    ) s
  ),
  priority_rollup as (
    select coalesce(jsonb_object_agg(priority, cnt), '{}'::jsonb) as payload
    from (
      select priority, count(*) as cnt
      from visible_tickets
      group by priority
    ) p
  )
  select
    count(*)::integer as total_count,
    count(*) filter (where status = 'new')::integer as new_count,
    count(*) filter (where status = 'assigned')::integer as assigned_count,
    count(*) filter (where status = 'in_progress')::integer as in_progress_count,
    count(*) filter (where status = 'pending_user')::integer as pending_user_count,
    count(*) filter (where status = 'resolved')::integer as resolved_count,
    count(*) filter (where status = 'closed')::integer as closed_count,
    count(*) filter (where status = 'archived')::integer as archived_count,
    count(*) filter (where assigned_to is null and status <> 'archived')::integer as unassigned_count,
    (select payload from status_rollup) as status_counts,
    (select payload from priority_rollup) as priority_counts
  from visible_tickets;
$$;

create or replace function public.rm_ticket_management_report()
returns table (
  total_count integer,
  new_count integer,
  assigned_count integer,
  in_progress_count integer,
  pending_user_count integer,
  resolved_count integer,
  closed_count integer,
  archived_count integer,
  unassigned_count integer,
  status_counts jsonb,
  priority_counts jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.rm_ticket_management_report(now());
$$;

insert into public.rm_ticket_categories (code, name, sort_order)
values
  ('property_maintenance', 'Property maintenance', 1),
  ('site_safety', 'Site safety', 2),
  ('heating_ventilation', 'Heating / ventilation', 3),
  ('grounds_external', 'Grounds / external', 4),
  ('fixtures_fittings', 'Fixtures / fittings', 5),
  ('toilets_washrooms', 'Toilets / washrooms', 6),
  ('contractor_access', 'Contractor access', 7),
  ('urgent_hazard', 'Urgent hazard', 8)
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'leaking_pipe_or_tap', 'Leaking pipe or tap', 'Leaks, drips, burst fittings, and water loss issues.', 1, true
from public.rm_ticket_categories c
where c.code = 'property_maintenance'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'lighting_fault', 'Lighting fault', 'Lighting outages, flickering fittings, and switch issues.', 1, true
from public.rm_ticket_categories c
where c.code = 'fixtures_fittings'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'power_or_electrical_fault', 'Power or electrical fault', 'Electrical faults, power loss, and switchboard concerns.', 1, true
from public.rm_ticket_categories c
where c.code = 'site_safety'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'door_or_window_damage', 'Door or window damage', 'Broken doors, windows, locks, and hardware faults.', 1, true
from public.rm_ticket_categories c
where c.code = 'fixtures_fittings'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'roof_or_water_ingress', 'Roof or water ingress', 'Roof leaks, damp, and water ingress issues.', 1, true
from public.rm_ticket_categories c
where c.code = 'property_maintenance'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'heating_or_ventilation_issue', 'Heating or ventilation issue', 'HVAC, heating, and ventilation problems.', 1, true
from public.rm_ticket_categories c
where c.code = 'heating_ventilation'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'toilet_or_washroom_issue', 'Toilet or washroom issue', 'Washroom faults, blockages, and hygiene concerns.', 1, true
from public.rm_ticket_categories c
where c.code = 'toilets_washrooms'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'furniture_or_fixture_damage', 'Furniture or fixture damage', 'Broken furniture, fittings, or anchored fixtures.', 1, true
from public.rm_ticket_categories c
where c.code = 'fixtures_fittings'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'grounds_or_playground_hazard', 'Grounds or playground hazard', 'External hazards, slips, and playground concerns.', 1, true
from public.rm_ticket_categories c
where c.code = 'grounds_external'
on conflict (code) do nothing;

insert into public.rm_ticket_templates (category_id, code, name, description, version, active)
select c.id, 'urgent_safety_hazard', 'Urgent safety hazard', 'Immediate hazards requiring fast response.', 1, true
from public.rm_ticket_categories c
where c.code = 'urgent_hazard'
on conflict (code) do nothing;

insert into public.rm_ticket_template_steps (template_id, step_key, label, sort_order, config, required)
select t.id, s.step_key, s.label, s.sort_order, s.config, s.required
from public.rm_ticket_templates t
join (
  values
    ('leaking_pipe_or_tap', 'location', 'Location', 1, '{"field_type":"short_text","prompt":"Which location needs attention?"}'::jsonb, true),
    ('leaking_pipe_or_tap', 'asset_area', 'Asset / area', 2, '{"field_type":"short_text","prompt":"What asset, room, or area is affected?"}'::jsonb, true),
    ('leaking_pipe_or_tap', 'issue_summary', 'Issue summary', 3, '{"field_type":"textarea","prompt":"Describe the repair or defect."}'::jsonb, true),
    ('leaking_pipe_or_tap', 'urgency', 'Urgency', 4, '{"field_type":"select","prompt":"How urgent is the issue?","options":["Low","Medium","High","Critical"]}'::jsonb, true),
    ('leaking_pipe_or_tap', 'access_notes', 'Access notes', 5, '{"field_type":"textarea","prompt":"Any access, safety, or supervision notes?"}'::jsonb, false),
    ('leaking_pipe_or_tap', 'visit_window', 'Visit window', 6, '{"field_type":"select","prompt":"Preferred visit window","options":["Morning","Midday","Afternoon","After school","Flexible"]}'::jsonb, false),
    ('lighting_fault', 'location', 'Location', 1, '{"field_type":"short_text","prompt":"Which location needs attention?"}'::jsonb, true),
    ('lighting_fault', 'asset_area', 'Asset / area', 2, '{"field_type":"short_text","prompt":"What asset, room, or area is affected?"}'::jsonb, true),
    ('lighting_fault', 'issue_summary', 'Issue summary', 3, '{"field_type":"textarea","prompt":"Describe the lighting fault."}'::jsonb, true),
    ('lighting_fault', 'urgency', 'Urgency', 4, '{"field_type":"select","prompt":"How urgent is the issue?","options":["Low","Medium","High","Critical"]}'::jsonb, true),
    ('lighting_fault', 'access_notes', 'Access notes', 5, '{"field_type":"textarea","prompt":"Any access, safety, or supervision notes?"}'::jsonb, false),
    ('lighting_fault', 'visit_window', 'Visit window', 6, '{"field_type":"select","prompt":"Preferred visit window","options":["Morning","Midday","Afternoon","After school","Flexible"]}'::jsonb, false)
) as s(template_code, step_key, label, sort_order, config, required)
  on s.template_code = t.code
on conflict (template_id, step_key) do nothing;

insert into storage.buckets (id, name, public)
values ('rm-ticket-attachments', 'rm-ticket-attachments', false)
on conflict (id) do update set public = excluded.public;

alter table public.rm_ticket_categories enable row level security;
alter table public.rm_ticket_templates enable row level security;
alter table public.rm_ticket_template_steps enable row level security;
alter table public.rm_tickets enable row level security;
alter table public.rm_ticket_comments enable row level security;
alter table public.rm_ticket_attachments enable row level security;
alter table public.rm_ticket_audit_log enable row level security;
alter table public.rm_ticket_notifications enable row level security;

drop policy if exists "RM ticket categories readable" on public.rm_ticket_categories;
create policy "RM ticket categories readable"
on public.rm_ticket_categories
for select
using (auth.uid() is not null and active = true);

drop policy if exists "RM ticket categories managed by operators" on public.rm_ticket_categories;
create policy "RM ticket categories managed by operators"
on public.rm_ticket_categories
for all
using (public.is_rm_operator(auth.uid()))
with check (public.is_rm_operator(auth.uid()));

drop policy if exists "RM ticket templates readable" on public.rm_ticket_templates;
create policy "RM ticket templates readable"
on public.rm_ticket_templates
for select
using (auth.uid() is not null and active = true);

drop policy if exists "RM ticket templates managed by operators" on public.rm_ticket_templates;
create policy "RM ticket templates managed by operators"
on public.rm_ticket_templates
for all
using (public.is_rm_operator(auth.uid()))
with check (public.is_rm_operator(auth.uid()));

drop policy if exists "RM ticket template steps readable" on public.rm_ticket_template_steps;
create policy "RM ticket template steps readable"
on public.rm_ticket_template_steps
for select
using (auth.uid() is not null);

drop policy if exists "RM ticket template steps managed by operators" on public.rm_ticket_template_steps;
create policy "RM ticket template steps managed by operators"
on public.rm_ticket_template_steps
for all
using (public.is_rm_operator(auth.uid()))
with check (public.is_rm_operator(auth.uid()));

drop policy if exists "RM tickets readable by scope holders" on public.rm_tickets;
create policy "RM tickets readable by scope holders"
on public.rm_tickets
for select
using (public.can_access_rm_ticket(id, auth.uid()));

drop policy if exists "RM tickets can be created by operators" on public.rm_tickets;
create policy "RM tickets can be created by operators"
on public.rm_tickets
for insert
with check (auth.uid() is not null and requester_id = auth.uid() and public.is_rm_operator(auth.uid()));

drop policy if exists "RM tickets can be updated by scope holders" on public.rm_tickets;
create policy "RM tickets can be updated by scope holders"
on public.rm_tickets
for update
using (public.can_access_rm_ticket(id, auth.uid()))
with check (public.can_access_rm_ticket(id, auth.uid()));

drop policy if exists "RM ticket comments readable by scope holders" on public.rm_ticket_comments;
create policy "RM ticket comments readable by scope holders"
on public.rm_ticket_comments
for select
using (public.can_access_rm_ticket(ticket_id, auth.uid()));

drop policy if exists "RM ticket comments can be added by operators" on public.rm_ticket_comments;
create policy "RM ticket comments can be added by operators"
on public.rm_ticket_comments
for insert
with check (
  auth.uid() is not null
  and author_id = auth.uid()
  and public.can_access_rm_ticket(ticket_id, auth.uid())
  and public.is_rm_operator(auth.uid())
);

drop policy if exists "RM ticket comments can be updated by operators" on public.rm_ticket_comments;
create policy "RM ticket comments can be updated by operators"
on public.rm_ticket_comments
for update
using (public.is_rm_operator(auth.uid()))
with check (public.is_rm_operator(auth.uid()));

drop policy if exists "RM ticket attachments readable by scope holders" on public.rm_ticket_attachments;
create policy "RM ticket attachments readable by scope holders"
on public.rm_ticket_attachments
for select
using (public.can_access_rm_ticket(ticket_id, auth.uid()));

drop policy if exists "RM ticket attachments can be added by operators" on public.rm_ticket_attachments;
create policy "RM ticket attachments can be added by operators"
on public.rm_ticket_attachments
for insert
with check (
  auth.uid() is not null
  and uploaded_by = auth.uid()
  and public.can_access_rm_ticket(ticket_id, auth.uid())
  and public.is_rm_operator(auth.uid())
);

drop policy if exists "RM ticket attachments can be deleted by operators" on public.rm_ticket_attachments;
create policy "RM ticket attachments can be deleted by operators"
on public.rm_ticket_attachments
for delete
using (public.is_rm_operator(auth.uid()));

drop policy if exists "RM ticket audit log readable by operators" on public.rm_ticket_audit_log;
create policy "RM ticket audit log readable by operators"
on public.rm_ticket_audit_log
for select
using (public.is_rm_operator(auth.uid()));

drop policy if exists "RM ticket audit log insert allowed for scope holders" on public.rm_ticket_audit_log;
create policy "RM ticket audit log insert allowed for scope holders"
on public.rm_ticket_audit_log
for insert
with check (public.is_rm_operator(auth.uid()) or public.can_access_rm_ticket(ticket_id, auth.uid()));

drop policy if exists "RM ticket notifications readable by recipient" on public.rm_ticket_notifications;
create policy "RM ticket notifications readable by recipient"
on public.rm_ticket_notifications
for select
using (public.is_rm_operator(auth.uid()) or recipient_id = auth.uid());

drop policy if exists "RM ticket notifications managed by operators" on public.rm_ticket_notifications;
create policy "RM ticket notifications managed by operators"
on public.rm_ticket_notifications
for all
using (public.is_rm_operator(auth.uid()))
with check (public.is_rm_operator(auth.uid()));

drop policy if exists "RM ticket attachment storage readable by scope holders" on storage.objects;
create policy "RM ticket attachment storage readable by scope holders"
on storage.objects
for select
using (
  bucket_id = 'rm-ticket-attachments'
  and (
    public.is_rm_operator(auth.uid())
    or exists (
      select 1
      from public.rm_ticket_attachments ta
      where ta.storage_path = name
        and public.can_access_rm_ticket(ta.ticket_id, auth.uid())
    )
  )
);

drop policy if exists "RM ticket attachment storage writable by authenticated users" on storage.objects;
create policy "RM ticket attachment storage writable by authenticated users"
on storage.objects
for insert
with check (bucket_id = 'rm-ticket-attachments' and auth.uid() is not null);

drop policy if exists "RM ticket attachment storage deletable by operators" on storage.objects;
create policy "RM ticket attachment storage deletable by operators"
on storage.objects
for delete
using (bucket_id = 'rm-ticket-attachments' and public.is_rm_operator(auth.uid()));

drop trigger if exists rm_ticket_categories_updated_at on public.rm_ticket_categories;
create trigger rm_ticket_categories_updated_at
before update on public.rm_ticket_categories
for each row execute function public.update_updated_at_column();

drop trigger if exists rm_ticket_templates_updated_at on public.rm_ticket_templates;
create trigger rm_ticket_templates_updated_at
before update on public.rm_ticket_templates
for each row execute function public.update_updated_at_column();

drop trigger if exists rm_ticket_template_steps_updated_at on public.rm_ticket_template_steps;
create trigger rm_ticket_template_steps_updated_at
before update on public.rm_ticket_template_steps
for each row execute function public.update_updated_at_column();

drop trigger if exists rm_tickets_set_defaults on public.rm_tickets;
create trigger rm_tickets_set_defaults
before insert on public.rm_tickets
for each row execute function public.set_rm_ticket_defaults();

drop trigger if exists rm_tickets_guard_template on public.rm_tickets;
create trigger rm_tickets_guard_template
before update on public.rm_tickets
for each row execute function public.guard_rm_ticket_template_immutability();

drop trigger if exists rm_tickets_updated_at on public.rm_tickets;
create trigger rm_tickets_updated_at
before update on public.rm_tickets
for each row execute function public.update_updated_at_column();

drop trigger if exists rm_tickets_audit_log on public.rm_tickets;
create trigger rm_tickets_audit_log
after insert or update on public.rm_tickets
for each row execute function public.log_rm_ticket_change();

drop trigger if exists rm_ticket_comments_updated_at on public.rm_ticket_comments;
create trigger rm_ticket_comments_updated_at
before update on public.rm_ticket_comments
for each row execute function public.update_updated_at_column();

drop trigger if exists rm_ticket_comments_audit_log on public.rm_ticket_comments;
create trigger rm_ticket_comments_audit_log
after insert or update on public.rm_ticket_comments
for each row execute function public.log_rm_ticket_comment_change();

drop trigger if exists rm_ticket_attachments_updated_at on public.rm_ticket_attachments;
create trigger rm_ticket_attachments_updated_at
before update on public.rm_ticket_attachments
for each row execute function public.update_updated_at_column();

drop trigger if exists rm_ticket_attachments_audit_log_insert on public.rm_ticket_attachments;
create trigger rm_ticket_attachments_audit_log_insert
after insert on public.rm_ticket_attachments
for each row execute function public.log_rm_ticket_attachment_change();

drop trigger if exists rm_ticket_attachments_audit_log_delete on public.rm_ticket_attachments;
create trigger rm_ticket_attachments_audit_log_delete
after delete on public.rm_ticket_attachments
for each row execute function public.log_rm_ticket_attachment_change();
