import { supabase, supabaseUrl } from "../supabaseClient"
import { can, canAny, defaultActiveRole, toAppRoles } from "../access/permissions"
import { todayInSchoolZone } from "../school-time"
import type { AppRole } from "../access/registry"
import type {
  Asset,
  IncidentEmailDispatchLog,
  IncidentFollowUp,
  IncidentFollowUpInsert,
  IncidentManagementReport,
  Incident,
  IncidentCategory,
  IncidentComment,
  IncidentCommentInsert,
  IncidentInsert,
  IncidentStudent,
  IncidentStudentInsert,
  IncidentUpdate,
  Attendance,
  AttendanceInsert,
  AttendanceUpdate,
  Profile,
  Staff,
  Student,
  UserRole,
  Class,
  ClassInsert,
  ClassUpdate,
  Ticket,
  TicketAttachment,
  TicketAuditLog,
  TicketCategory,
  TicketComment,
  TicketManagementReport,
  TicketNotification,
  TicketTemplate,
  TicketTemplateStep,
  FinanceIntakeBatch,
  FinanceIntakeItem,
  FinanceInvoiceCandidate,
  FinanceXeroLink,
  FinanceProcessingEvent,
  FinanceBudget,
  FinanceBudgetInsert,
  FinanceBudgetUpdate,
  FinanceForecastSnapshot,
  FinanceSupplierAlias,
  FinanceSupplierAliasInsert,
} from "./database.types"
import { logError } from "../../utils/logger"

/** A grant that is active but whose window does not cover today. */
export type DatedRoleGrant = {
  role: string
  effective_from: string | null
  effective_to: string | null
}

export type StaffDirectoryRow = Staff & {
  profile_id: string | null
  roles: string[]
  primary_role: string | null
  /** 'none' when no login exists, otherwise the registration status. */
  account_status: string | null
  account_invited_at: string | null
  dated_roles: DatedRoleGrant[]
  /**
   * Grants waiting for a first sign-in, held on the staff row.
   *
   * Organisation staff authenticate with Google, so a person added by an admin has
   * no profile yet and `user_roles` has nothing to key on. These are applied by the
   * `handle_new_user` trigger when they first sign in.
   */
  pending_roles: DatedRoleGrant[]
}

type StaffDirectoryRpcRow = Omit<
  StaffDirectoryRow,
  "account_status" | "account_invited_at" | "dated_roles" | "pending_roles"
> & {
  roles?: string[] | null
  account_status?: string | null
  account_invited_at?: string | null
  dated_roles?: DatedRoleGrant[] | null
  pending_roles?: DatedRoleGrant[] | null
}

function normalizeDatedRoles(value: unknown): DatedRoleGrant[] {
  if (!Array.isArray(value)) return []

  return value.flatMap((entry) => {
    const role = String((entry as DatedRoleGrant)?.role ?? "").trim()
    if (!role) return []
    return [{
      role,
      effective_from: (entry as DatedRoleGrant).effective_from ?? null,
      effective_to: (entry as DatedRoleGrant).effective_to ?? null,
    }]
  })
}

function normalizeStaffDirectoryRow(row: StaffDirectoryRpcRow): StaffDirectoryRow {
  const roles = Array.from(new Set((row.roles ?? []).filter(Boolean)))

  return {
    ...row,
    roles,
    dated_roles: normalizeDatedRoles(row.dated_roles),
    pending_roles: normalizeDatedRoles(row.pending_roles),
    primary_role: row.primary_role ?? roles[0] ?? null,
    role: roles[0] ?? row.role ?? null,
    // The account columns only come from the RPC, which is admin-gated. The
    // fallback read path is what a read-only viewer sees, and it genuinely does not
    // know whether a login exists beyond "a profile is linked", so it says exactly
    // that rather than asserting "active", which would be a guess presented as fact.
    account_status: row.account_status ?? (row.profile_id ? "unknown" : "none"),
    account_invited_at: row.account_invited_at ?? null,
  }
}

/**
 * A role grant, optionally windowed.
 *
 * `effective_from` / `effective_to` are honoured on read everywhere, so a grant
 * without dates is an open-ended one. The pair is carried per role rather than per
 * person because relief cover is the case that needs it: a teacher who takes a
 * class for a term and then hands it back.
 */
export type StaffRoleGrant = {
  role: string
  effective_from?: string | null
  effective_to?: string | null
}

function normalizeRoleGrants(grants: StaffRoleGrant[]) {
  const seen = new Set<string>()

  return grants.reduce<Array<{ role: string; effective_from: string | null; effective_to: string | null }>>(
    (acc, grant) => {
      const role = grant.role.trim()
      if (!role) return acc

      const effectiveFrom = grant.effective_from?.trim() || null
      const effectiveTo = grant.effective_to?.trim() || null
      const key = `${role}::${effectiveFrom ?? ""}`
      if (seen.has(key)) return acc

      seen.add(key)
      acc.push({ role, effective_from: effectiveFrom, effective_to: effectiveTo })
      return acc
    },
    [],
  )
}

/**
 * Today in the school timezone, matching `public.user_has_role` on the server.
 *
 * This used to be `new Date().toISOString().slice(0, 10)`, which is UTC. A
 * viewer east of Greenwich was handed yesterday's date for the first half of
 * their local day, so any role window starting "today" was filtered out and the
 * application reported no roles at all. See src/lib/school-time.ts.
 */
function getToday() {
  return todayInSchoolZone()
}

/**
 * `'unknown'` is not a stored status. It is what a viewer who cannot read
 * `account_registrations` sees when a profile is linked, so it must not be
 * confused with a real value.
 */
export type AccountStatus = "none" | "unknown" | "invited" | "active" | "revoked"

export type AccountAuditRow = {
  id: number
  action: string
  detail: Record<string, unknown> | null
  actor_email: string | null
  created_at: string
}

export type CreateStaffAccountResult = {
  ok: boolean
  profileId: string
  created: boolean
  invited: boolean
  staffId: string | null
}

export type StaffWritePayload = {
  first_name: string
  last_name: string
  email: string
  phone?: string | null
  department?: string | null
  hire_date?: string | null
  status?: string | null
  org_unit_path?: string | null
  profile_id?: string | null
  /**
   * Grants staged for a person who has not signed in yet.
   *
   * Only meaningful when `profile_id` is null, which is the normal state for
   * organisation staff before their first Google sign-in. Written by the Admin page
   * so ticked roles survive until the trigger applies them.
   */
  pending_roles?: StaffRoleGrant[]
}

// Helper function to throw if Supabase client is not initialized
function getSupabaseClient() {
  if (!supabase) {
    throw new Error("Supabase is not configured. Please check your environment variables.")
  }
  return supabase
}

// Helper function to safely execute Edge Function calls with full error logging
async function invokeEdgeFunction<T>(functionName: string, body: Record<string, any>): Promise<T> {
  const client = getSupabaseClient()
  const res = await client.functions.invoke(functionName, { body })

  const stringifyError = (value: unknown): string => {
    if (typeof value === "string") return value
    if (value instanceof Error) return value.message || value.name
    if (value && typeof value === "object") {
      const seen = new WeakSet<object>()
      try {
        const json = JSON.stringify(value, (_key, nested) => {
          if (nested instanceof Error) {
            return { name: nested.name, message: nested.message, stack: nested.stack }
          }
          if (nested && typeof nested === "object") {
            if (seen.has(nested as object)) return "[Circular]"
            seen.add(nested as object)
          }
          return nested
        })
        if (json && json !== "{}") return json
      } catch {
        // fall through to key summary below
      }

      const entries = Object.entries(value as Record<string, unknown>).slice(0, 6)
      if (entries.length > 0) {
        return entries
          .map(([key, nested]) => `${key}=${typeof nested === "string" ? nested : stringifyError(nested)}`)
          .join("; ")
      }

      return "Unknown error object"
    }
    return String(value)
  }

  if (res.error) {
    logError("Edge Function Raw Error", res.error)

    let detailedMessage = stringifyError((res.error as any).message ?? res.error)
    try {
      if ("context" in res.error && res.error.context) {
        const contextResponse = res.error.context as Response
        const rawText = await contextResponse.clone().text()
        try {
          const errorBody = rawText ? JSON.parse(rawText) : null
          if (errorBody?.error || errorBody?.message) {
            detailedMessage = stringifyError(errorBody.error ?? errorBody.message)
          } else if (rawText) {
            detailedMessage = rawText
          }
        } catch {
          if (rawText) {
            detailedMessage = rawText
          }
        }
      }
    } catch {
      // Fallback to res.error.message if parsing fails
    }

    if (detailedMessage === "[object Object]") {
      detailedMessage = stringifyError(res.error)
    }

    throw new Error(`Edge function failed: ${detailedMessage}`)
  }

  if (res.data && typeof res.data === "object" && "error" in res.data) {
    throw new Error(`Edge function failed: ${stringifyError((res.data as any).error)}`)
  }

  return res.data as T
}

