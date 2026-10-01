/**
 * Caller authentication for the account-admin function.
 *
 * Creating a login, granting roles, and revoking access are the three most
 * dangerous things this application can do, so the "who" on every audit row has to
 * be a verified identity rather than something the request body asserts. The
 * finance pipeline already settled this pattern (`finance-intake/auth.ts`): read
 * the bearer token, resolve it with `auth.getUser`, load roles from `user_roles`
 * with the service role, and refuse rather than downgrade.
 *
 * Modeled on the same file on purpose. Two things differ and both are deliberate:
 * there is no scheduler principal here (there is no server-to-server caller), and
 * there is exactly one permission level, because every action on this function
 * creates or destroys someone's access.
 */

/**
 * Managing logins requires the `access.manage` capability, resolved from the same
 * `role_permissions` matrix the database uses. This mirrors the SQL helper
 * `is_access_admin()`, which is now defined as `has_permission('access.manage')`.
 *
 * The matrix is read rather than imported so this function keeps no second copy
 * of the role-to-capability mapping; a change to the seed changes both layers.
 */
export const ACCESS_MANAGE_CAPABILITY = "access.manage";

export interface AccountCaller {
  userId: string;
  email: string | null;
  label: string;
  roles: string[];
  isAdmin: boolean;
}

interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
}

interface AuthClient {
  auth: {
    getUser(token: string): Promise<{
      data: { user: { id: string; email?: string | null } | null };
      error: { message: string } | null;
    }>;
  };
  from(table: string): any;
}

export class AccountAuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AccountAuthError";
    this.status = status;
  }
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

/**
 * Resolves the caller from the request's Authorization header.
 *
 * Roles are read from the database, not from the token, so a stale or forged claim
 * cannot widen what the caller may do. Date filtering matches the rest of the
 * codebase: `google-workspace-sync` and `send-incident-email` both honour
 * effective_from / effective_to, and a grant that starts next term must not count
 * as an admin role today.
 *
 * Throws rather than returning null, so a caller with no verified identity cannot
 * be mistaken for a verified one.
 */
export async function resolveCaller(
  req: Request,
  supabase: AuthClient,
  db: RpcClient,
): Promise<AccountCaller> {
  const token = readBearerToken(req);
  if (!token) {
    throw new AccountAuthError("Missing Authorization header. Sign in and retry.", 401);
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    throw new AccountAuthError("Invalid or expired session. Sign in and retry.", 401);
  }

  const userId = data.user.id;

  const [rolesResult, profileResult, permissionResult] = await Promise.all([
    supabase
      .from("user_roles")
      .select("role, effective_from, effective_to")
      .eq("profile_id", userId)
      .eq("active", true),
    supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle(),
    // Goes through the header-forwarding client, not the service client, so
    // this stays on the same path as every other role lookup in this function.
    db.rpc("has_permission", {
      p_user_id: userId,
      p_capability: ACCESS_MANAGE_CAPABILITY,
    }),
  ]);

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const roles: string[] = (rolesResult.data ?? [])
    .filter((row: { effective_from?: string | null; effective_to?: string | null }) =>
      (!row.effective_from || row.effective_from <= today) &&
      (!row.effective_to || row.effective_to >= today)
    )
    .map((row: { role: string }) => String(row.role))
    .filter(Boolean);

  const profile = profileResult.data as { full_name?: string | null; email?: string | null } | null;
  const email = profile?.email ?? data.user.email ?? null;

  return {
    userId,
    email,
    label: profile?.full_name?.trim() || data.user.email || userId,
    roles,
    // Falls back to false rather than trusting a role name: the RPC is the same
    // resolution the RLS policies use, including the grant date window.
    isAdmin: permissionResult.data === true,
  };
}

/**
 * Asserts the caller may manage logins, or throws with the right status.
 *
 * The error names the roles the caller actually holds, because "permission
 * denied" on an access screen is almost always a misconfiguration rather than an
 * attack, and the admin needs to know which role is missing.
 */
export function requireAccessAdmin(caller: AccountCaller): void {
  if (caller.isAdmin) return;

  throw new AccountAuthError(
    caller.roles.length > 0
      ? `Your role (${caller.roles.join(", ")}) cannot manage logins or role grants.`
      : "You do not have a role that allows managing logins or role grants.",
    403,
  );
}
