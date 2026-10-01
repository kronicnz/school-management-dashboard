do $$
declare
  v_profile_id uuid;
begin
  select id
  into v_profile_id
  from public.profiles
  where email = 'shaneb@ris.school.nz';

  if v_profile_id is null then
    raise exception 'profile_not_found';
  end if;

  delete from public.user_roles
  where profile_id = v_profile_id
    and role = 'site_admin';

  insert into public.user_roles (profile_id, role, active, granted_by)
  values (v_profile_id, 'site_admin', true, v_profile_id);
end $$;