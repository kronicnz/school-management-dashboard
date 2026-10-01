import { strict as assert } from "node:assert"
import {
  AccountAuthError,
  requireAccessAdmin,
  resolveCaller,
  type AccountCaller,
} from "./auth.ts"
import {
  isDomainAllowed,
  normalizeEmail,
  normalizeGrants,
  runAction,
  type AccountAdminClients,
} from "./handlers.ts"

// A small chainable PostgREST stand-in. Every method records itself so a test can
// assert which client and which table a call went to, which is the whole point of
// the two-client design: a role grant that silently went through the service-role
// client would fail at runtime with insufficient_privilege.
interface Write {
  kind: "insert" | "update" | "upsert"
  table: string
  payload: any
  options?: any
}

function createBuilder(
  table: string,
  state: FakeState,
  selectResult: (filters: Record<string, any>) => any,
) {
  const builder: any = {}
  // The filter values are kept, not just the column names, so a fake can tell
  // "look up the caller's own profile" apart from "look up some other profile by
  // id" and answer each honestly. Column names alone collapse those into one case
  // and any test asserting on a by-id lookup then silently passes.
  const filters: Record<string, any> = {}
  let isSelect = false

  const chain = (method: string) => (column?: any, value?: any) => {
    state.calls.push(`${table}.${method}`)
    if (method === "eq" && typeof column === "string") filters[column] = value
    return builder
  }

  for (const method of ["eq", "ilike", "is", "in", "order", "limit", "or", "not"]) {
    builder[method] = chain(method)
  }

  builder.select = () => {
    isSelect = true
    state.calls.push(`${table}.select`)
    return builder
  }

  builder.insert = (payload: any) => {
    state.writes.push({ kind: "insert", table, payload })
    return builder
  }
  builder.update = (payload: any) => {
    state.writes.push({ kind: "update", table, payload })
    return builder
  }
  builder.upsert = (payload: any, options?: any) => {
    state.writes.push({ kind: "upsert", table, payload, options })
    return builder
  }

  // A write resolves to a null payload; only a select resolves to row data.
  builder.maybeSingle = async () => ({ data: selectResult(filters), error: null })
  builder.single = async () => ({ data: selectResult(filters), error: null })
  builder.then = (resolve: (value: any) => unknown, reject: (reason: any) => unknown) =>
    Promise.resolve({ data: isSelect ? selectResult(filters) : null, error: null }).then(resolve, reject)

  return builder
}

interface FakeState {
  calls: string[]
  writes: Write[]
  auth: {
    createdUsers: any[]
    invites: any[]
    bans: any[]
    listedUsers: number
  }
  rpc: { name: string; args: any }[]
}

interface FakeOptions {
  tokenValid?: boolean
  roles?: string[]
  roleWindows?: Record<string, { effective_from?: string | null; effective_to?: string | null }>
  fullName?: string | null
  email?: string | null
  allowedDomains?: string[]
  existingProfileId?: string | null
  existingRegistration?: { status: string; invited_at?: string | null } | null
  staffMatchId?: string | null
  createUserError?: string
  createUserId?: string
  inviteError?: string
  updateUserError?: string
  authUserId?: string | null
  rpcError?: string
}