// ==========================================
// Assets API
// ==========================================

export async function fetchAssets(): Promise<Asset[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("assets")
    .select("*")
    .order("asset_tag", { ascending: true })

  if (error) throw error
  return (data as Asset[]) || []
}

export async function createAsset(payload: Partial<Asset>): Promise<Asset> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("assets")
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data as Asset
}

export async function updateAsset(id: string, payload: Partial<Asset>): Promise<Asset> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("assets")
    .update(payload)
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return data as Asset
}

export async function deleteAsset(id: string): Promise<void> {
  const client = getSupabaseClient()
  const { error } = await client
    .from("assets")
    .delete()
    .eq("id", id)

  if (error) throw error
}

export async function assignAsset(
  assetId: string,
  assignedToId: string | null,
  assignedToType: "student" | "staff" | null
): Promise<Asset> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("assets")
    .update({
      assigned_to: assignedToId,
      assigned_to_type: assignedToType,
      status: assignedToId ? "in_use" : "available",
      updated_at: new Date().toISOString(),
    })
    .eq("id", assetId)
    .select()
    .single()

  if (error) throw error
  return data as Asset
}

export async function syncAssetsFromGoogleWorkspace(): Promise<{ syncCount: number; errors: string[] }> {
  return invokeEdgeFunction<{ syncCount: number; errors: string[] }>("google-workspace-sync", { type: "assets" })
}

// ==========================================
// Students API
// ==========================================

export async function fetchStudents(): Promise<Student[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("students")
    .select("*")
    .order("last_name", { ascending: true })

  if (error) throw error
  return (data as Student[]) || []
}

export async function createStudent(payload: Partial<Student>): Promise<Student> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("students")
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data as Student
}

export async function updateStudent(id: string, payload: Partial<Student>): Promise<Student> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("students")
    .update(payload)
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return data as Student
}

export async function deleteStudent(id: string): Promise<void> {
  const client = getSupabaseClient()
  const { error } = await client
    .from("students")
    .delete()
    .eq("id", id)

  if (error) throw error
}

export async function syncStudentsFromGoogleWorkspace(
  orgUnitPaths?: string[]
): Promise<{ syncCount: number; year7Count?: number; year8Count?: number; errors: string[] }> {
  return invokeEdgeFunction("google-workspace-sync", { type: "students", orgUnitPaths })
}

// ==========================================
// Staff API
// ==========================================

export async function fetchStaff(): Promise<StaffDirectoryRow[]> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("list_staff_directory")

  if (!error) {
    const rows = (data as StaffDirectoryRpcRow[] | null) ?? []
    if (rows.length > 0) {
      return rows.map(normalizeStaffDirectoryRow)
    }
  }

  const { data: staffRows, error: staffError } = await client
    .from("staff")
    .select("id, profile_id, first_name, last_name, email, phone, role, department, hire_date, status, org_unit_path, created_at, updated_at")
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true })

  if (staffError) {
    if (error) throw error
    throw staffError
  }

  const rows = (staffRows ?? []) as StaffDirectoryRpcRow[]
  const profileIds = Array.from(new Set(rows.map((row) => row.profile_id).filter((profileId): profileId is string => Boolean(profileId))))

  if (profileIds.length === 0) {
    return rows.map(normalizeStaffDirectoryRow)
  }

  const { data: roleRows, error: roleError } = await client
    .from("user_roles")
    .select("profile_id, role, effective_from, effective_to")
    .eq("active", true)
    .in("profile_id", profileIds)
    .or(`effective_from.is.null,effective_from.lte.${getToday()}`)
    .or(`effective_to.is.null,effective_to.gte.${getToday()}`)

  if (roleError) {
    return rows.map(normalizeStaffDirectoryRow)
  }

  const rolesByProfile = new Map<string, string[]>()
  for (const roleRow of roleRows ?? []) {
    const existing = rolesByProfile.get(roleRow.profile_id) ?? []
    if (!existing.includes(roleRow.role)) {
      existing.push(roleRow.role)
    }
    rolesByProfile.set(roleRow.profile_id, existing)
  }

  return rows.map((row) => normalizeStaffDirectoryRow({ ...row, roles: rolesByProfile.get(row.profile_id ?? "") ?? [] }))
}

export async function fetchProfilesByIds(ids: string[]): Promise<Profile[]> {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))

  if (uniqueIds.length === 0) {
    return []
  }

  const client = getSupabaseClient()
  const { data, error } = await client.from("profiles").select("id, email, full_name").in("id", uniqueIds)

  if (error) throw error

  return (data ?? []) as Profile[]
}

export async function resolveProfileIdByEmail(email: string): Promise<string | null> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("resolve_profile_id_by_email", { p_email: email })

  if (error) throw error
  return (data as string | null) ?? null
}

export async function replaceStaffRolesByProfileId(
  profileId: string,
  grants: StaffRoleGrant[],
): Promise<void> {
  const client = getSupabaseClient()

  const { error } = await client.rpc("sync_staff_roles_by_profile_id", {
    p_profile_id: profileId,
    p_grants: normalizeRoleGrants(grants),
  })

  if (error) throw error
}

// ==========================================
// Manual account API
// ==========================================
// Every one of these delegates to the `account-admin` edge function rather than
// calling Supabase directly. Provisioning a login and revoking access both need
// the service role, and the browser must never hold it.

export async function fetchAccountSettings(): Promise<{ allowedEmailDomains: string[] }> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("app_settings")
    .select("allowed_email_domains")
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return { allowedEmailDomains: data?.allowed_email_domains ?? [] }
}

export async function createStaffAccount(payload: {
  email: string
  firstName: string
  lastName: string
  grants: StaffRoleGrant[]
  staffId?: string | null
}): Promise<CreateStaffAccountResult> {
  return invokeEdgeFunction<CreateStaffAccountResult>("account-admin", {
    action: "create_account",
    ...payload,
  })
}

export async function resendStaffInvite(profileId: string): Promise<{ ok: boolean; profileId: string }> {
  return invokeEdgeFunction("account-admin", { action: "resend_invite", profileId })
}

export async function revokeStaffAccess(profileId: string): Promise<{ ok: boolean; profileId: string }> {
  return invokeEdgeFunction("account-admin", { action: "revoke", profileId })
}

export async function restoreStaffAccess(profileId: string): Promise<{ ok: boolean; profileId: string }> {
  return invokeEdgeFunction("account-admin", { action: "restore", profileId })
}

/**
 * Audited role change for someone who already has a login.
 *
 * `replaceStaffRolesByProfileId` writes the same rows but leaves no audit entry, so
 * it is only for callers that cannot reach the edge function.
 */
export async function setStaffRoles(
  profileId: string,
  grants: StaffRoleGrant[],
): Promise<{ ok: boolean; profileId: string }> {
  return invokeEdgeFunction("account-admin", {
    action: "set_roles",
    profileId,
    grants: normalizeRoleGrants(grants),
  })
}

export async function fetchAccountAudit(
  profileId: string,
  limit = 10,
): Promise<AccountAuditRow[]> {
  const result = await invokeEdgeFunction<{ ok: boolean; rows: AccountAuditRow[] }>("account-admin", {
    action: "fetch_audit",
    profileId,
    limit,
  })

  return result.rows ?? []
}

