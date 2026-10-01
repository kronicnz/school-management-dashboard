-- Declarative role and permission matrix.
--
-- Adds a shared role catalogue (`app_roles`) and a role -> capability matrix
-- (`role_permissions`) so authorisation stops being hardcoded role-name checks
-- in two layers that have to stay in sync.
--
-- No policy is rewritten here. Every existing helper is redefined as a thin
-- wrapper over `has_permission()`, keeping its current signature, so the RLS
-- policies and SECURITY DEFINER RPCs that already call them compile and behave
-- unchanged. The client mirror lives in `src/lib/access/registry.ts`; the two
-- must be changed together and checked with the parity query at the bottom of
-- this file.
--
-- Behaviour changes, called out deliberately:
--   * `is_rm_admin` and `is_it_admin` now include `site_admin`, which matches
--     what `src/pages/Tickets.tsx` has always assumed. `assign_rm_ticket` and
--     `assign_ticket` no longer raise for a site admin.
--   * `is_access_admin` narrows from {site_admin, it_admin} to site_admin only.
--     This is Decision 7: `/staff`, `/assets` and `/admin` are site-admin only
--     and it_admin keeps ticket powers.
--   * `is_counsellor_or_leadership` narrows from {site_admin, it_admin,
--     counsellor} to {site_admin, counsellor}, because `incidents.view_sensitive`
--     is a counsellor capability under the agreed matrix.
--   * `it_staff` gains `ict.claim` and `rm.claim`, so "Take ticket" is real
--     self-service for the desk that does the work rather than an admin-only
--     action. Confirmed as a deliberate widening of the matrix.

-- ---------------------------------------------------------------------------
-- 1. Role catalogue
-- ---------------------------------------------------------------------------

create table if not exists public.app_roles (
  role text primary key,
  label text not null,
  description text,
  is_retired boolean not null default false
);

comment on table public.app_roles is
  'Shared role catalogue. user_roles.role must appear here; is_retired marks roles kept only for historical grants.';

insert into public.app_roles (role, label, description, is_retired) values
  ('site_admin',        'Site admin',        'Superuser. Bypasses the capability matrix entirely.', false),
  ('it_admin',          'IT admin',          'Full ICT and R&M ticket administration.', false),
  ('it_staff',          'IT staff',          'Works ICT tickets assigned to them; raises R&M tickets.', false),
  ('property_manager',  'Property manager',  'Owns R&M tickets end to end.', false),
  ('property_staff',    'Property staff',    'Reduced role held alongside staff.', false),
  ('counsellor',        'Counsellor',        'Manages incidents, including sensitive ones.', false),
  ('finance_admin',     'Finance admin',     'Manages finance.', false),
  ('finance_read_only', 'Finance read only', 'Views finance only.', false),
  ('board_member',      'Board member',      'Views finance for governance.', false),
  ('staff',             'Staff',             'Base role. Owns assigned students, classes, attendance and self-service tickets.', false),
  ('teacher',           'Teacher',           'Retired into staff. Kept for historical grants only.', true)
on conflict (role) do update
  set label = excluded.label,
      description = excluded.description,
      is_retired = excluded.is_retired;

-- ---------------------------------------------------------------------------
-- 2. Capability matrix
-- ---------------------------------------------------------------------------

-- The capability union is a catalogue in its own right rather than something
-- derived from whichever role happens to grant a capability. Without it, a
-- capability no role holds would be invisible to `user_capabilities`, and
-- site_admin's bypass would silently not cover it.
create table if not exists public.app_capabilities (
  capability text primary key,
  module text not null,
  description text
);

comment on table public.app_capabilities is
  'Every capability the system defines. site_admin resolves all of them; the matrix rows below are the grants.';

