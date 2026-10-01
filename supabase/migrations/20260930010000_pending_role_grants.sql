-- -----------------------------------------------------------------------------
-- Pending role grants: roles assigned to someone who has not signed in yet
-- -----------------------------------------------------------------------------
-- Organisation staff sign in with Google, so a staff member added by an admin has
-- no `profiles` row at creation time. The role RPCs are keyed on profile_id, which
-- meant an admin's ticked roles were simply discarded for every org user: the
-- Admin page reported the roles as unsaved and suggested sending an invitation,
-- which is the wrong remedy for someone who will authenticate with Google. When
-- they did sign in, nothing linked their profile to the staff row, so they arrived
-- with no access at all.
--
-- `pending_roles` stages those grants on the staff row. `handle_new_user` applies
-- them on first sign-in, which covers both the Google path and the manual
-- invitation path without the Admin page having to know in advance which one a
-- given person will use.

-- Immutable validator, because a CHECK constraint cannot contain a subquery.
-- Rejects anything that is not an array of objects carrying a string `role`, so a
-- malformed grant cannot reach the trigger and fail there, where it would abort
-- the whole signup rather than one row.
create or replace function public.staff_pending_roles_valid(p_roles jsonb)
returns boolean
language plpgsql
immutable
as $$
begin
  if p_roles is null then
    return false;
  end if;

  if jsonb_typeof(p_roles) <> 'array' then
    return false;
  end if;

  -- `is distinct from` rather than `<>`, because `jsonb_typeof` of an absent key
  -- returns NULL, and `NULL <> 'string'` evaluates to NULL rather than true. A
  -- plain `<>` would let a grant with no `role` at all through the check and then
  -- fail inside the trigger, taking the person's whole signup with it.
  if exists (
    select 1
    from jsonb_array_elements(p_roles) as element
    where jsonb_typeof(element) is distinct from 'object'
       or jsonb_typeof(element -> 'role') is distinct from 'string'
       or btrim(element ->> 'role') = ''
  ) then
    return false;
  end if;

  -- Dates are validated here for the same reason. The trigger casts them to `date`,
  -- and a non-date string raises inside it, which aborts the entire signup rather
  -- than staging a broken grant for an admin to fix.
  if exists (
    select 1
    from jsonb_array_elements(p_roles) as element,
         lateral (values (element ->> 'effective_from'), (element ->> 'effective_to')) as dates(value)
    where nullif(btrim(dates.value), '') is not null
      and dates.value !~ '^\d{4}-\d{2}-\d{2}$'
  ) then
    return false;
  end if;

  return true;
end;
$$;

alter table public.staff
  add column if not exists pending_roles jsonb not null default '[]'::jsonb,
  add column if not exists pending_roles_granted_by uuid references public.profiles(id) on delete set null;

alter table public.staff
  drop constraint if exists staff_pending_roles_valid;

alter table public.staff
  add constraint staff_pending_roles_valid
  check (public.staff_pending_roles_valid(pending_roles));

comment on column public.staff.pending_roles is
  'Role grants staged for a staff member who has not signed in yet, as [{role, effective_from, effective_to}]. Applied and cleared by handle_new_user on first sign-in. Organisation staff authenticate with Google, so there is no profile_id to key user_roles on until their first sign-in.';

comment on column public.staff.pending_roles_granted_by is
  'Admin who staged pending_roles. Carried into user_roles.granted_by when the grants are applied, so "who gave this person finance_admin" still has an answer for a grant that took effect at first sign-in rather than at an admin click.';

create index if not exists staff_pending_roles_not_empty_idx
  on public.staff (id)
  where pending_roles <> '[]'::jsonb;