export async function createStaff(payload: StaffWritePayload): Promise<Staff> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("staff")
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data as Staff
}

export async function updateStaff(id: string, payload: Partial<StaffWritePayload>): Promise<Staff> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("staff")
    .update(payload)
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return data as Staff
}

export async function deleteStaff(id: string): Promise<void> {
  const client = getSupabaseClient()
  const { error } = await client
    .from("staff")
    .delete()
    .eq("id", id)

  if (error) throw error
}

export async function syncStaffFromGoogleWorkspace(
  orgUnitPath?: string
): Promise<{ staffSyncCount: number; errors: string[] }> {
  return invokeEdgeFunction("google-workspace-sync", {
    type: "staff",
    orgUnitPaths: orgUnitPath ? [orgUnitPath] : undefined,
  })
}

// ==========================================
// Classes API
// ==========================================

export async function fetchClasses(): Promise<Class[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("classes")
    .select("*")

  if (error) throw error
  return (data as Class[]) || []
}

export async function createClass(payload: ClassInsert): Promise<Class> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("classes")
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data as Class
}

export async function updateClass(id: string, payload: ClassUpdate): Promise<Class> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("classes")
    .update(payload)
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return data as Class
}

export async function deleteClass(id: string): Promise<void> {
  const client = getSupabaseClient()
  const { error } = await client
    .from("classes")
    .delete()
    .eq("id", id)

  if (error) throw error
}

// ==========================================
// Attendance API
// ==========================================

export async function fetchAttendanceRecords(date?: string): Promise<Attendance[]> {
  const client = getSupabaseClient()
  let query = client.from("attendance").select("*").order("date", { ascending: false })

  if (date) {
    query = query.eq("date", date)
  }

  const { data, error } = await query
  if (error) throw error
  return (data as Attendance[]) || []
}

export async function createAttendanceRecord(payload: AttendanceInsert): Promise<Attendance> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("attendance")
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data as Attendance
}

export async function updateAttendanceRecord(id: string, payload: AttendanceUpdate): Promise<Attendance> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("attendance")
    .update(payload)
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return data as Attendance
}

// ==========================================
// Incidents API
// ==========================================

export async function fetchCurrentUserRoles(): Promise<string[]> {
  const client = getSupabaseClient()
  const {
    data: { user },
  } = await client.auth.getUser()

  if (!user) return []

  // A grant that starts next term or ended last term is not in force today, even
  // though the row is still active. Every other read of `user_roles` filters on
  // the window (see user_has_role in Postgres and the edge functions), so this
  // one did too; without it a relief teacher's admin-equivalent roles leaked into
  // their tier before they started.
  const today = getToday()
  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("active", true)
    .or(`effective_from.is.null,effective_from.lte.${today}`)
    .or(`effective_to.is.null,effective_to.gte.${today}`)

  if (error) throw error
  return ((data || []) as Pick<UserRole, "role">[]).map((row) => row.role)
}

export async function fetchIncidentCategories(): Promise<IncidentCategory[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("incident_categories")
    .select("*")
    .eq("active", true)
    .order("name", { ascending: true })

  if (error) throw error
  return (data as IncidentCategory[]) || []
}

export async function fetchIncidents(): Promise<Incident[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("incidents")
    .select("*")
    .order("reported_at", { ascending: false })

  if (error) throw error
  return (data as Incident[]) || []
}

export async function fetchIncidentAssignees(): Promise<Array<Profile & { roles: string[] }>> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("list_incident_assignees")

  if (error) throw error
  return (data as Array<Profile & { roles: string[] }>) || []
}

export async function fetchIncidentStudents(incidentId?: string): Promise<IncidentStudent[]> {
  const client = getSupabaseClient()
  let query = client.from("incident_students").select("*").order("tagged_at", { ascending: true })
  if (incidentId) {
    query = query.eq("incident_id", incidentId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data as IncidentStudent[]) || []
}

export async function replaceIncidentStudents(
  incidentId: string,
  studentIds: string[]
): Promise<IncidentStudent[]> {
  const client = getSupabaseClient()
  const {
    data: { user },
  } = await client.auth.getUser()

  if (!user) {
    throw new Error("You must be signed in to tag students on an incident.")
  }

  const taggedBy = user.id
  const roles = await fetchCurrentUserRoles()
  const hasSensitiveRole = can(roles, "incidents.view_sensitive")
  const isTeacherOnly = !can(roles, "incidents.update_all") && !hasSensitiveRole

  if (isTeacherOnly && studentIds.length > 0) {
    const { data: incidentRows, error: incidentError } = await client
      .from("incidents")
      .select("student_id")
      .eq("id", incidentId)
      .single()

    if (incidentError) throw incidentError

    for (const studentId of studentIds) {
      const { data: inScope, error: scopeError } = await client.rpc("is_student_in_effective_scope", {
        p_teacher_id: taggedBy,
        p_student_id: studentId,
      })

      if (scopeError) throw scopeError
      if (!inScope) {
        throw new Error("You can only tag students currently in your teaching scope.")
      }
    }

    if (incidentRows?.student_id) {
      const { data: primaryInScope, error: primaryScopeError } = await client.rpc("is_student_in_effective_scope", {
        p_teacher_id: taggedBy,
        p_student_id: incidentRows.student_id,
      })

      if (primaryScopeError) throw primaryScopeError
      if (!primaryInScope) {
        throw new Error("The primary student for this incident is no longer in scope.")
      }
    }
  }

  const { error: deleteError } = await client
    .from("incident_students")
    .delete()
    .eq("incident_id", incidentId)
    .select("id")

  if (deleteError) throw deleteError

  if (studentIds.length === 0) {
    return []
  }

  const rows: IncidentStudentInsert[] = studentIds.map((studentId) => ({
    incident_id: incidentId,
    student_id: studentId,
    tagged_by: taggedBy,
  }))

  const { data, error } = await client.from("incident_students").insert(rows).select("*")
  if (error) throw error
  return (data as IncidentStudent[]) || []
}

export async function fetchIncidentFollowUps(incidentId?: string): Promise<IncidentFollowUp[]> {
  const client = getSupabaseClient()
  let query = client.from("incident_follow_ups").select("*").order("created_at", { ascending: false })
  if (incidentId) {
    query = query.eq("incident_id", incidentId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data as IncidentFollowUp[]) || []
}

export async function createIncidentFollowUp(payload: IncidentFollowUpInsert): Promise<IncidentFollowUp> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("incident_follow_ups")
    .insert(payload)
    .select("*")
    .single()

  if (error) throw error
  return data as IncidentFollowUp
}

export async function updateIncidentFollowUp(id: string, payload: Partial<IncidentFollowUpInsert>): Promise<IncidentFollowUp> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("incident_follow_ups")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single()

  if (error) throw error
  return data as IncidentFollowUp
}

export async function fetchIncidentAuditLog(incidentId?: string): Promise<any[]> {
  const client = getSupabaseClient()
  let query = client.from("incident_audit_log").select("*").order("changed_at", { ascending: false })
  if (incidentId) {
    query = query.eq("incident_id", incidentId)
  }

  const { data, error } = await query
  if (error) throw error
  return data || []
}

export async function fetchIncidentEmailDispatchLog(incidentId?: string): Promise<IncidentEmailDispatchLog[]> {
  const client = getSupabaseClient()
  let query = client.from("incident_email_dispatch_log").select("*").order("created_at", { ascending: false })
  if (incidentId) {
    query = query.eq("incident_id", incidentId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data as IncidentEmailDispatchLog[]) || []
}

export async function fetchIncidentManagementReport(asOf?: string): Promise<IncidentManagementReport | null> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("incident_management_report", { p_as_of: asOf })
  if (error) throw error
  return (data?.[0] as IncidentManagementReport) ?? null
}

