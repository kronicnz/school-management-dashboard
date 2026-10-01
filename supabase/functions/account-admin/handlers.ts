/**
 * Account administration actions.
 *
 * Creating a staff login, sending an invitation, and revoking access all live here
 * rather than in the client, for one reason: every one of them needs the service
 * role, and handing the service role to the browser would let any signed-in user
 * create themselves an admin account.
 *
 * Two clients are required, and using one for both is a real trap rather than a
 * style preference:
 *
 *   - `service` — service role, no forwarded header. `auth.admin.*` needs this, and
 *     so do the direct reads and writes the admin's own RLS policies forbid
 *     (looking a profile up by email, writing the registration, appending to the
 *     audit log).
 *   - `db` — service role with the caller's bearer token in the forwarded
 *     `Authorization` header. The role RPCs gate on `auth.uid()`, and a plain
 *     service-role client resolves `auth.uid()` to null, so every call through it
 *     fails `is_access_admin()` with insufficient_privilege. Forwarding the real
 *     admin token also means `granted_by` records who actually made the change.
 *
 *     This mirrors supabase/functions/send-incident-email/index.ts.
 *
 * On outbound mail: this project already has an app-composed mail path through
 * the EMAIL_WEBHOOK_URL webhook in send-incident-email. That path is deliberately
 * NOT used here. A password set from an invitation link needs a one-time token
 * that only Supabase's own auth mailer can mint, so the credential email has to go
 * through `auth.admin.inviteUserByEmail`. The two mail paths serve different jobs
 * and should not be conflated.
 */

import type { AccountCaller } from "./auth.ts"

export interface AccountAdminClients {
  /** Service role, no forwarded Authorization header. */
  service: any
  /** Service role with the caller's bearer token forwarded, so `auth.uid()` is the admin. */
  db: any
  /** Application origin, used to build the post-invite redirect. */
  appUrl: string
}

export interface AccountResult {
  status: number
  body: Record<string, unknown>
}

export const SET_PASSWORD_PATH = "/set-password"

/**
 * GoTrue reports "this address is already registered" in several shapes depending
 * on version and whether the address is confirmed. Matching on text is unpleasant
 * but it is the only signal available from the admin API.
 */
const ALREADY_REGISTERED_PATTERNS = [
  /already been registered/i,
  /already registered/i,
  /already exists/i,
  /already been confirmed/i,
  /already confirmed/i,
]

/**
 * A ban with no end date is not expressible, and a short one would expire while
 * the person is still on the staff roll. A far-future `ban_until` is the durable
 * equivalent; restore clears it back to null.
 */
const BAN_UNTIL = "2999-12-31T23:59:59.000Z"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Mirrors the `user_roles` role check constraint.
 *
 * Validated here as well as in the database because this function is the trust
 * boundary: a bad role reaching PostgREST produces a check-constraint error that
 * names a column rather than the input that caused it, and an inverted date range
 * does the same.
 */
const GRANTABLE_ROLES = new Set([
  "site_admin",
  "finance_admin",
  "finance_read_only",
  "board_member",
  "it_admin",
  "it_staff",
  "property_manager",
  "property_staff",
  "staff",
  "counsellor",
])

/**
 * Recovering an existing auth user id from an email address.
 *
 * GoTrue has no get-user-by-email admin method, and `generateLink` is not an
 * acceptable substitute because it doubles as an address-enumeration oracle. The
 * `resolve_auth_user_id_by_email` RPC was added for this instead: `auth.users` is
 * owned by `postgres`, so a security-definer function can read one row out of it
 * and return nothing but the uuid.
 *
 * The call goes through the header-forwarding client because the RPC self-checks
 * `is_access_admin(auth.uid())`, which is exactly the guarantee we want: the id is
 * only ever resolved for a verified access admin.
 *
 * This replaced a bounded `auth.admin.listUsers` scan, which was O(n) across the
 * whole user table and pulled every account through the service role to find one.
 */
