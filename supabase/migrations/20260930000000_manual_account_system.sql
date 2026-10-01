-- Manual staff account system.
--
-- The app could create a `staff` row but not a login. Role grants are keyed on
-- `profile_id`, so a staff record with no linked profile silently discarded every
-- ticked role while still reporting success. This migration adds the records the
-- manual provisioning path needs (a login registration, an audit trail, a domain
-- allowlist) and repairs the two places that made the old flow lossy.
--
-- Access management itself lives in the `account-admin` edge function. Everything
-- here is either the storage it writes or the server-side rules it depends on.

-- -----------------------------------------------------------------------------
-- app_settings: single-row configuration
-- -----------------------------------------------------------------------------
-- An empty allowlist means "any domain is accepted". That default matters: a
-- fresh install should not silently block every new staff member, so the rule is
-- opt-in rather than opt-out.
create table if not exists public.app_settings (
  id text primary key default 'default',
  allowed_email_domains text[] not null default '{}'::text[],
  updated_at timestamptz not null default now(),
  constraint app_settings_singleton check (id = 'default')
);

insert into public.app_settings (id, allowed_email_domains)
values ('default', '{}'::text[])
on conflict (id) do nothing;

alter table public.app_settings enable row level security;

drop policy if exists "Authenticated users can read app settings" on public.app_settings;
create policy "Authenticated users can read app settings"
  on public.app_settings
  for select
  using (auth.role() = 'authenticated');

-- Deliberately no write policy. The allowlist is server-owned configuration and is
-- changed through SQL or a service-role path, never straight from the browser.