export async function fetchRetentionDueReport(asOf?: string): Promise<Array<{ incident_id: string; category_id: string; severity: string; archive_due_at: string; dispose_due_at: string; should_archive: boolean; should_dispose: boolean }>> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("retention_due_report", { p_as_of: asOf })
  if (error) throw error
  return data || []
}

export async function sendIncidentMergedEmail(payload: {
  incidentId: string
  templateKey: string
  recipients?: string[]
  extraRecipients?: string[]
  dryRun?: boolean
  subject?: string
}): Promise<any> {
  return invokeEdgeFunction("send-incident-email", payload)
}

export async function createIncident(payload: IncidentInsert): Promise<Incident> {
  const client = getSupabaseClient()

  const {
    data: { user },
  } = await client.auth.getUser()

  if (!user) {
    throw new Error("You must be signed in to create incidents.")
  }

  if (payload.created_by !== user.id) {
    throw new Error("Incident creator must match the signed-in user.")
  }

  const roles = await fetchCurrentUserRoles()
  const hasSensitiveRole = can(roles, "incidents.view_sensitive")
  const isTeacherOnly = !can(roles, "incidents.update_all") && !hasSensitiveRole

  if (roles.length === 0) {
    throw new Error("No incident access role is assigned to your account. Ask leadership to add a user_roles entry.")
  }

  if (!can(roles, "incidents.create_own") && !can(roles, "incidents.update_all")) {
    throw new Error("Your account does not have permission to create incidents.")
  }

  if (isTeacherOnly) {
    const { data: inScope, error: scopeError } = await client.rpc("is_student_in_effective_scope", {
      p_teacher_id: user.id,
      p_student_id: payload.student_id,
    })

    if (scopeError) throw scopeError

    if (!inScope) {
      throw new Error("You can only create incidents for students currently in your teaching scope.")
    }
  }

  const insertPayload: IncidentInsert = {
    ...payload,
    visibility: isTeacherOnly ? "standard" : payload.visibility,
    assigned_to: isTeacherOnly ? null : payload.assigned_to ?? null,
  }

  const { data, error } = await client
    .from("incidents")
    .insert(insertPayload)
    .select()
    .single()

  if (error) throw error
  return data as Incident
}

export async function updateIncident(id: string, payload: IncidentUpdate): Promise<Incident> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("incidents")
    .update(payload)
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return data as Incident
}

export async function fetchIncidentComments(incidentId: string): Promise<IncidentComment[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("incident_comments")
    .select("*")
    .eq("incident_id", incidentId)
    .order("created_at", { ascending: true })

  if (error) throw error
  return (data as IncidentComment[]) || []
}

export async function createIncidentComment(payload: IncidentCommentInsert): Promise<IncidentComment> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("incident_comments")
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data as IncidentComment
}

export async function softDeleteIncident(incidentId: string, reason: string): Promise<Incident> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("soft_delete_incident", {
    p_incident_id: incidentId,
    p_reason: reason,
  })

  if (error) throw error
  return data as Incident
}

export async function restoreIncident(incidentId: string, reason: string): Promise<Incident> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("restore_incident", {
    p_incident_id: incidentId,
    p_reason: reason,
  })

  if (error) throw error
  return data as Incident
}

export async function setIncidentVisibility(
  incidentId: string,
  visibility: "standard" | "sensitive",
  reason: string
): Promise<Incident> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("set_incident_visibility", {
    p_incident_id: incidentId,
    p_visibility: visibility,
    p_reason: reason,
  })

  if (error) throw error
  return data as Incident
}

// ==========================================
// Tickets API
// ==========================================

export async function fetchTicketCategories(): Promise<TicketCategory[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("ticket_categories")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })

  if (error) throw error
  return (data as TicketCategory[]) || []
}

export async function fetchTicketTemplates(): Promise<TicketTemplate[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("ticket_templates")
    .select("*")
    .eq("active", true)
    .order("name", { ascending: true })

  if (error) throw error
  return (data as TicketTemplate[]) || []
}

export async function fetchTicketTemplateSteps(templateId: string): Promise<TicketTemplateStep[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("ticket_template_steps")
    .select("*")
    .eq("template_id", templateId)
    .order("sort_order", { ascending: true })

  if (error) throw error
  return (data as TicketTemplateStep[]) || []
}

export async function fetchTickets(): Promise<Ticket[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("tickets")
    .select("*")
    .order("updated_at", { ascending: false })

  if (error) throw error
  return (data as Ticket[]) || []
}

export async function fetchTicketComments(ticketId?: string): Promise<TicketComment[]> {
  const client = getSupabaseClient()
  let query = client.from("ticket_comments").select("*").order("created_at", { ascending: true })

  if (ticketId) {
    query = query.eq("ticket_id", ticketId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data as TicketComment[]) || []
}

export async function fetchTicketAttachments(ticketId?: string): Promise<TicketAttachment[]> {
  const client = getSupabaseClient()
  let query = client.from("ticket_attachments").select("*").order("created_at", { ascending: true })

  if (ticketId) {
    query = query.eq("ticket_id", ticketId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data as TicketAttachment[]) || []
}

export async function fetchTicketAuditLog(ticketId?: string): Promise<TicketAuditLog[]> {
  const client = getSupabaseClient()
  let query = client.from("ticket_audit_log").select("*").order("changed_at", { ascending: false })

  if (ticketId) {
    query = query.eq("ticket_id", ticketId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data as TicketAuditLog[]) || []
}

export async function fetchTicketNotifications(ticketId?: string): Promise<TicketNotification[]> {
  const client = getSupabaseClient()
  let query = client.from("ticket_notifications").select("*").order("created_at", { ascending: false })

  if (ticketId) {
    query = query.eq("ticket_id", ticketId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data as TicketNotification[]) || []
}

export async function fetchTicketManagementReport(asOf?: string): Promise<TicketManagementReport | null> {
  const client = getSupabaseClient()
  const { data, error } = asOf
    ? await client.rpc("ticket_management_report", { p_as_of: asOf })
    : await client.rpc("ticket_management_report")

  if (error) throw error
  return (data?.[0] as TicketManagementReport) ?? null
}

// ==========================================
// Finance Mirror API
// ==========================================

export async function fetchFinanceIntakeBatches(): Promise<FinanceIntakeBatch[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("finance_intake_batches")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data as FinanceIntakeBatch[]) || []
}

export async function fetchFinanceIntakeItems(): Promise<FinanceIntakeItem[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("finance_intake_items")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data as FinanceIntakeItem[]) || []
}

export async function fetchFinanceInvoiceCandidates(): Promise<FinanceInvoiceCandidate[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("finance_invoice_candidates")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data as FinanceInvoiceCandidate[]) || []
}

export async function fetchFinanceXeroLinks(): Promise<FinanceXeroLink[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("finance_xero_links")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data as FinanceXeroLink[]) || []
}

export async function fetchFinanceProcessingEvents(): Promise<FinanceProcessingEvent[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("finance_processing_events")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data as FinanceProcessingEvent[]) || []
}

export async function fetchFinanceBudgets(): Promise<FinanceBudget[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("finance_budgets")
    .select("*")
    .order("fiscal_year", { ascending: false })
    .order("term", { ascending: true })
    .order("department", { ascending: true })
    .order("category", { ascending: true })

  if (error) throw error
  return (data as FinanceBudget[]) || []
}

export async function fetchFinanceSupplierAliases(): Promise<FinanceSupplierAlias[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("finance_supplier_aliases")
    .select("*")
    .eq("active", true)
    .order("usage_count", { ascending: false })

  if (error) throw error
  return (data as FinanceSupplierAlias[]) || []
}

export async function upsertFinanceSupplierAlias(payload: FinanceSupplierAliasInsert): Promise<FinanceSupplierAlias> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("finance_supplier_aliases")
    .upsert(payload, { onConflict: "normalized_name" })
    .select()
    .single()

  if (error) throw error
  return data as FinanceSupplierAlias
}

export async function createFinanceBudget(payload: FinanceBudgetInsert): Promise<FinanceBudget> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("finance_budgets")
    .insert(payload)
    .select()
    .single()

  if (error) throw error
  return data as FinanceBudget
}

