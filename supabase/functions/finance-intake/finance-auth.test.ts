import { strict as assert } from "node:assert"
import {
  FINANCE_MANAGE_ROLES,
  FINANCE_VIEW_ROLES,
  FinanceAuthError,
  describeActionPermission,
  requirePermission,
  resolveCaller,
  type FinanceCaller,
} from "./auth.ts"

// Builds a fake supabase client whose getUser / table lookups are scripted.
function fakeSupabase(options: {
  tokenIsValid?: boolean
  roles?: string[]
  fullName?: string | null
  email?: string | null
  userId?: string
}) {
  // The `in` checks let a test pass an explicit null, which the `??` default would
  // otherwise swallow and hide the fallback the test is trying to exercise.
  const email = "email" in options ? (options.email ?? null) : "a@b.c"
  const fullName = "fullName" in options ? (options.fullName ?? null) : null
  const userId = options.userId ?? "user-1"

  const calls: string[] = []
  return {
    calls,
    client: {
      auth: {
        getUser: async (token: string) => {
          calls.push(`getUser:${token}`)
          if (options.tokenIsValid === false) {
            return { data: { user: null }, error: { message: "invalid" } }
          }
          return { data: { user: { id: userId, email } }, error: null }
        },
      },
      from: (table: string) => {
        calls.push(`from:${table}`)
        const builder: any = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({ data: table === "profiles" ? { full_name: fullName, email } : null, error: null }),
          then: (resolve: (value: any) => unknown) =>
            resolve({
              data: table === "user_roles" ? (options.roles ?? []).map((role) => ({ role })) : null,
              error: null,
            }),
        };
        return builder;
      },
    } as any,
  };
}

