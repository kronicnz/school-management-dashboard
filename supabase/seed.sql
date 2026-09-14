-- Seed file for public.profiles
-- Run with `supabase db seed`

-- This file seeds the profiles table for local development.
-- Set these values before running:
--   DO $$ BEGIN INSERT INTO public.profiles (id, email, full_name, org_unit_path, updated_at)
--   VALUES (gen_random_uuid(), 'admin@school.local', 'Admin User', 'grade-9', now())
--   ON CONFLICT (email) DO NOTHING; END $$;