export async function updateFinanceBudget(id: string, payload: FinanceBudgetUpdate): Promise<FinanceBudget> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("finance_budgets")
    .update(payload)
    .eq("id", id)
    .select()
    .single()

  if (error) throw error
  return data as FinanceBudget
}

export async function deleteFinanceBudget(id: string): Promise<void> {
  const client = getSupabaseClient()
  const { error } = await client
    .from("finance_budgets")
    .delete()
    .eq("id", id)

  if (error) throw error
}

export async function fetchFinanceForecastSnapshots(): Promise<FinanceForecastSnapshot[]> {
  const client = getSupabaseClient()
  const { data, error } = await client
    .from("finance_forecast_snapshots")
    .select("*")
    .order("snapshot_date", { ascending: false })
    .order("horizon_weeks", { ascending: true })

  if (error) throw error
  return (data as FinanceForecastSnapshot[]) || []
}

function sanitizeStorageSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

async function digestFile(file: File) {
  const bytes = await file.arrayBuffer()
  if (typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.digest === "function") {
    const hash = await crypto.subtle.digest("SHA-256", bytes)
    return Array.from(new Uint8Array(hash))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }
  // Fallback when crypto.subtle is unavailable (non-secure context / older runtime):
  // a stable-enough fingerprint derived from file metadata + content length, so
  // deduplication still works without throwing.
  const size = bytes.byteLength
  const name = (file.name || "attachment").replace(/[^a-z0-9._-]+/gi, "-").toLowerCase()
  const sample = Array.from(new Uint8Array(bytes.slice(0, 64)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  let fallback = `fallback-${size}-${name}-${sample}`
  // Keep it short enough for a storage path segment.
  return fallback.slice(0, 64)
}

export async function uploadFinanceIntakeAttachment(file: File): Promise<{ storagePath: string; sourceFingerprint: string }> {
  const client = getSupabaseClient()
  const digest = await digestFile(file)
  const fileName = sanitizeStorageSegment(file.name || "attachment") || "attachment"
  const storagePath = `manual/${digest.slice(0, 2)}/${digest}-${fileName}`
  const { error } = await client.storage.from("finance-intake-attachments").upload(storagePath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  })

  if (error) throw error

  return {
    storagePath,
    sourceFingerprint: `manual:${digest}:${fileName}:${file.size}`,
  }
}

export type FinanceDashboardData = {
  intakeBatches: FinanceIntakeBatch[]
  intakeItems: FinanceIntakeItem[]
  invoiceCandidates: FinanceInvoiceCandidate[]
  xeroLinks: FinanceXeroLink[]
  processingEvents: FinanceProcessingEvent[]
  budgets: FinanceBudget[]
  forecastSnapshots: FinanceForecastSnapshot[]
}

export async function fetchFinanceDashboardData(): Promise<FinanceDashboardData> {
  const [
    intakeBatchesResult,
    intakeItemsResult,
    invoiceCandidatesResult,
    xeroLinksResult,
    processingEventsResult,
    budgetsResult,
    forecastSnapshotsResult,
  ] = await Promise.allSettled([
    fetchFinanceIntakeBatches(),
    fetchFinanceIntakeItems(),
    fetchFinanceInvoiceCandidates(),
    fetchFinanceXeroLinks(),
    fetchFinanceProcessingEvents(),
    fetchFinanceBudgets(),
    fetchFinanceForecastSnapshots(),
  ])

  return {
    intakeBatches: intakeBatchesResult.status === "fulfilled" ? intakeBatchesResult.value : [],
    intakeItems: intakeItemsResult.status === "fulfilled" ? intakeItemsResult.value : [],
    invoiceCandidates: invoiceCandidatesResult.status === "fulfilled" ? invoiceCandidatesResult.value : [],
    xeroLinks: xeroLinksResult.status === "fulfilled" ? xeroLinksResult.value : [],
    processingEvents: processingEventsResult.status === "fulfilled" ? processingEventsResult.value : [],
    budgets: budgetsResult.status === "fulfilled" ? budgetsResult.value : [],
    forecastSnapshots: forecastSnapshotsResult.status === "fulfilled" ? forecastSnapshotsResult.value : [],
  }
}

export async function enqueueFinanceIntakeItem(payload: {
  sourceFingerprint: string
  source?: string
  sourceType?: string
  batchId?: string
  batchStatus?: string
  sourceLabel?: string
  messageCount?: number
  itemCount?: number
  processedCount?: number
  errorCount?: number
  scheduledFor?: string | null
  notes?: string | null
  sourceKey?: string | null
  gmailMessageId?: string | null
  gmailThreadId?: string | null
  labelName?: string | null
  subject?: string | null
  senderEmail?: string | null
  receivedAt?: string | null
  fileName?: string | null
  mimeType?: string | null
  storagePath?: string | null
  status?: string
  confidence?: number
  duplicateRisk?: string
  metadata?: Record<string, any>
}): Promise<any> {
  return invokeEdgeFunction("finance-intake", { action: "enqueue", ...payload })
}

export async function processFinanceIntakeQueue(payload: {
  batchId?: string | null
  itemIds?: string[]
  candidateIds?: string[]
  limit?: number
  // Replacement invoice numbers keyed by candidate id, for bills whose number Xero has
  // permanently consumed. The API never renumbers a bill on its own.
  invoiceNumberOverrides?: Record<string, string>
  action?: "process" | "replay" | "sync_gmail" | "post_xero" | "record_edit"
}): Promise<any> {
  return invokeEdgeFunction("finance-intake", { action: payload.action ?? "process", ...payload })
}

/**
 * Re-runs extraction for a single intake item from the review panel. The previous
 * candidate is soft-reset and a fresh job is queued for the next process pass, so
 * the model re-reads the document instead of replaying the cached extraction.
 */
export async function reprocessFinanceIntakeItem(itemId: string): Promise<any> {
  return invokeEdgeFunction("finance-intake", { action: "reprocess", itemId })
}

export type FinanceIntakeLog = {
  id: number
  intake_item_id: string | null
  candidate_id: string | null
  event_type: string
  field_name: string | null
  original_value: unknown
  updated_value: unknown
  diff: Array<{ field: string; original: unknown; updated: unknown }>
  actor_id: string | null
  actor_label: string | null
  source: string
  metadata: Record<string, unknown>
  created_at: string
}

/**
 * Appends the immutable lifecycle log for an intake item.
 *
 * Only inserts are exposed. The table has no update or delete policy and a trigger
 * blocks both, so history cannot be rewritten even by a client that tries.
 */
export async function appendFinanceIntakeLog(payload: {
  intakeItemId?: string | null
  candidateId?: string | null
  eventType: string
  fieldName?: string | null
  originalValue?: unknown
  updatedValue?: unknown
  diff?: Array<{ field: string; original: unknown; updated: unknown }>
  source?: "system" | "worker" | "user" | "scheduler"
  metadata?: Record<string, unknown>
}): Promise<void> {
  const client = getSupabaseClient()
  const { error } = await client.from("finance_intake_logs").insert({
    intake_item_id: payload.intakeItemId ?? null,
    candidate_id: payload.candidateId ?? null,
    event_type: payload.eventType,
    field_name: payload.fieldName ?? null,
    original_value: payload.originalValue ?? null,
    updated_value: payload.updatedValue ?? null,
    diff: payload.diff ?? [],
    source: payload.source ?? "user",
    metadata: payload.metadata ?? {},
  })
  if (error) throw error
}

export async function fetchFinanceIntakeLogs(
  options: { intakeItemId?: string; candidateId?: string; limit?: number } = {},
): Promise<FinanceIntakeLog[]> {
  const client = getSupabaseClient()
  let query = client
    .from("finance_intake_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 100)

  if (options.intakeItemId) query = query.eq("intake_item_id", options.intakeItemId)
  if (options.candidateId) query = query.eq("candidate_id", options.candidateId)

  const { data, error } = await query
  if (error) throw error
  return (data as FinanceIntakeLog[]) || []
}

/**
 * Saves a manual correction to an extracted invoice.
 *
 * Routed through the edge function rather than a direct table update so the
 * before/after diff is computed server-side, where the pre-edit row is still
 * available. A client-side update would only ever see the value it is replacing.
 *
 * The acting user is deliberately not a parameter: the edge function reads it from
 * the verified session so the audit row cannot be attributed to someone else.
 */
export async function recordFinanceCandidateEdit(payload: {
  candidateId: string
  edits: Record<string, unknown>
}): Promise<{ diffs: Array<{ field: string; original: unknown; updated: unknown }> }> {
  const result = await invokeEdgeFunction<{ diffs?: Array<{ field: string; original: unknown; updated: unknown }> }>(
    "finance-intake",
    {
      action: "record_edit",
      candidateId: payload.candidateId,
      edits: payload.edits,
    },
  )
  return { diffs: result?.diffs ?? [] }
}

export async function createTicketFromTemplate(payload: {
  templateCode: string
  title: string
  summary?: string
  priority?: string
  submissionPayload?: Record<string, any>
  deviceContext?: Record<string, any>
  requestContext?: Record<string, any>
}): Promise<Ticket> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("create_ticket_from_template", {
    p_template_code: payload.templateCode,
    p_title: payload.title,
    p_summary: payload.summary,
    p_priority: payload.priority,
    p_submission_payload: payload.submissionPayload ?? {},
    p_device_context: payload.deviceContext ?? {},
    p_request_context: payload.requestContext ?? {},
  })

  if (error) throw error
  return data as Ticket
}

export async function assignTicket(ticketId: string, assignedTo: string | null, reason?: string): Promise<Ticket> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("assign_ticket", {
    p_ticket_id: ticketId,
    p_assigned_to: assignedTo,
    p_reason: reason,
  })

  if (error) throw error
  return data as Ticket
}

