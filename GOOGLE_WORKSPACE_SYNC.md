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
GOOGLE_ACCESS_TOKEN=<your-service-account-access-token>
```

Or use OAuth2 client credentials:

```
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_REFRESH_TOKEN=<your-refresh-token>
```

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