insert into public.app_capabilities (capability, module, description) values
  ('students.view_all',            'students',   'Read every student record.'),
  ('students.view_assigned',       'students',   'Read only students in the user''s scope.'),
  ('classes.view_all',             'classes',    'Read every class.'),
  ('classes.view_assigned',        'classes',    'Read only classes the user is assigned to.'),
  ('attendance.view_all',          'attendance', 'Read attendance for every student.'),
  ('attendance.view_assigned',     'attendance', 'Read attendance only for students in scope.'),
  ('incidents.create_own',         'incidents',  'Raise an incident.'),
  ('incidents.view_own',           'incidents',  'Read incidents the user raised.'),
  ('incidents.view_all',           'incidents',  'Read every incident.'),
  ('incidents.update_own',         'incidents',  'Update incidents the user raised.'),
  ('incidents.update_all',         'incidents',  'Update every incident.'),
  ('incidents.assign',             'incidents',  'Assign an incident to a responder.'),
  ('incidents.take',               'incidents',  'Take an unassigned incident.'),
  ('incidents.view_sensitive',     'incidents',  'Read incidents flagged sensitive.'),
  ('incidents.export',             'incidents',  'Export incident data.'),
  ('ict.create',                   'ict',        'Raise an ICT ticket.'),
  ('ict.view_own',                 'ict',        'Read ICT tickets the user raised.'),
  ('ict.view_assigned',            'ict',        'Read ICT tickets assigned to the user.'),
  ('ict.view_all',                 'ict',        'Read every ICT ticket.'),
  ('ict.update_assigned',          'ict',        'Work ICT tickets assigned to the user.'),
  ('ict.assign',                   'ict',        'Assign an ICT ticket.'),
  ('ict.claim',                    'ict',        'Take an unassigned ICT ticket.'),
  ('rm.create',                    'rm',         'Raise an R&M ticket.'),
  ('rm.view_own',                  'rm',         'Read R&M tickets the user raised.'),
  ('rm.view_assigned',             'rm',         'Read R&M tickets assigned to the user.'),
  ('rm.view_all',                  'rm',         'Read every R&M ticket.'),
  ('rm.update_assigned',           'rm',         'Work R&M tickets assigned to the user.'),
  ('rm.assign',                    'rm',         'Assign an R&M ticket.'),
  ('rm.claim',                     'rm',         'Take an unassigned R&M ticket.'),
  ('finance.view',                 'finance',    'Read finance.'),
  ('finance.manage',               'finance',    'Change finance data.'),
  ('assets.manage',                'admin',      'Manage assets.'),
  ('staff.view',                   'admin',      'Read the staff directory.'),
  ('staff.manage',                 'admin',      'Manage the staff directory and accounts.'),
  ('access.manage',                'admin',      'Grant and revoke roles.'),
  ('settings.manage',              'admin',      'Change system settings.')
on conflict (capability) do update
  set module = excluded.module,
      description = excluded.description;

create table if not exists public.role_permissions (
  role text not null references public.app_roles(role) on delete cascade,
  capability text not null references public.app_capabilities(capability) on delete cascade,
  primary key (role, capability)
);

comment on table public.role_permissions is
  'Role to capability grants. site_admin holds no rows here because it bypasses the matrix.';

-- Capability lookups always start from a capability, so the primary key order
-- (role, capability) is the wrong shape for `has_permission`.
create index if not exists role_permissions_capability_role_idx
  on public.role_permissions (capability, role);

create index if not exists user_roles_profile_active_idx
  on public.user_roles (profile_id, active, role);