/**
 * Take an unassigned ticket. Distinct from `assignTicket`, which is the
 * assign-to-someone-else action: the claim RPC refuses to overwrite an existing
 * assignee, and the server distinguishes "already taken" from "not permitted".
 */
export async function claimTicket(ticketId: string, reason?: string): Promise<Ticket> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("claim_ticket", {
    p_ticket_id: ticketId,
    p_reason: reason,
  })

  if (error) throw error
  return data as Ticket
}

export async function transitionTicketStatus(
  ticketId: string,
  status: string,
  reason?: string,
  override = false
): Promise<Ticket> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("transition_ticket_status", {
    p_ticket_id: ticketId,
    p_status: status,
    p_reason: reason,
    p_override: override,
  })

  if (error) throw error
  return data as Ticket
}

export async function requestTicketClose(ticketId: string, comment?: string): Promise<Ticket> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("request_ticket_close", {
    p_ticket_id: ticketId,
    p_comment: comment,
  })

  if (error) throw error
  return data as Ticket
}

export async function addTicketComment(payload: {
  ticketId: string
  content: string
  commentType?: string
  isCloseRequest?: boolean
}): Promise<TicketComment> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("add_ticket_comment", {
    p_ticket_id: payload.ticketId,
    p_content: payload.content,
    p_comment_type: payload.commentType,
    p_is_close_request: payload.isCloseRequest,
  })

  if (error) throw error
  return data as TicketComment
}

export async function archiveTicket(ticketId: string, reason?: string): Promise<Ticket> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("archive_ticket", {
    p_ticket_id: ticketId,
    p_reason: reason,
  })

  if (error) throw error
  return data as Ticket
}

export async function restoreTicket(ticketId: string, reason?: string): Promise<Ticket> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("restore_ticket", {
    p_ticket_id: ticketId,
    p_reason: reason,
  })

  if (error) throw error
  return data as Ticket
}

type SupabaseAnyClient = ReturnType<typeof getSupabaseClient> & Record<string, any>

function getAnySupabaseClient() {
  return getSupabaseClient() as SupabaseAnyClient
}

async function fetchDatasetRows<T>(table: string, orderBy: string, ascending: boolean, ticketId?: string): Promise<T[]> {
  const client = getAnySupabaseClient()
  let query = client.from(table).select("*").order(orderBy, { ascending })

  if (ticketId) {
    query = query.eq("ticket_id", ticketId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data as T[]) || []
}

async function runDatasetRpc<T>(name: string, args: Record<string, any>): Promise<T> {
  const client = getAnySupabaseClient()
  const { data, error } = await client.rpc(name, args)

  if (error) throw error
  return data as T
}

export async function fetchRmTicketCategories(): Promise<TicketCategory[]> {
  const client = getAnySupabaseClient()
  const { data, error } = await client
    .from("rm_ticket_categories")
    .select("*")
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })

  if (error) throw error
  return (data as TicketCategory[]) || []
}

export async function fetchRmTicketTemplates(): Promise<TicketTemplate[]> {
  const client = getAnySupabaseClient()
  const { data, error } = await client
    .from("rm_ticket_templates")
    .select("*")
    .eq("active", true)
    .order("name", { ascending: true })

  if (error) throw error
  return (data as TicketTemplate[]) || []
}

export async function fetchRmTicketTemplateSteps(templateId: string): Promise<TicketTemplateStep[]> {
  return fetchDatasetRows<TicketTemplateStep>("rm_ticket_template_steps", "sort_order", true, undefined).then((rows) => rows.filter((row) => row.template_id === templateId))
}

export async function fetchRmTickets(): Promise<Ticket[]> {
  const client = getAnySupabaseClient()
  const { data, error } = await client
    .from("rm_tickets")
    .select("*")
    .order("updated_at", { ascending: false })

  if (error) throw error
  return (data as Ticket[]) || []
}

export async function fetchRmTicketComments(ticketId?: string): Promise<TicketComment[]> {
  return fetchDatasetRows<TicketComment>("rm_ticket_comments", "created_at", true, ticketId)
}

export async function fetchRmTicketAttachments(ticketId?: string): Promise<TicketAttachment[]> {
  return fetchDatasetRows<TicketAttachment>("rm_ticket_attachments", "created_at", true, ticketId)
}

export async function fetchRmTicketAuditLog(ticketId?: string): Promise<TicketAuditLog[]> {
  return fetchDatasetRows<TicketAuditLog>("rm_ticket_audit_log", "changed_at", false, ticketId)
}

export async function fetchRmTicketNotifications(ticketId?: string): Promise<TicketNotification[]> {
  return fetchDatasetRows<TicketNotification>("rm_ticket_notifications", "created_at", false, ticketId)
}

export async function fetchRmTicketManagementReport(asOf?: string): Promise<TicketManagementReport | null> {
  const data = asOf
    ? await runDatasetRpc<TicketManagementReport[]>("rm_ticket_management_report", { p_as_of: asOf })
    : await runDatasetRpc<TicketManagementReport[]>("rm_ticket_management_report", {})

  return data?.[0] ?? null
}

export async function createRmTicketFromTemplate(payload: {
  templateCode: string
  title: string
  summary?: string
  priority?: string
  submissionPayload?: Record<string, any>
  deviceContext?: Record<string, any>
  requestContext?: Record<string, any>
}): Promise<Ticket> {
  return runDatasetRpc<Ticket>("create_rm_ticket_from_template", {
    p_template_code: payload.templateCode,
    p_title: payload.title,
    p_summary: payload.summary,
    p_priority: payload.priority,
    p_submission_payload: payload.submissionPayload ?? {},
    p_device_context: payload.deviceContext ?? {},
    p_request_context: payload.requestContext ?? {},
  })
}

export async function assignRmTicket(ticketId: string, assignedTo: string | null, reason?: string): Promise<Ticket> {
  return runDatasetRpc<Ticket>("assign_rm_ticket", {
    p_ticket_id: ticketId,
    p_assigned_to: assignedTo,
    p_reason: reason,
  })
}

/** See `claimTicket`. Mirrors it for the R&M queue. */
export async function claimRmTicket(ticketId: string, reason?: string): Promise<Ticket> {
  return runDatasetRpc<Ticket>("claim_rm_ticket", {
    p_ticket_id: ticketId,
    p_reason: reason,
  })
}

