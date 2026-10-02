-- Scheduled queue drain.
--
-- The previous migration promoted due retries from 'retrying' back to 'queued' on a
-- cron schedule, but nothing consumed them: only a finance user opening the dashboard
-- triggered an extraction pass. A retry whose backoff elapsed at 2am sat queued until
-- someone looked at the screen the next morning, which is the exact failure the
-- scheduled drain was introduced to remove.
--
-- This closes that gap by having cron invoke the edge function with the scheduler-only
-- 'drain_queue' action, which reuses the same worker path as the interactive
-- 'process' action.
--
-- The blast radius of a leaked drain credential is deliberately small: in
-- auth.ts the scheduler principal is refused 'post_xero', 'sync_gmail', and
-- 'record_edit'. A stolen drain key can re-run extraction on items that are already
-- queued, and nothing else. It cannot move money, mail the supplier, or forge an
-- audit row attributing an edit to a person.

-- ---------------------------------------------------------------------------
-- Provisioning (required once per environment, not part of the migration)
-- ---------------------------------------------------------------------------
--
-- The drain stays inert until a credential is present. Nothing is hardcoded here,
-- and no migration creates the secret, because the value is environment-specific
-- and this repository must not carry it.
--
-- Insert the SAME value the running function sees as SUPABASE_SERVICE_ROLE_KEY:
--
--   select vault.create_secret(
--     '<SUPABASE_SERVICE_ROLE_KEY for this environment>',
--     'finance_intake_drain_key',
--     'Scheduler credential for the finance intake queue drain.'
--   );
--
-- To check it took effect:
--
--   select public.finance_intake_drain_queue();   -- 'queued drain as net request N'
--   select status_code, content from net._http_response order by id desc limit 1;
--
-- Expect 200 and {"ok":true,...}. A 401 means the stored key does not match the
-- function's env; a 403 on any other action is the intended boundary holding.
--
-- For a hosted environment, also set the function URL:
--
--   select vault.create_secret(
--     'https://<project-ref>.supabase.co/functions/v1/finance-intake',
--     'finance_intake_function_url',
--     'Edge function base URL for the finance intake drain.'
--   );
--
-- The local stack default is already correct and needs no secret.

create extension if not exists pg_net;

-- Reads the scheduler credential and the function base URL from vault so neither is
-- hardcoded in the repository. Returns null when unprovisioned, which the caller
-- treats as "skip this tick" rather than an error.
create or replace function public.finance_intake_drain_secret()
returns text
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare
  secret text;
begin
  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'finance_intake_drain_key'
  limit 1;

  return nullif(secret, '');
exception
  when others then
    -- A vault read failure must not abort the cron tick; the alternative is a
    -- broken schedule that also stops the retry promotion job if they share a run.
    return null;
end;
$$;

create or replace function public.finance_intake_function_url()
returns text
language plpgsql
stable
as $$
declare
  url text;
begin
  select decrypted_secret into url
  from vault.decrypted_secrets
  where name = 'finance_intake_function_url'
  limit 1;

  -- Local stack default. Overridden per environment via the vault secret above.
  return coalesce(nullif(url, ''), 'http://kong:8000/functions/v1/finance-intake');
end;
$$;

-- ---------------------------------------------------------------------------
-- Escalate instead of skipping
-- ---------------------------------------------------------------------------
--
-- A drain that quietly returns "skipped" is indistinguishable from an idle queue.
-- Two real misconfigurations produce exactly that: no vault secret at all, and a
-- secret that is present but does not match the key the function sees (the 401
-- seen while building this). Both leave retries promoted-but-undrained indefinitely
-- with no error anywhere.
--
-- So the drain now records its outcome and raises once it has failed enough
-- consecutive times. pg_cron catches the exception and writes it to
-- cron.job_run_details, which turns a silent no-op into a queryable signal.

-- Consecutive failed ticks tolerated before escalating. At one tick per minute this
-- is roughly five minutes, which rides out a short provisioning or deploy window
-- without letting a genuine misconfiguration go unnoticed for long. Because each
-- tick reconciles the request fired by the one before it, a fault is observed one
-- tick after it happens, so the real worst case is closer to six minutes.
create or replace function public.finance_intake_drain_failure_threshold()
returns integer
language sql
immutable
as $$ select 5 $$;

create table if not exists public.finance_intake_drain_state (
  singleton boolean primary key default true check (singleton),
  consecutive_failures integer not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_error text,
  -- The request fired by the previous tick, reconciled at the start of this one.
  pending_request_id bigint,
  pending_since timestamptz
);

comment on table public.finance_intake_drain_state is
  'Health of the scheduled finance intake queue drain. consecutive_failures is reset '
  'by a successful drain; once it reaches finance_intake_drain_failure_threshold() the '
  'drain raises, and pg_cron records the error in cron.job_run_details. Query this '
  'table to answer "is unattended extraction actually running".';

insert into public.finance_intake_drain_state (singleton)
values (true)
on conflict (singleton) do nothing;

-- ---------------------------------------------------------------------------
-- Outcome handling
-- ---------------------------------------------------------------------------
--
-- Note the ordering in the failure path: the counter is READ first and the raise
-- happens BEFORE any write. This is deliberate.
--
-- pg_cron runs each job in its own transaction, and RAISE aborts that transaction.
-- A counter incremented and then raised in the same call would roll its own
-- increment back, so the count would stay at zero and the drain would never
-- escalate. Reading the committed count and raising before writing keeps the count
-- pinned at the threshold, so every subsequent tick raises again, while ticks below
-- the threshold commit their increment normally.
--
-- A successful drain resets the counter, so an outage that recovers does not leave
-- a stale count that escalates on the very next unrelated hiccup.

