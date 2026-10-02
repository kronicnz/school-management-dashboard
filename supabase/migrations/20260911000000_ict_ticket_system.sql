-- ICT ticket domain

alter table public.user_roles
  drop constraint if exists user_roles_role_check;

alter table public.user_roles
  add constraint user_roles_role_check
  check (
    role in (
      'site_admin',
      'finance_admin',
      'finance_read_only',
      'board_member',
      'it_admin',
      'it_staff',
      'property_manager',
      'property_staff',
      'teacher',
      'counsellor'
    )
  );

create table if not exists public.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_templates (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.ticket_categories(id) on delete restrict,
  code text not null unique,
  name text not null,
  description text null,
  active boolean not null default true,
  version integer not null default 1,
  created_by uuid null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_template_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.ticket_templates(id) on delete cascade,
  step_key text not null,
  label text not null,
  sort_order integer not null default 0,
  config jsonb not null default '{}'::jsonb,
  required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, step_key)
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique,
  requester_id uuid not null references public.profiles(id),
  category_id uuid not null references public.ticket_categories(id),
  template_id uuid not null references public.ticket_templates(id),
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

create table if not exists public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete restrict,
  author_id uuid not null references public.profiles(id),
  comment_type text not null default 'public' check (comment_type in ('public', 'internal')),
  is_close_request boolean not null default false,
  content text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete restrict,
  uploaded_by uuid not null references public.profiles(id),
  storage_path text not null unique,
  file_name text not null,
  mime_type text null,
  file_size bigint null,
  visibility text not null default 'public' check (visibility in ('public', 'internal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_audit_log (
  id bigserial primary key,
  ticket_id uuid not null references public.tickets(id) on delete restrict,
  action text not null,
  changed_by uuid null references public.profiles(id),
  before_data jsonb null,
  after_data jsonb null,
  context jsonb null,
  changed_at timestamptz not null default now()
);

create table if not exists public.ticket_notifications (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete restrict,
  recipient_id uuid not null references public.profiles(id),
  channel text not null check (channel in ('email', 'in_app')),
  event_type text not null,
  delivered_at timestamptz null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_number_counters (
  year integer primary key,
  last_sequence integer not null default 0
);

create index if not exists ticket_categories_active_sort_idx on public.ticket_categories(active, sort_order, name);
create index if not exists ticket_templates_category_idx on public.ticket_templates(category_id, active, name);
create index if not exists ticket_template_steps_template_idx on public.ticket_template_steps(template_id, sort_order);
create index if not exists tickets_requester_idx on public.tickets(requester_id, is_deleted, status, updated_at desc);
create index if not exists tickets_assignee_idx on public.tickets(assigned_to, is_deleted, status, updated_at desc);
create index if not exists tickets_status_idx on public.tickets(status, priority, is_deleted);
create index if not exists ticket_comments_ticket_idx on public.ticket_comments(ticket_id, created_at);
create index if not exists ticket_attachments_ticket_idx on public.ticket_attachments(ticket_id, created_at);
create index if not exists ticket_audit_ticket_idx on public.ticket_audit_log(ticket_id, changed_at desc);
create index if not exists ticket_notifications_ticket_idx on public.ticket_notifications(ticket_id, created_at desc);

create or replace function public.is_it_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_has_any_role(p_user_id, array['it_admin']::text[]);
$$;

create or replace function public.is_it_staff(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_has_any_role(p_user_id, array['it_staff', 'it_admin']::text[]);
$$;

create or replace function public.is_ticket_requester(p_ticket_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tickets t
    where t.id = p_ticket_id
      and t.requester_id = p_user_id
  );
$$;

create or replace function public.is_ticket_assignee(p_ticket_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tickets t
    where t.id = p_ticket_id
      and t.assigned_to = p_user_id
  );
$$;

create or replace function public.can_access_ticket(p_ticket_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_it_admin(p_user_id)
    or public.is_ticket_requester(p_ticket_id, p_user_id)
    or public.is_ticket_assignee(p_ticket_id, p_user_id);
$$;

create or replace function public.next_ticket_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from now())::integer;
  v_sequence integer;
begin
  insert into public.ticket_number_counters(year, last_sequence)
  values (v_year, 1)
  on conflict (year)
  do update set last_sequence = public.ticket_number_counters.last_sequence + 1
  returning last_sequence into v_sequence;

  return format('ICT-%s-%05s', v_year, v_sequence);
end;
$$;

create or replace function public.ticket_snapshot_from_template(p_template_id uuid)
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
  from public.ticket_templates t
  left join public.ticket_template_steps s on s.template_id = t.id
  where t.id = p_template_id
  group by t.id;
$$;

create or replace function public.ticket_audit_context()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'reason', nullif(current_setting('app.ticket_change_reason', true), ''),
    'override', nullif(current_setting('app.ticket_override', true), ''),
    'trigger', current_setting('app.trigger_name', true)
  );
$$;

create or replace function public.set_ticket_defaults()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.ticket_number := coalesce(new.ticket_number, public.next_ticket_number());
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

create or replace function public.guard_ticket_template_immutability()
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
    raise exception 'ticket template fields are immutable';
  end if;

  return new;
end;
$$;

create or replace function public.log_ticket_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'ticket_created';
  elsif old.is_deleted = false and new.is_deleted = true then
    v_action := 'ticket_archived';
  elsif old.is_deleted = true and new.is_deleted = false then
    v_action := 'ticket_restored';
  elsif old.status is distinct from new.status then
    v_action := 'ticket_status_changed';
  elsif old.assigned_to is distinct from new.assigned_to then
    v_action := 'ticket_assigned';
  elsif old.priority is distinct from new.priority then
    v_action := 'ticket_priority_changed';
  else
    v_action := 'ticket_updated';
  end if;

  insert into public.ticket_audit_log (
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
    public.ticket_audit_context()
  );

  return new;
end;
$$;

create or replace function public.log_ticket_comment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ticket_audit_log (
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
      when tg_op = 'INSERT' then 'ticket_comment_created'
      when old.is_deleted = false and new.is_deleted = true then 'ticket_comment_deleted'
      else 'ticket_comment_updated'
    end,
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    jsonb_build_object('trigger', tg_name)
  );

  return new;
end;
$$;

create or replace function public.log_ticket_attachment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ticket_audit_log (
    ticket_id,
    action,
    changed_by,
    before_data,
    after_data,
    context
  )
  values (
    coalesce(new.ticket_id, old.ticket_id),
    case when tg_op = 'INSERT' then 'ticket_attachment_added' else 'ticket_attachment_removed' end,
    auth.uid(),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end,
    jsonb_build_object('trigger', tg_name)
  );

  return coalesce(new, old);
end;
$$;

create or replace function public.create_ticket_from_template(
  p_template_code text,
  p_title text,
  p_summary text default null,
  p_priority text default null,
  p_submission_payload jsonb default '{}'::jsonb,
  p_device_context jsonb default '{}'::jsonb,
  p_request_context jsonb default '{}'::jsonb
)
returns public.tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.ticket_templates%rowtype;
  v_snapshot jsonb;
  v_ticket public.tickets;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to create a ticket';
  end if;

  select *
  into v_template
  from public.ticket_templates
  where code = p_template_code
    and active = true
  limit 1;

  if not found then
    raise exception 'Template not found';
  end if;

  v_snapshot := public.ticket_snapshot_from_template(v_template.id);

  insert into public.tickets (
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

  if p_assigned_to is not null and not exists (select 1 from public.profiles p where p.id = p_assigned_to) then
    raise exception 'Assignee profile does not exist';
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
begin
  if not public.is_it_admin(auth.uid()) then
    raise exception 'Only IT Admin can claim tickets';
  end if;

  perform set_config('app.ticket_change_reason', coalesce(p_reason, 'Claimed by admin'), true);

  update public.tickets
  set assigned_to = auth.uid(),
      assigned_by = auth.uid(),
      status = case when status = 'new' then 'assigned' else status end
  where id = p_ticket_id
  returning * into v_ticket;

  if not found then
    raise exception 'Ticket not found';
  end if;

  return v_ticket;
end;
$$;

create or replace function public.transition_ticket_status(
  p_ticket_id uuid,
  p_status text,
  p_reason text default null,
  p_override boolean default false
)
returns public.tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets;
  v_is_admin boolean := public.is_it_admin(auth.uid());
  v_is_requester boolean := public.is_ticket_requester(p_ticket_id, auth.uid());
  v_is_assignee boolean := public.is_ticket_assignee(p_ticket_id, auth.uid());
begin
  select * into v_ticket
  from public.tickets
  where id = p_ticket_id;

  if not found then
    raise exception 'Ticket not found';
  end if;

  if p_override and not v_is_admin then
    raise exception 'Only IT Admin can override ticket transitions';
  end if;

  if not v_is_admin then
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

  perform set_config('app.ticket_change_reason', coalesce(p_reason, 'Ticket status transition'), true);
  perform set_config('app.ticket_override', case when p_override then 'true' else 'false' end, true);

  update public.tickets
  set status = p_status,
      closed_by_requester_at = case when v_is_requester and p_status = 'closed' then now() else closed_by_requester_at end,
      close_requested_at = case when p_status = 'pending_user' then coalesce(close_requested_at, now()) else close_requested_at end
  where id = p_ticket_id
  returning * into v_ticket;

  return v_ticket;
end;
$$;

create or replace function public.request_ticket_close(
  p_ticket_id uuid,
  p_comment text default null
)
returns public.tickets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ticket public.tickets;
  v_comment text;
begin
  if not public.is_ticket_requester(p_ticket_id, auth.uid()) and not public.is_it_admin(auth.uid()) then
    raise exception 'Only the requester or IT Admin can request ticket closure';
  end if;

  select * into v_ticket from public.tickets where id = p_ticket_id;
  if not found then
    raise exception 'Ticket not found';
  end if;

  if v_ticket.status = 'closed' then
    return v_ticket;
  end if;

  perform set_config('app.ticket_change_reason', 'Close requested', true);

  update public.tickets
  set close_requested_at = now()
  where id = p_ticket_id
  returning * into v_ticket;

  v_comment := nullif(trim(coalesce(p_comment, '')), '');
  if v_comment is not null then
    insert into public.ticket_comments (ticket_id, author_id, comment_type, is_close_request, content)
    values (p_ticket_id, auth.uid(), 'public', true, v_comment);
  end if;

  return v_ticket;
end;
$$;

create or replace function public.add_ticket_comment(
  p_ticket_id uuid,
  p_content text,
  p_comment_type text default 'public',
  p_is_close_request boolean default false
)
returns public.ticket_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_comment public.ticket_comments;
begin
  if not public.can_access_ticket(p_ticket_id, auth.uid()) then
    raise exception 'You do not have access to this ticket';
  end if;

  if p_is_close_request and not public.is_ticket_requester(p_ticket_id, auth.uid()) then
    raise exception 'Only the requester can submit a close request';
  end if;

  if p_comment_type = 'internal' and not public.is_it_staff(auth.uid()) then
    raise exception 'Only IT staff can add internal notes';
  end if;

  insert into public.ticket_comments (
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
    update public.tickets
    set close_requested_at = coalesce(close_requested_at, now())
    where id = p_ticket_id;
  end if;

  return v_comment;
end;
$$;

create or replace function public.archive_ticket(
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
begin
  if not public.is_it_admin(auth.uid()) then
    raise exception 'Only IT Admin can archive tickets';
  end if;

  perform set_config('app.ticket_change_reason', coalesce(p_reason, 'Archived ticket'), true);

  update public.tickets
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

create or replace function public.restore_ticket(
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
begin
  if not public.is_it_admin(auth.uid()) then
    raise exception 'Only IT Admin can restore tickets';
  end if;

  perform set_config('app.ticket_change_reason', coalesce(p_reason, 'Restored ticket'), true);

  update public.tickets
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

create or replace function public.ticket_management_report(p_as_of timestamptz default now())
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
    from public.tickets
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

create or replace function public.ticket_management_report()
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
  from public.ticket_management_report(now());
$$;

-- Seed categories and starter templates.
insert into public.ticket_categories (code, name, sort_order)
values
  ('hardware', 'Hardware', 1),
  ('software_access', 'Software Access', 2),
  ('network_wifi', 'Network / Wi-Fi', 3),
  ('printing', 'Printing', 4),
  ('email_accounts', 'Email / Accounts', 5)
on conflict (code) do nothing;

insert into public.ticket_categories (code, name, sort_order)
values
  ('chromebooks', 'Chromebooks', 6),
  ('laptops_desktops', 'Laptops / Desktops', 7),
  ('ipads', 'iPads', 8),
  ('displays_av', 'Displays / AV', 9),
  ('google_workspace', 'Google Workspace', 10),
  ('microsoft_365', 'Microsoft 365', 11),
  ('accessories', 'Accessories', 12)
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'printer_not_responding', 'Printer not responding', 'Printer diagnostics for offline or unresponsive printers.', 1, true
from public.ticket_categories c
where c.code = 'printing'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'password_reset_account_locked', 'Password reset / account locked', 'Account access flow for locked or inaccessible accounts.', 1, true
from public.ticket_categories c
where c.code = 'email_accounts'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'chromebook_wont_turn_on', 'Chromebook will not turn on', 'Power, charging, and boot issues for managed Chromebooks.', 1, true
from public.ticket_categories c
where c.code = 'chromebooks'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'chromebook_slow_freezing', 'Chromebook slow / freezing', 'Performance issues, stuck tabs, and update problems on Chromebooks.', 1, true
from public.ticket_categories c
where c.code = 'chromebooks'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'chromebook_camera_microphone', 'Chromebook camera / microphone', 'Camera and microphone access faults during online learning.', 1, true
from public.ticket_categories c
where c.code = 'chromebooks'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'laptop_display_dock_issue', 'Laptop display / dock issue', 'Laptop screen, docking station, and external display faults.', 1, true
from public.ticket_categories c
where c.code = 'laptops_desktops'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'desktop_no_display', 'Desktop no display / power fault', 'Desktop power, monitor, and startup problems.', 1, true
from public.ticket_categories c
where c.code = 'laptops_desktops'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'ipad_app_not_opening', 'iPad app not opening', 'iPad app crashes, sign-in, and MDM restrictions.', 1, true
from public.ticket_categories c
where c.code = 'ipads'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'wifi_connectivity', 'Wi-Fi connectivity problem', 'Wireless dropouts, slow speeds, and login failures.', 1, true
from public.ticket_categories c
where c.code = 'network_wifi'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'internet_outage', 'Internet outage / no connection', 'School internet or WAN connection problems affecting multiple users.', 1, true
from public.ticket_categories c
where c.code = 'network_wifi'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'printer_offline', 'Printer offline / not printing', 'Printer queue, paper jam, offline, and driver issues.', 1, true
from public.ticket_categories c
where c.code = 'printing'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'tv_projector_casting', 'TV / projector / Chromecast issue', 'Display casting, projector input, and classroom screen faults.', 1, true
from public.ticket_categories c
where c.code = 'displays_av'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'google_apps_issue', 'Google app or Classroom issue', 'Drive, Docs, Classroom, Gmail, and account sync issues.', 1, true
from public.ticket_categories c
where c.code = 'google_workspace'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'microsoft_apps_issue', 'Microsoft / Office app issue', 'Teams, Word, Excel, OneDrive, and Office sign-in or activation issues.', 1, true
from public.ticket_categories c
where c.code = 'microsoft_365'
on conflict (code) do nothing;

insert into public.ticket_templates (category_id, code, name, description, version, active)
select c.id, 'peripheral_keyboard_mouse', 'Keyboard / mouse / accessory fault', 'Peripherals, chargers, cables, and other accessory faults.', 1, true
from public.ticket_categories c
where c.code = 'accessories'
on conflict (code) do nothing;

insert into public.ticket_template_steps (template_id, step_key, label, sort_order, config, required)
select t.id, s.step_key, s.label, s.sort_order, s.config, s.required
from public.ticket_templates t
join (
  values
    ('printer_not_responding', 'impact', 'Impact check', 1, '{"field_type":"yes_no","prompt":"Is this affecting multiple users?"}'::jsonb, true),
    ('printer_not_responding', 'restart', 'Restart check', 2, '{"field_type":"yes_no","prompt":"Have you restarted the printer?"}'::jsonb, true),
    ('printer_not_responding', 'print_test', 'Test print', 3, '{"field_type":"yes_no","prompt":"Are other devices able to print?"}'::jsonb, true),
    ('password_reset_account_locked', 'locked', 'Account lock', 1, '{"field_type":"yes_no","prompt":"Is the account locked?"}'::jsonb, true),
    ('password_reset_account_locked', 'mfa', 'MFA check', 2, '{"field_type":"yes_no","prompt":"Is the MFA prompt failing?"}'::jsonb, true),
    ('password_reset_account_locked', 'blocker', 'Business impact', 3, '{"field_type":"segment","prompt":"Is this blocking classes or payroll?"}'::jsonb, true)
) as s(template_code, step_key, label, sort_order, config, required)
  on s.template_code = t.code
on conflict (template_id, step_key) do nothing;

insert into public.ticket_template_steps (template_id, step_key, label, sort_order, config, required)
select t.id, s.step_key, s.label, s.sort_order, s.config, s.required
from public.ticket_templates t
join (
  values
    ('chromebook_wont_turn_on', 'power_led', 'Power check', 1, '{"field_type":"yes_no","prompt":"Does the Chromebook show a power light or charging indicator?"}'::jsonb, true),
    ('chromebook_wont_turn_on', 'charger', 'Charger check', 2, '{"field_type":"yes_no","prompt":"Have you tried the correct charger and wall outlet?"}'::jsonb, true),
    ('chromebook_wont_turn_on', 'damage', 'Physical damage', 3, '{"field_type":"yes_no","prompt":"Is there any visible damage to the device or charger?"}'::jsonb, false),
    ('chromebook_slow_freezing', 'rebooted', 'Restarted device', 1, '{"field_type":"yes_no","prompt":"Have you restarted the Chromebook?"}'::jsonb, true),
    ('chromebook_slow_freezing', 'tabs', 'Open tabs', 2, '{"field_type":"select","prompt":"How many tabs are open?","options":["1-5","6-10","11-20","20+"]}'::jsonb, true),
    ('chromebook_slow_freezing', 'updates', 'Update status', 3, '{"field_type":"yes_no","prompt":"Has the device been updated recently?"}'::jsonb, false),
    ('chromebook_camera_microphone', 'camera', 'Camera check', 1, '{"field_type":"yes_no","prompt":"Is the camera not working in Meet or Camera app?"}'::jsonb, true),
    ('chromebook_camera_microphone', 'microphone', 'Microphone check', 2, '{"field_type":"yes_no","prompt":"Is the microphone not working?"}'::jsonb, true),
    ('chromebook_camera_microphone', 'privacy', 'Privacy covers', 3, '{"field_type":"yes_no","prompt":"Is there a privacy shutter or mute key enabled?"}'::jsonb, false),
    ('laptop_display_dock_issue', 'screen', 'Screen behaviour', 1, '{"field_type":"select","prompt":"What is the display issue?","options":["Blank screen","Flickering","External monitor only","Dock not detected"]}'::jsonb, true),
    ('laptop_display_dock_issue', 'dock', 'Dock check', 2, '{"field_type":"yes_no","prompt":"Have you tried reconnecting the dock and power?"}'::jsonb, true),
    ('desktop_no_display', 'power', 'Power state', 1, '{"field_type":"select","prompt":"What does the desktop do?","options":["No power","Fans on, no display","Boot loop","Monitor only"]}'::jsonb, true),
    ('desktop_no_display', 'monitor', 'Monitor check', 2, '{"field_type":"yes_no","prompt":"Have you checked the monitor input and cable?"}'::jsonb, true),
    ('ipad_app_not_opening', 'app', 'App name', 1, '{"field_type":"short_text","prompt":"Which app is affected?"}'::jsonb, true),
    ('ipad_app_not_opening', 'reinstall', 'Restart / update', 2, '{"field_type":"yes_no","prompt":"Have you restarted the iPad and checked for updates?"}'::jsonb, true),
    ('wifi_connectivity', 'location', 'Location', 1, '{"field_type":"short_text","prompt":"Where is the Wi-Fi issue happening?"}'::jsonb, true),
    ('wifi_connectivity', 'devices', 'Affected devices', 2, '{"field_type":"select","prompt":"How many devices are affected?","options":["One device","A few devices","Whole room","Whole school"]}'::jsonb, true),
    ('internet_outage', 'outage_scope', 'Outage scope', 1, '{"field_type":"select","prompt":"What is affected?","options":["Internet only","Wi-Fi only","Both Wi-Fi and internet","Not sure"]}'::jsonb, true),
    ('internet_outage', 'wan', 'WAN check', 2, '{"field_type":"yes_no","prompt":"Is this affecting multiple rooms or sites?"}'::jsonb, true),
    ('printer_offline', 'printer', 'Printer identifier', 1, '{"field_type":"short_text","prompt":"Printer name, room, or asset tag"}'::jsonb, true),
    ('printer_offline', 'issue', 'Printer fault', 2, '{"field_type":"select","prompt":"What is the printer doing?","options":["Offline","Paper jam","Blank pages","Won''t print","Toner/ink issue"]}'::jsonb, true),
    ('tv_projector_casting', 'device', 'Display device', 1, '{"field_type":"select","prompt":"Which device is affected?","options":["TV","Projector","Chromecast","Interactive panel"]}'::jsonb, true),
    ('tv_projector_casting', 'source', 'Source device', 2, '{"field_type":"select","prompt":"What are you casting from?","options":["Chromebook","Laptop","iPad","Desktop"]}'::jsonb, true),
    ('google_apps_issue', 'service', 'Google service', 1, '{"field_type":"select","prompt":"Which Google service is affected?","options":["Drive","Docs","Slides","Classroom","Gmail","Meet"]}'::jsonb, true),
    ('google_apps_issue', 'sign_in', 'Sign-in', 2, '{"field_type":"yes_no","prompt":"Are you able to sign in to Google?"}'::jsonb, true),
    ('microsoft_apps_issue', 'service', 'Microsoft app', 1, '{"field_type":"select","prompt":"Which Microsoft app is affected?","options":["Teams","Word","Excel","PowerPoint","OneDrive"]}'::jsonb, true),
    ('microsoft_apps_issue', 'license', 'License / sign-in', 2, '{"field_type":"yes_no","prompt":"Is this a sign-in or licensing problem?"}'::jsonb, true),
    ('peripheral_keyboard_mouse', 'accessory', 'Accessory type', 1, '{"field_type":"select","prompt":"Which accessory is faulty?","options":["Keyboard","Mouse","Headset","Charger","Cable","Other"]}'::jsonb, true),
    ('peripheral_keyboard_mouse', 'spare', 'Swap test', 2, '{"field_type":"yes_no","prompt":"Have you tested with a spare cable or accessory?"}'::jsonb, true)
) as s(template_code, step_key, label, sort_order, config, required)
  on s.template_code = t.code
on conflict (template_id, step_key) do nothing;

insert into storage.buckets (id, name, public)
values ('ticket-attachments', 'ticket-attachments', false)
on conflict (id) do update set public = excluded.public;

-- RLS
alter table public.ticket_categories enable row level security;
alter table public.ticket_templates enable row level security;
alter table public.ticket_template_steps enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.ticket_audit_log enable row level security;
alter table public.ticket_notifications enable row level security;

drop policy if exists "Ticket categories readable" on public.ticket_categories;
create policy "Ticket categories readable"
on public.ticket_categories
for select
using (auth.uid() is not null and active = true);

drop policy if exists "Ticket categories managed by IT Admin" on public.ticket_categories;
create policy "Ticket categories managed by IT Admin"
on public.ticket_categories
for all
using (public.is_it_admin(auth.uid()))
with check (public.is_it_admin(auth.uid()));

drop policy if exists "Ticket templates readable" on public.ticket_templates;
create policy "Ticket templates readable"
on public.ticket_templates
for select
using (auth.uid() is not null and active = true);

drop policy if exists "Ticket templates managed by IT Admin" on public.ticket_templates;
create policy "Ticket templates managed by IT Admin"
on public.ticket_templates
for all
using (public.is_it_admin(auth.uid()))
with check (public.is_it_admin(auth.uid()));

drop policy if exists "Ticket template steps readable" on public.ticket_template_steps;
create policy "Ticket template steps readable"
on public.ticket_template_steps
for select
using (auth.uid() is not null);

drop policy if exists "Ticket template steps managed by IT Admin" on public.ticket_template_steps;
create policy "Ticket template steps managed by IT Admin"
on public.ticket_template_steps
for all
using (public.is_it_admin(auth.uid()))
with check (public.is_it_admin(auth.uid()));

drop policy if exists "Tickets readable by requester, assignee, or IT Admin" on public.tickets;
create policy "Tickets readable by requester, assignee, or IT Admin"
on public.tickets
for select
using (public.can_access_ticket(id, auth.uid()));

drop policy if exists "Tickets can be created by signed in requester" on public.tickets;
create policy "Tickets can be created by signed in requester"
on public.tickets
for insert
with check (auth.uid() is not null and requester_id = auth.uid());

drop policy if exists "Tickets can be updated by IT Admin or scope holder" on public.tickets;
create policy "Tickets can be updated by IT Admin or scope holder"
on public.tickets
for update
using (public.can_access_ticket(id, auth.uid()))
with check (public.can_access_ticket(id, auth.uid()));

drop policy if exists "Ticket comments readable by scope holders" on public.ticket_comments;
create policy "Ticket comments readable by scope holders"
on public.ticket_comments
for select
using (public.can_access_ticket(ticket_id, auth.uid()));

drop policy if exists "Ticket comments can be added by scope holders" on public.ticket_comments;
create policy "Ticket comments can be added by scope holders"
on public.ticket_comments
for insert
with check (
  auth.uid() is not null
  and author_id = auth.uid()
  and public.can_access_ticket(ticket_id, auth.uid())
  and (
    comment_type = 'public'
    or public.is_it_staff(auth.uid())
  )
);

drop policy if exists "Ticket comments can be updated by IT Admin" on public.ticket_comments;
create policy "Ticket comments can be updated by IT Admin"
on public.ticket_comments
for update
using (public.is_it_admin(auth.uid()))
with check (public.is_it_admin(auth.uid()));

drop policy if exists "Ticket attachments readable by scope holders" on public.ticket_attachments;
create policy "Ticket attachments readable by scope holders"
on public.ticket_attachments
for select
using (public.can_access_ticket(ticket_id, auth.uid()));

drop policy if exists "Ticket attachments can be added by scope holders" on public.ticket_attachments;
create policy "Ticket attachments can be added by scope holders"
on public.ticket_attachments
for insert
with check (
  auth.uid() is not null
  and uploaded_by = auth.uid()
  and public.can_access_ticket(ticket_id, auth.uid())
);

drop policy if exists "Ticket attachments can be deleted by IT Admin" on public.ticket_attachments;
create policy "Ticket attachments can be deleted by IT Admin"
on public.ticket_attachments
for delete
using (public.is_it_admin(auth.uid()));

drop policy if exists "Ticket audit log readable by IT Admin" on public.ticket_audit_log;
create policy "Ticket audit log readable by IT Admin"
on public.ticket_audit_log
for select
using (public.is_it_admin(auth.uid()));

drop policy if exists "Ticket audit log insert allowed for scope holders" on public.ticket_audit_log;
create policy "Ticket audit log insert allowed for scope holders"
on public.ticket_audit_log
for insert
with check (public.is_it_admin(auth.uid()) or public.can_access_ticket(ticket_id, auth.uid()));

drop policy if exists "Ticket notifications readable by recipient" on public.ticket_notifications;
create policy "Ticket notifications readable by recipient"
on public.ticket_notifications
for select
using (public.is_it_admin(auth.uid()) or recipient_id = auth.uid());

drop policy if exists "Ticket notifications managed by IT Admin" on public.ticket_notifications;
create policy "Ticket notifications managed by IT Admin"
on public.ticket_notifications
for all
using (public.is_it_admin(auth.uid()))
with check (public.is_it_admin(auth.uid()));

drop policy if exists "Ticket attachment storage readable by scope holders" on storage.objects;
create policy "Ticket attachment storage readable by scope holders"
on storage.objects
for select
using (
  bucket_id = 'ticket-attachments'
  and (
    public.is_it_admin(auth.uid())
    or exists (
      select 1
      from public.ticket_attachments ta
      where ta.storage_path = name
        and public.can_access_ticket(ta.ticket_id, auth.uid())
    )
  )
);

drop policy if exists "Ticket attachment storage writable by authenticated users" on storage.objects;
create policy "Ticket attachment storage writable by authenticated users"
on storage.objects
for insert
with check (bucket_id = 'ticket-attachments' and auth.uid() is not null);

drop policy if exists "Ticket attachment storage deletable by IT Admin" on storage.objects;
create policy "Ticket attachment storage deletable by IT Admin"
on storage.objects
for delete
using (bucket_id = 'ticket-attachments' and public.is_it_admin(auth.uid()));

-- Triggers
drop trigger if exists ticket_categories_updated_at on public.ticket_categories;
create trigger ticket_categories_updated_at
before update on public.ticket_categories
for each row execute function public.update_updated_at_column();

drop trigger if exists ticket_templates_updated_at on public.ticket_templates;
create trigger ticket_templates_updated_at
before update on public.ticket_templates
for each row execute function public.update_updated_at_column();

drop trigger if exists ticket_template_steps_updated_at on public.ticket_template_steps;
create trigger ticket_template_steps_updated_at
before update on public.ticket_template_steps
for each row execute function public.update_updated_at_column();

drop trigger if exists tickets_set_defaults on public.tickets;
create trigger tickets_set_defaults
before insert on public.tickets
for each row execute function public.set_ticket_defaults();

drop trigger if exists tickets_guard_template on public.tickets;
create trigger tickets_guard_template
before update on public.tickets
for each row execute function public.guard_ticket_template_immutability();

drop trigger if exists tickets_updated_at on public.tickets;
create trigger tickets_updated_at
before update on public.tickets
for each row execute function public.update_updated_at_column();

drop trigger if exists tickets_audit_log on public.tickets;
create trigger tickets_audit_log
after insert or update on public.tickets
for each row execute function public.log_ticket_change();

drop trigger if exists ticket_comments_updated_at on public.ticket_comments;
create trigger ticket_comments_updated_at
before update on public.ticket_comments
for each row execute function public.update_updated_at_column();

drop trigger if exists ticket_comments_audit_log on public.ticket_comments;
create trigger ticket_comments_audit_log
after insert or update on public.ticket_comments
for each row execute function public.log_ticket_comment_change();

drop trigger if exists ticket_attachments_updated_at on public.ticket_attachments;
create trigger ticket_attachments_updated_at
before update on public.ticket_attachments
for each row execute function public.update_updated_at_column();

drop trigger if exists ticket_attachments_audit_log_insert on public.ticket_attachments;
create trigger ticket_attachments_audit_log_insert
after insert on public.ticket_attachments
for each row execute function public.log_ticket_attachment_change();

drop trigger if exists ticket_attachments_audit_log_delete on public.ticket_attachments;
create trigger ticket_attachments_audit_log_delete
after delete on public.ticket_attachments
for each row execute function public.log_ticket_attachment_change();