export async function transitionRmTicketStatus(
  ticketId: string,
  status: string,
  reason?: string,
  override = false
): Promise<Ticket> {
  return runDatasetRpc<Ticket>("transition_rm_ticket_status", {
    p_ticket_id: ticketId,
    p_status: status,
    p_reason: reason,
    p_override: override,
  })
}

export async function requestRmTicketClose(ticketId: string, comment?: string): Promise<Ticket> {
  return runDatasetRpc<Ticket>("request_rm_ticket_close", {
    p_ticket_id: ticketId,
    p_comment: comment,
  })
}

export async function addRmTicketComment(payload: {
  ticketId: string
  content: string
  commentType?: string
  isCloseRequest?: boolean
}): Promise<TicketComment> {
  return runDatasetRpc<TicketComment>("add_rm_ticket_comment", {
    p_ticket_id: payload.ticketId,
    p_content: payload.content,
    p_comment_type: payload.commentType,
    p_is_close_request: payload.isCloseRequest,
  })
}

export async function archiveRmTicket(ticketId: string, reason?: string): Promise<Ticket> {
  return runDatasetRpc<Ticket>("archive_rm_ticket", {
    p_ticket_id: ticketId,
    p_reason: reason,
  })
}

export async function restoreRmTicket(ticketId: string, reason?: string): Promise<Ticket> {
  return runDatasetRpc<Ticket>("restore_rm_ticket", {
    p_ticket_id: ticketId,
    p_reason: reason,
  })
}

// ==========================================
// Dashboard Stats API
// ==========================================

type StatusSummary = Record<string, number>

type LeadershipDashboardSection = {
  totalStudents: number
  totalClasses: number
  totalStaff: number
  activeIncidents: number
  openTickets: number
  attendanceToday: number
  studentsByStatus: StatusSummary
  ticketsByStatus: StatusSummary
}

type OperationalDashboardSection = {
  classesInScope: number
  studentsInScope: number
  incidentsInWork: number
  openTickets: number
  followUpsDue: number
  ticketsByStatus: StatusSummary
}

type ItAdminDashboardSection = {
  totalTickets: number
  unassignedTickets: number
  activeItStaff: number
  openIncidents: number
  pendingRoleUpdates: number
  roleDistribution: StatusSummary
}

/**
 * Dashboard sections are keyed by the capability that produces them, not by a
 * tier name:
 *
 * - `schoolWide` requires `access.manage` (site admin): every count is a plain
 *   table total.
 * - `assigned` requires any of the `*.view_assigned` / `*.view_own` scoped
 *   capabilities: counts come from the effective-scope views.
 * - `itAdmin` requires `ict.view_all` or `rm.view_all` without assigned scope:
 *   queue triage, unassigned volume, and access-review rows.
 *
 * A viewer can satisfy more than one rule, so every matching section is filled.
 */
export type DashboardStatsForRole = {
  role: AppRole | null
  roles: AppRole[]
  schoolWide?: LeadershipDashboardSection
  assigned?: OperationalDashboardSection
  itAdmin?: ItAdminDashboardSection
}