function requestWith(token?: string): Request {
  return new Request("http://localhost/finance-intake", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

function callerFor(roles: string[]): FinanceCaller {
  return {
    kind: "user",
    userId: "user-1",
    email: "a@b.c",
    label: "Test User",
    roles,
    canView: roles.some((role) => (FINANCE_VIEW_ROLES as readonly string[]).includes(role)),
    canManage: roles.some((role) => (FINANCE_MANAGE_ROLES as readonly string[]).includes(role)),
  };
}

const scheduler: FinanceCaller = {
  kind: "scheduler",
  userId: null,
  email: null,
  label: "Finance scheduler",
  roles: [],
  canView: true,
  canManage: true,
}

// --- Authentication ------------------------------------------------------------

Deno.test("a request with no Authorization header is refused", async () => {
  const { client } = fakeSupabase({});
  await assert.rejects(
    () => resolveCaller(requestWith(), client),
    (error: unknown) => error instanceof FinanceAuthError && error.status === 401,
  )
})

Deno.test("an invalid session is refused with 401", async () => {
  const { client } = fakeSupabase({ tokenIsValid: false });
  await assert.rejects(
    () => resolveCaller(requestWith("bad.jwt.token"), client),
    (error: unknown) => error instanceof FinanceAuthError && error.status === 401,
  )
})

Deno.test("a valid session resolves the caller and their finance roles", async () => {
  const { client } = fakeSupabase({ roles: ["finance_admin"], fullName: "Alex Finance" });
  const caller = await resolveCaller(requestWith("valid.jwt"), client);

  assert.equal(caller.kind, "user")
  assert.equal(caller.userId, "user-1")
  assert.equal(caller.label, "Alex Finance")
  assert.deepEqual(caller.roles, ["finance_admin"])
  assert.equal(caller.canManage, true)
  assert.equal(caller.canView, true)
})

Deno.test("the caller's label falls back through full name, email, then id", async () => {
  const byEmail = await resolveCaller(requestWith("t"), fakeSupabase({ fullName: null, email: "x@y.z" }).client)
  assert.equal(byEmail.label, "x@y.z")

  const byId = await resolveCaller(requestWith("t"), fakeSupabase({ fullName: null, email: null, userId: "user-9" }).client)
  assert.equal(byId.label, "user-9")
})

Deno.test("the caller's roles and name are read from the database, not the token", async () => {
  const { client, calls } = fakeSupabase({ roles: ["board_member"] });
  const caller = await resolveCaller(requestWith("t"), client);
  assert.ok(calls.includes("from:user_roles"))
  assert.ok(calls.includes("from:profiles"))
  assert.deepEqual(caller.roles, ["board_member"])
})

// --- Authorization -------------------------------------------------------------

Deno.test("a finance admin may run every interactive action", () => {
  const caller = callerFor(["finance_admin"])
  for (const action of ["enqueue", "process", "sync_gmail", "post_xero", "record_edit"]) {
    assert.doesNotThrow(() => requirePermission(caller, action), `${action} should be allowed for finance_admin`)
  }
})

Deno.test("a site admin may run every interactive action", () => {
  const caller = callerFor(["site_admin"])
  assert.doesNotThrow(() => requirePermission(caller, "post_xero"))
})

Deno.test("a read-only finance role may not change finance records", () => {
  const caller = callerFor(["finance_read_only"])
  assert.equal(caller.canView, true)
  assert.equal(caller.canManage, false)
  for (const action of ["enqueue", "process", "sync_gmail", "post_xero", "record_edit"]) {
    assert.throws(
      () => requirePermission(caller, action),
      (error: unknown) => error instanceof FinanceAuthError && error.status === 403,
      `${action} must be refused for finance_read_only`,
    )
  }
})

Deno.test("a board member may not change finance records", () => {
  const caller = callerFor(["board_member"])
  assert.equal(caller.canView, true)
  assert.throws(() => requirePermission(caller, "post_xero"), FinanceAuthError)
  assert.throws(() => requirePermission(caller, "record_edit"), FinanceAuthError)
})

Deno.test("a user with no finance role is refused", () => {
  const caller = callerFor(["teacher"])
  assert.equal(caller.canView, false)
  assert.throws(
    () => requirePermission(caller, "enqueue"),
    (error: unknown) => error instanceof FinanceAuthError && error.status === 403,
  )
})

Deno.test("the error names the roles the caller actually holds", () => {
  assert.throws(
    () => requirePermission(callerFor(["board_member"]), "post_xero"),
    (error: unknown) => error instanceof FinanceAuthError && error.message.includes("board_member"),
  )
})

Deno.test("an unknown action is rejected as a bad request, not a permission failure", () => {
  assert.throws(
    () => requirePermission(callerFor(["site_admin"]), "delete_everything"),
    (error: unknown) => error instanceof FinanceAuthError && error.status === 400,
  )
})

// --- Scheduler principal -------------------------------------------------------

Deno.test("a user session may not invoke the scheduler-only drain", () => {
  assert.throws(
    () => requirePermission(callerFor(["site_admin"]), "drain_queue"),
    (error: unknown) => error instanceof FinanceAuthError && error.status === 403,
  )
})

Deno.test("the scheduler may drain the queue but may not post to Xero", () => {
  assert.doesNotThrow(() => requirePermission(scheduler, "drain_queue"))
  // A leaked service key should not be able to move money.
  assert.throws(
    () => requirePermission(scheduler, "post_xero"),
    (error: unknown) => error instanceof FinanceAuthError && error.status === 403,
  )
  assert.throws(() => requirePermission(scheduler, "record_edit"), FinanceAuthError)
  assert.throws(() => requirePermission(scheduler, "sync_gmail"), FinanceAuthError)
})

Deno.test("the action permission map is explicit about what each action needs", () => {
  assert.equal(describeActionPermission("post_xero"), "manage")
  assert.equal(describeActionPermission("record_edit"), "manage")
  assert.equal(describeActionPermission("drain_queue"), "scheduler")
  assert.equal(describeActionPermission("not_an_action"), null)
})
