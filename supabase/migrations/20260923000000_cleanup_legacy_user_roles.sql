-- Remove retired role rows and lock the table to the live role set.

delete from public.user_roles
where role not in (
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
);

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