-- Fires the drain and reports the outcome. SECURITY DEFINER because the vault read
-- is restricted; the function is revoked from public so only cron (running as
-- postgres) can call it.
create or replace function public.finance_intake_drain_queue()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  key text;
  request_id bigint;
  failures integer;
  threshold integer;
  pending_id bigint;
  pending_at timestamptz;
  resp_status integer;
  resp_body text;
  error_text text;
begin
  threshold := coalesce(public.finance_intake_drain_failure_threshold(), 5);
  select consecutive_failures, pending_request_id, pending_since
  into failures, pending_id, pending_at
  from public.finance_intake_drain_state
  where singleton;

  failures := coalesce(failures, 0);

  ------------------------------------------------------------------
  -- Reconcile the request fired by the previous tick.
  ------------------------------------------------------------------
  -- net.http_post is asynchronous, and the edge function's cold start (Deno plus
  -- the Gemini and Xero modules) regularly takes longer than a few seconds. Waiting
  -- inline for the response was tried first and misfired: a drain that in fact
  -- returned 200 after 5.1s was recorded as a failure, which is worse than the
  -- silent no-op this change exists to fix.
  --
  -- Reconciling on the following tick costs no blocking time, lets a slow cold start
  -- finish, and keeps the cron worker free for the retry promotion job. A request
  -- still outstanding after the grace window is treated as a failure.
  if pending_id is not null then
    select status_code, content into resp_status, resp_body
    from net._http_response
    where id = pending_id;

    if found then
      if resp_status >= 200 and resp_status < 300 then
        update public.finance_intake_drain_state
        set consecutive_failures = 0,
            last_success_at = now(),
            last_error = null,
            pending_request_id = null,
            pending_since = null
        where singleton;
      else
        error_text := 'edge function returned ' || resp_status || ': ' || left(coalesce(resp_body, ''), 200);
        perform public.finance_intake_record_drain_failure(failures, threshold, error_text);
        update public.finance_intake_drain_state
        set pending_request_id = null, pending_since = null
        where singleton;
      end if;
    elsif pending_at is not null and pending_at < now() - interval '90 seconds' then
      error_text := 'net request ' || pending_id || ' produced no response within 90s';
      perform public.finance_intake_record_drain_failure(failures, threshold, error_text);
      update public.finance_intake_drain_state
      set pending_request_id = null, pending_since = null
      where singleton;
    end if;
  end if;

  ------------------------------------------------------------------
  -- Resolve the credential.
  ------------------------------------------------------------------
  key := public.finance_intake_drain_secret();

  if key is null then
    error_text := 'finance_intake_drain_key is not provisioned in vault';
    perform public.finance_intake_record_drain_failure(failures, threshold, error_text);
    return 'skipped (failure ' || (failures + 1) || '/' || threshold || '): ' || error_text;
  end if;

  ------------------------------------------------------------------
  -- Fire the drain and record the id for next tick to reconcile.
  ------------------------------------------------------------------
  select net.http_post(
    url     := public.finance_intake_function_url() || '/drain_queue',
    body    := jsonb_build_object(
      'action', 'drain_queue',
      'limit', 5
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- Both headers are required, and that is not redundancy. The stored key is a
      -- new-style 'sb_secret_' value. Kong validates `apikey` and, in response,
      -- rewrites Authorization to the legacy service-role JWT the function can
      -- actually match against SUPABASE_SERVICE_ROLE_KEY. Sending Authorization
      -- alone passes the raw secret straight through, which auth.ts then rejects
      -- as an invalid session - the drain would fail on every tick.
      'apikey', key,
      'Authorization', 'Bearer ' || key
    ),
    timeout_milliseconds := 5000
  ) into request_id;

  update public.finance_intake_drain_state
  set pending_request_id = request_id,
      pending_since = now()
  where singleton;

  return 'queued drain as net request ' || request_id;
end;
$$;

-- Single writer for the failure counter, kept separate so the ordering rule above is
-- expressed once: raise when the committed count has already reached the threshold,
-- otherwise record the failure and let the caller return quietly.
create or replace function public.finance_intake_record_drain_failure(
  failures integer,
  threshold integer,
  error_text text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if failures >= threshold then
    -- Deliberately raised before writing. See the ordering note in the caller.
    raise exception using
      errcode = 'P0001',
      message = format(
        'finance intake drain has failed %s consecutive times (threshold %s). Last error: %s. '
        'Retries are being promoted to queued but nothing is draining them. Re-provision '
        'the finance_intake_drain_key vault secret so it matches the SUPABASE_SERVICE_ROLE_KEY '
        'the running function sees.',
        failures, threshold, error_text
      ),
      detail = error_text;
  end if;

  update public.finance_intake_drain_state
  set consecutive_failures = failures + 1,
      last_failure_at = now(),
      last_error = error_text
  where singleton;
end;
$$;

revoke all on function public.finance_intake_drain_secret() from public;
revoke all on function public.finance_intake_drain_queue() from public;
revoke all on function public.finance_intake_record_drain_failure(integer, integer, text) from public;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'finance-intake-queue-drain') then
      perform cron.schedule(
        'finance-intake-queue-drain',
        '* * * * *',
        'select public.finance_intake_drain_queue()'
      );
    end if;
  end if;
exception
  when others then
    raise notice 'pg_cron drain schedule skipped: %', sqlerrm;
end $$;