async function findAuthUserIdByEmail(
  clients: AccountAdminClients,
  email: string,
): Promise<string | null> {
  const { data, error } = await clients.db.rpc("resolve_auth_user_id_by_email", { p_email: email })

  if (error) {
    console.error("account-admin: could not resolve an auth user id", describeError(error))
    return null
  }

  return typeof data === "string" && data.length > 0 ? data : null
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim().toLowerCase()
  return EMAIL_PATTERN.test(trimmed) ? trimmed : null
}

export function extractEmailDomain(email: string): string {
  return email.split("@")[1] ?? ""
}

export function isAlreadyRegistered(message: string | null | undefined): boolean {
  if (!message) return false
  return ALREADY_REGISTERED_PATTERNS.some((pattern) => pattern.test(message))
}

/**
 * Turns a refused invitation into the right status code.
 *
 * A 409 is a conflict the admin can act on - the address is already registered or
 * already confirmed, so Supabase will not send another invitation. 502 is reserved
 * for a genuinely upstream failure such as an unreachable mailer.
 */
function describeInviteFailure(message: string) {
  if (isAlreadyRegistered(message)) {
    return {
      status: 409,
      message:
        "This address already has a login, so Supabase will not send another invitation. "
        + "Use a password reset link instead: the person sets their own password from it.",
    } as const
  }

  return {
    status: 502,
    message: `The invitation could not be sent: ${message}`,
  } as const
}

