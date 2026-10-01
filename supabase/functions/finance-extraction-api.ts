// /// <reference lib="deno.ns" />
// @ts-ignore
import { serve } from "https://deno.land/std/http/server.ts";
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type DenoGlobal = {
  env: {
    get(key: string): string | undefined;
  };
};

declare const Deno: DenoGlobal;

// Reads env vars from the host process without depending on @types/node,
// since edge function sources are typechecked without Node lib types.
const nodeEnv: Record<string, string | undefined> | undefined = (
  globalThis as { process?: { env?: Record<string, string | undefined> } }
).process?.env;

if (typeof Deno === "undefined") {
  (globalThis as { Deno?: DenoGlobal }).Deno = {
    env: {
      get: (key: string) => nodeEnv?.[key],
    },
  };
}

function safeEnv(...keys: string[]) {
  for (const key of keys) {
    try {
      const value = Deno.env.get(key);
      if (value) return value;
    } catch {
      return "";
    }
  }
  return "";
}

const SUPABASE_URL = safeEnv("SUPABASE_URL", "SUPABASE_INTERNAL_URL");
const SUPABASE_SERVICE_ROLE_KEY = safeEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_INTERNAL_SECRET_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Replaces the `uuid` package, which is not resolvable in the Deno edge runtime.
// Falls back when crypto.randomUUID is unavailable on the host runtime.
function createId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function jsonResponse(payload: unknown, status: number) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req: Request) => {
  try {
    const { pathname, searchParams } = new URL(req.url);

    if (pathname === "/start-job") {
      if (req.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return new Response("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", { status: 500 });
      }

      let jobData: unknown;
      try {
        jobData = await req.json();
      } catch {
        return new Response("Invalid JSON body", { status: 400 });
      }

      const jobId = createId();

      const { error } = await supabase
        .from("job_states")
        .insert([{ id: jobId, status: "queued", job_data: jobData }]);
      if (error) {
        return new Response("Failed to enqueue job: " + error.message, { status: 500 });
      }

      return jsonResponse({ jobId, status: "queued" }, 200);
    }

    if (pathname === "/job-status") {
      if (req.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }

      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return new Response("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", { status: 500 });
      }

      const jobId = searchParams.get("jobId");
      if (!jobId) return new Response("Missing jobId query", { status: 400 });

      const { data, error } = await supabase.from("job_states").select("*").eq("id", jobId).maybeSingle();
      if (error) {
        return new Response("Failed to read job state: " + error.message, { status: 500 });
      }
      if (!data) return new Response("Job not found", { status: 404 });

      return jsonResponse(data, 200);
    }

    return new Response("Not Found", { status: 404 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Internal Server Error: ${message}`, { status: 500 });
  }
});
