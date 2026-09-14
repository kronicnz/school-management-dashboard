-- supabase/migrations/20260907_001_add_profile_columns.sql

-- Add missing columns to the profiles table
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists org_unit_path text;
alter table public.profiles add column if not exists updated_at timestamp with time zone;