-- -----------------------------------------------------------------------------
-- account_registrations: one row per provisioned login
-- -----------------------------------------------------------------------------
-- `staff.status` is an HR field and is not access control; this table is what
-- actually records whether a person can sign in. Revoking sets `status` and bans
-- the auth account, so restoring is a deliberate two-part act and access never
-- returns silently.
--
-- `created_by` is the admin who last provisioned or re-provisioned the login. The
-- full history of who did what lives in `account_audit_log`; this column answers
-- the narrower "who set this up" question without a join.
create table if not exists public.account_registrations (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'invited'
    check (status in ('invited', 'active', 'revoked')),
  created_by uuid references public.profiles(id) on delete set null,
  invited_at timestamptz not null default now(),
  invite_sent_at timestamptz,
  last_reinvited_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists account_registrations_status_idx
  on public.account_registrations(status);

alter table public.account_registrations enable row level security;

drop policy if exists "Access admins can read account registrations" on public.account_registrations;
create policy "Access admins can read account registrations"
  on public.account_registrations
  for select
  using (public.is_access_admin(auth.uid()));

-- No client write policy. The `account-admin` edge function writes these rows with
-- the service role so that "who provisioned this" cannot be forged from the client.

drop trigger if exists account_registrations_updated_at on public.account_registrations;
create trigger account_registrations_updated_at
  before update on public.account_registrations
  for each row execute function public.update_updated_at_column();

-- -----------------------------------------------------------------------------
-- account_audit_log: append-only record of every account change
-- -----------------------------------------------------------------------------
create table if not exists public.account_audit_log (
  id bigint generated always as identity primary key,
  profile_id uuid references public.profiles(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_email text,
  -- The action list is deliberately short. `create_failed` is the catch-all for any
  -- account operation that could not be completed; `detail.stage` names the step
  -- that failed, so a row is never ambiguous about which operation it belongs to.
  action text not null check (
    action in (
      'create',
      'resend_invite',
      'revoke',
      'restore',
      'role_change',
      'domain_rejected',
      'create_failed'
    )
  ),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_audit_log_profile_idx
  on public.account_audit_log(profile_id, created_at desc);

alter table public.account_audit_log enable row level security;

drop policy if exists "Access admins can read account audit log" on public.account_audit_log;
create policy "Access admins can read account audit log"
  on public.account_audit_log
  for select
  using (public.is_access_admin(auth.uid()));

-- -----------------------------------------------------------------------------
-- Schema fix: handle_new_user must tolerate a missing email
-- -----------------------------------------------------------------------------
-- `profiles.email` is `not null`, so a phone-only or OAuth-without-email signup made
-- the auth insert fail inside this trigger and the whole signup was rejected with
-- an opaque database error. Return early instead: no profile, but a user.
-- `on conflict do nothing` keeps the trigger idempotent for a retried insert.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or btrim(new.email) = '' then
    return new;
  end if;

  insert into public.profiles (id, email, full_name, org_unit_path)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    null
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Schema fix: staff writes are an admin capability
-- -----------------------------------------------------------------------------
-- The blanket `for all` policy let any signed-in user create, edit, and delete
-- staff records. Reads deliberately stay open: teacher and property-staff ticket
-- assignee dropdowns read `staff` (see src/pages/Tickets.tsx), so restricting
-- select would break normal ticket work.
drop policy if exists "Authenticated users can manage staff" on public.staff;

create policy "Access admins can manage staff"
  on public.staff
  for all
  using (public.is_access_admin(auth.uid()))
  with check (public.is_access_admin(auth.uid()));

comment on policy "Authenticated users can view staff" on public.staff is
  'Intentionally readable by every signed-in user: the ICT and property ticket assignee dropdowns in src/pages/Tickets.tsx resolve assignees by reading staff. Do not tighten this policy without replacing those lookups.';

-- -----------------------------------------------------------------------------
-- Drop the unused email-keyed role RPC
-- -----------------------------------------------------------------------------
-- Nothing in the client or the edge functions calls this. `profiles.email` is
-- unique but `staff.email` is not, and the untrimmed `where email = p_email`
-- comparison was already unreliable, so the profile-id keyed RPC is the only
-- supported path.
drop function if exists public.sync_staff_roles_by_email(text, text[]);

-- -----------------------------------------------------------------------------
-- list_staff_directory: add the account status
-- -----------------------------------------------------------------------------
-- Dropped rather than `create or replace` because Postgres refuses to change a
-- function's return type, and the return type is changing.
drop function if exists public.list_staff_directory();

create function public.list_staff_directory()
returns table (
  id uuid,
  profile_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  role text,
  department text,
  hire_date date,
  status text,
  org_unit_path text,
  created_at timestamp,
  updated_at timestamp,
  roles jsonb,
  primary_role text,
  account_status text,
  account_invited_at timestamptz,
  dated_roles jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_access_admin(auth.uid()) then
    raise exception 'insufficient_privilege';
  end if;

  return query
  select
    s.id,
    s.profile_id,
    s.first_name,
    s.last_name,
    s.email,
    s.phone,
    s.role,
    s.department,
    s.hire_date,
    s.status,
    s.org_unit_path,
    s.created_at,
    s.updated_at,
    coalesce(
      jsonb_agg(distinct ur.role) filter (where ur.role is not null),
      '[]'::jsonb
    ) as roles,
    max(ur.role) filter (where ur.role is not null) as primary_role,
    -- A staff row with no profile has no login at all, which is a different
    -- situation from a login whose registration is merely inactive.
    case
      when s.profile_id is null then 'none'
      else coalesce(ar.status, 'active')
    end as account_status,
    ar.invited_at as account_invited_at,
    -- Active grants whose window does not currently cover today, so the admin
    -- edit dialog can show them. Without this they would be invisible in the
    -- directory and would be silently deactivated by the next save, because
    -- `sync_staff_roles_by_profile_id` deactivates anything not in the submitted
    -- list. A relief-cover or next-year board seat is exactly the kind of grant
    -- an admin must not lose to an unrelated phone-number edit.
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'role', dur.role,
            'effective_from', dur.effective_from,
            'effective_to', dur.effective_to
          ) order by dur.effective_from nulls last, dur.role
        ),
        '[]'::jsonb
      )
      from public.user_roles dur
      where dur.profile_id = s.profile_id
        and dur.active = true
        and not (
          (dur.effective_from is null or dur.effective_from <= current_date)
          and (dur.effective_to is null or dur.effective_to >= current_date)
        )
    ) as dated_roles
  from public.staff s
  left join public.user_roles ur
    on ur.profile_id = s.profile_id
   and ur.active = true
   and (ur.effective_from is null or ur.effective_from <= current_date)
   and (ur.effective_to is null or ur.effective_to >= current_date)
  left join public.account_registrations ar
    on ar.profile_id = s.profile_id
  group by
    s.id,
    s.profile_id,
    s.first_name,
    s.last_name,
    s.email,
    s.phone,
    s.role,
    s.department,
    s.hire_date,
    s.status,
    s.org_unit_path,
    s.created_at,
    s.updated_at,
    ar.status,
    ar.invited_at
  order by s.last_name, s.first_name;
end;
$$;

