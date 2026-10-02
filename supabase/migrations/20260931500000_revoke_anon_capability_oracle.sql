-- -----------------------------------------------------------------------------
-- Close the anonymous capability oracle
-- -----------------------------------------------------------------------------
-- Postgres grants EXECUTE on a new function to PUBLIC by default. The permission
-- matrix redefined sixteen existing helper RPCs as SECURITY DEFINER, which left
-- `anon` able to call every one of them through `/rest/v1/rpc/*`.
--
-- That matters more than it does for an ordinary function, because these take an
-- explicit user id and are SECURITY DEFINER, so they run as their owner and ignore
-- the caller's RLS. An anonymous caller could call
--
--   select has_permission('<any-uuid>', 'access.manage');
--   select user_capabilities('<any-uuid>');
--
-- and read back which users are site admins, and everything else they hold. That
-- is a role-assignment oracle: it turns the access model itself into a public
-- directory.
--
-- `anon` is revoked because there is no anonymous dashboard to render, and every
-- caller of these functions is either a signed-in user, an RLS policy (which runs
-- as the querying role), or a service-role edge function.
--
-- Both `PUBLIC` and `anon` are revoked. Revoking either alone leaves the grant
-- reachable: `PUBLIC` is where the default grant lives, and several of these also
-- carry an explicit `anon` grant from earlier migrations. An earlier revision of
-- this migration revoked only from `PUBLIC`, and the explicit `anon` grant
-- survived, leaving the oracle fully open.
--
-- Scope: only the functions this permission work redefined. The incident, ticket,
-- and finance RPCs still carry an `anon` execute grant from before this work and
-- are tracked separately; see the report rather than widening this migration.

revoke all on function public.has_permission(uuid, text) from public;
revoke all on function public.user_capabilities(uuid) from public;
revoke all on function public.is_access_admin(uuid) from public;
revoke all on function public.is_it_admin(uuid) from public;
revoke all on function public.is_it_staff(uuid) from public;
revoke all on function public.is_rm_admin(uuid) from public;
revoke all on function public.is_rm_operator(uuid) from public;
revoke all on function public.is_rm_leadership(uuid) from public;
revoke all on function public.is_rm_property_manager(uuid) from public;
revoke all on function public.is_counsellor_or_leadership(uuid) from public;
revoke all on function public.finance_can_view() from public;
revoke all on function public.finance_can_manage() from public;
revoke all on function public.can_access_ticket(uuid, uuid) from public;
revoke all on function public.can_access_rm_ticket(uuid, uuid) from public;
revoke all on function public.assign_ticket(uuid, uuid, text) from public;
revoke all on function public.assign_rm_ticket(uuid, uuid, text) from public;

revoke all on function public.dashboard_stats_for_role(text) from public;

revoke all on function public.has_permission(uuid, text) from anon;
revoke all on function public.user_capabilities(uuid) from anon;
revoke all on function public.is_access_admin(uuid) from anon;
revoke all on function public.is_it_admin(uuid) from anon;
revoke all on function public.is_it_staff(uuid) from anon;
revoke all on function public.is_rm_admin(uuid) from anon;
revoke all on function public.is_rm_operator(uuid) from anon;
revoke all on function public.is_rm_leadership(uuid) from anon;
revoke all on function public.is_rm_property_manager(uuid) from anon;
revoke all on function public.is_counsellor_or_leadership(uuid) from anon;
revoke all on function public.finance_can_view() from anon;
revoke all on function public.finance_can_manage() from anon;
revoke all on function public.can_access_ticket(uuid, uuid) from anon;
revoke all on function public.can_access_rm_ticket(uuid, uuid) from anon;
revoke all on function public.assign_ticket(uuid, uuid, text) from anon;
revoke all on function public.assign_rm_ticket(uuid, uuid, text) from anon;
revoke all on function public.dashboard_stats_for_role(text) from anon;

-- Signed-in users keep the read path: RLS policies evaluate as `authenticated`,
-- and the dashboard calls this directly.
grant execute on function public.has_permission(uuid, text) to authenticated;
grant execute on function public.user_capabilities(uuid) to authenticated;
grant execute on function public.is_access_admin(uuid) to authenticated;
grant execute on function public.is_it_admin(uuid) to authenticated;
grant execute on function public.is_it_staff(uuid) to authenticated;
grant execute on function public.is_rm_admin(uuid) to authenticated;
grant execute on function public.is_rm_operator(uuid) to authenticated;
grant execute on function public.is_rm_leadership(uuid) to authenticated;
grant execute on function public.is_rm_property_manager(uuid) to authenticated;
grant execute on function public.is_counsellor_or_leadership(uuid) to authenticated;
grant execute on function public.finance_can_view() to authenticated;
grant execute on function public.finance_can_manage() to authenticated;
grant execute on function public.can_access_ticket(uuid, uuid) to authenticated;
grant execute on function public.can_access_rm_ticket(uuid, uuid) to authenticated;
grant execute on function public.assign_ticket(uuid, uuid, text) to authenticated;
grant execute on function public.assign_rm_ticket(uuid, uuid, text) to authenticated;
grant execute on function public.dashboard_stats_for_role(text) to authenticated;

-- Not revoked here, and why:
--
-- - `user_has_role(uuid, text)`, `user_has_any_role(uuid, text[])`,
--   `is_ticket_requester`, `is_ticket_assignee`, `is_rm_ticket_requester`,
--   `is_rm_ticket_assignee` and `is_student_in_effective_scope` are evaluated
--   inside RLS policies that can run as `anon` on the public ticket intake path,
--   so removing the `anon` grant would break intake rather than close a hole.
-- - `sync_staff_roles_by_profile_id` is called by the account-admin edge function
--   over the service role.
--
-- `user_has_role` is still a weaker form of the same oracle and is left as-is
-- because it cannot be closed without touching intake. It is reported rather than
-- silently accepted.