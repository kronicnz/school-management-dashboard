-- SUPERSEDED. Reference only - do not apply.
--
-- Moved out of supabase/migrations/ on 2026-10-02. The CLI only applies files
-- named <timestamp>_name.sql, so this was never a migration; sitting in that
-- directory it read like one that was still pending.
--
-- Both policies already exist, created by 20260907000000_create_profiles_table.sql,
-- so running this would fail on the duplicate name rather than do anything.
--
-- Note the anon insert policy if this is ever revived deliberately: the profile
-- row is created by the on_auth_user_created trigger instead, which runs as the
-- definer. Granting anon a direct insert path onto profiles is a way to write
-- rows the trigger did not create, so it should not be reintroduced on the
-- strength of this snippet alone.

CREATE POLICY "Allow anon to insert profiles" ON profiles FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow authenticated to insert own profile" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
