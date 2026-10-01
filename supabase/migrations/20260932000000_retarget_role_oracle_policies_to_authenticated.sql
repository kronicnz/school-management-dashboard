-- -----------------------------------------------------------------------------
-- Retarget role-oracle RLS policies from `public` to `authenticated`
--
-- `20260931500000_revoke_anon_capability_oracle.sql` revoked `anon` and `PUBLIC`
-- execution on the role and capability oracles (`is_access_admin`, `is_it_admin`,
-- `finance_can_view`, `can_access_ticket`, and the rest of that list). It did not
-- retarget the policies that call them, and 75 policies on 39 tables were still
-- `TO public`.
--
-- Every one of those predicates is a role check against `auth.uid()`, which is null
-- for the `anon` role, so none of them could ever have granted an anonymous row.
-- Leaving them `TO public` only meant the `anon` role evaluated a function it no
-- longer had permission to run, so policy evaluation raised
-- `permission denied for function ...` rather than denying the row.
--
-- These tables are internal staff, ticket, incident-configuration and finance
-- mirror data with no anonymous intake path: finance ingestion runs from a
-- scheduled edge function under `service_role`, and the finance intake tables are
-- gated by the same role oracles. Nothing here is reachable by an anonymous
-- client, so narrowing the policies does not remove a public entry point.
--
-- The retarget is deliberately narrow. It only rewrites a policy when that policy
-- both is `TO public` and actually calls one of the revoked oracles, detected
-- server-side with `position(fn || '(' ...)`. Any genuinely public policy that
-- does not call these functions is left untouched.
--
-- Predicates are copied verbatim from `pg_policies` rather than retyped, and both
-- `USING` and `WITH CHECK` are emitted for `UPDATE` so the stored expressions stay
-- byte-identical to what was there before.
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
  using_clause text;
  check_clause text;
  rewritten integer := 0;
begin
  for r in
    select p.tablename, p.policyname, p.cmd, p.permissive, p.roles,
           coalesce(p.qual, '') as qual,
           coalesce(p.with_check, '') as wc
    from pg_policies p
    where p.schemaname = 'public'
      and p.roles @> ARRAY['public']::name[]
      and exists (
        select 1
        from unnest(array[
          'has_permission(', 'user_capabilities(', 'is_access_admin(',
          'is_it_admin(', 'is_it_staff(', 'is_rm_admin(', 'is_rm_operator(',
          'is_rm_leadership(', 'is_rm_property_manager(',
          'is_counsellor_or_leadership(', 'finance_can_view(',
          'finance_can_manage(', 'can_access_ticket(', 'can_access_rm_ticket(',
          'assign_ticket(', 'assign_rm_ticket(', 'dashboard_stats_for_role('
        ]) as needle(fn)
        where position(needle.fn in (coalesce(p.qual,'') || ' ' || coalesce(p.with_check,''))) > 0
      )
    order by p.tablename, p.policyname
  loop
    if r.permissive <> 'PERMISSIVE' then
      raise exception 'unexpected restrictive policy % on %', r.policyname, r.tablename;
    end if;

    using_clause := case when r.cmd in ('SELECT', 'UPDATE', 'ALL') and r.qual <> ''
                         then ' using (' || r.qual || ')' else '' end;
    check_clause := case when r.cmd in ('INSERT', 'UPDATE', 'ALL') and r.wc <> ''
                         then ' with check (' || r.wc || ')' else '' end;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute format(
      'create policy %I on public.%I for %s to authenticated%s%s',
      r.policyname, r.tablename, r.cmd, using_clause, check_clause
    );
    rewritten := rewritten + 1;
  end loop;

  if rewritten <> 75 then
    raise exception 'expected to retarget 75 policies, retargeted %', rewritten;
  end if;
end $$;
