/**
 * Caller authentication and authorization for the finance pipeline.
 *
 * The audit trail is only worth keeping if the "who" on each row is true. The
 * previous implementation took `actorId` from the request body, which any caller
 * could set to any value, so the log recorded who the caller *claimed* to be.
 * Actor identity is now derived exclusively from a verified access token, and a
 * request that carries no verified identity is refused rather than downgraded to
 * an anonymous write.
 *
 * Two principals are recognised:
 *   - a signed-in finance user, identified by their Supabase access token
 *   - the scheduler, identified by presenting the service role key
 *
 * The scheduler path exists because `pg_cron` promotes due retries in the
 * database and needs to hand the resulting work to a worker without a browser
 * tab. It is deliberately narrow: only a bounded drain, never an arbitrary
 * action, and only when the request presents the exact service role key.
 */

/** Roles that may read finance data. Mirrors finance_can_view() in Postgres. */
export const FINANCE_VIEW_ROLES = ["site_admin", "finance_admin", "finance_read_only", "board_member"] as const;

/** Roles that may write finance data. Mirrors finance_can_manage() in Postgres. */
export const FINANCE_MANAGE_ROLES = ["site_admin", "finance_admin"] as const;

/**
 * Which permission each action requires.
 *
 * Every action on this function mutates finance state - there is no read action
 * yet - so all of them require manage. A board member has view access and can
 * read the finance mirror through the REST API, but cannot ingest, correct, or
 * post a bill. Keeping the list explicit means adding a future read-only action
 * is a deliberate decision rather than an accident.
 */
const ACTION_PERMISSION: Record<string, "view" | "manage" | "scheduler"> = {
  enqueue: "manage",
  process: "manage",
  sync_gmail: "manage",
  post_xero: "manage",
  record_edit: "manage",
  reprocess: "manage",
  // Server-to-server queue drain. Never reachable from a browser session.
  drain_queue: "scheduler",
};

export type FinanceAction = keyof typeof ACTION_PERMISSION;

export interface FinanceCaller {
  kind: "user" | "scheduler";
  userId: string | null;
  email: string | null;
  label: string;
  roles: string[];
  canView: boolean;
  canManage: boolean;
}

interface AuthClient {
  auth: {
    getUser(token: string): Promise<{ data: { user: { id: string; email?: string | null } | null }; error: { message: string } | null }>;
  };
  from(table: string): any;
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

/**
 * Constant-time-ish string comparison.
 *
 * A plain `===` on a secret leaks its length and prefix through timing. This is
 * not a defence against a determined attacker with network access, but it costs
 * nothing and removes the obvious version of the attack.
 */
function secretsMatch(candidate: string, expected: string): boolean {
  if (!expected || candidate.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < candidate.length; i++) {
    diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export class FinanceAuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "FinanceAuthError";
    this.status = status;
  }
}

/**
 * Resolves the caller from the request's Authorization header.
 *
 * Throws FinanceAuthError rather than returning null so the caller cannot
 * accidentally proceed with an unverified identity; `requirePermission` is the
 * only supported way to use the result.
 */
export async function resolveCaller(req: Request, supabase: AuthClient): Promise<FinanceCaller> {
  const token = readBearerToken(req);
  if (!token) {
    throw new FinanceAuthError(
      "Missing Authorization header. Sign in and retry.",
      401,
    );
  }

  const serviceKey = supabaseEnv("SUPABASE_SERVICE_ROLE_KEY") ?? supabaseEnv("SUPABASE_INTERNAL_SECRET_KEY") ?? "";

  // The scheduler principal is matched first so a legitimate drain is not
  // handed to getUser(), which would reject a service key as an invalid user JWT.
  if (serviceKey && secretsMatch(token, serviceKey)) {
    return {
      kind: "scheduler",
      userId: null,
      email: null,
      label: "Finance scheduler",
      roles: [],
      canView: true,
      canManage: true,
    };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    throw new FinanceAuthError("Invalid or expired session. Sign in and retry.", 401);
  }

  const userId = data.user.id;

  const [rolesResult, profileResult] = await Promise.all([
    supabase
      .from("user_roles")
      .select("role")
      .eq("profile_id", userId)
      .eq("active", true),
    supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  const roles: string[] = (rolesResult.data ?? [])
    .map((row: { role: string }) => String(row.role))
    .filter(Boolean);

  const profile = profileResult.data as { full_name?: string | null; email?: string | null } | null;
  const label = profile?.full_name?.trim() || data.user.email || userId;

  return {
    kind: "user",
    userId,
    email: profile?.email ?? data.user.email ?? null,
    label,
    roles,
    canView: roles.some((role) => (FINANCE_VIEW_ROLES as readonly string[]).includes(role)),
    canManage: roles.some((role) => (FINANCE_MANAGE_ROLES as readonly string[]).includes(role)),
  };
}

/**
 * Asserts the caller may perform an action, or throws with the right status.
 *
 * A scheduler token is refused for any action other than the queue drain: a
 * leaked service key is catastrophic, and the drain is the only thing that
 * genuinely needs it.
 */
export function requirePermission(caller: FinanceCaller, action: string): void {
  const required = ACTION_PERMISSION[action];
  if (!required) {
    throw new FinanceAuthError(`Unsupported action: ${action}`, 400);
  }

  if (required === "scheduler" && caller.kind === "user") {
    throw new FinanceAuthError(
      `"${action}" may only be invoked by the server-side scheduler.`,
      403,
    );
  }

  if (required !== "scheduler" && caller.kind === "scheduler") {
    throw new FinanceAuthError(
      `The scheduler token may not perform "${action}".`,
      403,
    );
  }

  if (required === "manage" && !caller.canManage) {
    throw new FinanceAuthError(
      caller.roles.length > 0
        ? `Your role (${caller.roles.join(", ")}) cannot change finance records.`
        : "You do not have a finance role that allows changing finance records.",
      403,
    );
  }

  if (required === "view" && !caller.canView) {
    throw new FinanceAuthError("You do not have access to finance records.", 403);
  }
}

export function describeActionPermission(action: string): string | null {
  return ACTION_PERMISSION[action] ?? null;
}

// Small indirection so this module stays testable outside the Deno runtime,
// where the global Deno object is polyfilled by index.ts.
function supabaseEnv(key: string): string | undefined {
  try {
    const env = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno?.env;
    return env?.get(key);
  } catch {
    return undefined;
  }
}