-- -----------------------------------------------------------------------------
-- sync_staff_roles_by_profile_id: accept dated grants
-- -----------------------------------------------------------------------------
-- The old signature could only express an undated role list, which made
-- `effective_from` / `effective_to` write-only: the columns existed and were
-- honoured by the database helpers, but no client path could ever set them.
-- Grants now arrive as jsonb so each role carries its own window.
--
-- Soft-grant semantics are preserved: a role that is no longer granted is
-- deactivated rather than deleted, and the row is revived if it is granted again.
--
-- Matching is on (profile_id, role, effective_from) because that is the table's
-- unique key, and Postgres treats NULL as distinct in unique indexes, so several
-- undated rows for the same role are legal. The reconciliation below still
-- collapses them to the newest active row so active duplicates cannot accumulate.
drop function if exists public.sync_staff_roles_by_profile_id(uuid, text[]);

create function public.sync_staff_roles_by_profile_id(p_profile_id uuid, p_grants jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant jsonb;
  v_role text;
  v_effective_from date;
  v_effective_to date;
  v_latest_role_row_id uuid;
begin
  if not public.is_access_admin(auth.uid()) then
    raise exception 'insufficient_privilege';
  end if;

  if p_profile_id is null then
    raise exception 'profile_id_required';
  end if;

  -- Deactivate every active row that is not part of the requested grant set.
  update public.user_roles ur
  set active = false
  where ur.profile_id = p_profile_id
    and ur.active = true
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_grants, '[]'::jsonb)) as requested
      where requested.value ->> 'role' = ur.role
        and nullif(btrim(coalesce(requested.value ->> 'effective_from', '')), '')::date
            is not distinct from ur.effective_from
    );

  for v_grant in select value from jsonb_array_elements(coalesce(p_grants, '[]'::jsonb)) loop
    v_role := nullif(btrim(coalesce(v_grant ->> 'role', '')), '');
    v_effective_from := nullif(btrim(coalesce(v_grant ->> 'effective_from', '')), '')::date;
    v_effective_to := nullif(btrim(coalesce(v_grant ->> 'effective_to', '')), '')::date;

    if v_role is null then
      continue;
    end if;

    if v_effective_from is not null
       and v_effective_to is not null
       and v_effective_to < v_effective_from then
      raise exception 'effective_to_before_effective_from: %', v_role;
    end if;

    select ur.id
    into v_latest_role_row_id
    from public.user_roles ur
    where ur.profile_id = p_profile_id
      and ur.role = v_role
      and ur.effective_from is not distinct from v_effective_from
    order by ur.created_at desc, ur.updated_at desc, ur.id desc
    limit 1;

    if v_latest_role_row_id is null then
      insert into public.user_roles (profile_id, role, active, effective_from, effective_to, granted_by)
      values (p_profile_id, v_role, true, v_effective_from, v_effective_to, auth.uid());
    else
      update public.user_roles
      set active = true,
          effective_to = v_effective_to,
          granted_by = auth.uid()
      where id = v_latest_role_row_id;

      update public.user_roles
      set active = false
      where profile_id = p_profile_id
        and role = v_role
        and effective_from is not distinct from v_effective_from
        and id <> v_latest_role_row_id;
    end if;
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- resolve_auth_user_id_by_email: recover an id without scanning the user table
-- -----------------------------------------------------------------------------
-- GoTrue exposes no get-user-by-email admin method, so the `account-admin` edge
-- function used to recover an id with a bounded `auth.admin.listUsers` scan. That
-- is O(n) across every account in the project, it pulls the entire user list
-- through the service role just to find one row, and it grows worse with every
-- signup.
--
-- `auth.users` is owned by `postgres`, which is not subject to its own RLS, so a
-- security-definer function can read it directly. This returns a single uuid and
-- nothing else - no email, no metadata, no row data - and only to an access admin,
-- who can already read the staff directory, every role grant, and the account
-- audit log.
--
-- It exists for one narrow case: an auth user with no `profiles` row, which is
-- what a half-finished earlier provisioning attempt leaves behind.
create function public.resolve_auth_user_id_by_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  if not public.is_access_admin(auth.uid()) then
    raise exception 'insufficient_privilege';
  end if;

  if p_email is null or btrim(p_email) = '' then
    return null;
  end if;

  select u.id
  into v_user_id
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  order by u.created_at
  limit 1;

  return v_user_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Guard: the manual account tables must not fall back to blanket access
-- -----------------------------------------------------------------------------
do $$
declare
  v_bad_count integer;
begin
  select count(*)
  into v_bad_count
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('app_settings', 'account_registrations', 'account_audit_log')
    and p.permissive = 'ALL'
    and coalesce(p.qual, '') ilike '%auth.role() = ''authenticated''%';

  if v_bad_count > 0 then
    raise exception 'Manual account table policy guard failed: blanket authenticated policy detected';
  end if;
end;
$$;
