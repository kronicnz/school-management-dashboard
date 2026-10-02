// @ts-nocheck
// deno-lint-ignore-file
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { AccountAuthError, requireAccessAdmin, resolveCaller } from "./auth.ts"
import { runAction, type AccountAdminClients } from "./handlers.ts"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    status,
  })
}

function describeError(error: unknown): string {
  if (!error) return "Unknown error"
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object" && "message" in (error as Record<string, unknown>)) {
    return String((error as Record<string, unknown>).message)
  }
  return String(error)
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS })
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Only POST is supported." }, 405)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Missing Supabase configuration" }, 500)
  }

  // `verify_jwt = true` in config.toml already rejects anonymous callers at the
  // gateway. This re-check is the second lock: a gateway misconfiguration must not
  // silently turn this into an unauthenticated account-creation endpoint.
  const authHeader = req.headers.get("Authorization") ?? ""
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing authorization token" }, 401)
  }

  // Service role, no forwarded header. Used for auth.admin.* and for the direct
  // reads/writes the admin's own RLS policies would otherwise block.
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  })

  // Service role with the caller's token forwarded, so auth.uid() resolves to the
  // real admin for the role RPCs. See handlers.ts for why both are required.
  const db = createClient(supabaseUrl, serviceRoleKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  })

  let caller
  try {
    caller = await resolveCaller(req, service, db)
    requireAccessAdmin(caller)
  } catch (error) {
    if (error instanceof AccountAuthError) {
      return jsonResponse({ error: error.message }, error.status)
    }
    return jsonResponse({ error: "Could not verify the caller." }, 500)
  }

  let payload: Record<string, unknown>
  try {
    payload = (await req.json()) ?? {}
  } catch {
    return jsonResponse({ error: "Request body must be JSON." }, 400)
  }

  const appUrl = Deno.env.get("APP_URL") ?? Deno.env.get("VITE_APP_URL") ?? Deno.env.get("SITE_URL") ?? "http://localhost:5173"
  const clients: AccountAdminClients = { service, db, appUrl }

  try {
    const result = await runAction(payload, caller, clients)
    return jsonResponse(result.body, result.status)
  } catch (error) {
    console.error("account-admin: unhandled error", error)
    return jsonResponse({ error: describeError(error) }, 500)
  }
})