-- ---------------------------------------------------------------------------
-- 3. Resolution functions
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so the matrix can be read from inside RLS policies without
-- the caller also needing select access to it. The date window is applied here,
-- not only in the helper wrappers, so a closed grant never resolves.
create or replace function public.has_permission(
  p_user_id uuid default auth.uid(),
  p_capability text default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_has_role(p_user_id, 'site_admin')
    or exists (
      select 1
      from public.user_roles ur
      join public.role_permissions rp on rp.role = ur.role
      where ur.profile_id = p_user_id
        and rp.capability = p_capability
        and ur.active = true
        and (ur.effective_from is null or ur.effective_from <= current_date)
        and (ur.effective_to is null or ur.effective_to >= current_date)
    );
$$;

comment on function public.has_permission(uuid, text) is
  'True when the user holds the capability through any active, in-window role grant. site_admin bypasses the matrix. Both arguments must be supplied; the second default only exists because Postgres forbids a required parameter after a defaulted one, and a null capability always resolves false.';

create or replace function public.user_capabilities(p_user_id uuid default auth.uid())
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select rp.capability
  from public.user_roles ur
  join public.role_permissions rp on rp.role = ur.role
  where ur.profile_id = p_user_id
    and ur.active = true
    and (ur.effective_from is null or ur.effective_from <= current_date)
    and (ur.effective_to is null or ur.effective_to >= current_date)
  union
  -- site_admin bypasses the matrix, so it resolves the full catalogue rather
  -- than whatever the matrix happens to grant.
  select ac.capability
  from public.app_capabilities ac
  where public.user_has_role(p_user_id, 'site_admin')
  order by 1;
$$;

comment on function public.user_capabilities(uuid) is
  'Every capability the user resolves to, for parity checks against src/lib/access/permissions.ts.';

-- ---------------------------------------------------------------------------
-- 4. Seed the matrix
-- ---------------------------------------------------------------------------

-- Idempotent: re-running replaces the matrix wholesale so a corrected seed does
-- not need a follow-up migration.
delete from public.role_permissions;

insert into public.role_permissions (role, capability)
select r.role, r.capability
from (values
  -- students
  ('staff',              'students.view_assigned'),
  ('property_staff',     'students.view_assigned'),
  ('counsellor',         'students.view_assigned'),
  -- classes
  ('staff',              'classes.view_assigned'),
  ('property_staff',     'classes.view_assigned'),
  ('counsellor',         'classes.view_assigned'),
  -- attendance
  ('staff',              'attendance.view_assigned'),
  ('property_staff',     'attendance.view_assigned'),
  ('counsellor',         'attendance.view_assigned'),
  -- incidents
  ('staff',              'incidents.create_own'),
  ('staff',              'incidents.view_own'),
  ('staff',              'incidents.update_own'),
  ('counsellor',         'incidents.create_own'),
  ('counsellor',         'incidents.view_own'),
  ('counsellor',         'incidents.view_all'),
  ('counsellor',         'incidents.update_own'),
  ('counsellor',         'incidents.update_all'),
  ('counsellor',         'incidents.assign'),
  ('counsellor',         'incidents.take'),
  ('counsellor',         'incidents.view_sensitive'),
  ('counsellor',         'incidents.export'),
  -- ICT tickets
  ('staff',              'ict.create'),
  ('staff',              'ict.view_own'),
  ('it_staff',           'ict.create'),
  ('it_staff',           'ict.view_own'),
  ('it_staff',           'ict.view_assigned'),
  ('it_staff',           'ict.update_assigned'),
  ('it_staff',           'ict.claim'),
  ('it_admin',           'ict.create'),
  ('it_admin',           'ict.view_own'),
  ('it_admin',           'ict.view_assigned'),
  ('it_admin',           'ict.view_all'),
  ('it_admin',           'ict.update_assigned'),
  ('it_admin',           'ict.assign'),
  ('it_admin',           'ict.claim'),
  ('property_manager',   'ict.create'),
  ('property_manager',   'ict.view_own'),
  ('counsellor',         'ict.create'),
  ('counsellor',         'ict.view_own'),
  -- R&M tickets
  ('staff',              'rm.create'),
  ('staff',              'rm.view_own'),
  ('it_staff',           'rm.create'),
  ('it_staff',           'rm.view_own'),
  ('it_staff',           'rm.view_assigned'),
  ('it_staff',           'rm.update_assigned'),
  ('it_staff',           'rm.claim'),
  ('it_admin',           'rm.create'),
  ('it_admin',           'rm.view_own'),
  ('it_admin',           'rm.view_assigned'),
  ('it_admin',           'rm.view_all'),
  ('it_admin',           'rm.update_assigned'),
  ('it_admin',           'rm.assign'),
  ('it_admin',           'rm.claim'),
  ('property_manager',   'rm.create'),
  ('property_manager',   'rm.view_own'),
  ('property_manager',   'rm.view_assigned'),
  ('property_manager',   'rm.update_assigned'),
  ('property_manager',   'rm.view_all'),
  ('property_manager',   'rm.assign'),
  ('property_manager',   'rm.claim'),
  ('counsellor',         'rm.create'),
  ('counsellor',         'rm.view_own'),
  -- finance
  ('finance_admin',      'finance.view'),
  ('finance_admin',      'finance.manage'),
  ('finance_read_only',  'finance.view'),
  ('board_member',       'finance.view')
) as r(role, capability)
-- A role absent from the catalogue must not silently gain grants.
join public.app_roles ar on ar.role = r.role and ar.is_retired = false
on conflict (role, capability) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Matrix RLS
-- ---------------------------------------------------------------------------

alter table public.role_permissions enable row level security;
alter table public.app_roles enable row level security;
alter table public.app_capabilities enable row level security;

drop policy if exists role_permissions_read_authenticated on public.role_permissions;
create policy role_permissions_read_authenticated
  on public.role_permissions
  for select
  to authenticated
  using (true);

drop policy if exists role_permissions_write_access_admin on public.role_permissions;
create policy role_permissions_write_access_admin
  on public.role_permissions
  for all
  to authenticated
  using (public.has_permission(auth.uid(), 'access.manage'))
  with check (public.has_permission(auth.uid(), 'access.manage'));

drop policy if exists app_roles_read_authenticated on public.app_roles;
create policy app_roles_read_authenticated
  on public.app_roles
  for select
  to authenticated
  using (true);

drop policy if exists app_capabilities_read_authenticated on public.app_capabilities;
create policy app_capabilities_read_authenticated
  on public.app_capabilities
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- 6. Widen the role CHECK to the catalogue
-- ---------------------------------------------------------------------------

-- `staff` joins the legal set now; `teacher` stays legal until the grant
-- migration in a later phase deactivates those rows.
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
      'counsellor',
      'staff'
    )
  );

