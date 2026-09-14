# School Management System - Asset Plan

## Overview
React + Supabase application for school administration. Handles auth (email/password + Google OAuth), user profiles stored in `public.profiles`, and provides a sandbox interface for testing auth flows.

## Core Components

### Frontend (src/App.tsx)
- **Auth state management**: Supabase session subscriptions, boot sequence, refresh
- **Sign-in flows**: Email/password, Google OAuth redirect, sign-out
- **Profile lifecycle**: Auto-create missing profile rows from `user_metadata`, lookup by email
- **UI components**: StatusPill, InfoCard, AlertBanner, DetailPanel
- **Session summary**: User email, provider, expiry, profile status

### Backend (Supabase)
- **Database**: `public.profiles` table with columns: `id`, `email`, `full_name`, `org_unit_path`, `updated_at`
- **Auth configuration**: Google OAuth (client_id in config.toml:419), JWT expiry 3600s, rate limits
- **Storage**: Enabled with 50MiB file size limit, S3 protocol support
- **Realtime**: Enabled for live updates

## Data Flow

1. **Boot**: `initializeSession()` fetches initial session → sets `authEvent` to `INITIAL_SESSION`
2. **Auth state changes**: `onAuthStateChange` subscription updates session + status
3. **Profile load**: On session establishment, `loadProfile()` checks `profiles` table by email
4. **Profile auto-create**: If no row exists, inserts minimal profile from `session.user.user_metadata.full_name`/`name`
5. **Sign-in**: `handleEmailSignIn`/`handleGoogleSignIn` → Supabase auth → profile load triggers
6. **Sign-out**: `handleSignOut` → clears profile + session

## Configuration Points

### supabase/config.toml
- `[auth.google]`: enabled=true, client_id, secret via env, redirect_uri to port 54321
- `[auth]`: site_url=http://localhost:5173, additional_redirect_urls=[http://localhost:5173]
- `[db]`: port=54322, major_version=17, pooler enabled=false
- `[realtime]`: enabled=true
- `[storage]`: file_size_limit=50MiB, s3_protocol enabled=true

### Environment variables (Vite)
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_APP_URL` (default: window.location.origin)

## Database Schema (public.profiles)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key, references auth.users(id) |
| email | text | Unique, from auth.user.email |
| full_name | text | Nullable, from user_metadata or manual entry |
| org_unit_path | text | Nullable (e.g., grade level, department) |
| updated_at | timestamp | Auto-updated |

## Integration Points

1. **Google OAuth**: Redirect to `appOrigin` (localhost:5173), callback handled by Supabase
2. **Session persistence**: Supabase client stores token in browser localStorage/cookies
3. **Profile sync**: Manual `handleCheckProfile` button + auto-create on profile load
4. **Storage**: Future use for student documents, attachments

## Open Questions / Enhancements

1. **org_unit_path purpose**: Currently stored as `null` — define whether this maps to grade levels, homerooms, or administrative units
2. **Profile update flow**: No UI currently exists to edit profile after creation — consider adding edit functionality
3. **Error handling**: Profile auto-create failure message could guide users to run a database function
4. **Rate limiting**: Config.toml sets sign_in_sign_ups=30 per 5min — verify aligns with expected usage
5. **Additional auth providers**: Apple, Auth0, AWS Cognito are disabled — evaluate if needed
6. **Network restrictions**: Currently allow all IPs (0.0.0.0/0) — restrict for production

## Validation Steps

1. Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set
2. Confirm Google OAuth client_id matches Supabase project console
3. Test email/password sign-in with a test user
4. Test Google OAuth flow end-to-end
5. Verify profile auto-creation on first sign-in
6. Test session restore after page refresh
7. Test sign-out and re-sign-in preserves profile
8. Check Supabase Studio tables reflect correct schema