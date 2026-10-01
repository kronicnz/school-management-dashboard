-- -----------------------------------------------------------------------------
-- Close the remaining `anon` SECURITY DEFINER function surface
--
-- The Supabase linter flags every `SECURITY DEFINER` function that the `anon` role
-- can reach over `/rest/v1/rpc/...`. Because these functions run as their owner,
-- anonymous callers can read and mutate data that RLS would otherwise deny, so the
-- grants were worth closing.
--
-- The blocker for doing this earlier was that revoking `anon` from a function which
-- a still-`TO public` RLS policy calls turns a clean denial into a
-- `permission denied for function ...` error. That dependency is now fully
-- removed:
--
--   * `20260931500000` ... `20260931800000` moved capability and role checks onto
--     closed oracles and revoked the role oracle.
--   * `20260931900000` and `20260932000000` retargeted every policy that calls
--     those oracles from `public` to `authenticated`.
--
-- Verified against the live schema before writing this: zero `TO public` policies
-- remain that reference a function `anon` cannot execute, so no policy evaluation
-- can break. Every edge function in `supabase/functions` connects with
-- `SUPABASE_SERVICE_ROLE_KEY`, and the finance drain is driven by the scheduler
-- principal, so no anonymous client path depends on these grants.
--
-- Trigger functions (`log_*`, `set_*_defaults`, `next_*_number`, `guard_*`) are
-- included for tidiness: PostgreSQL does not check EXECUTE when firing a trigger,
-- so revoking them cannot affect trigger behaviour.
--
-- `authenticated` and `service_role` retain EXECUTE on everything. The capability
-- and role oracles are excluded from the sweep because they were already narrowed
-- deliberately by the earlier migrations and rewriting their ACLs here would only
-- add churn.
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
  processed integer := 0;
begin
  for r in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and (
        p.proacl is null
        or p.proacl @> ARRAY['=X/postgres']::aclitem[]
        or p.proacl @> ARRAY['anon=X/postgres']::aclitem[]
      )
      and p.proname not in (
        'has_permission', 'user_capabilities',
        'is_access_admin', 'is_it_admin', 'is_it_staff', 'is_rm_admin',
        'is_rm_operator', 'is_rm_leadership', 'is_rm_property_manager',
        'is_counsellor_or_leadership', 'finance_can_view', 'finance_can_manage',
        'can_access_ticket', 'can_access_rm_ticket', 'assign_ticket',
        'assign_rm_ticket', 'dashboard_stats_for_role',
        'user_has_role', 'user_has_any_role'
      )
    order by p.proname, p.oid
  loop
    execute format('revoke all on function %s from public, anon', r.signature);
    execute format('grant execute on function %s to authenticated, service_role', r.signature);
    processed := processed + 1;
  end loop;

  if processed <> 58 then
    raise exception 'expected to revoke 58 functions, revoked %', processed;
  end if;
end $$;
