-- -----------------------------------------------------------------------------
-- Close the `user_has_role` / `user_has_any_role` anonymous role oracle
--
-- These are `SECURITY DEFINER` helpers that answer "does this profile hold role
-- X" for an arbitrary profile id passed by the caller. While they were granted to
-- `PUBLIC` and `anon`, an anonymous client could enumerate role assignments across
-- the whole staff directory.
--
-- The original blocker was that RLS policies still called them, so revoking
-- execution would have made policy evaluation raise a permission error instead of
-- denying. That dependency is now gone:
--
--   * `20260931500000_revoke_anon_capability_oracle.sql` moved capability checks
--     onto `has_permission` / `user_capabilities`, which do not use these.
--   * `20260931600000_retarget_incident_policies_to_capabilities.sql` and
--     `20260931700000_retarget_incident_comment_read_policy.sql` removed the last
--     policy call sites.
--
-- Verified against the live schema before writing this migration: no policy, view,
-- or other function body references either name, and no client code calls them.
-- `enforce_incident_mutation_rules` still mentions the name in its body, but it is
-- a trigger function invoked by the trigger machinery rather than by a role's RPC
-- path, so it is unaffected.
--
-- `authenticated` and `service_role` keep EXECUTE.
-- -----------------------------------------------------------------------------

revoke all on function public.user_has_role(uuid, text) from public, anon;
revoke all on function public.user_has_any_role(uuid, text[]) from public, anon;

grant execute on function public.user_has_role(uuid, text) to authenticated, service_role;
grant execute on function public.user_has_any_role(uuid, text[]) to authenticated, service_role;
