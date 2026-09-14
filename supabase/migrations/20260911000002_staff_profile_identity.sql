alter table public.staff
  add column if not exists profile_id uuid references public.profiles(id) on delete restrict;

create unique index if not exists staff_profile_id_key
  on public.staff(profile_id)
  where profile_id is not null;

update public.staff s
set profile_id = p.id
from public.profiles p
where s.profile_id is null
  and lower(trim(s.email)) = lower(trim(p.email));

create or replace function public.resolve_profile_id_by_email(p_email text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  if not public.is_access_admin(auth.uid()) then
    raise exception 'insufficient_privilege';
  end if;

  select p.id
  into v_profile_id
  from public.profiles p
  where lower(trim(p.email)) = lower(trim(p_email))
  limit 1;

  return v_profile_id;
end;
$$;

create or replace function public.list_staff_directory()
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
  primary_role text
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
    max(ur.role) filter (where ur.role is not null) as primary_role
  from public.staff s
  left join public.user_roles ur
    on ur.profile_id = s.profile_id
   and ur.active = true
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
    s.updated_at
  order by s.last_name, s.first_name;
end;
$$;

create or replace function public.sync_staff_roles_by_profile_id(p_profile_id uuid, p_roles text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_latest_role_row_id uuid;
begin
  if not public.is_access_admin(auth.uid()) then
    raise exception 'insufficient_privilege';
  end if;

  update public.user_roles
  set active = false
  where profile_id = p_profile_id
    and active = true
    and role <> all(coalesce(p_roles, array[]::text[]));

  foreach v_role in array coalesce(p_roles, array[]::text[]) loop
    select id
    into v_latest_role_row_id
    from public.user_roles
    where profile_id = p_profile_id
      and role = v_role
    order by created_at desc, updated_at desc, id desc
    limit 1;

    if v_latest_role_row_id is null then
      insert into public.user_roles (profile_id, role, active, granted_by)
      values (p_profile_id, v_role, true, auth.uid());
    else
      update public.user_roles
      set active = true,
          granted_by = auth.uid()
      where id = v_latest_role_row_id;

      update public.user_roles
      set active = false
      where profile_id = p_profile_id
        and role = v_role
        and id <> v_latest_role_row_id;
    end if;
  end loop;
end;
$$;