-- -----------------------------------------------------------------------------
-- handle_new_user: link the staff row and apply staged roles
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_pending jsonb;
  v_granted_by uuid;
  v_grant jsonb;
  v_role text;
  v_from date;
  v_to date;
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

  -- Link the staff row for this email.
  --
  -- Deliberately takes at most one row. `staff.email` is not unique, so linking
  -- every match would violate the partial unique index on profile_id and abort the
  -- entire signup. If two unlinked staff rows share an address, the oldest is
  -- linked and the other is left for an admin to disambiguate rather than taking
  -- the whole login down with it.
  select s.id, s.pending_roles, s.pending_roles_granted_by
  into v_staff_id, v_pending, v_granted_by
  from public.staff s
  where s.profile_id is null
    and lower(btrim(s.email)) = lower(btrim(new.email))
    and not exists (select 1 from public.staff other where other.profile_id = new.id)
  order by s.created_at nulls last, s.id
  limit 1;

  if v_staff_id is not null then
    update public.staff
    set profile_id = new.id
    where id = v_staff_id
      and profile_id is null;

    -- Apply the staged grants. Inserted directly rather than through
    -- `sync_staff_roles_by_profile_id` because that RPC self-checks
    -- `is_access_admin(auth.uid())`, and auth.uid() is null inside this trigger.
    for v_grant in select jsonb_array_elements(coalesce(v_pending, '[]'::jsonb)) loop
      v_role := v_grant ->> 'role';
      v_from := nullif(btrim(v_grant ->> 'effective_from'), '')::date;
      v_to := nullif(btrim(v_grant ->> 'effective_to'), '')::date;

      insert into public.user_roles (profile_id, role, effective_from, effective_to, active, granted_by)
      values (new.id, v_role, v_from, v_to, true, v_granted_by)
      on conflict (profile_id, role, effective_from) do update
        set active = true,
            effective_to = excluded.effective_to,
            granted_by = excluded.granted_by,
            updated_at = now();
    end loop;

    -- Cleared only after the grants are written, so a failure above leaves them
    -- staged for the retry rather than losing them.
    update public.staff
    set pending_roles = '[]'::jsonb,
        pending_roles_granted_by = null
    where id = v_staff_id;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- sync_staff_roles_by_profile_id: clear staged grants once roles are real
-- -----------------------------------------------------------------------------
-- Otherwise a staged grant for an address that already has a profile would sit
-- unreconciled in `pending_roles` and be re-applied at some unrelated future signup
-- if the link were ever broken.
create or replace function public.sync_staff_roles_by_profile_id(p_profile_id uuid, p_grants jsonb)
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

  update public.user_roles ur
  set active = false
  where ur.profile_id = p_profile_id
    and ur.active = true
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(p_grants, '[]'::jsonb)) g
      where g ->> 'role' = ur.role
        and nullif(btrim(g ->> 'effective_from'), '')::date is not distinct from ur.effective_from
    );

  for v_grant in select jsonb_array_elements(coalesce(p_grants, '[]'::jsonb)) loop
    v_role := v_grant ->> 'role';
    v_effective_from := nullif(btrim(v_grant ->> 'effective_from'), '')::date;
    v_effective_to := nullif(btrim(v_grant ->> 'effective_to'), '')::date;

    select id
    into v_latest_role_row_id
    from public.user_roles
    where profile_id = p_profile_id
      and role = v_role
      and effective_from is not distinct from v_effective_from
    order by created_at desc, updated_at desc, id desc
    limit 1;

    if v_latest_role_row_id is null then
      insert into public.user_roles (profile_id, role, effective_from, effective_to, active, granted_by)
      values (p_profile_id, v_role, v_effective_from, v_effective_to, true, auth.uid());
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

  -- The grants now live in `user_roles`, so the staged copy would only be a second
  -- source of truth that can drift.
  update public.staff
  set pending_roles = '[]'::jsonb,
      pending_roles_granted_by = null
  where profile_id = p_profile_id
    and pending_roles <> '[]'::jsonb;
end;
$$;

-- -----------------------------------------------------------------------------
-- list_staff_directory: report staged grants
-- -----------------------------------------------------------------------------
-- Without this the Admin page cannot show what is waiting to be applied, and a
-- later save would overwrite the staged list from an empty one.
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
  dated_roles jsonb,
  pending_roles jsonb
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
    case
      when s.profile_id is null then 'none'
      else coalesce(ar.status, 'active')
    end as account_status,
    ar.invited_at as account_invited_at,
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
    ) as dated_roles,
    s.pending_roles as pending_roles
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
    ar.invited_at,
    s.pending_roles
  order by s.last_name, s.first_name;
end;
$$;