function createFake(options: FakeOptions = {}) {
  const state: FakeState = {
    calls: [],
    writes: [],
    auth: { createdUsers: [], invites: [], bans: [], listedUsers: 0 },
    rpc: [],
  }

  // `profiles` serves two lookups: the caller's own row (filtered by id, used when
  // resolving who is calling) and a by-email lookup used by create_account.
  const tableResult = (table: string, filters: Record<string, any> = {}) => {
    if (table === "app_settings") return { allowed_email_domains: options.allowedDomains ?? [] }
    if (table === "user_roles") {
      return (options.roles ?? []).map((role) => ({
        role,
        effective_from: options.roleWindows?.[role]?.effective_from ?? null,
        effective_to: options.roleWindows?.[role]?.effective_to ?? null,
      }))
    }
    if (table === "profiles") {
      // By id. `admin-1` is the caller resolving their own row; any other id is a
      // lookup of a target account, which only exists if the fake was told about it.
      if (typeof filters.id === "string") {
        if (filters.id === "admin-1") {
          return { id: "admin-1", email: options.email ?? "admin@school.test", full_name: options.fullName ?? null }
        }
        if (options.existingProfileId && filters.id === options.existingProfileId) {
          return { id: options.existingProfileId, email: "new.staff@school.test", full_name: null }
        }
        return null
      }
      if (options.existingProfileId) {
        return { id: options.existingProfileId, email: "new.staff@school.test", full_name: null }
      }
      return null
    }
    if (table === "staff") return options.staffMatchId ? { id: options.staffMatchId } : null
    if (table === "account_registrations") {
      return options.existingRegistration
        ? { status: options.existingRegistration.status, invited_at: options.existingRegistration.invited_at ?? null }
        : null
    }
    return null
  }

  const service = {
    auth: {
      getUser: async (token: string) => {
        state.calls.push(`getUser:${token}`)
        if (options.tokenValid === false) {
          return { data: { user: null }, error: { message: "invalid" } }
        }
        return {
          data: { user: { id: "admin-1", email: "admin@school.test" } },
          error: null,
        }
      },
      admin: {
        createUser: async (attributes: any) => {
          state.auth.createdUsers.push(attributes)
          if (options.createUserError) {
            return { data: { user: null }, error: { message: options.createUserError } }
          }
          return { data: { user: { id: options.createUserId ?? "profile-new" } }, error: null }
        },
        inviteUserByEmail: async (email: string, options2: any) => {
          state.auth.invites.push({ email, ...options2 })
          if (options.inviteError) return { data: null, error: { message: options.inviteError } }
          // GoTrue will not send an invitation to an address that is already
          // confirmed. Modelled here because create_account creates the user and
          // then invites that same address: confirming it at creation made every
          // invitation fail, and a fake that allowed it hid that completely.
          const created = state.auth.createdUsers.find((user) => user.email === email)
          if (created?.email_confirm) {
            return { data: null, error: { message: "User already registered" } }
          }
          return { data: {}, error: null }
        },
        updateUserById: async (id: string, attributes: any) => {
          state.auth.bans.push({ id, ...attributes })
          if (options.updateUserError) {
            return { data: null, error: { message: options.updateUserError } }
          }
          return { data: {}, error: null }
        },
        listUsers: async () => {
          state.auth.listedUsers += 1
          return { data: { users: [] }, error: null }
        },
      },
    },
    from(table: string) {
      state.calls.push(`from:${table}`)
      return createBuilder(table, state, (filters) => tableResult(table, filters))
    },
  }

  // The header-forwarding client. Deliberately a different object identity so a
  // test can prove which one an RPC went through.
  const db = {
    rpc: async (name: string, args: any) => {
      state.rpc.push({ name, args })
      if (options.rpcError && name === "sync_staff_roles_by_profile_id") {
        return { data: null, error: { message: options.rpcError } }
      }
      if (name === "resolve_auth_user_id_by_email") {
        return { data: options.authUserId ?? null, error: null }
      }
      if (name === "has_permission") {
        // `has_permission` is the gate for managing logins, so the fake has to
        // honour the grant date window the same way the SQL does. Without this
        // the window tests would pass for the wrong reason.
        const today = new Date().toISOString().slice(0, 10)
        const active = (options.roles ?? []).filter((role) => {
          const window = options.roleWindows?.[role]
          return (!window?.effective_from || window.effective_from <= today) &&
            (!window?.effective_to || window.effective_to >= today)
        })

        // `access.manage` is a site_admin-only capability in the matrix.
        const holds = args.p_capability === "access.manage"
          ? active.includes("site_admin")
          : active.length > 0

        return { data: holds, error: null }
      }
      return { data: null, error: null }
    },
  }

  return { state, clients: { service, db, appUrl: "http://localhost:5173" } as unknown as AccountAdminClients }
}

