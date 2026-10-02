-- -----------------------------------------------------------------------------
-- Retarget counsellor/leadership RLS policies from `public` to `authenticated`
--
-- `20260931500000_revoke_anon_capability_oracle.sql` removed `anon` execution on
-- `is_counsellor_or_leadership`. Twelve incident policies still referenced that
-- function while remaining `TO public`, so the `anon` role was left evaluating a
-- policy it could no longer execute: policy evaluation raised
-- `permission denied for function is_counsellor_or_leadership` instead of denying
-- the row.
--
-- The change is behaviour-preserving for every signed-in user, because the
-- function is only ever true for `counsellor` and `site_admin` and both already
-- hold `authenticated`. For `anon` the policies were already non-functional, and
-- the result changes from an error to a clean denial.
--
-- The policies are rewritten programmatically from their stored expressions so the
-- predicates are copied verbatim rather than retyped.
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
  using_clause text;
  check_clause text;
begin
  for r in
    select tablename, policyname, cmd, permissive, roles,
           coalesce(qual, '') as qual,
           coalesce(with_check, '') as wc
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
            ilike '%is_counsellor_or_leadership%'
      and roles = '{public}'
    order by tablename, policyname
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
  end loop;
end $$;
