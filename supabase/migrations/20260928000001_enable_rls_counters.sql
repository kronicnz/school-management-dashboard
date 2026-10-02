-- Enable Row Level Security on three tables that the original schema scan flagged as
-- fully exposed to the anon and authenticated roles. None of these were introduced by
-- this work; they predate the finance intake pipeline.
--
-- incident_categories is a reference/lookup table: every authenticated user can read the
-- active categories (it is referenced from incidents and retention rules), but only the
-- behaviour-management writers may mutate it. The migration that owns that domain
-- (20260909000000_behaviour_management_privacy_rls.sql) already gates incident inserts,
-- updates and deletes behind role checks, so the categories table inherits the same
-- boundary by being read-only for everyone except admins.
--
-- ticket_number_counters and rm_ticket_number_counters are sequence state. They are
-- written exclusively by the security-definer functions next_ticket_number() and
-- next_rm_ticket_number(), which run with the function owner's privileges and bypass RLS.
-- Direct table access is therefore denied for all roles: the counters cannot be edited
-- through the client, which is what stops a request from resetting or leaking ticket
-- numbers.

alter table public.incident_categories enable row level security;

drop policy if exists "Authenticated users can read active incident categories" on public.incident_categories;
create policy "Authenticated users can read active incident categories"
  on public.incident_categories for select
  using (auth.uid() is not null and active);

drop policy if exists "Only admins may manage incident categories" on public.incident_categories;
create policy "Only admins may manage incident categories"
  on public.incident_categories for all
  using (public.is_access_admin(auth.uid()))
  with check (public.is_access_admin(auth.uid()));

alter table public.ticket_number_counters enable row level security;

drop policy if exists "No direct access to ticket number counters" on public.ticket_number_counters;
create policy "No direct access to ticket number counters"
  on public.ticket_number_counters for all
  using (false)
  with check (false);

alter table public.rm_ticket_number_counters enable row level security;

drop policy if exists "No direct access to rm ticket number counters" on public.rm_ticket_number_counters;
create policy "No direct access to rm ticket number counters"
  on public.rm_ticket_number_counters for all
  using (false)
  with check (false);