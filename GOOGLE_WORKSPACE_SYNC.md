# Google Workspace Sync Setup

## Overview

This Supabase Edge Function syncs students from Google Workspace into the local `students` table.

## Prerequisites

1. Google Workspace Admin SDK enabled
2. Service account with domain-wide delegation
3. Supabase project with Edge Functions enabled

## Environment Variables

Set these in Supabase secrets (`supabase secrets set`):

```
GOOGLE_ACCESS_TOKEN=<your-access-token>
```

Or use OAuth2 client credentials in the root `.env.local`:

```
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_REFRESH_TOKEN=<your-refresh-token>
```

The sync function accepts either `GOOGLE_ACCESS_TOKEN` or the OAuth client + refresh-token trio.
It also accepts `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` as the client secret alias used by local auth setup.
When running locally, the function reads only the repo-root `.env.local`.

Assets sync also needs the ChromeOS device scope, so the Workspace token must include both `admin.directory.user.readonly` and `admin.directory.device.chromeos.readonly`.

## Finance Intake Gmail Access

The finance intake function uses Gmail labels and message reads. It needs a refresh token minted with Gmail scopes, not the normal login token.
Use `node get-finance-google-token.cjs` to mint and persist the finance-specific token.

Set these for finance intake:

```
FINANCE_GOOGLE_CLIENT_ID=<your-client-id>
FINANCE_GOOGLE_CLIENT_SECRET=<your-client-secret>
FINANCE_GOOGLE_REFRESH_TOKEN=<your-gmail-scoped-refresh-token>
```

The finance intake function also accepts the `GOOGLE_*` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_*` aliases, but the finance-prefixed variables are preferred.
It refreshes access tokens from the refresh token first, so a stale `FINANCE_GOOGLE_ACCESS_TOKEN` will not override a newly rotated refresh token.

Do not reuse the Workspace sync refresh token for finance intake; the Gmail token must be minted with the mail scopes below.

Required Gmail scopes:

```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.modify
```

Create the token with a fresh OAuth consent flow using `access_type=offline` and `prompt=consent` so Google issues a Gmail-scoped refresh token.
If Google returns `invalid_grant`, the refresh token has been revoked, expired, or minted for the wrong client. Mint a new finance token and replace the stored refresh token.

## Database Migration

Run the migration to add the required columns:

```bash
supabase db push
```

Or execute the SQL in `supabase/migrations/20260907000002_add_google_workspace_columns.sql` directly.

## Manual Sync

Trigger the sync manually from the dashboard or via API:

```bash
curl -X POST 'https://<your-project>.supabase.co/functions/v1/google-workspace-sync' \
  -H 'Authorization: Bearer <your-anon-key>'
```

## Scheduled Sync (Optional)

Set up a cron job in Supabase to sync daily:

```bash
supabase cron create \
  --name "Daily Student Sync" \
  --schedule "0 6 * * *" \
  --command "POST /functions/v1/google-workspace-sync"
```

## Custom Attributes

The function expects the following custom attributes on Google Workspace users:

- `RoomNumber` - The room number for the student
- `YearGroup` - The year group (e.g., "Year 7", "Year 8")

Set these up in Google Workspace Admin > Directory > Users > User schema.
