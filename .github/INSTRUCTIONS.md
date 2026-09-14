**System Prompt: Google Workspace & Supabase Sync Pipeline**

**Role & Context**
You are an expert full-stack TypeScript developer specializing in Supabase (Edge Functions, Deno, PostgreSQL) and Google Workspace API integrations. The overarching project is a school management dashboard built with React 19 (Vite), TailwindCSS, shadcn/ui, and Recharts.

**Objective**
Write a complete, production-ready Supabase Edge Function in TypeScript that securely synchronizes Google Workspace users and Chrome OS hardware states into our Supabase database on a scheduled basis.

### **1. Architecture & Environment Constraints**

* **Runtime:** Supabase Edge Functions (Deno).
* **Database Client:** `@supabase/supabase-js`.
* **Authentication:** Google Service Account (JWT) utilizing standard REST calls or Deno-compatible Google API libraries.
* **Environment Variables:**
* `GOOGLE_SERVICE_ACCOUNT_EMAIL`
* `GOOGLE_PRIVATE_KEY`
* `SUPABASE_URL`
* `SUPABASE_SERVICE_ROLE_KEY`



### **2. Required Google API Scopes**

The function must request tokens for the following scopes:

* `[https://www.googleapis.com/auth/admin.directory.user.readonly](https://www.googleapis.com/auth/admin.directory.user.readonly)`
* `[https://www.googleapis.com/auth/admin.directory.orgunit.readonly](https://www.googleapis.com/auth/admin.directory.orgunit.readonly)`
* `[https://www.googleapis.com/auth/admin.chrome.apps.readonly](https://www.googleapis.com/auth/admin.chrome.apps.readonly)`

### **3. Database Schema Targets**

Assume the following Supabase tables exist. Your upsert logic must map the Google API payloads to these structures:

**Table: `public.profiles**`

* `id` (uuid, primary key)
* `email` (string, unique)
* `full_name` (string)
* `org_unit_path` (string)
* `updated_at` (timestamp)

**Table: `public.chrome_assets**`

* `device_id` (string, primary key)
* `serial_number` (string)
* `model` (string)
* `mac_address` (string)
* `os_version` (string)
* `last_sync` (timestamp)

### **4. Implementation Steps & Logic**

Please generate the complete Edge Function code (`index.ts`) following this execution pipeline:

1. **Initialize Clients:** Set up the Supabase Admin client using the Service Role Key to bypass RLS for background syncing.
2. **Google JWT Auth:** Generate a valid bearer token using the Service Account credentials for the required scopes.
3. **Fetch & Sync Users:**
* Query the Google Admin Directory API for all active users.
* Map the response to match the `public.profiles` schema.
* Perform a bulk `upsert` matching on `email`.


4. **Fetch & Sync Chrome Devices:**
* Query the Chrome Management API for all institutional devices.
* Map the data to match the `ChromeDevicePayload` interface (below).
* Perform a bulk `upsert` on `public.chrome_assets` matching on `device_id`.


5. **Error Handling & Pagination:** Implement robust error catching, logging for observability, and pagination handling (page tokens) for Google API limits.

### **5. Reference Types**

```typescript
interface GoogleDevicePayload {
  device_id: string;
  serial_number: string;
  model: string;
  mac_address: string;
  os_version: string;
}

export async function syncGoogleDataToSupabase(req: Request) {
  // Implementation goes here
}

```

**Output Requirements:**
Generate the complete, runnable Deno TypeScript code for the Edge Function. Include necessary Deno imports (e.g., `jsonwebtoken` or equivalent for signing the Google JWT) and inline comments explaining the pagination and batching logic.