function toStatusSummary(rows: Array<{ status: string | null }>): StatusSummary {
  return rows.reduce<StatusSummary>((acc, row) => {
    const key = row.status?.trim() || "unknown"
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}

function toKeySummary(rows: Array<Record<string, string | null>>, keyName: string): StatusSummary {
  return rows.reduce<StatusSummary>((acc, row) => {
    const rawValue = row[keyName]
    const key = rawValue?.trim() || "unknown"
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})
}

function buildDashboardStatsFromPayload(
  payload: Partial<DashboardStatsForRole> & Pick<DashboardStatsForRole, "role" | "roles">
): DashboardStatsForRole {
  return {
    role: payload.role,
    roles: payload.roles ?? [],
    schoolWide: payload.schoolWide,
    assigned: payload.assigned,
    itAdmin: payload.itAdmin,
  }
}

/**
 * Whether an RPC payload actually carries at least one section.
 *
 * The dashboard reads `stats.schoolWide?.totalStudents ?? stats.assigned?....
 * ?? stats.itAdmin?.openIncidents`, so a payload whose sections are all missing
 * does not throw. It silently degrades every metric to a live table count and
 * every role-specific figure to zero, which presents as "my role gives me no
 * content". Rejecting an empty payload costs one extra round trip instead of an
 * empty dashboard.
 */
function hasAnyDashboardSection(stats: DashboardStatsForRole): boolean {
  return Boolean(stats.schoolWide || stats.assigned || stats.itAdmin)
}

async function fetchDashboardStatsFromRpc(role: AppRole | null): Promise<DashboardStatsForRole | null> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("dashboard_stats_for_role", { p_role: role })

  if (error || !data) {
    return null
  }

  if (typeof data !== "object" || Array.isArray(data)) {
    return null
  }

  const payload = data as Partial<DashboardStatsForRole> & Pick<DashboardStatsForRole, "role" | "roles">
  const stats = buildDashboardStatsFromPayload(payload)

  // Rejected rather than returned, so the caller falls back to the local
  // implementation instead of rendering a role-less dashboard.
  if (!hasAnyDashboardSection(stats)) return null

  return stats
}

function shouldUseDashboardStatsRpc(): boolean {
  if (!supabaseUrl) {
    return false
  }

  try {
    const url = new URL(supabaseUrl)
    return url.port !== "54321" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1"
  } catch {
    return true
  }
}

/** Whether the viewer sees whole queues rather than just their own work. */
function hasQueueScope(roles: AppRole[]) {
  return canAny(roles, ["ict.view_all", "rm.view_all"])
}

/** Whether the viewer works from assigned scope rather than whole queues. */
function hasAssignedScope(roles: AppRole[]) {
  return canAny(roles, [
    "students.view_assigned",
    "classes.view_assigned",
    "attendance.view_assigned",
    "ict.view_assigned",
    "rm.view_assigned",
  ])
}

/**
 * Classes in scope for this user.
 *
 * `class_staff_assignments` is windowed, so a row whose `effective_from` is in
 * the future or whose `effective_to` has passed must not count. The old query
 * applied no window filter at all, so a staff member kept seeing last year's
 * classes.
 */
async function fetchClassesInScope(client: ReturnType<typeof getSupabaseClient>, staffId: string) {
  const today = getToday()
  const { data, error } = await client
    .from("class_staff_assignments")
    .select("class_id")
    .eq("staff_profile_id", staffId)
    .or(`effective_from.is.null,effective_from.lte.${today}`)
    .or(`effective_to.is.null,effective_to.gte.${today}`)

  if (error) throw error

  return new Set((data ?? []).map((row) => row.class_id as string))
}

/**
 * Students in scope for this user.
 *
 * This reads `effective_teacher_student_scope` rather than `teacher_student_scope`
 * directly. The view already applies the `is_excluded` flag, the assignment
 * window, and the class-derived rows, so counting the base table disagreed with
 * `is_student_in_effective_scope` on both the window and the class join.
 */
async function fetchStudentsInScope(client: ReturnType<typeof getSupabaseClient>, staffId: string) {
  const { data, error } = await client.from("effective_teacher_student_scope").select("student_id").eq("teacher_id", staffId)

  if (error) throw error

  return data?.length ?? 0
}

/**
 * School-wide totals. Gated on `access.manage`.
 */
async function fetchSchoolWideSection(client: ReturnType<typeof getSupabaseClient>): Promise<LeadershipDashboardSection> {
  const [studentsRes, classesRes, staffRes, incidentsRes, ticketsRes, rmTicketsRes, attendanceRes] = await Promise.all([
    client.from("students").select("status"),
    client.from("classes").select("id", { count: "exact", head: true }),
    client.from("staff").select("id", { count: "exact", head: true }),
    client.from("incidents").select("status").eq("is_deleted", false).in("status", ["open", "in_review"]),
    client.from("tickets").select("status").eq("is_deleted", false).not("status", "in", "(resolved,closed,archived)"),
    client.from("rm_tickets").select("status").eq("is_deleted", false).not("status", "in", "(resolved,closed,archived)"),
    client.from("attendance").select("id", { count: "exact", head: true }).eq("date", getToday()),
  ])

  if (studentsRes.error) throw studentsRes.error
  if (classesRes.error) throw classesRes.error
  if (staffRes.error) throw staffRes.error
  if (incidentsRes.error) throw incidentsRes.error
  if (ticketsRes.error) throw ticketsRes.error
  if (rmTicketsRes.error) throw rmTicketsRes.error
  if (attendanceRes.error) throw attendanceRes.error

  return {
    totalStudents: studentsRes.data?.length ?? 0,
    totalClasses: classesRes.count ?? 0,
    totalStaff: staffRes.count ?? 0,
    activeIncidents: incidentsRes.data?.length ?? 0,
    openTickets: (ticketsRes.data?.length ?? 0) + (rmTicketsRes.data?.length ?? 0),
    attendanceToday: attendanceRes.count ?? 0,
    studentsByStatus: toStatusSummary((studentsRes.data ?? []) as Array<{ status: string | null }>),
    ticketsByStatus: toStatusSummary((ticketsRes.data ?? []) as Array<{ status: string | null }>),
  }
}

/**
 * Assigned-scope counts. Reads the effective sources so these agree with
 * `is_student_in_effective_scope`.
 */
async function fetchAssignedSection(client: ReturnType<typeof getSupabaseClient>, staffId: string): Promise<OperationalDashboardSection> {
  const classesInScope = await fetchClassesInScope(client, staffId)
  const [studentsInScope, incidentsRes, ticketsRes, rmTicketsRes, followUpsRes] = await Promise.all([
    fetchStudentsInScope(client, staffId),
    client.from("incidents").select("status").eq("is_deleted", false).or(`created_by.eq.${staffId},assigned_to.eq.${staffId}`),
    client.from("tickets").select("status").eq("is_deleted", false).or(`requester_id.eq.${staffId},assigned_to.eq.${staffId}`).not("status", "in", "(resolved,closed,archived)"),
    client.from("rm_tickets").select("status").eq("is_deleted", false).or(`requester_id.eq.${staffId},assigned_to.eq.${staffId}`).not("status", "in", "(resolved,closed,archived)"),
    client.from("incident_follow_ups").select("id", { count: "exact", head: true }).or(`author_id.eq.${staffId},assigned_to.eq.${staffId}`).is("completed_at", null),
  ])

  if (incidentsRes.error) throw incidentsRes.error
  if (ticketsRes.error) throw ticketsRes.error
  if (rmTicketsRes.error) throw rmTicketsRes.error
  if (followUpsRes.error) throw followUpsRes.error

  return {
    classesInScope: classesInScope.size,
    studentsInScope,
    incidentsInWork: incidentsRes.data?.length ?? 0,
    openTickets: (ticketsRes.data?.length ?? 0) + (rmTicketsRes.data?.length ?? 0),
    followUpsDue: followUpsRes.count ?? 0,
    ticketsByStatus: toStatusSummary((ticketsRes.data ?? []) as Array<{ status: string | null }>),
  }
}

/**
 * Whole-queue triage counts. `activeItStaff` comes from `user_roles`, not the
 * legacy `staff.role` column, which disagreed with the rows `assign_ticket`
 * validates against.
 */
async function fetchItAdminSection(client: ReturnType<typeof getSupabaseClient>): Promise<ItAdminDashboardSection> {
  const today = getToday()
  const [ticketsRes, rmTicketsRes, incidentsRes, staffRolesRes, roleRowsRes, pendingRolesRes] = await Promise.all([
    client.from("tickets").select("status, assigned_to").eq("is_deleted", false),
    client.from("rm_tickets").select("status, assigned_to").eq("is_deleted", false),
    client.from("incidents").select("status").eq("is_deleted", false).in("status", ["open", "in_review"]),
    client
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .eq("role", "it_staff")
      .or(`effective_from.is.null,effective_from.lte.${today}`)
      .or(`effective_to.is.null,effective_to.gte.${today}`),
    client
      .from("user_roles")
      .select("role")
      .eq("active", true)
      .or(`effective_from.is.null,effective_from.lte.${today}`)
      .or(`effective_to.is.null,effective_to.gte.${today}`),
    client.from("user_roles").select("id", { count: "exact", head: true }).eq("active", false),
  ])

  if (ticketsRes.error) throw ticketsRes.error
  if (rmTicketsRes.error) throw rmTicketsRes.error
  if (incidentsRes.error) throw incidentsRes.error
  if (staffRolesRes.error) throw staffRolesRes.error
  if (roleRowsRes.error) throw roleRowsRes.error
  if (pendingRolesRes.error) throw pendingRolesRes.error

  const finalStatuses = ["resolved", "closed", "archived"]
  const allTickets = [
    ...((ticketsRes.data ?? []) as Array<{ status: string | null; assigned_to: string | null }>),
    ...((rmTicketsRes.data ?? []) as Array<{ status: string | null; assigned_to: string | null }>),
  ]

  return {
    totalTickets: allTickets.length,
    unassignedTickets: allTickets.filter((ticket) => !ticket.assigned_to && !finalStatuses.includes(ticket.status ?? "")).length,
    activeItStaff: staffRolesRes.count ?? 0,
    openIncidents: incidentsRes.data?.length ?? 0,
    pendingRoleUpdates: pendingRolesRes.count ?? 0,
    roleDistribution: toKeySummary((roleRowsRes.data ?? []) as Array<Record<string, string | null>>, "role"),
  }
}

/**
 * Local fallback for `dashboard_stats_for_role`.
 *
 * The section rules mirror the SQL function exactly, and a viewer can satisfy
 * more than one: a site admin gets `schoolWide` *and* `itAdmin`, while an
 * `it_admin` gets `assigned` *and* `itAdmin`. Only `assigned` is suppressed for
 * a school-wide viewer, because its figures are subsumed by the totals. Keeping
 * the combination rules identical is what stops the local stack (where the RPC
 * is disabled) from showing a different dashboard from production.
 */
async function fetchDashboardStatsLocally(roleHint?: AppRole | null): Promise<DashboardStatsForRole> {
  const client = getSupabaseClient()
  const [{ data: userData }, rawRoles] = await Promise.all([
    client.auth.getUser(),
    fetchCurrentUserRoles().catch(() => []),
  ])

  const roles = toAppRoles(rawRoles)
  const role = roleHint ?? defaultActiveRole(roles)
  const userId = userData.user?.id ?? null
  const scopedUserId = userId ?? "__missing__"
  const schoolWide = can(rawRoles, "access.manage")
  const assigned = !schoolWide && hasAssignedScope(roles)
  const queue = hasQueueScope(roles)

  const [schoolWideSection, assignedSection, itAdminSection] = await Promise.all([
    schoolWide ? fetchSchoolWideSection(client) : Promise.resolve(undefined),
    assigned ? fetchAssignedSection(client, scopedUserId) : Promise.resolve(undefined),
    queue ? fetchItAdminSection(client) : Promise.resolve(undefined),
  ])

  return {
    role,
    roles,
    schoolWide: schoolWideSection,
    assigned: assignedSection,
    itAdmin: itAdminSection,
  }
}

export async function fetchDashboardStatsForRole(role?: AppRole | null): Promise<DashboardStatsForRole> {
  const client = getSupabaseClient()
  const { data: authData } = await client.auth.getUser()
  const roles = authData.user ? await fetchCurrentUserRoles().catch(() => []) : []
  const resolvedRole = role ?? defaultActiveRole(roles)

  if (shouldUseDashboardStatsRpc()) {
    const rpcStats = await fetchDashboardStatsFromRpc(resolvedRole).catch(() => null)
    if (rpcStats) {
      return rpcStats
    }
  }

  return fetchDashboardStatsLocally(resolvedRole)
}

export async function fetchDashboardStats(): Promise<DashboardStatsForRole> {
  return fetchDashboardStatsForRole()
}