export interface RoleGrant {
  role: string
  effective_from: string | null
  effective_to: string | null
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

/**
 * Normalizes and de-duplicates the grant list.
 *
 * De-duplication is on (role, effective_from) because that is the uniqueness key
 * of `user_roles`; two identical grants would otherwise race the insert.
 */
export function normalizeGrants(value: unknown): RoleGrant[] {
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const grants: RoleGrant[] = []

  for (const entry of value) {
    const role = typeof entry === "string"
      ? entry.trim()
      : String((entry as { role?: unknown })?.role ?? "").trim()
    if (!role) continue

    const effectiveFrom = typeof entry === "string"
      ? null
      : normalizeDate((entry as { effective_from?: unknown })?.effective_from)
    const effectiveTo = typeof entry === "string"
      ? null
      : normalizeDate((entry as { effective_to?: unknown })?.effective_to)

    const key = `${role}::${effectiveFrom ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    grants.push({ role, effective_from: effectiveFrom, effective_to: effectiveTo })
  }

  return grants
}

function requireProfileId(payload: Record<string, unknown>): string | null {
  const value = payload.profileId ?? payload.profile_id
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Rejects unusable grants before anything is written.
 *
 * The database would reject both of these too, but only after the login had been
 * created and the registration written, leaving a half-provisioned account behind.
 */
function validateGrants(grants: RoleGrant[]): string | null {
  for (const grant of grants) {
    if (!GRANTABLE_ROLES.has(grant.role)) {
      return `"${grant.role}" is not a grantable role.`
    }

    if (
      grant.effective_from
      && grant.effective_to
      && grant.effective_to < grant.effective_from
    ) {
      return `"${grant.role}" ends (${grant.effective_to}) before it starts (${grant.effective_from}).`
    }
  }

  return null
}

function buildRedirectTo(appUrl: string): string {
  return `${appUrl.replace(/\/+$/, "")}${SET_PASSWORD_PATH}`
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

/**
 * Appends to the audit trail.
 *
 * Never throws: a failed audit write must not turn a successful revocation into an
 * error the admin sees as a failure, and the admin page surfaces the log anyway.
 * The write is still awaited so a test can observe it.
 */
async function writeAudit(
  clients: AccountAdminClients,
  caller: AccountCaller,
  entry: {
    action: string
    profileId?: string | null
    detail?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await clients.service.from("account_audit_log").insert({
    profile_id: entry.profileId ?? null,
    actor_id: caller.userId,
    actor_email: caller.email ?? null,
    action: entry.action,
    detail: entry.detail ?? {},
  })

  if (error) {
    console.error(`account-admin: failed to write ${entry.action} audit row`, describeError(error))
  }
}

async function readAllowedDomains(clients: AccountAdminClients): Promise<string[]> {
  const { data, error } = await clients.service
    .from("app_settings")
    .select("allowed_email_domains")
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error("account-admin: could not read app_settings", describeError(error))
    // Failing open here would weaken the rule; failing closed would lock every
    // admin out of provisioning during a settings outage. Refusing the request and
    // logging loudly is the honest option.
    throw new Error(`Could not read the email domain allowlist: ${describeError(error)}`)
  }

  return Array.isArray(data?.allowed_email_domains) ? data.allowed_email_domains.map(String) : []
}

export function isDomainAllowed(allowedDomains: string[], email: string): boolean {
  if (allowedDomains.length === 0) return true
  const domain = extractEmailDomain(email)
  return allowedDomains.some((allowed) => allowed.trim().toLowerCase() === domain)
}

/**
 * Links the newly provisioned profile to a staff row.
 *
 * Resolves the target by id first when the caller supplied one, otherwise by email
 * match, and only fills an empty `profile_id` so this can never steal a staff row
 * that already belongs to a different login.
 */
async function linkStaffRow(
  clients: AccountAdminClients,
  profileId: string,
  email: string,
  staffId: string | null,
): Promise<string | null> {
  let targetId = staffId

  if (!targetId) {
    const { data, error } = await clients.service
      .from("staff")
      .select("id")
      .ilike("email", email)
      .is("profile_id", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error("account-admin: could not match a staff row by email", describeError(error))
      return null
    }

    targetId = data?.id ?? null
  }

  if (!targetId) return null

  const { error } = await clients.service
    .from("staff")
    .update({ profile_id: profileId })
    .eq("id", targetId)
    .is("profile_id", null)

  if (error) {
    console.error("account-admin: could not link the staff row", describeError(error))
    return null
  }

  return targetId
}

async function applyRoleGrants(
  clients: AccountAdminClients,
  profileId: string,
  grants: RoleGrant[],
): Promise<{ ok: boolean; error: string | null }> {
  if (grants.length === 0) return { ok: true, error: null }

  const { error } = await clients.db.rpc("sync_staff_roles_by_profile_id", {
    p_profile_id: profileId,
    p_grants: grants,
  })

  if (error) return { ok: false, error: describeError(error) }
  return { ok: true, error: null }
}

async function upsertRegistration(
  clients: AccountAdminClients,
  profileId: string,
  caller: AccountCaller,
  fields: Record<string, unknown>,
): Promise<string | null> {
  const { error } = await clients.service.from("account_registrations").upsert(
    {
      profile_id: profileId,
      created_by: caller.userId,
      ...fields,
    },
    { onConflict: "profile_id" },
  )

  if (error) {
    console.error("account-admin: could not write the registration row", describeError(error))
    return describeError(error)
  }

  return null
}

/**
 * Stamps the delivery time on a registration once the mail has actually gone out.
 *
 * Kept separate from the registration upsert so `invite_sent_at` can never claim a
 * delivery that failed. A failure here is logged rather than thrown: the invitation
 * itself succeeded, and reporting the whole action as failed would be a lie.
 */
async function markInviteSent(
  clients: AccountAdminClients,
  profileId: string,
  sentAt: string,
): Promise<void> {
  const { error } = await clients.service
    .from("account_registrations")
    .update({ invite_sent_at: sentAt })
    .eq("profile_id", profileId)

  if (error) {
    console.error("account-admin: could not stamp invite_sent_at", describeError(error))
  }
}

export async function createAccount(
  payload: Record<string, unknown>,
  caller: AccountCaller,
  clients: AccountAdminClients,
): Promise<AccountResult> {
  const email = normalizeEmail(payload.email)
  if (!email) {
    return { status: 400, body: { error: "A valid email address is required." } }
  }

  const firstName = typeof payload.firstName === "string" ? payload.firstName.trim() : ""
  const lastName = typeof payload.lastName === "string" ? payload.lastName.trim() : ""
  const fullName = [firstName, lastName].filter(Boolean).join(" ")
  const staffId = typeof payload.staffId === "string" && payload.staffId.trim()
    ? payload.staffId.trim()
    : null
  const grants = normalizeGrants(payload.grants)

  // Checked first, and ahead of the domain allowlist, so an unusable request never
  // gets as far as creating a login.
  const grantError = validateGrants(grants)
  if (grantError) {
    return { status: 400, body: { error: grantError } }
  }

  // 1. Domain allowlist. A rejection is audited even though nothing was created,
  //    because a repeated rejection is a signal worth keeping.
  const allowedDomains = await readAllowedDomains(clients)
  if (!isDomainAllowed(allowedDomains, email)) {
    await writeAudit(clients, caller, {
      action: "domain_rejected",
      detail: { email, domain: extractEmailDomain(email), allowed_domains: allowedDomains },
    })
    return {
      status: 400,
      body: {
        error: `${extractEmailDomain(email)} is not an allowed email domain for staff logins.`,
        allowed_domains: allowedDomains,
      },
    }
  }

  // 2. Reuse an existing profile rather than creating a second login.
  const { data: existingProfile, error: profileLookupError } = await clients.service
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle()

  if (profileLookupError) {
    await writeAudit(clients, caller, {
      action: "create_failed",
      detail: { email, operation: "create_account", stage: "profile_lookup", error: describeError(profileLookupError) },
    })
    return { status: 500, body: { error: `Could not look up an existing login: ${describeError(profileLookupError)}` } }
  }

  let profileId: string | null = existingProfile?.id ?? null
  let created = false

  // 3. Create the auth user when there is no profile yet.
  //
  //    `email_confirm` is deliberately false. GoTrue refuses to send an invitation
  //    to an address that is already confirmed, so pre-confirming here made step 7
  //    below fail every single time: the account was created, the roles and the
  //    registration were written, and the invite was then rejected as "already
  //    registered". The admin got a 409 for a first-time account and no
  //    invitation. The invite link is what confirms the address, so leaving it
  //    unconfirmed here is both necessary and sufficient.
  if (!profileId) {
    const { data: createdUser, error: createError } = await clients.service.auth.admin.createUser({
      email,
      email_confirm: false,
      user_metadata: fullName ? { full_name: fullName } : undefined,
    })

    if (createError) {
      // The profile row is missing but the auth user may still exist, which is
      // exactly the state a half-finished earlier attempt leaves behind. Recover
      // the id rather than failing the admin on a retry.
      if (isAlreadyRegistered(createError.message)) {
        profileId = await findAuthUserIdByEmail(clients, email)
      }
    } else {
      profileId = createdUser?.user?.id ?? null
      created = true
    }

    if (!profileId) {
      const message = describeError(createError)
      // Already-registered is a conflict the admin can act on; anything else is an
      // upstream failure from GoTrue. Collapsing both into one code would send an
      // admin looking for a duplicate that is not there.
      const alreadyRegistered = isAlreadyRegistered(createError?.message)
      await writeAudit(clients, caller, {
        action: "create_failed",
        detail: {
          email,
          operation: "create_account",
          stage: "create_user",
          error: message,
          resolved_from_auth: alreadyRegistered,
        },
      })
      return {
        status: alreadyRegistered ? 409 : 502,
        body: {
          error: alreadyRegistered
            ? "A login is already registered for this address, but no matching profile row could be "
              + "found, so there is nothing to attach roles to. Check this address in Supabase Studio "
              + "before retrying."
            : `The login could not be created: ${message}`,
        },
      }
    }
  }

  // 4. Record the registration.
  //
  //    The status has to reflect what is actually true, and the common case is not
  //    "brand new login". Profiles are created by the auth trigger on any Google
  //    sign-in, so reusing an existing profile means the person can already sign in
  //    and their account is active, not invited. Marking them "invited" would show a
  //    badge on the directory that is simply wrong.
  const now = new Date().toISOString()
  const { data: existingRegistration } = await clients.service
    .from("account_registrations")
    .select("status, invited_at")
    .eq("profile_id", profileId)
    .maybeSingle()

  // An existing registration keeps its status. Re-provisioning must not quietly
  // un-revoke somebody: lifting a suspension stays an explicit Restore action.
  const nextStatus = existingRegistration?.status ?? (created ? "invited" : "active")

  const registrationError = await upsertRegistration(clients, profileId, caller, {
    status: nextStatus,
    invited_at: existingRegistration?.invited_at ?? now,
    revoked_at: null,
    revoked_by: null,
  })

  if (registrationError) {
    return { status: 500, body: { error: `The login was created but the registration record failed: ${registrationError}` } }
  }

  // 5. Attach the staff record.
  const linkedStaffId = await linkStaffRow(clients, profileId, email, staffId)

  // 6. Apply the roles through the header-forwarding client so `auth.uid()` and
  //    `granted_by` resolve to the real admin.
  const roleResult = await applyRoleGrants(clients, profileId, grants)
  if (!roleResult.ok) {
    await writeAudit(clients, caller, {
      action: "create_failed",
      profileId,
      detail: { email, operation: "create_account", stage: "sync_roles", error: roleResult.error, grants },
    })
    return {
      status: 500,
      body: { error: `The login was created but the role grants failed: ${roleResult.error}` },
    }
  }

  if (grants.length > 0) {
    await writeAudit(clients, caller, {
      action: "role_change",
      profileId,
      detail: { email, grants },
    })
  }

  // 7. Send the one-time invitation.
  const { error: inviteError } = await clients.service.auth.admin.inviteUserByEmail(email, {
    redirectTo: buildRedirectTo(clients.appUrl),
  })

  if (inviteError) {
    const failure = describeInviteFailure(describeError(inviteError))
    await writeAudit(clients, caller, {
      action: "create_failed",
      profileId,
      detail: { email, operation: "create_account", stage: "invite", error: describeError(inviteError) },
    })
    return {
      status: failure.status,
      body: {
        error: `The login was created but the invitation was not delivered. ${failure.message}`,
        profileId,
      },
    }
  }

  // Stamped only once the mail actually went out, so `invited_at` never claims a
  // delivery that did not happen.
  await markInviteSent(clients, profileId, now)

  // 8. Audit the successful creation.
  await writeAudit(clients, caller, {
    action: "create",
    profileId,
    detail: {
      email,
      full_name: fullName,
      created,
      reused_profile: !created,
      registration_status: nextStatus,
      staff_id: linkedStaffId,
      grants,
      redirect_to: buildRedirectTo(clients.appUrl),
    },
  })

  return {
    status: 200,
    body: { ok: true, profileId, created, invited: true, staffId: linkedStaffId },
  }
}

export async function resendInvite(
  payload: Record<string, unknown>,
  caller: AccountCaller,
  clients: AccountAdminClients,
): Promise<AccountResult> {
  const profileId = requireProfileId(payload)
  if (!profileId) {
    return { status: 400, body: { error: "profileId is required." } }
  }

  const { data: profile, error: profileError } = await clients.service
    .from("profiles")
    .select("email")
    .eq("id", profileId)
    .maybeSingle()

  if (profileError) {
    return { status: 500, body: { error: `Could not read the profile: ${describeError(profileError)}` } }
  }

  const email = normalizeEmail(profile?.email)
  if (!email) {
    return { status: 404, body: { error: "That login has no email address to send an invitation to." } }
  }

  const { error: inviteError } = await clients.service.auth.admin.inviteUserByEmail(email, {
    redirectTo: buildRedirectTo(clients.appUrl),
  })

  if (inviteError) {
    const failure = describeInviteFailure(describeError(inviteError))
    await writeAudit(clients, caller, {
      action: "create_failed",
      profileId,
      detail: { email, operation: "resend_invite", stage: "invite", error: describeError(inviteError) },
    })
    return { status: failure.status, body: { error: failure.message } }
  }

  const now = new Date().toISOString()
  // Resending is not re-provisioning: it must not clear a suspension, so only the
  // delivery timestamps are written here.
  await markInviteSent(clients, profileId, now)

  const { error: reinviteStampError } = await clients.service
    .from("account_registrations")
    .update({ last_reinvited_at: now })
    .eq("profile_id", profileId)

  if (reinviteStampError) {
    console.error("account-admin: could not stamp last_reinvited_at", describeError(reinviteStampError))
  }

  await writeAudit(clients, caller, {
    action: "resend_invite",
    profileId,
    detail: { email, redirect_to: buildRedirectTo(clients.appUrl) },
  })

  return { status: 200, body: { ok: true, profileId, invited: true } }
}

export async function revokeAccess(
  payload: Record<string, unknown>,
  caller: AccountCaller,
  clients: AccountAdminClients,
): Promise<AccountResult> {
  const profileId = requireProfileId(payload)
  if (!profileId) {
    return { status: 400, body: { error: "profileId is required." } }
  }

  // Roles first: if the ban call then fails, the person has already lost access,
  // which is the safe direction for a revoke to fail in.
  const { error: roleError } = await clients.service
    .from("user_roles")
    .update({ active: false })
    .eq("profile_id", profileId)
    .eq("active", true)

  if (roleError) {
    return { status: 500, body: { error: `Could not deactivate the role grants: ${describeError(roleError)}` } }
  }

  const { error: banError } = await clients.service.auth.admin.updateUserById(profileId, {
    ban_until: BAN_UNTIL,
  })

  // The registration is marked revoked either way. Roles are already deactivated,
  // so leaving the row reading "active" would put a claim on the directory that is
  // not true, and an admin looking at the table is exactly who would be misled.
  const registrationError = await upsertRegistration(clients, profileId, caller, {
    status: "revoked",
    revoked_at: new Date().toISOString(),
    revoked_by: caller.userId,
  })

  if (registrationError) {
    return { status: 500, body: { error: `Access was revoked but the registration record failed: ${registrationError}` } }
  }

  if (banError) {
    // The half-completed state is the dangerous one: no roles are in force, but the
    // auth account is not suspended, so the person can still sign in. Say plainly
    // that the sign-in is still open rather than reporting a clean revocation.
    await writeAudit(clients, caller, {
      action: "create_failed",
      profileId,
      detail: { operation: "revoke", stage: "ban", error: describeError(banError) },
    })
    return {
      status: 500,
      body: {
        error: `Every role grant was deactivated and the account is marked revoked, but the auth account `
          + `could not be suspended: ${describeError(banError)}. That person may still be able to sign in - `
          + "suspend them in Supabase Studio until it is resolved.",
      },
    }
  }

  await writeAudit(clients, caller, {
    action: "revoke",
    profileId,
    detail: { ban_until: BAN_UNTIL },
  })

  return { status: 200, body: { ok: true, profileId, revoked: true } }
}

export async function restoreAccess(
  payload: Record<string, unknown>,
  caller: AccountCaller,
  clients: AccountAdminClients,
): Promise<AccountResult> {
  const profileId = requireProfileId(payload)
  if (!profileId) {
    return { status: 400, body: { error: "profileId is required." } }
  }

  const { error: unbanError } = await clients.service.auth.admin.updateUserById(profileId, {
    ban_until: null,
  })

  if (unbanError) {
    return { status: 500, body: { error: `The suspension could not be lifted: ${describeError(unbanError)}` } }
  }

  // Roles are deliberately NOT reactivated. Restoring a login and restoring
  // access are two different decisions, and bundling them would let access return
  // to someone the moment an admin lifted a suspension.
  const registrationError = await upsertRegistration(clients, profileId, caller, {
    status: "active",
    revoked_at: null,
    revoked_by: null,
  })

  if (registrationError) {
    return { status: 500, body: { error: `The suspension was lifted but the registration record failed: ${registrationError}` } }
  }

  await writeAudit(clients, caller, {
    action: "restore",
    profileId,
    detail: { roles_reactivated: false },
  })

  return { status: 200, body: { ok: true, profileId, restored: true, rolesReactivated: false } }
}

/**
 * Applies a role list to someone who already has a login, and records it.
 *
 * Role changes previously went straight from the browser to
 * `sync_staff_roles_by_profile_id`, which means they were applied correctly but left
 * no trace. In an access-control system the question "who gave this person
 * finance_admin" has to have an answer, and `create_account` only ever explains the
 * first grant. Routing the edit through here makes the role grant list a single
 * audited write path.
 */
export async function setRoles(
  payload: Record<string, unknown>,
  caller: AccountCaller,
  clients: AccountAdminClients,
): Promise<AccountResult> {
  const profileId = requireProfileId(payload)
  if (!profileId) {
    return { status: 400, body: { error: "profileId is required." } }
  }

  const grants = normalizeGrants(payload.grants)

  // Ahead of the write, for the same reason as in create_account: a rejected grant
  // must not leave the person's existing access half-changed.
  const grantError = validateGrants(grants)
  if (grantError) {
    return { status: 400, body: { error: grantError } }
  }

  const { data: profile, error: profileError } = await clients.service
    .from("profiles")
    .select("email")
    .eq("id", profileId)
    .maybeSingle()

  if (profileError) {
    return { status: 500, body: { error: `Could not read the profile: ${describeError(profileError)}` } }
  }

  if (!profile) {
    return { status: 404, body: { error: "That login no longer exists." } }
  }

  const result = await applyRoleGrants(clients, profileId, grants)
  if (!result.ok) {
    await writeAudit(clients, caller, {
      action: "create_failed",
      profileId,
      detail: { operation: "set_roles", stage: "sync_roles", error: result.error, grants },
    })
    return { status: 500, body: { error: `The role grants could not be applied: ${result.error}` } }
  }

  await writeAudit(clients, caller, {
    action: "role_change",
    profileId,
    detail: { email: profile.email ?? null, grants },
  })

  return { status: 200, body: { ok: true, profileId, grants } }
}

export async function fetchAudit(
  payload: Record<string, unknown>,
  _caller: AccountCaller,
  clients: AccountAdminClients,
): Promise<AccountResult> {
  const profileId = requireProfileId(payload)
  if (!profileId) {
    return { status: 400, body: { error: "profileId is required." } }
  }

  const rawLimit = Number(payload.limit ?? 10)
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 10

  const { data, error } = await clients.service
    .from("account_audit_log")
    .select("id, action, detail, actor_email, created_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    return { status: 500, body: { error: `Could not read the audit log: ${describeError(error)}` } }
  }

  return { status: 200, body: { ok: true, rows: data ?? [] } }
}

type AccountAction = (
  payload: Record<string, unknown>,
  caller: AccountCaller,
  clients: AccountAdminClients,
) => Promise<AccountResult>

const ACTIONS: Record<string, AccountAction> = {
  create_account: createAccount,
  resend_invite: resendInvite,
  revoke: revokeAccess,
  restore: restoreAccess,
  set_roles: setRoles,
  fetch_audit: fetchAudit,
}

export function describeAction(action: string): string | null {
  return Object.prototype.hasOwnProperty.call(ACTIONS, action) ? action : null
}

export async function runAction(
  payload: Record<string, unknown>,
  caller: AccountCaller,
  clients: AccountAdminClients,
): Promise<AccountResult> {
  const action = typeof payload.action === "string" ? payload.action : ""
  const handler = describeAction(action) ? ACTIONS[action] : undefined

  if (!handler) {
    return { status: 400, body: { error: `Unsupported action: ${action || "(missing)"}` } }
  }

  return handler(payload, caller, clients)
}
