-- -----------------------------------------------------------------------------
-- Retarget the last `TO public` policy that calls a closed function
--
-- `20260932100000_revoke_anon_security_definer_surface.sql` removed `anon` and
-- `PUBLIC` execution from 58 `SECURITY DEFINER` functions, including
-- `has_active_emergency_access`. The policy "Emergency grant incident read" on
-- `public.incidents` was still `TO public` and calls that function, so an
-- `anon` read of `incidents` started raising
--
--   permission denied for function has_active_emergency_access
--
-- instead of returning no rows. It only surfaced because the read probe covers
-- `incidents`; the equivalent checks against `rm_tickets`, `user_roles` and
-- `staff` still passed.
--
-- The policy is meaningless for `anon` in any case: it grants an incident to a
-- caller holding an emergency grant for that student, and
-- `has_active_emergency_access(auth.uid(), ...)` can never be true when
-- `auth.uid()` is null. Narrowing it to `authenticated` is behaviour-preserving
-- for every signed-in user and turns the `anon` failure back into a clean denial.
--
-- The predicate is copied from `pg_policies` rather than retyped.
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
  rewritten integer := 0;
begin
  for r in
    select p.tablename, p.policyname, p.cmd, p.permissive,
           coalesce(p.qual, '') as qual,
           coalesce(p.with_check, '') as wc
    from pg_policies p
    where p.schemaname = 'public'
      and p.roles @> ARRAY['public']::name[]
      and exists (
        select 1
        from pg_proc f
        join pg_namespace fn on fn.oid = f.pronamespace
        where fn.nspname = 'public'
          and position(f.proname || '(' in (coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''))) > 0
          and not (
            f.proacl is null
            or f.proacl @> ARRAY['=X/postgres']::aclitem[]
            or f.proacl @> ARRAY['anon=X/postgres']::aclitem[]
          )
      )
    order by p.tablename, p.policyname
  loop
    if r.permissive <> 'PERMISSIVE' then
      raise exception 'unexpected restrictive policy % on %', r.policyname, r.tablename;
    end if;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    execute format(
      'create policy %I on public.%I for %s to authenticated using (%s)',
      r.policyname, r.tablename, r.cmd, r.qual
    );
    rewritten := rewritten + 1;
  end loop;

  if rewritten <> 1 then
    raise exception 'expected to retarget 1 policy, retargeted %', rewritten;
  end if;
end $$;