function requestWith(token?: string): Request {
  return new Request("http://localhost/account-admin", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

function adminCaller(): AccountCaller {
  return {
    userId: "admin-1",
    email: "admin@school.test",
    label: "Admin",
    roles: ["site_admin"],
    isAdmin: true,
  }
}

// --- Authentication ------------------------------------------------------------

Deno.test("a request with no Authorization header is refused", async () => {
  const { clients } = createFake()
  await assert.rejects(
    () => resolveCaller(requestWith(), clients.service, clients.db),
    (error: unknown) => error instanceof AccountAuthError && error.status === 401,
  )
})

Deno.test("an invalid session is refused with 401", async () => {
  const { clients } = createFake({ tokenValid: false })
  await assert.rejects(
    () => resolveCaller(requestWith("bad.jwt"), clients.service, clients.db),
    (error: unknown) => error instanceof AccountAuthError && error.status === 401,
  )
})

Deno.test("a valid session resolves the caller and their roles from the database", async () => {
  const { clients, state } = createFake({ roles: ["site_admin"], fullName: "Sam Admin" })
  const caller = await resolveCaller(requestWith("valid.jwt"), clients.service, clients.db)

  assert.equal(caller.userId, "admin-1")
  assert.equal(caller.label, "Sam Admin")
  assert.deepEqual(caller.roles, ["site_admin"])
  assert.equal(caller.isAdmin, true)
  assert.ok(state.calls.includes("from:user_roles"))
})

Deno.test("a role that has not started yet is not treated as an admin role", async () => {
  const { clients } = createFake({
    roles: ["site_admin"],
    roleWindows: { site_admin: { effective_from: "2099-01-01" } },
  })
  const caller = await resolveCaller(requestWith("valid.jwt"), clients.service, clients.db)

  assert.equal(caller.isAdmin, false)
  assert.throws(
    () => requireAccessAdmin(caller),
    (error: unknown) => error instanceof AccountAuthError && error.status === 403,
  )
})

Deno.test("a role that has already ended is not treated as an admin role", async () => {
  const { clients } = createFake({
    roles: ["site_admin"],
    roleWindows: { site_admin: { effective_to: "2000-01-01" } },
  })
  const caller = await resolveCaller(requestWith("valid.jwt"), clients.service, clients.db)
  assert.equal(caller.isAdmin, false)
})

Deno.test("a signed-in user without an admin role is refused with 403", async () => {
  const { clients } = createFake({ roles: ["staff"] })
  const caller = await resolveCaller(requestWith("valid.jwt"), clients.service, clients.db)

  assert.equal(caller.isAdmin, false)
  assert.throws(
    () => requireAccessAdmin(caller),
    (error: unknown) => error instanceof AccountAuthError && error.status === 403,
  )
})

Deno.test("it_admin may manage logins, a staff member may not", () => {
  assert.doesNotThrow(() => requireAccessAdmin({ ...adminCaller(), roles: ["it_admin"], isAdmin: true }))
  assert.throws(
    () => requireAccessAdmin({ ...adminCaller(), roles: ["counsellor"], isAdmin: false }),
    (error: unknown) => error instanceof AccountAuthError && error.status === 403,
  )
})

Deno.test("the refusal names the roles the caller actually holds", () => {
  assert.throws(
    () => requireAccessAdmin({ ...adminCaller(), roles: ["board_member"], isAdmin: false }),
    (error: unknown) => error instanceof AccountAuthError && error.message.includes("board_member"),
  )
})

// --- Pure helpers --------------------------------------------------------------

Deno.test("emails are normalized and malformed input is rejected", () => {
  assert.equal(normalizeEmail("  New.Staff@School.TEST "), "new.staff@school.test")
  assert.equal(normalizeEmail("not-an-email"), null)
  assert.equal(normalizeEmail(undefined), null)
})

Deno.test("an empty allowlist accepts any domain", () => {
  assert.equal(isDomainAllowed([], "anyone@anywhere.test"), true)
  assert.equal(isDomainAllowed(["school.test"], "a@school.test"), true)
  assert.equal(isDomainAllowed(["School.Test "], "a@school.test"), true)
  assert.equal(isDomainAllowed(["school.test"], "a@other.test"), false)
})

Deno.test("grants are de-duplicated on role and start date", () => {
  const grants = normalizeGrants([
    { role: "staff" },
    { role: "staff", effective_from: null },
    { role: "staff", effective_from: "2026-01-01" },
    { role: "staff", effective_from: "2026-01-01" },
    { role: "", effective_from: "2026-01-01" },
    "counsellor",
  ])

  assert.deepEqual(grants, [
    { role: "staff", effective_from: null, effective_to: null },
    { role: "staff", effective_from: "2026-01-01", effective_to: null },
    { role: "counsellor", effective_from: null, effective_to: null },
  ])
})

// --- create_account ------------------------------------------------------------

Deno.test("an unusable grant is refused before a login is created", async () => {
  const { clients, state } = createFake({ existingProfileId: null })

  const badRole = await runAction(
    { action: "create_account", email: "new.staff@school.test", grants: [{ role: "superuser" }] },
    adminCaller(),
    clients,
  )
  assert.equal(badRole.status, 400)
  assert.match(String(badRole.body.error), /not a grantable role/)

  const inverted = await runAction(
    {
      action: "create_account",
      email: "new.staff@school.test",
      grants: [{ role: "staff", effective_from: "2026-06-01", effective_to: "2026-01-01" }],
    },
    adminCaller(),
    clients,
  )
  assert.equal(inverted.status, 400)
  assert.match(String(inverted.body.error), /before it starts/)

  assert.equal(state.auth.createdUsers.length, 0, "nothing was created")
  assert.equal(state.writes.length, 0)
})

Deno.test("a non-allowlisted domain is rejected and audited without creating anything", async () => {
  const { clients, state } = createFake({ allowedDomains: ["school.test"] })

  const result = await runAction(
    { action: "create_account", email: "someone@outsider.test", firstName: "Out", lastName: "Sider" },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 400)
  assert.equal(state.auth.createdUsers.length, 0)
  assert.equal(state.auth.invites.length, 0)

  const audit = state.writes.find((write) => write.table === "account_audit_log")
  assert.ok(audit, "a domain_rejected audit row must be written")
  assert.equal(audit!.payload.action, "domain_rejected")
  assert.equal(audit!.payload.actor_id, "admin-1")
  assert.equal(audit!.payload.detail.domain, "outsider.test")
})

Deno.test("a successful create issues one invite, one registration, and one audit row", async () => {
  const { clients, state } = createFake({ existingProfileId: null, staffMatchId: "staff-7" })

  const result = await runAction(
    {
      action: "create_account",
      email: "new.staff@school.test",
      firstName: "New",
      lastName: "Staff",
      grants: [{ role: "staff" }, { role: "counsellor", effective_from: "2027-01-01" }],
    },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.invited, true)
  assert.equal(result.body.created, true)
  assert.equal(result.body.profileId, "profile-new")

  assert.equal(state.auth.createdUsers.length, 1)
  assert.equal(state.auth.createdUsers[0].email, "new.staff@school.test")
  // Regression guard: confirming the address at creation makes GoTrue refuse the
  // invitation that follows, so the create path delivered no mail at all.
  assert.equal(
    state.auth.createdUsers[0].email_confirm,
    false,
    "the account must be left unconfirmed or the invitation is rejected",
  )

  assert.equal(state.auth.invites.length, 1)
  assert.equal(state.auth.invites[0].redirectTo, "http://localhost:5173/set-password")

  const registrationUpserts = state.writes.filter(
    (write) => write.table === "account_registrations" && write.kind === "upsert"
  )
  assert.equal(registrationUpserts.length, 1)
  assert.equal(registrationUpserts[0].payload.status, "invited")
  assert.equal(registrationUpserts[0].payload.created_by, "admin-1")

  // invite_sent_at is stamped by a separate write so it can only ever claim a
  // delivery that actually happened.
  const deliveryStamps = state.writes.filter(
    (write) => write.table === "account_registrations" && write.kind === "update"
  )
  assert.equal(deliveryStamps.length, 1)
  assert.ok(deliveryStamps[0].payload.invite_sent_at)
  assert.equal(registrationUpserts[0].payload.invite_sent_at, undefined)

  const audits = state.writes.filter((write) => write.table === "account_audit_log")
  const actions = audits.map((write) => write.payload.action).sort()
  assert.deepEqual(actions, ["create", "role_change"])
  assert.equal(audits[0].payload.profile_id, "profile-new")
})

Deno.test("the role RPC goes through the header-forwarding client, not the service client", async () => {
  const { clients, state } = createFake({ existingProfileId: null })

  await runAction(
    { action: "create_account", email: "new.staff@school.test", grants: [{ role: "staff" }] },
    adminCaller(),
    clients,
  )

  assert.equal(state.rpc.length, 1)
  assert.equal(state.rpc[0].name, "sync_staff_roles_by_profile_id")
  assert.equal(state.rpc[0].args.p_profile_id, "profile-new")
  assert.deepEqual(state.rpc[0].args.p_grants, [
    { role: "staff", effective_from: null, effective_to: null },
  ])

  // The service client has no rpc() at all, so a grant that did not go through
  // `db` would have thrown rather than silently bypassed auth.uid().
  assert.equal((clients.service as any).rpc, undefined)
})

Deno.test("set_roles audits a later role change on an existing login", async () => {
  const { clients, state } = createFake({ existingProfileId: "profile-existing" })

  const result = await runAction(
    {
      action: "set_roles",
      profileId: "profile-existing",
      grants: [{ role: "finance_admin" }, { role: "staff", effective_from: "2027-01-01" }],
    },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 200)
  assert.equal(state.auth.createdUsers.length, 0, "no second login is created")
  assert.equal(state.auth.invites.length, 0, "editing roles must not send mail")

  assert.equal(state.rpc.length, 1)
  assert.equal(state.rpc[0].name, "sync_staff_roles_by_profile_id")
  assert.equal(state.rpc[0].args.p_profile_id, "profile-existing")
  assert.deepEqual(state.rpc[0].args.p_grants, [
    { role: "finance_admin", effective_from: null, effective_to: null },
    { role: "staff", effective_from: "2027-01-01", effective_to: null },
  ])

  const audits = state.writes.filter((write) => write.table === "account_audit_log")
  assert.equal(audits.length, 1, "exactly one audit entry, not a create plus a change")
  assert.equal(audits[0].payload.action, "role_change")
  assert.equal(audits[0].payload.profile_id, "profile-existing")
  assert.equal(audits[0].payload.actor_id, "admin-1")
  assert.equal(audits[0].payload.detail.grants.length, 2)
})

Deno.test("set_roles refuses a bad grant before touching the existing access", async () => {
  const { clients, state } = createFake({ existingProfileId: "profile-existing" })

  const result = await runAction(
    { action: "set_roles", profileId: "profile-existing", grants: [{ role: "wizard" }] },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 400)
  assert.equal(state.rpc.length, 0, "no partial write")
  assert.equal(state.writes.filter((w) => w.table === "account_audit_log").length, 0)
})

Deno.test("set_roles reports a missing profile rather than writing grants blindly", async () => {
  const { clients, state } = createFake({ existingProfileId: null })

  const result = await runAction(
    { action: "set_roles", profileId: "profile-missing", grants: [{ role: "staff" }] },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 404)
  assert.equal(state.rpc.length, 0)
})

Deno.test("set_roles needs a profile id", async () => {
  const { clients, state } = createFake({ existingProfileId: "profile-existing" })

  const result = await runAction({ action: "set_roles", grants: [{ role: "staff" }] }, adminCaller(), clients)

  assert.equal(result.status, 400)
  assert.equal(state.rpc.length, 0)
})

Deno.test("an existing profile is reused instead of creating a second login", async () => {
  const { clients, state } = createFake({ existingProfileId: "profile-existing" })

  const result = await runAction(
    { action: "create_account", email: "known@school.test", grants: [] },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 200)
  assert.equal(result.body.created, false)
  assert.equal(result.body.profileId, "profile-existing")
  assert.equal(state.auth.createdUsers.length, 0)
  assert.equal(state.auth.invites.length, 1)
  assert.equal(state.rpc.length, 0, "no grants means no role RPC call")
})

Deno.test("reusing a profile records the account as active, not invited", async () => {
  // Profiles are created by the auth trigger on any Google sign-in, so a reused
  // profile is somebody who can already sign in. "Invited" would be a lie on the
  // directory badge.
  const { clients, state } = createFake({ existingProfileId: "profile-google" })

  await runAction(
    { action: "create_account", email: "known@school.test", grants: [] },
    adminCaller(),
    clients,
  )

  const registration = state.writes.find((write) => write.table === "account_registrations")
  assert.equal(registration!.payload.status, "active")

  const createAudit = state.writes.find((write) => write.table === "account_audit_log")
  assert.equal(createAudit!.payload.detail.reused_profile, true)
  assert.equal(createAudit!.payload.detail.registration_status, "active")
})

Deno.test("re-provisioning never quietly un-revokes an account", async () => {
  const { clients, state } = createFake({
    existingProfileId: "profile-revoked",
    existingRegistration: { status: "revoked", invited_at: "2026-01-01T00:00:00.000Z" },
  })

  await runAction(
    { action: "create_account", email: "known@school.test", grants: [{ role: "staff" }] },
    adminCaller(),
    clients,
  )

  const registration = state.writes.find((write) => write.table === "account_registrations")
  assert.equal(registration!.payload.status, "revoked")
  assert.equal(registration!.payload.invited_at, "2026-01-01T00:00:00.000Z", "the original invite date is kept")
})

Deno.test("the user list is never scanned to recover an auth user id", async () => {
  // Regression guard for the O(n) `auth.admin.listUsers` scan this replaced.
  const { clients, state } = createFake({
    existingProfileId: null,
    createUserError: "User already registered",
    authUserId: "recovered-1",
  })

  await runAction(
    { action: "create_account", email: "new.staff@school.test", grants: [] },
    adminCaller(),
    clients,
  )

  assert.equal(state.auth.listedUsers, 0)
  const resolveCall = state.rpc.find((entry) => entry.name === "resolve_auth_user_id_by_email")
  assert.ok(resolveCall, "the id is resolved through the gated RPC instead")
  assert.equal(resolveCall!.args.p_email, "new.staff@school.test")
})

Deno.test("an already-registered address recovers its user id through the RPC", async () => {
  const { clients, state } = createFake({
    existingProfileId: null,
    createUserError: "User already registered",
    authUserId: "recovered-1",
  })

  const result = await runAction(
    { action: "create_account", email: "new.staff@school.test", grants: [] },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 200)
  assert.equal(result.body.profileId, "recovered-1")
  assert.equal(state.auth.createdUsers.length, 1)
  assert.equal(state.auth.invites.length, 1)
})

Deno.test("an unresolvable existing login is refused with 409 and audited", async () => {
  const { clients, state } = createFake({
    existingProfileId: null,
    createUserError: "User already registered",
    authUserId: null,
  })

  const result = await runAction(
    { action: "create_account", email: "new.staff@school.test", grants: [] },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 409)
  const audit = state.writes.find((write) => write.table === "account_audit_log")
  assert.equal(audit!.payload.action, "create_failed")
  assert.equal(audit!.payload.detail.resolved_from_auth, true)
  assert.equal(state.auth.invites.length, 0)
})

Deno.test("a non-registration failure is reported as 502, not a misleading 409", async () => {
  const { clients } = createFake({
    existingProfileId: null,
    createUserError: "smtp configuration invalid",
  })

  const result = await runAction(
    { action: "create_account", email: "new.staff@school.test", grants: [] },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 502)
  assert.match(String(result.body.error), /smtp configuration invalid/)
})

Deno.test("a role grant failure is surfaced and audited instead of reported as success", async () => {
  const { clients, state } = createFake({ existingProfileId: null, rpcError: "insufficient_privilege" })

  const result = await runAction(
    { action: "create_account", email: "new.staff@school.test", grants: [{ role: "site_admin" }] },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 500)
  assert.equal(state.auth.invites.length, 0, "no invitation when the grants failed")
  const audit = state.writes.find((write) => write.table === "account_audit_log")
  assert.equal(audit!.payload.action, "create_failed")
  assert.equal(audit!.payload.detail.stage, "sync_roles")
})

Deno.test("a mailer failure is reported as a 502 and audited, without blaming the address", async () => {
  const { clients, state } = createFake({ existingProfileId: null, inviteError: "smtp unavailable" })

  const result = await runAction(
    { action: "create_account", email: "new.staff@school.test", grants: [] },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 502)
  assert.match(String(result.body.error), /smtp unavailable/)
  assert.equal(result.body.profileId, "profile-new", "the profile id is returned so the admin can retry")
  const audit = state.writes.find((write) => write.table === "account_audit_log")
  assert.equal(audit!.payload.action, "create_failed")
  assert.equal(audit!.payload.detail.operation, "create_account")
  assert.equal(audit!.payload.detail.stage, "invite")
})

Deno.test("a malformed email is refused before anything is written", async () => {
  const { clients, state } = createFake()

  const result = await runAction(
    { action: "create_account", email: "nope", grants: [] },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 400)
  assert.equal(state.writes.length, 0)
})

Deno.test("the staff row is linked by email when no staff id is supplied", async () => {
  const { clients, state } = createFake({ existingProfileId: null, staffMatchId: "staff-7" })

  await runAction(
    { action: "create_account", email: "new.staff@school.test", grants: [] },
    adminCaller(),
    clients,
  )

  const staffUpdate = state.writes.find((write) => write.table === "staff")
  assert.ok(staffUpdate)
  assert.equal(staffUpdate!.payload.profile_id, "profile-new")
  assert.ok(state.calls.includes("staff.ilike"))
})

// --- resend_invite -------------------------------------------------------------

Deno.test("resending an invite stamps the delivery and audits it", async () => {
  const { clients, state } = createFake({ existingProfileId: "profile-1" })

  const result = await runAction(
    { action: "resend_invite", profileId: "profile-1" },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 200)
  assert.equal(state.auth.invites.length, 1)
  const stamps = state.writes.filter((write) => write.table === "account_registrations")
  assert.equal(stamps.length, 2)
  assert.ok(stamps.every((write) => write.kind === "update"))
  assert.ok(stamps[0].payload.invite_sent_at)
  assert.ok(stamps[1].payload.last_reinvited_at)
  const audit = state.writes.find((write) => write.table === "account_audit_log")
  assert.equal(audit!.payload.action, "resend_invite")
})

Deno.test("an already-confirmed address gets a 409 that points at password reset", async () => {
  const { clients } = createFake({ existingProfileId: "profile-1", inviteError: "Email address has already been confirmed" })

  const result = await runAction(
    { action: "resend_invite", profileId: "profile-1" },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 409)
  assert.match(String(result.body.error), /password reset/i)
})

Deno.test("create_account reports an already-registered address as a 409, not a gateway failure", async () => {
  const { clients } = createFake({
    existingProfileId: "profile-1",
    inviteError: "User already registered",
  })

  const result = await runAction(
    { action: "create_account", email: "known@school.test", grants: [] },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 409)
  assert.match(String(result.body.error), /password reset/i)
})

// --- revoke / restore ----------------------------------------------------------

Deno.test("revoke deactivates the role grants and bans the auth account", async () => {
  const { clients, state } = createFake()

  const result = await runAction({ action: "revoke", profileId: "profile-1" }, adminCaller(), clients)

  assert.equal(result.status, 200)
  assert.equal(result.body.revoked, true)

  const roleUpdate = state.writes.find((write) => write.table === "user_roles")
  assert.ok(roleUpdate, "role rows must be deactivated")
  assert.deepEqual(roleUpdate!.payload, { active: false })
  assert.ok(state.calls.includes("user_roles.eq"))

  assert.equal(state.auth.bans.length, 1)
  assert.equal(state.auth.bans[0].id, "profile-1")
  assert.ok(state.auth.bans[0].ban_until, "a far-future ban_until is set")

  const registration = state.writes.find((write) => write.table === "account_registrations")
  assert.equal(registration!.payload.status, "revoked")
  assert.equal(registration!.payload.revoked_by, "admin-1")

  const audit = state.writes.find((write) => write.table === "account_audit_log")
  assert.equal(audit!.payload.action, "revoke")
})

Deno.test("a failed ban still marks the account revoked and warns that sign-in is open", async () => {
  // The half-completed revoke is the dangerous state: no roles are in force but the
  // auth account is not suspended, so the person can still sign in.
  const { clients, state } = createFake({ updateUserError: "User not found" })

  const result = await runAction({ action: "revoke", profileId: "profile-1" }, adminCaller(), clients)

  assert.equal(result.status, 500)
  assert.match(String(result.body.error), /may still be able to sign in/i)

  const roleUpdate = state.writes.find((write) => write.table === "user_roles")
  assert.ok(roleUpdate, "roles are still deactivated")

  const registration = state.writes.find(
    (write) => write.table === "account_registrations" && write.kind === "upsert"
  )
  assert.equal(registration!.payload.status, "revoked")

  const audit = state.writes.find((write) => write.table === "account_audit_log")
  assert.equal(audit!.payload.action, "create_failed")
  assert.equal(audit!.payload.detail.operation, "revoke")
  assert.equal(audit!.payload.detail.stage, "ban")
})

Deno.test("restore lifts the ban without reactivating any role", async () => {
  const { clients, state } = createFake()

  const result = await runAction({ action: "restore", profileId: "profile-1" }, adminCaller(), clients)

  assert.equal(result.status, 200)
  assert.equal(result.body.rolesReactivated, false)
  assert.equal(state.auth.bans.length, 1)
  assert.equal(state.auth.bans[0].ban_until, null)
  assert.equal(
    state.writes.find((write) => write.table === "user_roles"),
    undefined,
    "restore must not touch user_roles",
  )

  const registration = state.writes.find((write) => write.table === "account_registrations")
  assert.equal(registration!.payload.status, "active")
  assert.equal(registration!.payload.revoked_at, null)

  const audit = state.writes.find((write) => write.table === "account_audit_log")
  assert.equal(audit!.payload.action, "restore")
  assert.equal(audit!.payload.detail.roles_reactivated, false)
})

Deno.test("revoke refuses a request with no profile id", async () => {
  const { clients, state } = createFake()

  const result = await runAction({ action: "revoke" }, adminCaller(), clients)

  assert.equal(result.status, 400)
  assert.equal(state.writes.length, 0)
})

// --- fetch_audit ---------------------------------------------------------------

Deno.test("fetch_audit clamps the row limit to a sane range", async () => {
  const { clients, state } = createFake()

  const result = await runAction(
    { action: "fetch_audit", profileId: "profile-1", limit: 5000 },
    adminCaller(),
    clients,
  )

  assert.equal(result.status, 200)
  assert.deepEqual(result.body.rows, [])
  assert.ok(state.calls.includes("account_audit_log.order"))
  assert.ok(state.calls.includes("account_audit_log.limit"))
})

Deno.test("an unknown action is a bad request, not a silent success", async () => {
  const { clients, state } = createFake()

  const result = await runAction({ action: "delete_everything" }, adminCaller(), clients)

  assert.equal(result.status, 400)
  assert.equal(state.writes.length, 0)
})

Deno.test("a missing action is rejected", async () => {
  const { clients } = createFake()
  const result = await runAction({}, adminCaller(), clients)
  assert.equal(result.status, 400)
})