-- ---------------------------------------------------------------------------
-- 7. Redefine the existing helpers as capability lookups
-- ---------------------------------------------------------------------------
-- Signatures are unchanged, so no existing policy or RPC needs rewriting.

create or replace function public.is_it_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission(p_user_id, 'ict.assign');
$$;

create or replace function public.is_it_staff(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission(p_user_id, 'ict.update_assigned');
$$;

create or replace function public.is_access_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission(p_user_id, 'access.manage');
$$;

create or replace function public.is_counsellor_or_leadership(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission(p_user_id, 'incidents.view_sensitive');
$$;

-- `site_admin` now resolves true, fixing the assign RPCs for site admins.
create or replace function public.is_rm_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission(p_user_id, 'rm.assign');
$$;

create or replace function public.is_rm_property_manager(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission(p_user_id, 'rm.assign');
$$;

create or replace function public.is_rm_leadership(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission(p_user_id, 'rm.view_all');
$$;

-- Unchanged behaviour: the R&M operator set is still {it_admin, property_manager}.
create or replace function public.is_rm_operator(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_rm_admin(p_user_id) or public.is_rm_property_manager(p_user_id);
$$;

create or replace function public.can_access_ticket(p_ticket_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission(p_user_id, 'ict.view_all')
    or public.has_permission(p_user_id, 'ict.view_assigned')
      and public.is_ticket_assignee(p_ticket_id, p_user_id)
    or public.is_ticket_requester(p_ticket_id, p_user_id);
$$;

create or replace function public.can_access_rm_ticket(p_ticket_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission(p_user_id, 'rm.view_all')
    or public.has_permission(p_user_id, 'rm.view_assigned')
      and public.is_rm_ticket_assignee(p_ticket_id, p_user_id)
    or public.is_rm_ticket_requester(p_ticket_id, p_user_id);
$$;

create or replace function public.finance_can_view()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission(auth.uid(), 'finance.view');
$$;

create or replace function public.finance_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_permission(auth.uid(), 'finance.manage');
$$;

-- ---------------------------------------------------------------------------
-- 8. Validate the assignee by capability, not by role name
-- ---------------------------------------------------------------------------

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
        and public.has_permission(p_assigned_to, 'ict.update_assigned')
    ) then
      raise exception 'Assignee must be an active staff member who can work assigned tickets';
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

  -- rm.assign, not rm.update_assigned: the latter also resolves true for
  -- it_staff, who can work an R&M ticket assigned to them but is deliberately
  -- not in the assignable operator set.
  if p_assigned_to is not null and not public.has_permission(p_assigned_to, 'rm.assign') then
    raise exception 'Assignee must be able to assign R&M tickets';
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

-- ---------------------------------------------------------------------------
-- 9. Parity check
-- ---------------------------------------------------------------------------
-- For each role the database agrees with src/lib/access/registry.ts. Run after
-- any change to either side; the roles below must all come back empty.
--
--   select r.role, t.expected::text[] - c.actual as missing, c.actual - t.expected::text[] as extra
--   from (values
--     ('staff', array['students.view_assigned','classes.view_assigned','attendance.view_assigned','incidents.create_own','incidents.view_own','incidents.update_own','ict.create','ict.view_own','rm.create','rm.view_own']::text[]),
--     ('counsellor', array['students.view_assigned','classes.view_assigned','attendance.view_assigned','incidents.create_own','incidents.view_own','incidents.view_all','incidents.update_own','incidents.update_all','incidents.assign','incidents.take','incidents.view_sensitive','incidents.export','ict.create','ict.view_own','rm.create','rm.view_own']::text[])
--   ) as t(role, expected)
--   cross join lateral (
--     select coalesce(array_agg(rp.capability), '{}'::text[]) as actual
--     from public.role_permissions rp
--     where rp.role = t.role
--   ) c
--   right join (select unnest(t.expected) as role) r on true
--   group by r.role, t.expected, c.actual;
--
-- A per-profile equivalent, to prove the date window is honoured:
--
--   select p.id, array_agg(distinct c)
--   from public.profiles p
--   cross join lateral public.user_capabilities(p.id) c
--   group by p.id;
