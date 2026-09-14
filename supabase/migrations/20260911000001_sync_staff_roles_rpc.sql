create or replace function public.sync_staff_roles_by_email(p_email text, p_roles text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_role text;
  v_latest_role_row_id uuid;
begin
  if not public.is_access_admin(auth.uid()) then
    raise exception 'insufficient_privilege';
  end if;

  select id
  into v_profile_id
  from public.profiles
  where email = p_email;

  if v_profile_id is null then
    raise exception 'profile_not_found';
  end if;

  update public.user_roles
  set active = false
  where profile_id = v_profile_id
    and active = true
    and role <> all(coalesce(p_roles, array[]::text[]));

  foreach v_role in array coalesce(p_roles, array[]::text[]) loop
    select id
    into v_latest_role_row_id
    from public.user_roles
    where profile_id = v_profile_id
      and role = v_role
    order by created_at desc, updated_at desc, id desc
    limit 1;

    if v_latest_role_row_id is null then
      insert into public.user_roles (profile_id, role, active, granted_by)
      values (v_profile_id, v_role, true, auth.uid());
    else
      update public.user_roles
      set active = true,
          granted_by = auth.uid()
      where id = v_latest_role_row_id;

      update public.user_roles
      set active = false
      where profile_id = v_profile_id
        and role = v_role
        and id <> v_latest_role_row_id;
    end if;
  end loop;
end;
$$;
