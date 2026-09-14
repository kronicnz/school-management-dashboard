import { supabase } from "../supabaseClient"
import {
  getOperationalSubtype,
  getResolvedRoleTier,
  isItAdminTier,
  isLeadershipTier,
  isOperationalStaffTier,
  type OperationalSubtype,
  type RoleTier,
} from "../role-tier"
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
} from "./database.types"
import { logError } from "../../utils/logger"

export type StaffDirectoryRow = Staff & {
  profile_id: string | null
  roles: string[]
  primary_role: string | null
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

  if (res.error) {
    logError("Google Workspace Sync Raw Error", res.error)

    let detailedMessage = res.error.message
    try {
      if ("context" in res.error && res.error.context) {
        const errorBody = await (res.error.context as Response).json()
        if (errorBody?.error || errorBody?.message) {
          detailedMessage = errorBody.error || errorBody.message
        }
      }
    } catch {
      // Fallback to res.error.message if parsing fails
    }

    throw new Error(`Sync failed: ${detailedMessage}`)
  }

  if (res.data && typeof res.data === "object" && "error" in res.data) {
    throw new Error(`Sync failed: ${(res.data as any).error}`)
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

  if (error) throw error

  const rows = (data as Array<StaffDirectoryRow & { roles?: string[] | null }>) || []

  return rows.map((row) => {
    const roles = Array.from(new Set((row.roles ?? []).filter(Boolean)))
    return {
      ...row,
      roles,
      primary_role: row.primary_role ?? roles[0] ?? null,
      role: roles[0] ?? row.role ?? null,
    }
  })
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

export async function replaceStaffRolesByProfileId(profileId: string, roles: string[]): Promise<void> {
  const client = getSupabaseClient()
  const normalizedRoles = Array.from(new Set(roles.map((role) => role.trim()).filter(Boolean)))

  const { error } = await client.rpc("sync_staff_roles_by_profile_id", {
    p_profile_id: profileId,
    p_roles: normalizedRoles,
  })

  if (error) throw error
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

  const { data, error } = await client
    .from("user_roles")
    .select("role")
    .eq("profile_id", user.id)
    .eq("active", true)

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
  const hasLeadershipRole = roles.some((role) =>
    ["counsellor", "principal", "deputy_principal", "counsellor_delegate", "leadership_delegate"].includes(role)
  )
  const isTeacherOnly = roles.includes("teacher") && !hasLeadershipRole

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
  const hasLeadershipRole = roles.some((role) =>
    ["counsellor", "principal", "deputy_principal", "counsellor_delegate", "leadership_delegate"].includes(role)
  )
  const isTeacherOnly = roles.includes("teacher") && !hasLeadershipRole

  if (roles.length === 0) {
    throw new Error("No incident access role is assigned to your account. Ask leadership to add a user_roles entry.")
  }

  if (!roles.includes("teacher") && !hasLeadershipRole) {
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

export function hasItAdminRole(roles: string[] | undefined) {
  return isItAdminTier(getResolvedRoleTier(roles))
}

export function hasItStaffRole(roles: string[] | undefined) {
  const tier = getResolvedRoleTier(roles)
  return isItAdminTier(tier) || isOperationalStaffTier(tier)
}

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
  const { data, error } = await client.rpc("ticket_management_report", { p_as_of: asOf })

  if (error) throw error
  return (data?.[0] as TicketManagementReport) ?? null
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

export type DashboardStatsForTier = {
  tier: RoleTier
  operationalSubtype: OperationalSubtype
  leadership?: LeadershipDashboardSection
  operational?: OperationalDashboardSection
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

function buildDashboardStatsFromPayload(payload: Partial<DashboardStatsForTier> & Pick<DashboardStatsForTier, "tier" | "operationalSubtype">): DashboardStatsForTier {
  return {
    tier: payload.tier,
    operationalSubtype: payload.operationalSubtype,
    leadership: payload.leadership,
    operational: payload.operational,
    itAdmin: payload.itAdmin,
  }
}

async function fetchDashboardStatsFromRpc(tier: RoleTier): Promise<DashboardStatsForTier | null> {
  const client = getSupabaseClient()
  const { data, error } = await client.rpc("dashboard_stats_for_tier", { p_tier: tier })

  if (error || !data) {
    return null
  }

  if (typeof data !== "object" || Array.isArray(data)) {
    return null
  }

  const payload = data as Partial<DashboardStatsForTier> & Pick<DashboardStatsForTier, "tier" | "operationalSubtype">
  return buildDashboardStatsFromPayload(payload)
}

async function fetchDashboardStatsLocally(tierHint?: RoleTier): Promise<DashboardStatsForTier> {
  const client = getSupabaseClient()
  const [
    { data: userData },
    roles,
  ] = await Promise.all([
    client.auth.getUser(),
    fetchCurrentUserRoles().catch(() => []),
  ])

  const tier = tierHint ?? getResolvedRoleTier(roles)
  const operationalSubtype = getOperationalSubtype(roles)
  const userId = userData.user?.id ?? null
  const scopedUserId = userId ?? "__missing__"

  if (isLeadershipTier(tier)) {
    const [studentsRes, classesRes, staffRes, incidentsRes, ticketsRes, attendanceRes] = await Promise.all([
      client.from("students").select("status"),
      client.from("classes").select("id", { count: "exact", head: true }),
      client.from("staff").select("id", { count: "exact", head: true }),
      client.from("incidents").select("status").eq("is_deleted", false).in("status", ["open", "in_review"]),
      client.from("tickets").select("status").eq("is_deleted", false).not("status", "in", "(resolved,closed,archived)"),
      client.from("attendance").select("id", { count: "exact", head: true }).eq("date", new Date().toISOString().slice(0, 10)),
    ])

    if (studentsRes.error) throw studentsRes.error
    if (classesRes.error) throw classesRes.error
    if (staffRes.error) throw staffRes.error
    if (incidentsRes.error) throw incidentsRes.error
    if (ticketsRes.error) throw ticketsRes.error
    if (attendanceRes.error) throw attendanceRes.error

    return {
      tier,
      operationalSubtype,
      leadership: {
        totalStudents: studentsRes.data?.length ?? 0,
        totalClasses: classesRes.count ?? 0,
        totalStaff: staffRes.count ?? 0,
        activeIncidents: incidentsRes.data?.length ?? 0,
        openTickets: ticketsRes.data?.length ?? 0,
        attendanceToday: attendanceRes.count ?? 0,
        studentsByStatus: toStatusSummary((studentsRes.data ?? []) as Array<{ status: string | null }>),
        ticketsByStatus: toStatusSummary((ticketsRes.data ?? []) as Array<{ status: string | null }>),
      },
    }
  }

  if (isOperationalStaffTier(tier)) {
    const [classScopeRes, studentScopeRes, incidentsRes, ticketsRes, followUpsRes] = await Promise.all([
      client.from("class_staff_assignments").select("class_id").eq("staff_profile_id", scopedUserId),
      client.from("teacher_student_scope").select("student_id").eq("teacher_id", scopedUserId).eq("is_excluded", false),
      client.from("incidents").select("status").eq("is_deleted", false).or(`created_by.eq.${scopedUserId},assigned_to.eq.${scopedUserId}`),
      client.from("tickets").select("status").eq("is_deleted", false).or(`requester_id.eq.${scopedUserId},assigned_to.eq.${scopedUserId}`).not("status", "in", "(resolved,closed,archived)"),
      client.from("incident_follow_ups").select("id", { count: "exact", head: true }).or(`author_id.eq.${scopedUserId},assigned_to.eq.${scopedUserId}`).is("completed_at", null),
    ])

    if (classScopeRes.error) throw classScopeRes.error
    if (studentScopeRes.error) throw studentScopeRes.error
    if (incidentsRes.error) throw incidentsRes.error
    if (ticketsRes.error) throw ticketsRes.error
    if (followUpsRes.error) throw followUpsRes.error

    return {
      tier,
      operationalSubtype,
      operational: {
        classesInScope: classScopeRes.data?.length ?? 0,
        studentsInScope: studentScopeRes.data?.length ?? 0,
        incidentsInWork: incidentsRes.data?.length ?? 0,
        openTickets: ticketsRes.data?.length ?? 0,
        followUpsDue: followUpsRes.count ?? 0,
        ticketsByStatus: toStatusSummary((ticketsRes.data ?? []) as Array<{ status: string | null }>),
      },
    }
  }

  const [ticketsRes, incidentsRes, staffRes, roleRowsRes, pendingRolesRes] = await Promise.all([
    client.from("tickets").select("status, assigned_to").eq("is_deleted", false),
    client.from("incidents").select("status").eq("is_deleted", false).in("status", ["open", "in_review"]),
    client.from("staff").select("id", { count: "exact", head: true }).eq("role", "it_staff").eq("status", "active"),
    client.from("user_roles").select("role").eq("active", true),
    client.from("user_roles").select("id", { count: "exact", head: true }).eq("active", false),
  ])

  if (ticketsRes.error) throw ticketsRes.error
  if (incidentsRes.error) throw incidentsRes.error
  if (staffRes.error) throw staffRes.error
  if (roleRowsRes.error) throw roleRowsRes.error
  if (pendingRolesRes.error) throw pendingRolesRes.error

  return {
    tier,
    operationalSubtype,
    itAdmin: {
      totalTickets: ticketsRes.data?.length ?? 0,
      unassignedTickets:
        ticketsRes.data?.filter(
          (ticket) => !ticket.assigned_to && !["resolved", "closed", "archived"].includes(ticket.status ?? "")
        ).length ?? 0,
      activeItStaff: staffRes.count ?? 0,
      openIncidents: incidentsRes.data?.length ?? 0,
      pendingRoleUpdates: pendingRolesRes.count ?? 0,
      roleDistribution: toKeySummary((roleRowsRes.data ?? []) as Array<Record<string, string | null>>, "role"),
    },
  }
}

export async function fetchDashboardStatsForTier(tier?: RoleTier): Promise<DashboardStatsForTier> {
  const client = getSupabaseClient()
  const { data: authData } = await client.auth.getUser()
  const roles = authData.user ? await fetchCurrentUserRoles().catch(() => []) : []
  const resolvedTier = tier ?? getResolvedRoleTier(roles)

  const rpcStats = await fetchDashboardStatsFromRpc(resolvedTier).catch(() => null)
  if (rpcStats) {
    return rpcStats
  }

  return fetchDashboardStatsLocally(resolvedTier)
}

export async function fetchDashboardStats(): Promise<DashboardStatsForTier> {
  return fetchDashboardStatsForTier()
}
