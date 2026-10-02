-- Reference only - do not apply.
--
-- Moved out of supabase/migrations/ on 2026-10-02. The CLI only applies files
-- named <timestamp>_name.sql, so this was never a migration; sitting in that
-- directory it read like one.
--
-- Ad-hoc inspection query for the profiles table shape.

SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' ORDER BY ordinal_position;
