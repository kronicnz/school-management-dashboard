insert into public.user_roles (id, profile_id, role, active, created_at, updated_at)
select
  gen_random_uuid(),
  p.id,
  'it_admin', -- or other role
  true,
  now(),
  now()
from public.profiles p
where p.email = 'shaneb@ris.school.nz'
on conflict do nothing;