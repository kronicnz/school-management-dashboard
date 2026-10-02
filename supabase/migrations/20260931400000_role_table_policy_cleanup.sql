-- -----------------------------------------------------------------------------
-- Clear the advisor findings on the role tables
-- -----------------------------------------------------------------------------
-- Three findings, all introduced by the permission matrix work:
--
-- 1. `multiple_permissive_policies` on `role_permissions` and `user_roles`.
--    Both tables had a broad `for all` write policy *and* a narrower read policy.
--    Postgres ORs permissive policies together, so a SELECT was governed by two
--    of them, and the `for all` policy also silently granted admins DELETE on
--    every column of the read path. Splitting the write policy to insert/update/
--    delete preserves behaviour: admins already get full read through the read
--    policy, which is the one branch that explicitly includes them.
--
-- 2. `auth_rls_initplan` on both tables. `auth.uid()` re-evaluated per row
--    instead of once per query. Wrapping it in `(select ...)` makes the planner
--    treat it as an InitPlan.
--
-- 3. `unused_index` on `role_permissions_capability_role_idx`. The index was
--    justified as "capability lookups always start from a capability", but no
--    query does: `has_permission` and `user_capabilities` both start from
--    `user_roles.profile_id` and join the matrix on `(role, capability)`, which
--    the primary key already covers. The index was dead weight and is dropped.

-- 1 + 2. Split the write policies and pin auth.uid() as an InitPlan.
drop policy if exists role_permissions_write_access_admin on public.role_permissions;

create policy role_permissions_write_access_admin
  on public.role_permissions
  for insert to authenticated
  with check (public.has_permission((select auth.uid()), 'access.manage'));

create policy role_permissions_update_access_admin
  on public.role_permissions
  for update to authenticated
  using (public.has_permission((select auth.uid()), 'access.manage'))
  with check (public.has_permission((select auth.uid()), 'access.manage'));

create policy role_permissions_delete_access_admin
  on public.role_permissions
  for delete to authenticated
  using (public.has_permission((select auth.uid()), 'access.manage'));

drop policy if exists "Users can read own roles" on public.user_roles;

create policy "Users can read own roles"
  on public.user_roles
  for select to public
  using ((profile_id = (select auth.uid())) or public.is_access_admin((select auth.uid())));

drop policy if exists "Access admins can manage roles" on public.user_roles;

create policy "Access admins can insert roles"
  on public.user_roles
  for insert to public
  with check (public.is_access_admin((select auth.uid())));

create policy "Access admins can update roles"
  on public.user_roles
  for update to public
  using (public.is_access_admin((select auth.uid())))
  with check (public.is_access_admin((select auth.uid())));

create policy "Access admins can delete roles"
  on public.user_roles
  for delete to public
  using (public.is_access_admin((select auth.uid())));

-- 3. Drop the unused reverse index.
--
--    The index was justified as "capability lookups always start from a
--    capability", but no query does: `has_permission` and `user_capabilities`
--    both start from `user_roles.profile_id` and join the matrix on
--    `(role, capability)`, which the primary key already covers. The index was
--    dead weight.
--
--    Dropping it leaves `role_permissions_capability_fkey` without a covering
--    index, which the linter reports as INFO. That is the intended trade: the
--    only reader the index would have had is the `on delete cascade` from
--    `app_capabilities`, a rare administrative delete over a catalogue of a few
--    dozen rows. Do not re-add it to silence that advisory without a query that
--    needs it.
drop index if exists public.role_permissions_capability_role_idx;

-- The roles table is read on every capability check, and `granted_by` was left
-- without a covering index, so deactivating or auditing a grant scanned the table.
create index if not exists user_roles_granted_by_idx
  on public.user_roles (granted_by);