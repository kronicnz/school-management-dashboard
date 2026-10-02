-- Close three RLS gaps found reviewing the migration history.
--
-- 1. public.finance_intake_drain_state never had row level security enabled. It
--    was the only table of roughly ninety in that state. Its contents are low
--    sensitivity, but `last_error` can carry internal detail, and write access
--    would let anyone zero `consecutive_failures` and silence the unattended
--    extraction alerting that this table exists to provide.
--
--    No policy is created, and that is the point: RLS with no policy denies
--    everything to anon and authenticated. Nothing needs it. Every read and write
--    goes through public.finance_intake_drain_queue() and the vault helpers,
--    which are SECURITY DEFINER owned by postgres and so bypass RLS, and the
--    drain function is already revoked from public. The finance-intake edge
--    function reaches it with the service role, which also bypasses RLS. No
--    browser client reads this table - the finance dashboard reports intake
--    health from the queue tables it is already allowed to see.
--
-- 2. public.handle_new_user() is SECURITY DEFINER without a pinned search_path.
--    It was the only one of 124 SECURITY DEFINER occurrences in the history
--    missing the pin. The risk was already low, since every object reference in
--    the body is schema-qualified, but the empty search_path costs nothing and
--    closes the shadowing vector for good.

-- ---------------------------------------------------------------------------
-- 1. Drain health state: enable RLS, grant no client policy
-- ---------------------------------------------------------------------------

alter table public.finance_intake_drain_state enable row level security;

comment on table public.finance_intake_drain_state is
  'Health of the scheduled finance intake queue drain. consecutive_failures is reset '
  'by a successful drain; once it reaches finance_intake_drain_failure_threshold() the '
  'drain raises, and pg_cron records the error in cron.job_run_details. Query this '
  'table to answer "is unattended extraction actually running". RLS is enabled with '
  'no policy: only the SECURITY DEFINER drain functions and the service role reach '
  'this row, and no anon or authenticated role can read or write it.';

-- Belt and braces alongside the RLS. Default privileges on this project grant
-- table access to the client roles, so the grants are revoked explicitly rather
-- than relying on the absence of a policy to be the only thing in the way. If
-- either statement is a no-op because a grant was never made, that is fine.
revoke all on table public.finance_intake_drain_state from anon;
revoke all on table public.finance_intake_drain_state from authenticated;

-- A policy left behind by a future edit would quietly reopen this, so the
-- migration states the intent rather than only closing the door. Drops any
-- policy on this table before the table is locked down.
do $$
declare
  policy_name text;
begin
  for policy_name in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'finance_intake_drain_state'
  loop
    execute format('drop policy %I on public.finance_intake_drain_state', policy_name);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Pin the search_path on the signup trigger
-- ---------------------------------------------------------------------------

-- Safe with an empty search_path: the body references public.profiles in full
-- and otherwise only touches NEW and built-ins.
alter function public.handle_new_user() set search_path = '';
