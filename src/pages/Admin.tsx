import { useCallback, useEffect, useMemo, useState, type FormEventHandler } from "react"
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  Crown,
  Download,
  Filter,
  History,
  KeyRound,
  Layers3,
  MailWarning,
  RefreshCw,
  RotateCcw,
  School,
  Search,
  Pencil,
  Send,
  ShieldCheck,
  ShieldOff,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useAuth } from "../context/useAuth"
import type { Class, Incident, Student } from "../lib/api/database.types"
import {
  createStaff,
  createStaffAccount,
  fetchAccountAudit,
  fetchAccountSettings,
  fetchClasses,
  fetchCurrentUserRoles,
  fetchIncidents,
  fetchStaff,
  fetchStudents,
  replaceStaffRolesByProfileId,
  resendStaffInvite,
  resolveProfileIdByEmail,
  restoreStaffAccess,
  revokeStaffAccess,
  setStaffRoles,
  syncStaffFromGoogleWorkspace,
  syncStudentsFromGoogleWorkspace,
  updateStaff,
  type AccountAuditRow,
  type StaffDirectoryRow,
  type StaffRoleGrant,
} from "../lib/api/supabaseApi"
import { ASSIGNABLE_ROLES } from "../lib/access/registry"
import { todayInSchoolZone } from "../lib/school-time"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card"
import { Button } from "../components/ui/button"
import { Dialog } from "../components/ui/Dialog"
import { FormField } from "../components/ui/FormField"
import { Input } from "../components/ui/Input"
import { Select } from "../components/ui/Select"
import { Textarea } from "../components/ui/Textarea"
import { DataTable } from "../components/ui/DataTable"
import { StatisticCard, StatisticGrid } from "../components/ui/StatisticCard"
import { Spinner } from "../components/ui/Spinner"
import { TableAvatar } from "../components/ui/TableAvatar"
import { TableBadge } from "../components/ui/TableBadge"
import { useToast } from "../components/ui/useToast"
import { getErrorMessage } from "../utils/getErrorMessage"
import { labelize } from "../utils/labelize"
import { cn } from "../utils/cn"
import { useAsyncTask } from "../hooks/useAsyncTask"
import { logError } from "../utils/logger"

type AssignmentDraft = {
  id: string
  scopeType: "role" | "teaching scope" | "exception"
  ownerId: string
  ownerName: string
  targetType: "class" | "student"
  targetName: string
  mode: string
  source: string
  effectiveFrom: string
  effectiveTo: string
  notes: string
}

type DashboardTab = "directory" | "assignments" | "sync" | "analytics"

type RoleWindow = { effective_from: string; effective_to: string }

/**
 * The date the school considers today, used to decide which grants are in force.
 *
 * This replaces a local-calendar implementation built from `getFullYear()` and
 * friends, which put the *viewer's* timezone in charge of a window that the
 * server compares in the *database's* timezone. An admin signing in from
 * overseas could see a different answer to the same question than the RLS
 * policies. Both sides now resolve through src/lib/school-time.ts.
 */
function todayIso(): string {
  return todayInSchoolZone()
}

function toRoleGrants(roles: StaffRole[], windows: Record<string, RoleWindow>): StaffRoleGrant[] {
  return roles.map((role) => ({
    role,
    effective_from: windows[role]?.effective_from || null,
    effective_to: windows[role]?.effective_to || null,
  }))
}

// The grantable role set, straight from the catalogue in
// src/lib/access/registry.ts. `teacher` is retired and deliberately absent.
const roleOptions = [...ASSIGNABLE_ROLES] as const

type StaffRole = (typeof roleOptions)[number]

/**
 * The status values the `staff.status` check constraint actually allows.
 *
 * "pending" was offered here before and violated the constraint, so every save
 * with it ticked failed against the database with an opaque error.
 */
const statusOptions = ["active", "inactive", "on_leave"]

// `assignment_role` values the `class_staff_assignments` CHECK allows. `dean` and
// `pastoral_support` are legal in the database but are not staffing modes this
// screen offers, so they are left out rather than offered and rejected.
const scopeModeOptions = ["primary_teacher", "co_teacher", "manual_inclusion", "manual_exclusion"] as const

function getRoleBadgeTone(value: string) {
  if (["site_admin", "it_admin"].includes(value)) return "violet"
  if (["finance_admin", "board_member"].includes(value)) return "amber"
  if (["finance_read_only"].includes(value)) return "slate"
  if (["staff", "counsellor", "it_staff", "property_staff", "property_manager"].includes(value)) return "cyan"
  return "slate"
}

function getStatusBadgeTone(value: string) {
  if (value === "active") return "emerald"
  if (value === "on_leave") return "amber"
  if (value === "pending") return "amber"
  if (value === "inactive") return "slate"
  return "slate"
}

/**
 * Account status is not the same thing as `staff.status`. That column is an HR
 * field; this one is whether the person can sign in and what they can reach.
 *
 * `unknown` means the viewer is not allowed to read the registration table, so it
 * is reported as the honest "a login exists" rather than a guessed "active".
 */
function getAccountStatusTone(value: string) {
  if (value === "active") return "emerald"
  if (value === "invited") return "amber"
  if (value === "revoked") return "rose"
  return "slate"
}

function getAccountStatusLabel(value: string | null | undefined) {
  if (!value || value === "none") return "No login"
  if (value === "unknown") return "Login linked"
  return labelize(value)
}

function getModeBadgeTone(value: string) {
  if (value === "primary_teacher") return "emerald"
  if (value === "co_teacher") return "amber"
  if (value === "manual_inclusion") return "cyan"
  if (value === "manual_exclusion") return "slate"
  return "cyan"
}

function formatWindow(from: string, to: string) {
  if (!from && !to) return "Open-ended"
  if (from && to) return `${from} to ${to}`
  return from || to || "Open-ended"
}

export default function AdminPage() {
  const toast = useToast()
  const { user } = useAuth()
  const [staff, setStaff] = useState<StaffDirectoryRow[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [roles, setRoles] = useState<string[]>([])
  const [syncing, setSyncing] = useState<"staff" | "students" | "refresh" | null>(null)
  const { loading, run } = useAsyncTask()
  
  // Tabs and Filters State
  const [activeTab, setActiveTab] = useState<DashboardTab>("directory")
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [roleFilter, setRoleFilter] = useState<string>("")
  const [departmentFilter, setDepartmentFilter] = useState<string>("")
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null)

  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null)
  const [showStaffDialog, setShowStaffDialog] = useState(false)
  const [editingStaff, setEditingStaff] = useState<StaffDirectoryRow | null>(null)
  const [staffForm, setStaffForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    department: "",
    status: "active",
    org_unit_path: "",
    profile_id: "",
    roles: [] as StaffRole[],
    roleWindows: {} as Record<string, RoleWindow>,
    createAccount: false,
  })
  const [allowedEmailDomains, setAllowedEmailDomains] = useState<string[]>([])
  const [auditRows, setAuditRows] = useState<AccountAuditRow[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [accountAction, setAccountAction] = useState<"resend" | "revoke" | "restore" | null>(null)
  const [confirmRevokeFor, setConfirmRevokeFor] = useState<string | null>(null)
  const [assignmentDrafts, setAssignmentDrafts] = useState<AssignmentDraft[]>([])
  const [assignmentForm, setAssignmentForm] = useState({
    scopeType: "teaching scope" as AssignmentDraft["scopeType"],
    ownerId: "",
    targetType: "class" as AssignmentDraft["targetType"],
    targetId: "",
    mode: "primary_teacher",
    source: "manual",
    effectiveFrom: "",
    effectiveTo: "",
    notes: "",
  })

  const loadAdminData = useCallback(() => {
    return run(async () => {
      const [staffData, studentData, classData, incidentData, roleData, settingsData] = await Promise.all([
        fetchStaff(),
        fetchStudents(),
        fetchClasses(),
        fetchIncidents(),
        fetchCurrentUserRoles(),
        // Read-only and never load-bearing: a failure here must not blank the page.
        fetchAccountSettings().catch(() => ({ allowedEmailDomains: [] })),
      ])
      setStaff(staffData)
      setStudents(studentData)
      setClasses(classData)
      setIncidents(incidentData)
      setRoles(roleData)
      setAllowedEmailDomains(settingsData.allowedEmailDomains)
      setSelectedStaffId((current) => current ?? staffData[0]?.id ?? null)
    }, {
      onError: (error) => logError("Failed to load admin dashboard", error),
    })
  }, [run])

  useEffect(() => {
    queueMicrotask(() => {
      void loadAdminData()
    })
  }, [loadAdminData])

  const isAdmin = roles.some((role) =>
    ["site_admin", "it_admin"].includes(role)
  )

  const selectedStaff = selectedStaffId ? staff.find((entry) => entry.id === selectedStaffId) ?? null : null
  const selectedProfileId = selectedStaff?.profile_id ?? null

  // The audit trail is admin-only on purpose, so it is not fetched for a
  // read-only viewer and is never fetched for a person with no login.
  useEffect(() => {
    if (!isAdmin || !selectedProfileId) {
      setAuditRows([])
      return
    }

    let cancelled = false
    setAuditLoading(true)

    void fetchAccountAudit(selectedProfileId, 10)
      .then((rows) => {
        if (!cancelled) setAuditRows(rows)
      })
      .catch((error) => {
        if (!cancelled) setAuditRows([])
        logError("Failed to load the account audit log", error)
      })
      .finally(() => {
        if (!cancelled) setAuditLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [isAdmin, selectedProfileId])

  async function handleResendInvite() {
    if (!selectedProfileId) return
    setAccountAction("resend")
    try {
      await resendStaffInvite(selectedProfileId)
      toast.success("Invitation resent", `${selectedStaff?.first_name} has a fresh set-password link.`)
      await loadAdminData()
    } catch (error) {
      logError("Failed to resend the invitation", error)
      toast.error("Could not resend the invitation", getErrorMessage(error))
    } finally {
      setAccountAction(null)
    }
  }

  async function handleRevokeAccess() {
    if (!selectedProfileId) return
    setAccountAction("revoke")
    try {
      await revokeStaffAccess(selectedProfileId)
      setConfirmRevokeFor(null)
      toast.success(
        "Access revoked",
        `${selectedStaff?.first_name} can no longer sign in, and every role grant was deactivated.`,
      )
      await loadAdminData()
    } catch (error) {
      logError("Failed to revoke access", error)
      toast.error("Could not revoke access", getErrorMessage(error))
    } finally {
      setAccountAction(null)
    }
  }

  async function handleRestoreAccess() {
    if (!selectedProfileId) return
    setAccountAction("restore")
    try {
      await restoreStaffAccess(selectedProfileId)
      toast.success(
        "Suspension lifted",
        `${selectedStaff?.first_name} can sign in again. Their role grants stay off until an admin re-grants them.`,
      )
      await loadAdminData()
    } catch (error) {
      logError("Failed to restore access", error)
      toast.error("Could not restore access", getErrorMessage(error))
    } finally {
      setAccountAction(null)
    }
  }

  const departments = useMemo(() => {
    const list = staff.map((s) => s.department).filter(Boolean) as string[]
    return Array.from(new Set(list))
  }, [staff])

  const filteredStaff = useMemo(() => {
    return staff.filter((entry) => {
      const haystack = [
        entry.first_name,
        entry.last_name,
        entry.email,
        entry.role ?? "",
        entry.roles.join(" "),
        entry.department ?? "",
        entry.org_unit_path ?? "",
      ]
        .join(" ")
        .toLowerCase()
      const matchesSearch = !search || haystack.includes(search.toLowerCase())
      const matchesStatus = !statusFilter || (entry.status ?? "") === statusFilter
      const matchesRole = !roleFilter || (entry.role ?? "") === roleFilter
      const matchesDept = !departmentFilter || (entry.department ?? "") === departmentFilter
      return matchesSearch && matchesStatus && matchesRole && matchesDept
    })
  }, [staff, search, statusFilter, roleFilter, departmentFilter])
  const activeIncidents = incidents.filter((incident) => ["open", "in_review"].includes(incident.status)).length
  // `teacher` is retired in favour of `staff`, so both must be counted or this
  // tile reads zero on a school that has no historical teacher grants left.
  const teacherCount = staff.filter((entry) =>
    entry.roles.some((role) => {
      const value = role.toLowerCase()
      return value === "staff" || value.includes("teacher")
    }),
  ).length
  const departmentCount = departments.length
  const totalClasses = classes.length
  const totalStudents = students.length
  const totalStaff = staff.length
  
  const roleBreakdown = useMemo(() => {
    return staff.reduce<Record<string, number>>((acc, entry) => {
      const key = entry.role || entry.roles[0] || "unassigned"
      acc[key] = (acc[key] ?? 0) + 1
      return acc
    }, {})
  }, [staff])

  const selectedDrafts = selectedStaff?.profile_id
    ? assignmentDrafts.filter((draft) => draft.ownerId === selectedStaff.profile_id)
    : []

  function handleCopyEmail(email: string) {
    void navigator.clipboard.writeText(email)
    setCopiedEmail(email)
    setTimeout(() => setCopiedEmail(null), 2000)
  }

  function handleDeleteDraft(id: string) {
    setAssignmentDrafts((prev) => prev.filter((d) => d.id !== id))
  }

  function handleExportDrafts() {
    if (assignmentDrafts.length === 0) return
    const json = JSON.stringify(assignmentDrafts, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `assignment-drafts-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const staffColumns = [
    {
      accessor: "first_name",
      header: "User",
      sortable: true,
      className: "min-w-[280px]",
      cell: (_: unknown, row: StaffDirectoryRow) => (
        <div className="flex items-center gap-3">
          <TableAvatar>{`${row.first_name?.[0] ?? ""}${row.last_name?.[0] ?? ""}`.trim() || "U"}</TableAvatar>
          <div>
            <div className="font-medium text-[var(--color-text)]">{row.first_name} {row.last_name}</div>
            <div className="text-xs text-[var(--color-muted)]">{row.org_unit_path || "No org unit"}</div>
          </div>
        </div>
      ),
    },
    {
      accessor: "email",
      header: "Email",
      sortable: true,
      className: "min-w-[280px]",
      cell: (value: unknown) => (
        <div className="flex items-center gap-2">
          <span className="text-[var(--color-muted)]">{String(value ?? "-")}</span>
          {Boolean(value) && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleCopyEmail(String(value))
              }}
              className="text-[var(--color-muted)] hover:text-[var(--color-accent)] transition-colors"
              title="Copy email"
            >
              {copiedEmail === String(value) ? <Check className="size-3.5 text-[var(--color-success)]" /> : <Copy className="size-3.5" />}
            </button>
          )}
        </div>
      ),
    },
    {
      accessor: "status",
      header: "Status",
      sortable: true,
      className: "whitespace-nowrap min-w-[130px]",
      cell: (value: unknown) => (
        <TableBadge tone={getStatusBadgeTone(String(value || "active"))}>
          {labelize(String(value || "active"))}
        </TableBadge>
      ),
    },
    {
      accessor: "role",
      header: "Primary Role",
      sortable: true,
      className: "whitespace-nowrap min-w-[180px]",
      cell: (value: unknown) => (
        <TableBadge tone={getRoleBadgeTone(String(value || "unassigned"))}>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-current" />
            {labelize(String(value || "unassigned"))}
          </span>
        </TableBadge>
      ),
    },
    {
      accessor: "account_status",
      header: "Account",
      sortable: true,
      className: "whitespace-nowrap min-w-[150px]",
      cell: (_: unknown, row: StaffDirectoryRow) => (
        <TableBadge tone={getAccountStatusTone(row.account_status ?? "none")}>
          {getAccountStatusLabel(row.account_status)}
        </TableBadge>
      ),
    },
    {
      accessor: "department",
      header: "Department",
      sortable: true,
      className: "whitespace-nowrap min-w-[180px]",
      cell: (value: unknown) => <span className="text-[var(--color-muted)]">{String(value ?? "-")}</span>,
    },
    {
      accessor: "actions",
      header: "Actions",
      sortable: false,
      searchable: false,
      className: "whitespace-nowrap min-w-[120px]",
      cell: (_: unknown, row: StaffDirectoryRow) => (
        <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
          <Button variant="ghost" size="sm" title="Edit user" onClick={() => handleEditStaff(row)}>
            <Pencil className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="Queue assignment"
            onClick={() => {
              setAssignmentForm((prev) => ({ ...prev, ownerId: row.profile_id ?? "" }))
              setActiveTab("assignments")
            }}
          >
            <UserPlus className="size-4 text-[var(--color-information)]" />
          </Button>
        </div>
      ),
    },
  ]

  function resetStaffForm() {
    setEditingStaff(null)
    setStaffForm({
      first_name: "",
      last_name: "",
      email: "",
      phone: "",
      department: "",
      status: "active",
      org_unit_path: "",
      profile_id: "",
      roles: [],
      roleWindows: {},
      createAccount: false,
    })
  }

  function handleEditStaff(row: StaffDirectoryRow, options: { createAccount?: boolean } = {}) {
    const inForce = row.roles.length > 0 ? row.roles as StaffRole[] : row.role ? [row.role as StaffRole] : []

    // Grants staged for a first Google sign-in. Loaded here for the same reason the
    // dated grants are: the form writes back the full ticked list, so anything not
    // loaded is silently dropped on the next save of an unrelated field.
    const staged = row.pending_roles

    // Grants that are active but not in force today, such as next year's board seat
    // or a relief-cover term, are merged in so the dialog shows what is actually
    // granted. Leaving them out would not merely hide them: saving this form writes
    // back the full ticked list, so an unrelated phone-number edit would deactivate
    // them for good.
    //
    // The form is keyed by role, so a role with more than one out-of-window grant
    // collapses to a single row. Upcoming grants win over lapsed ones, because
    // losing a future grant is worse than losing an expired one.
    const upcoming = row.dated_roles
      .filter((grant) => !grant.effective_to || grant.effective_to >= todayIso())
      .sort((a, b) => (a.effective_from ?? "9999-12-31").localeCompare(b.effective_from ?? "9999-12-31"))

    const windowsFromGrants: Record<string, RoleWindow> = {}
    for (const grant of [...staged, ...upcoming, ...row.dated_roles]) {
      if (windowsFromGrants[grant.role]) continue
      windowsFromGrants[grant.role] = {
        effective_from: grant.effective_from ?? "",
        effective_to: grant.effective_to ?? "",
      }
    }

    const roles = Array.from(
      new Set([...inForce, ...staged.map((grant) => grant.role), ...row.dated_roles.map((grant) => grant.role)]),
    ) as StaffRole[]

    setEditingStaff(row)
    setStaffForm({
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      phone: row.phone ?? "",
      department: row.department ?? "",
      status: row.status ?? "active",
      org_unit_path: row.org_unit_path ?? "",
      profile_id: row.profile_id ?? "",
      roles,
      // Existing dates are carried over, so opening and saving a form unchanged is a
      // no-op for grants. A windowed grant in force today still opens empty: the
      // directory row reports the role but not whether the window was deliberate, and
      // guessing either way would silently rewrite someone's access.
      roleWindows: Object.fromEntries(
        roles.map((role) => [role, windowsFromGrants[role] ?? { effective_from: "", effective_to: "" }]),
      ),
      // Pre-ticked when opened from the "create login" action so the admin does not
      // have to find the checkbox to get the thing they asked for.
      createAccount: options.createAccount ?? false,
    })
    setShowStaffDialog(true)
  }

  const handleSubmitStaff: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()

      const fullName = `${staffForm.first_name} ${staffForm.last_name}`.trim()
      const grants = toRoleGrants(staffForm.roles, staffForm.roleWindows)
      // Resolved below; declared here so the outcome toast can report it.
      let rolesStaged = false

    try {
      let resolvedProfileId =
        editingStaff?.profile_id?.trim() ||
        staffForm.profile_id.trim() ||
        (staffForm.email.trim() ? await resolveProfileIdByEmail(staffForm.email.trim()) : null) ||
        null

      // When creating a login, the edge function runs first. The staff row needs a
      // profile_id and a profile only comes into existence when the login is made,
      // so the old order (save the staff row, then look for a profile) could only
      // ever find one that already existed.
      let accountCreated = false
      let rolesAlreadyApplied = false
      if (staffForm.createAccount && isAdmin) {        const result = await createStaffAccount({
          email: staffForm.email.trim(),
          firstName: staffForm.first_name.trim(),
          lastName: staffForm.last_name.trim(),
          grants,
          staffId: editingStaff?.id ?? null,
        })
        resolvedProfileId = result.profileId
        accountCreated = result.invited
        // The function already applied these exact grants through the same RPC.
        // Writing them a second time would be a redundant round trip that only
        // obscures which write is authoritative in the audit trail.
        rolesAlreadyApplied = true
      }

      const payload = {
        first_name: staffForm.first_name,
        last_name: staffForm.last_name,
        email: staffForm.email,
        phone: staffForm.phone || null,
        department: staffForm.department || null,
        status: staffForm.status,
        org_unit_path: staffForm.org_unit_path || null,
        profile_id: resolvedProfileId,
        // No profile means organisation staff who have not signed in with Google
        // yet. The grants are staged on the staff row and applied by the
        // `handle_new_user` trigger at first sign-in, because `user_roles` is keyed
        // on a profile that does not exist until then.
        pending_roles: resolvedProfileId ? [] : grants,
      }

      rolesStaged = !resolvedProfileId && grants.length > 0

      if (editingStaff) {
        await updateStaff(editingStaff.id, payload)
      } else {
        await createStaff(payload)
      }

      if (resolvedProfileId && !rolesAlreadyApplied) {
        // Through the edge function rather than straight to the RPC, so the change
        // lands in the audit log. `create_account` already covers the first grant;
        // without this, later grants would be invisible.
        if (isAdmin) {
          await setStaffRoles(resolvedProfileId, grants)
        } else {
          await replaceStaffRolesByProfileId(resolvedProfileId, grants)
        }
      }

      if (rolesStaged) {
        toast.success(
          editingStaff ? "Staff user updated" : "Staff user created",
          `${fullName} was saved. ${grants.length} role(s) are held until they first sign in with `
            + "Google, then applied automatically.",
        )
      } else if (accountCreated) {
        toast.success(
          editingStaff ? "Staff user updated" : "Staff user created",
          `${fullName} was saved and an invitation was sent to set their password.`,
        )
      } else {
        toast.success(
          editingStaff ? "Staff user updated" : "Staff user created",
          `${fullName} was saved successfully.`,
        )
      }

      setShowStaffDialog(false)
      resetStaffForm()
      await loadAdminData()
    } catch (error) {
      logError("Failed to save staff record", error)
      toast.error("Could not save staff record", getErrorMessage(error))
    }
  }

  function openNewStaffDialog() {
    resetStaffForm()
    setShowStaffDialog(true)
  }

  const handleQueueAssignment: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault()

    const owner = staff.find((entry) => entry.profile_id === assignmentForm.ownerId)
    const targetLabel =
      assignmentForm.targetType === "class"
        ? classes.find((entry) => entry.id === assignmentForm.targetId)?.name
        : (() => {
            const targetStudent = students.find((entry) => entry.id === assignmentForm.targetId)
            return targetStudent ? `${targetStudent.first_name} ${targetStudent.last_name}` : undefined
          })()

    if (!owner || !assignmentForm.targetId) {
      toast.error("Missing assignment details", "Choose a user and a target before queuing the assignment.")
      return
    }

    const draft: AssignmentDraft = {
      id: crypto.randomUUID(),
      scopeType: assignmentForm.scopeType,
      ownerId: owner.profile_id ?? owner.id,
      ownerName: `${owner.first_name} ${owner.last_name}`,
      targetType: assignmentForm.targetType,
      targetName: targetLabel || "Unknown target",
      mode: assignmentForm.mode,
      source: assignmentForm.source,
      effectiveFrom: assignmentForm.effectiveFrom,
      effectiveTo: assignmentForm.effectiveTo,
      notes: assignmentForm.notes,
    }

    setAssignmentDrafts((current) => [draft, ...current])
    setAssignmentForm((current) => ({
      ...current,
      targetId: "",
      notes: "",
      effectiveFrom: "",
      effectiveTo: "",
    }))
    toast.success("Assignment queued", `${draft.ownerName} -> ${draft.targetName}`)
  }

  async function handleSyncStaff() {
    setSyncing("staff")
    try {
      await syncStaffFromGoogleWorkspace("/Accounts/Automated/Staff")
      toast.success("Staff sync complete", "Google Workspace staff records were refreshed.")
      await loadAdminData()
    } catch (error) {
      logError("Failed to sync staff", error)
      toast.error("Staff sync failed", getErrorMessage(error))
    } finally {
      setSyncing(null)
    }
  }

  async function handleSyncStudents() {
    setSyncing("students")
    try {
      await syncStudentsFromGoogleWorkspace([
        "/Accounts/Automated/Students/Year 7",
        "/Accounts/Automated/Students/Year 8",
      ])
      toast.success("Student sync complete", "Google Workspace student records were refreshed.")
      await loadAdminData()
    } catch (error) {
      logError("Failed to sync students", error)
      toast.error("Student sync failed", getErrorMessage(error))
    } finally {
      setSyncing(null)
    }
  }

  async function handleRefreshAll() {
    setSyncing("refresh")
    try {
      await loadAdminData()
    } finally {
      setSyncing(null)
    }
  }

  if (loading) {
    return (
      <div className="flex h-72 w-full items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)]/40">
        <Spinner size="xl" className="text-[var(--color-information)]" />
      </div>
    )
  }

  return (
    <div className="w-full max-w-full min-w-0 space-y-6">
      {/* Access context only. The page title, breadcrumb and active role already sit in
          the app header, so this strip carries what the header cannot: who you are acting
          as and what that allows. The gradient, glow orbs, shadow and pulsing "Live
          Directory" dot it replaced described nothing the data supports. */}
      <section className="flex flex-col gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2.5">
          {isAdmin
            ? <BadgeCheck className="size-5 shrink-0 text-[var(--color-success)]" aria-hidden="true" />
            : <ShieldCheck className="size-5 shrink-0 text-[var(--color-muted)]" aria-hidden="true" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[var(--color-text)]">
              {isAdmin ? "Administrative access" : "Read-only governance view"}
            </p>
            <p className="truncate text-xs text-[var(--color-muted)]">
              <span className="sr-only">Signed in as </span>{user?.email}
              {" · "}
              <span className="sr-only">Active roles: </span>
              {roles.length > 0 ? roles.map(labelize).join(", ") : "no roles assigned"}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <TableBadge tone="slate">{assignmentDrafts.length} queued drafts</TableBadge>
          <TableBadge tone="slate">{activeIncidents} active incidents</TableBadge>
        </div>
      </section>

      {/* Statistic Cards */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Governance metrics</h2>
            <p className="text-xs text-[var(--color-muted)]">Counts across the accounts, cohorts and incidents this workspace manages.</p>
          </div>
        </div>
        <StatisticGrid>
          {([
          { label: "Staff Accounts", value: totalStaff, icon: Users, tone: "information" as const, description: "Users with linked staff records" },
          { label: "Teaching Staff", value: teacherCount, icon: School, tone: "completed" as const, description: "Staff assigned to classroom teaching" },
          { label: "Total Students", value: totalStudents, icon: BookOpen, tone: "warning" as const, description: "Learner records available to governance" },
          { label: "Total Classes", value: totalClasses, icon: ClipboardList, tone: "destructive" as const, description: "Class sections tracked in the schedule" },
          { label: "Open Incidents", value: activeIncidents, icon: AlertTriangle, tone: "overdue" as const, description: "Unresolved governance and safety items" },
          { label: "Departments", value: departmentCount, icon: Layers3, tone: "pending" as const, description: "Distinct departments represented" },
        ]).map((card) => (
          <StatisticCard
            key={card.label}
            label={card.label}
            value={card.value}
            icon={card.icon}
            description={card.description}
            tone={card.tone}
          />
        ))}
        </StatisticGrid>
      </section>

      {/* Workspace tabs. A real tablist: the strip is one control with one selected
          child, so it is announced and arrow-key navigable rather than four buttons
          that look like one. */}
      <div role="tablist" aria-label="Admin sections" className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)] pb-px">
        {[
          { id: "directory", label: "User Directory", icon: Users, badge: staff.length },
          { id: "assignments", label: "Scope & Assignments", icon: SlidersHorizontal, badge: assignmentDrafts.length },
          { id: "sync", label: "Workspace Sync", icon: RefreshCw },
          { id: "analytics", label: "Governance & Incidents", icon: Layers3 },
        ].map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`admin-tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`admin-panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveTab(tab.id as DashboardTab)}
              className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-t-lg border-b-2 px-4 py-2.5 text-sm font-medium transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] ${
                isActive
                  ? "border-[var(--color-information)] bg-[color-mix(in_srgb,var(--color-information)_10%,transparent)] text-[var(--color-information)]"
                  : "border-transparent text-[var(--color-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-text)]"
              }`}
            >
              <Icon className={`size-4 ${isActive ? "text-[var(--color-information)]" : "text-[var(--color-muted)]"}`} aria-hidden="true" />
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 ? (
                <span className={cn(
                  "ml-1 rounded-full px-2 py-0.5 text-xs tabular-nums",
                  isActive
                    ? "bg-[color-mix(in_srgb,var(--color-information)_18%,transparent)] text-[var(--color-information)]"
                    : "bg-[var(--color-surface-muted)] text-[var(--color-text)]",
                )}>
                  {tab.badge}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {/* TAB 1: USER DIRECTORY & SELECTION */}
      {activeTab === "directory" && (
        <section
          role="tabpanel"
          id="admin-panel-directory"
          aria-labelledby="admin-tab-directory"
          className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,2.35fr)_minmax(300px,0.9fr)]"
        >
          <Card className="min-w-0 overflow-hidden p-0 border-[var(--color-border)]">
            <CardHeader className="mb-0 flex-col items-start justify-start border-b border-[var(--color-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="size-4 text-[var(--color-information)]" />
                  Staff Directory
                </CardTitle>
                <p className="mt-1 text-xs text-[var(--color-muted)]">Search, filter, and inspect staff metadata and active assignments.</p>
              </div>
              <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:justify-end">
                <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={handleRefreshAll}>
                  <RefreshCw className={`mr-1.5 size-3.5 ${syncing === "refresh" ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
                <Button size="sm" className="flex-1 sm:flex-none" onClick={openNewStaffDialog}>
                  <UserPlus className="mr-1.5 size-3.5" />
                  Add User
                </Button>
              </div>
            </CardHeader>

            <CardContent className="min-w-0 space-y-4 px-0 py-0">
              <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="relative sm:col-span-2 lg:col-span-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted)]" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search name, email..."
                    className="pl-9 text-xs"
                  />
                </div>
                
                <Select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} className="text-xs">
                  <option value="">All Roles</option>
                  {roleOptions.map((role) => (
                    <option key={role} value={role}>{labelize(role)}</option>
                  ))}
                </Select>

                <Select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className="text-xs">
                  <option value="">All Departments</option>
                  {departments.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </Select>

                <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="text-xs">
                  <option value="">All Statuses</option>
                  {statusOptions.map((status) => (
                    <option key={status} value={status}>{labelize(status)}</option>
                  ))}
                </Select>
              </div>

              {(roleFilter || departmentFilter || statusFilter || search) && (
                <div className="flex min-w-0 flex-col gap-2 rounded-lg bg-[var(--color-row-hover)] px-3 py-2 text-xs text-[var(--color-muted)] sm:flex-row sm:items-center">
                  <Filter className="size-3 text-[var(--color-information)]" />
                  <span className="min-w-0 break-words sm:flex-1">Filters active: showing {filteredStaff.length} of {staff.length} users</span>
                  <button
                    onClick={() => {
                      setSearch("")
                      setRoleFilter("")
                      setDepartmentFilter("")
                      setStatusFilter("")
                    }}
                    className="text-left font-medium text-[var(--color-information)] hover:underline sm:ml-auto sm:text-right"
                  >
                    Reset filters
                  </button>
                </div>
              )}

              <DataTable
                data={filteredStaff}
                columns={staffColumns}
                searchQuery={search}
                initialSort={{ id: "first_name", desc: false }}
                itemsPerPageOptions={[10, 25, 50]}
                emptyMessage="No staff records matched the specified criteria"
                onRowClick={(row) => setSelectedStaffId(row.id)}
              />
            </CardContent>
          </Card>

          {/* Selected User Inspector Panel */}
          <div className="space-y-4">
            <Card className="p-0 border-[var(--color-border)] sticky top-4">
              <CardHeader className="mb-0 border-b border-[var(--color-border)] px-5 py-4">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <UserCheck className="size-4 text-[var(--color-success)]" />
                    Account Overview
                  </CardTitle>
                  <p className="mt-1 text-xs text-[var(--color-muted)]">Detailed parameters for the selected account.</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 px-5 py-5">
                {selectedStaff ? (
                  <>
                    <div className="rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-bold text-[var(--color-text)]">
                            {selectedStaff.first_name} {selectedStaff.last_name}
                          </div>
                          <div className="text-xs text-[var(--color-muted)] flex items-center gap-1.5 mt-0.5">
                            {selectedStaff.email}
                            <button
                              onClick={() => handleCopyEmail(selectedStaff.email)}
                              className="text-[var(--color-muted)] hover:text-[var(--color-accent)]"
                              title="Copy email"
                            >
                              <Copy className="size-3" />
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <TableBadge tone={getStatusBadgeTone(selectedStaff.status ?? "active")}>
                            {labelize(selectedStaff.status ?? "active")}
                          </TableBadge>
                          <TableBadge tone={getAccountStatusTone(selectedStaff.account_status ?? "none")}>
                            {getAccountStatusLabel(selectedStaff.account_status)}
                          </TableBadge>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-[var(--color-border)] grid gap-2 text-xs text-[var(--color-text)]">
                        <div className="flex justify-between"><span className="text-[var(--color-muted)]">Roles:</span> <span className="font-medium text-[var(--color-text)]">{selectedStaff.roles.length > 0 ? selectedStaff.roles.map(labelize).join(", ") : "Unassigned"}</span></div>
                        {selectedStaff.dated_roles.length > 0 && (
                          <div className="flex justify-between gap-3">
                            <span className="text-[var(--color-muted)] shrink-0">Not in force:</span>
                            <span className="font-medium text-[var(--color-warning)]/90 text-right">
                              {selectedStaff.dated_roles
                                .map((grant) => {
                                  const from = grant.effective_from
                                  const to = grant.effective_to
                                  if (from && to) return `${labelize(grant.role)} (${from} to ${to})`
                                  if (from) return `${labelize(grant.role)} (from ${from})`
                                  if (to) return `${labelize(grant.role)} (until ${to})`
                                  return labelize(grant.role)
                                })
                                .join(", ")}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between"><span className="text-[var(--color-muted)]">Department:</span> <span className="font-medium text-[var(--color-text)]">{selectedStaff.department || "Unassigned"}</span></div>
                        <div className="flex justify-between"><span className="text-[var(--color-muted)]">Phone:</span> <span className="font-medium text-[var(--color-text)]">{selectedStaff.phone || "Not provided"}</span></div>
                        <div className="flex justify-between"><span className="text-[var(--color-muted)]">Org Unit:</span> <span className="font-medium text-[var(--color-text)] truncate max-w-[180px]">{selectedStaff.org_unit_path || "Root"}</span></div>
                        <div className="flex justify-between"><span className="text-[var(--color-muted)]">Invited:</span> <span className="font-medium text-[var(--color-text)]">{selectedStaff.account_invited_at ? new Date(selectedStaff.account_invited_at).toLocaleDateString() : "Never"}</span></div>
                        <div className="flex justify-between"><span className="text-[var(--color-muted)]">Drafted Queue:</span> <span className="font-medium text-[var(--color-information)]">{selectedDrafts.length} updates</span></div>
                      </div>
                    </div>

                    {isAdmin && (
                      <div className="space-y-2 rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] p-3.5">
                        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text)]">
                          <KeyRound className="size-3.5 text-[var(--color-information)]" />
                          Login &amp; Access
                        </div>

                        {!selectedProfileId ? (
                          <div className="space-y-2">
                            <p className="text-xs leading-relaxed text-[var(--color-muted)]">
                              Organisation staff sign in with Google, so no password login is needed. The roles
                              below are held on their staff record and applied automatically the first time
                              they sign in.
                              {selectedStaff.pending_roles.length > 0 && (
                                <> Currently holding {selectedStaff.pending_roles.map((grant) => labelize(grant.role)).join(", ")}.</>
                              )}
                            </p>
                            <Button
                              variant="outline"
                              size="sm"
                              className="justify-between w-full text-xs border-[color-mix(in_srgb,var(--color-information)_30%,transparent)] text-[var(--color-information)] hover:bg-[color-mix(in_srgb,var(--color-information)_10%,transparent)]"
                              onClick={() => handleEditStaff(selectedStaff, { createAccount: true })}
                            >
                              <span>Create manual login (no Google)</span>
                              <Send className="size-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <div className="grid gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="justify-between text-xs"
                                disabled={accountAction !== null}
                                onClick={handleResendInvite}
                              >
                                <span>Resend invitation</span>
                                {accountAction === "resend" ? <Spinner size="sm" /> : <Send className="size-3.5" />}
                              </Button>

                              {selectedStaff.account_status === "revoked" ? (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="justify-between text-xs border-[color-mix(in_srgb,var(--color-success)_30%,transparent)] text-[var(--color-success)] hover:bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)]"
                                  disabled={accountAction !== null}
                                  onClick={handleRestoreAccess}
                                >
                                  <span>Restore access</span>
                                  {accountAction === "restore" ? <Spinner size="sm" /> : <RotateCcw className="size-3.5" />}
                                </Button>
                              ) : confirmRevokeFor === selectedProfileId ? (
                                <div className="space-y-2 rounded-lg border border-[color-mix(in_srgb,var(--color-destructive)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_20%,transparent)] p-2.5">
                                  <p className="text-xs leading-relaxed text-[var(--color-destructive)]">
                                    Revoking deactivates every role grant and suspends the login. It is
                                    reversible, and roles are not restored automatically.
                                  </p>
                                  <div className="flex gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="flex-1 text-xs"
                                      onClick={() => setConfirmRevokeFor(null)}
                                      disabled={accountAction !== null}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      className="flex-1 text-xs"
                                      onClick={handleRevokeAccess}
                                      disabled={accountAction !== null}
                                    >
                                      {accountAction === "revoke" ? <Spinner size="sm" /> : <ShieldOff className="size-3.5 mr-1.5" />}
                                      Confirm revoke
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="justify-between text-xs border-[color-mix(in_srgb,var(--color-destructive)_30%,transparent)] text-[var(--color-destructive)] hover:bg-[color-mix(in_srgb,var(--color-destructive)_10%,transparent)]"
                                  onClick={() => setConfirmRevokeFor(selectedProfileId)}
                                >
                                  <span>Revoke access</span>
                                  <ShieldOff className="size-3.5" />
                                </Button>
                              )}
                            </div>

                            {selectedStaff.account_status === "revoked" && (
                              <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_20%,transparent)] p-2.5">
                                <p className="text-xs leading-relaxed text-[var(--color-warning)]">
                                  This account is suspended and every role grant is deactivated. Lifting the
                                  suspension does not bring the roles back &mdash; re-granting them is a
                                  separate decision.
                                </p>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="mt-2 w-full justify-between text-xs text-[var(--color-warning)] hover:bg-[color-mix(in_srgb,var(--color-warning)_10%,transparent)]"
                                  onClick={() => handleEditStaff(selectedStaff)}
                                >
                                  <span>Re-grant roles</span>
                                  <ShieldCheck className="size-3.5" />
                                </Button>
                              </div>
                            )}

                            <div className="border-t border-[var(--color-border)] pt-2">
                              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-muted)]">
                                <History className="size-3 text-[var(--color-muted)]" />
                                Recent account activity
                              </div>
                              {auditLoading ? (
                                <div className="mt-2 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                                  <Spinner size="sm" /> Loading...
                                </div>
                              ) : auditRows.length === 0 ? (
                                <p className="mt-2 text-xs text-[var(--color-muted)]">No account changes recorded.</p>
                              ) : (
                                <ul className="mt-2 space-y-1.5">
                                  {auditRows.map((row) => (
                                    <li key={row.id} className="flex items-start justify-between gap-2 text-xs">
                                      <span className="text-[var(--color-text)]">
                                        {labelize(row.action)}
                                        {row.actor_email ? (
                                          <span className="text-[var(--color-muted)]"> by {row.actor_email}</span>
                                        ) : null}
                                      </span>
                                      <span className="shrink-0 text-[var(--color-muted)]">
                                        {new Date(row.created_at).toLocaleString()}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    <div className="grid gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleEditStaff(selectedStaff)} className="justify-between text-xs">
                        <span>Edit User Profile</span>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            setAssignmentForm((current) => ({ ...current, ownerId: selectedStaff.profile_id ?? "" }))
                          setActiveTab("assignments")
                        }}
                        className="justify-between text-xs border-[color-mix(in_srgb,var(--color-information)_30%,transparent)] text-[var(--color-information)] hover:bg-[color-mix(in_srgb,var(--color-information)_10%,transparent)]"
                      >
                        <span>Queue New Scope Assignment</span>
                        <ClipboardList className="size-3.5" />
                      </Button>
                    </div>

                    {selectedDrafts.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-[var(--color-border)]">
                        <span className="text-xs font-semibold text-[var(--color-text)]">Pending Drafts for User:</span>
                        {selectedDrafts.map((draft) => (
                          <div key={draft.id} className="rounded-lg border border-[color-mix(in_srgb,var(--color-information)_20%,transparent)] bg-[color-mix(in_srgb,var(--color-information)_20%,transparent)] p-2.5 text-xs">
                            <div className="flex items-center justify-between font-medium text-[var(--color-information)]">
                              <span>{draft.targetName} ({labelize(draft.targetType)})</span>
                              <TableBadge tone={getModeBadgeTone(draft.mode)}>{draft.mode}</TableBadge>
                            </div>
                            <div className="mt-1 text-[var(--color-muted)] text-xs">{draft.notes || "No notes"}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-8 text-center text-xs text-[var(--color-muted)]">
                    Select a row in the table to inspect individual user credentials and configuration.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </section>
      )}

      {/* TAB 2: ASSIGNMENT QUEUE & GOVERNANCE */}
      {activeTab === "assignments" && (
        <section
          role="tabpanel"
          id="admin-panel-assignments"
          aria-labelledby="admin-tab-assignments"
          className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
        >
          <Card className="p-0 border-[var(--color-border)]">
            <CardHeader className="mb-0 border-b border-[var(--color-border)] px-5 py-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <SlidersHorizontal className="size-4 text-[var(--color-information)]" />
                  Scope & Role Assignment Form
                </CardTitle>
                <p className="mt-1 text-xs text-[var(--color-muted)]">Draft granular permission updates and teaching scope bindings.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-[color-mix(in_srgb,var(--color-information)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-information)_10%,transparent)] px-3 py-1 text-xs text-[var(--color-information)] font-medium">
                  {assignmentDrafts.length} Pending
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-5 py-5">
              <form onSubmit={handleQueueAssignment} className="space-y-4 rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <FormField label="Assignment Scope" htmlFor="assignment-scope" labelClassName="text-xs font-medium text-[var(--color-text)]">
                    <Select
                      id="assignment-scope"
                      value={assignmentForm.scopeType}
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, scopeType: event.target.value as AssignmentDraft["scopeType"] }))}
                    >
                      <option value="role">Role Assignment</option>
                      <option value="teaching scope">Teaching Scope</option>
                      <option value="exception">Scope Exception</option>
                    </Select>
                  </FormField>

                  <FormField label="Target Staff Account" htmlFor="assignment-owner" labelClassName="text-xs font-medium text-[var(--color-text)]">
                    <Select
                      id="assignment-owner"
                      value={assignmentForm.ownerId}
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, ownerId: event.target.value }))}
                    >
                      <option value="">Select Staff User...</option>
                        {staff
                          .filter((entry) => Boolean(entry.profile_id))
                          .map((entry) => (
                            <option key={entry.id} value={entry.profile_id ?? ""}>{entry.first_name} {entry.last_name} ({entry.roles.length > 0 ? entry.roles.map(labelize).join(", ") : "No role"})</option>
                          ))}
                    </Select>
                  </FormField>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <FormField label="Target Object Type" htmlFor="assignment-target-type" labelClassName="text-xs font-medium text-[var(--color-text)]">
                    <Select
                      id="assignment-target-type"
                      value={assignmentForm.targetType}
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, targetType: event.target.value as AssignmentDraft["targetType"], targetId: "" }))}
                    >
                      <option value="class">Class</option>
                      <option value="student">Student</option>
                    </Select>
                  </FormField>

                  <FormField label="Scope Inclusion Mode" htmlFor="assignment-mode" labelClassName="text-xs font-medium text-[var(--color-text)]">
                    <Select
                      id="assignment-mode"
                      value={assignmentForm.mode}
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, mode: event.target.value }))}
                    >
                      {scopeModeOptions.map((mode) => (
                        <option key={mode} value={mode}>{labelize(mode)}</option>
                      ))}
                    </Select>
                  </FormField>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <FormField label={`Select Target ${assignmentForm.targetType === "class" ? "Class" : "Student"}`} htmlFor="assignment-target" labelClassName="text-xs font-medium text-[var(--color-text)]">
                    <Select
                      id="assignment-target"
                      value={assignmentForm.targetId}
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, targetId: event.target.value }))}
                    >
                      <option value="">Select target {assignmentForm.targetType}...</option>
                      {assignmentForm.targetType === "class"
                        ? classes.map((entry) => (
                            <option key={entry.id} value={entry.id}>{entry.name}</option>
                          ))
                        : students.map((entry) => (
                            <option key={entry.id} value={entry.id}>{entry.first_name} {entry.last_name}</option>
                          ))}
                    </Select>
                  </FormField>

                  <FormField label="Source Provenance" htmlFor="assignment-source" labelClassName="text-xs font-medium text-[var(--color-text)]">
                    <Select
                      id="assignment-source"
                      value={assignmentForm.source}
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, source: event.target.value }))}
                    >
                      <option value="manual">Manual Admin Override</option>
                      <option value="class">Class-Derived Access</option>
                      <option value="sync">Google Sync Pipeline</option>
                    </Select>
                  </FormField>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <FormField label="Effective Start Date" htmlFor="assignment-effective-from" labelClassName="text-xs font-medium text-[var(--color-text)]">
                    <Input id="assignment-effective-from" type="date" value={assignmentForm.effectiveFrom} onChange={(event) => setAssignmentForm((current) => ({ ...current, effectiveFrom: event.target.value }))} className="text-xs" />
                  </FormField>
                  <FormField label="Effective Expiry Date" htmlFor="assignment-effective-to" labelClassName="text-xs font-medium text-[var(--color-text)]">
                    <Input id="assignment-effective-to" type="date" value={assignmentForm.effectiveTo} onChange={(event) => setAssignmentForm((current) => ({ ...current, effectiveTo: event.target.value }))} className="text-xs" />
                  </FormField>
                </div>

                <FormField label="Audit Justification & Notes" htmlFor="assignment-notes" labelClassName="text-xs font-medium text-[var(--color-text)]">
                  <Textarea
                    id="assignment-notes"
                    value={assignmentForm.notes}
                    onChange={(event) => setAssignmentForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Document the administrative reason, exception note, or ticket reference..."
                    rows={2}
                    className="text-xs"
                  />
                </FormField>

                <div className="flex justify-end">
                  <Button type="submit" size="sm">
                    <ClipboardList className="mr-1.5 size-4" />
                    Queue Assignment Draft
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Draft List Sidebar */}
          <Card className="p-0 border-[var(--color-border)]">
            <CardHeader className="mb-0 border-b border-[var(--color-border)] px-5 py-4">
              <div>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Queued Drafts ({assignmentDrafts.length})</span>
                  {assignmentDrafts.length > 0 && (
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={handleExportDrafts} title="Export JSON">
                        <Download className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setAssignmentDrafts([])} className="text-[var(--color-destructive)] hover:text-[var(--color-destructive)]">
                        Clear All
                      </Button>
                    </div>
                  )}
                </CardTitle>
                <p className="mt-1 text-xs text-[var(--color-muted)]">Staged changes ready for governance review and deployment.</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 px-5 py-5 max-h-[550px] overflow-y-auto">
              {assignmentDrafts.length > 0 ? (
                assignmentDrafts.map((draft) => (
                  <div key={draft.id} className="group relative rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] p-3.5 hover:border-[color-mix(in_srgb,var(--color-information)_30%,transparent)] transition-colors">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-xs text-[var(--color-text)] flex items-center gap-1.5">
                          <span>{draft.ownerName}</span>
                          <ArrowRight className="size-3 text-[var(--color-muted)]" />
                          <span className="text-[var(--color-information)]">{draft.targetName}</span>
                        </div>
                        <div className="mt-1 text-xs text-[var(--color-muted)]">
                          {labelize(draft.scopeType)} via <span className="text-[var(--color-text)]">{labelize(draft.source)}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteDraft(draft.id)}
                        className="text-[var(--color-muted)] hover:text-[var(--color-destructive)] transition-colors p-1"
                        title="Remove draft"
                      >
                        <Trash2 className="size-4 text-[var(--color-destructive)]" />
                      </button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <TableBadge tone={getModeBadgeTone(draft.mode)}>
                        {labelize(draft.mode)}
                      </TableBadge>
                      <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-row-hover)] px-2 py-0.5 text-[var(--color-text)]">
                        {draft.targetType.toUpperCase()}
                      </span>
                      <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-row-hover)] px-2 py-0.5 text-[var(--color-muted)]">
                        {formatWindow(draft.effectiveFrom, draft.effectiveTo)}
                      </span>
                    </div>

                    {draft.notes && (
                      <p className="mt-2 text-xs text-[var(--color-muted)] italic bg-[var(--color-row-hover)] p-2 rounded">
                        "{draft.notes}"
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_30%,transparent)] p-8 text-center text-xs text-[var(--color-muted)]">
                  <Sparkles className="mx-auto size-6 text-[var(--color-muted)] mb-2" />
                  No changes queued. Fill out the scope form to stage updates before applying.
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* TAB 3: WORKSPACE SYNC & GOVERNANCE */}
      {activeTab === "sync" && (
        <section
          role="tabpanel"
          id="admin-panel-sync"
          aria-labelledby="admin-tab-sync"
          className="grid gap-6 xl:grid-cols-2"
        >
          <Card className="p-0 border-[var(--color-border)]">
            <CardHeader className="mb-0 border-b border-[var(--color-border)] px-5 py-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <RefreshCw className="size-4 text-[var(--color-information)]" />
                  Google Workspace Automated Synchronization
                </CardTitle>
                <p className="mt-1 text-xs text-[var(--color-muted)]">Synchronize accounts and organizational units directly from Google Workspace.</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-5 py-5">
              <div className="rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-[var(--color-text)]">Staff Organizational Unit</div>
                    <div className="text-xs text-[var(--color-muted)]">/Accounts/Automated/Staff</div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSyncStaff}
                    disabled={syncing === "staff"}
                  >
                    {syncing === "staff" ? <Spinner size="sm" className="mr-2" /> : <RefreshCw className="mr-2 size-3.5 text-[var(--color-information)]" />}
                    Sync Staff OU
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-[var(--color-text)]">Students Organizational Units</div>
                    <div className="text-xs text-[var(--color-muted)]">Year 7 & Year 8 Active Cohorts</div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSyncStudents}
                    disabled={syncing === "students"}
                  >
                    {syncing === "students" ? <Spinner size="sm" className="mr-2" /> : <RefreshCw className="mr-2 size-3.5 text-[var(--color-warning)]" />}
                    Sync Students OU
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-information)_20%,transparent)] bg-[color-mix(in_srgb,var(--color-information)_20%,transparent)] p-4 text-xs text-[var(--color-text)] space-y-2">
                <div className="font-semibold text-[var(--color-information)] flex items-center gap-2">
                  <ShieldCheck className="size-4 text-[var(--color-information)]" /> Sync Policy & Conflict Resolution
                </div>
                <p>
                  Automated sync actions reconcile user email addresses, full names, and group memberships. Manual overrides created in this dashboard take priority over incoming automated Google Workspace payload attributes.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="p-0 border-[var(--color-border)]">
            <CardHeader className="mb-0 border-b border-[var(--color-border)] px-5 py-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Crown className="size-4 text-[var(--color-warning)]" />
                  Role Distribution Breakdown
                </CardTitle>
                <p className="mt-1 text-xs text-[var(--color-muted)]">Live breakdown of privileged roles across active staff.</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 px-5 py-5">
              {Object.keys(roleBreakdown).length > 0 ? (
                Object.entries(roleBreakdown).map(([role, count]) => {
                  const percentage = Math.round((count / staff.length) * 100) || 0
                  return (
                    <div key={role} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[var(--color-text)]">{labelize(role)}</span>
                        <span className="text-[var(--color-muted)]">{count} accounts ({percentage}%)</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-[var(--color-surface)] overflow-hidden border border-[var(--color-border-muted)]">
                        <div
                          className="h-full rounded-full bg-[var(--color-accent)] transition-[width] duration-500 motion-reduce:transition-none"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  )
                })
              ) : (
                <p className="text-xs text-[var(--color-muted)]">No role metadata available.</p>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* TAB 4: ANALYTICS & QUICK SHORTCUTS */}
      {activeTab === "analytics" && (
        <section
          role="tabpanel"
          id="admin-panel-analytics"
          aria-labelledby="admin-tab-analytics"
          className="grid gap-6 xl:grid-cols-2"
        >
          <Card className="p-0 border-[var(--color-border)]">
            <CardHeader className="mb-0 border-b border-[var(--color-border)] px-5 py-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="size-4 text-[var(--color-destructive)]" />
                  Active Incident & Safeguarding Queue
                </CardTitle>
                <p className="mt-1 text-xs text-[var(--color-muted)]">Real-time status of incidents requiring leadership action.</p>
              </div>
              <Button asChild variant="outline" size="sm" className="text-xs">
                <Link to="/incidents">
                  Open Incident Manager <ChevronRight className="ml-1 size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 px-5 py-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] p-4">
                  <div className="text-xs text-[var(--color-muted)]">Open Incidents</div>
                  <div className="mt-1 text-2xl font-bold text-[var(--color-destructive)]">{activeIncidents}</div>
                  <div className="mt-1 text-xs text-[var(--color-muted)]">Requires triage or delegate assignment</div>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] p-4">
                  <div className="text-xs text-[var(--color-muted)]">Total Logged</div>
                  <div className="mt-1 text-2xl font-bold text-[var(--color-text)]">{incidents.length}</div>
                  <div className="mt-1 text-xs text-[var(--color-muted)]">Lifetime system incident logs</div>
                </div>
              </div>

              <div className="pt-2 border-t border-[var(--color-border)] space-y-2">
                <div className="text-xs font-semibold text-[var(--color-text)]">Quick Navigation Shortcuts</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Button asChild variant="outline" size="sm" className="w-full justify-between text-xs">
                    <Link to="/staff">
                      <span>Staff Directory</span>
                      <ArrowRight className="size-3 text-[var(--color-muted)]" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="w-full justify-between text-xs">
                    <Link to="/classes">
                      <span>Class Management</span>
                      <ArrowRight className="size-3 text-[var(--color-muted)]" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="w-full justify-between text-xs">
                    <Link to="/incidents">
                      <span>Incidents</span>
                      <ArrowRight className="size-3 text-[var(--color-muted)]" />
                    </Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="p-0 border-[var(--color-border)]">
            <CardHeader className="mb-0 border-b border-[var(--color-border)] px-5 py-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers3 className="size-4 text-[var(--color-information)]" />
                  Governance Guidelines
                </CardTitle>
                <p className="mt-1 text-xs text-[var(--color-muted)]">Key safeguards and audit principles for system operators.</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 px-5 py-5 text-xs text-[var(--color-text)]">
              <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] p-3.5">
                <Layers3 className="mt-0.5 size-4 text-[var(--color-information)] shrink-0" />
                <div>
                  <div className="font-semibold text-[var(--color-text)]">Explicit Role Grants</div>
                  <div className="text-[var(--color-muted)] mt-0.5">Always verify staff access rights before granting leadership or delegate role overrides.</div>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] p-3.5">
                <BookOpen className="mt-0.5 size-4 text-[var(--color-success)] shrink-0" />
                <div>
                  <div className="font-semibold text-[var(--color-text)]">Teaching Scope Isolation</div>
                  <div className="text-[var(--color-muted)] mt-0.5">Scope follows explicit class assignments first, followed by manual inclusion/exclusion rules.</div>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] p-3.5">
                <Clock3 className="mt-0.5 size-4 text-[var(--color-warning)] shrink-0" />
                <div>
                  <div className="font-semibold text-[var(--color-text)]">Audit Windowing</div>
                  <div className="text-[var(--color-muted)] mt-0.5">Temporary relief teachers should always have strict effective start and expiry date windows.</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Staff Create / Edit Modal Dialog */}
      <Dialog
        open={showStaffDialog}
        onOpenChange={setShowStaffDialog}
        title={editingStaff ? "Edit Staff User" : "Create New Staff User"}
      >
        <form onSubmit={handleSubmitStaff} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="First Name *" htmlFor="admin-staff-first-name" labelClassName="text-xs font-medium text-[var(--color-text)]">
              <Input
                id="admin-staff-first-name"
                value={staffForm.first_name}
                onChange={(event) => setStaffForm((current) => ({ ...current, first_name: event.target.value }))}
                required
                className="text-xs"
              />
            </FormField>
            <FormField label="Last Name *" htmlFor="admin-staff-last-name" labelClassName="text-xs font-medium text-[var(--color-text)]">
              <Input
                id="admin-staff-last-name"
                value={staffForm.last_name}
                onChange={(event) => setStaffForm((current) => ({ ...current, last_name: event.target.value }))}
                required
                className="text-xs"
              />
            </FormField>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Email Address *" htmlFor="admin-staff-email" labelClassName="text-xs font-medium text-[var(--color-text)]">
              <Input
                id="admin-staff-email"
                type="email"
                value={staffForm.email}
                onChange={(event) => setStaffForm((current) => ({ ...current, email: event.target.value }))}
                required
                className="text-xs"
              />
            </FormField>
            <FormField label="Phone Number" htmlFor="admin-staff-phone" labelClassName="text-xs font-medium text-[var(--color-text)]">
              <Input
                id="admin-staff-phone"
                value={staffForm.phone}
                onChange={(event) => setStaffForm((current) => ({ ...current, phone: event.target.value }))}
                className="text-xs"
              />
            </FormField>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Account Status" htmlFor="admin-staff-status" labelClassName="text-xs font-medium text-[var(--color-text)]">
              <Select
                id="admin-staff-status"
                value={staffForm.status}
                onChange={(event) => setStaffForm((current) => ({ ...current, status: event.target.value }))}
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>{labelize(status)}</option>
                ))}
              </Select>
            </FormField>
          </div>

          {isAdmin && (
            <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-information)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-information)_15%,transparent)] p-3.5">
              <div className="flex items-start gap-3">
                <input
                  id="admin-staff-create-account"
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0 rounded border-[color-mix(in_srgb,var(--color-text)_20%,var(--color-border))] accent-[var(--color-information)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                  checked={staffForm.createAccount}
                  onChange={(event) =>
                    setStaffForm((current) => ({ ...current, createAccount: event.target.checked }))
                  }
                />
                <label htmlFor="admin-staff-create-account" className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--color-text)]">
                    Create a manual login (no Google account)
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-[var(--color-muted)]">
                    Only for people outside the organisation, who cannot sign in with Google. Creates a
                    password sign-in for {staffForm.email || "this address"} and emails a one-time link so
                    they set their own password. No password is ever generated, emailed, or shown here.
                    Leave this unticked for organisation staff: they sign in with Google, and the roles
                    below are held for them until their first sign-in.
                  </span>
                </label>
              </div>

              <div className="mt-3 flex items-start gap-2 border-t border-[var(--color-border)] pt-3 text-xs leading-relaxed text-[var(--color-muted)]">
                <MailWarning className="mt-0.5 size-3.5 shrink-0 text-[var(--color-information)]" />
                <span>
                  {allowedEmailDomains.length === 0
                    ? "No email domain rule is configured, so any address is accepted."
                    : `Only these domains may receive a login: ${allowedEmailDomains.join(", ")}.`}
                </span>
              </div>
            </div>
          )}

          <FormField label="Roles" htmlFor="admin-staff-roles" labelClassName="text-xs font-medium text-[var(--color-text)]">
            <div id="admin-staff-roles" className="space-y-3 rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_60%,transparent)] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[var(--color-muted)]">
                  Manage all active roles for this staff member. Dates are optional; a role with no dates is
                  open-ended.
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setStaffForm((current) => ({ ...current, roles: [], roleWindows: {} }))}
                  disabled={staffForm.roles.length === 0}
                >
                  Clear
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {roleOptions.map((role) => {
                  const selected = staffForm.roles.includes(role)
                  const window = staffForm.roleWindows[role] ?? { effective_from: "", effective_to: "" }

                  return (
                    <div
                      key={role}
                      className={`rounded-lg border px-3 py-2 text-sm transition ${selected ? "border-[color-mix(in_srgb,var(--color-information)_50%,transparent)] bg-[color-mix(in_srgb,var(--color-information)_10%,transparent)] text-[var(--color-text)]" : "border-[var(--color-border)] bg-[var(--color-surface-muted)]/50 text-[var(--color-text)] hover:border-[color-mix(in_srgb,var(--color-text)_20%,var(--color-border))]"}`}
                    >
                      <label className="flex cursor-pointer items-center justify-between gap-3">
                        <span>{labelize(role)}</span>
                        <input
                          type="checkbox"
                          className="size-4 shrink-0 rounded border-[color-mix(in_srgb,var(--color-text)_20%,var(--color-border))] accent-[var(--color-information)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
                          checked={selected}
                          onChange={() => {
                            setStaffForm((current) => ({
                              ...current,
                              roles: selected
                                ? current.roles.filter((value) => value !== role)
                                : [...current.roles, role],
                              roleWindows: selected
                                ? Object.fromEntries(
                                    Object.entries(current.roleWindows).filter(([key]) => key !== role),
                                  )
                                : { ...current.roleWindows, [role]: window },
                            }))
                          }}
                        />
                      </label>

                      {selected && (
                        <div className="mt-2 grid gap-2 border-t border-[var(--color-border)] pt-2 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor={`admin-staff-role-from-${role}`}
                              className="block text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]"
                            >
                              From
                            </label>
                            <Input
                              id={`admin-staff-role-from-${role}`}
                              type="date"
                              aria-label={`${labelize(role)} start date`}
                              value={window.effective_from}
                              onChange={(event) =>
                                setStaffForm((current) => ({
                                  ...current,
                                  roleWindows: {
                                    ...current.roleWindows,
                                    [role]: { ...window, effective_from: event.target.value },
                                  },
                                }))
                              }
                              className="mt-1 text-xs"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`admin-staff-role-to-${role}`}
                              className="block text-xs font-medium uppercase tracking-wider text-[var(--color-muted)]"
                            >
                              To
                            </label>
                            <Input
                              id={`admin-staff-role-to-${role}`}
                              type="date"
                              aria-label={`${labelize(role)} end date`}
                              value={window.effective_to}
                              onChange={(event) =>
                                setStaffForm((current) => ({
                                  ...current,
                                  roleWindows: {
                                    ...current.roleWindows,
                                    [role]: { ...window, effective_to: event.target.value },
                                  },
                                }))
                              }
                              className="mt-1 text-xs"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                {staffForm.roles.length > 0 ? staffForm.roles.map((role) => {
                  const window = staffForm.roleWindows[role]
                  return (
                    <span
                      key={role}
                      className="rounded-full border border-[var(--color-border)] bg-[var(--color-row-hover)] px-2.5 py-1 text-xs text-[var(--color-text)]"
                    >
                      {labelize(role)}
                      {window?.effective_from || window?.effective_to ? (
                        <span className="ml-1 text-[var(--color-muted)]">
                          ({formatWindow(window.effective_from, window.effective_to)})
                        </span>
                      ) : null}
                    </span>
                  )
                }) : (
                  <span className="text-xs text-[var(--color-muted)]">No roles selected</span>
                )}
              </div>
            </div>
          </FormField>

          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Department" htmlFor="admin-staff-department" labelClassName="text-xs font-medium text-[var(--color-text)]">
              <Input
                id="admin-staff-department"
                value={staffForm.department}
                onChange={(event) => setStaffForm((current) => ({ ...current, department: event.target.value }))}
                className="text-xs"
              />
            </FormField>
            <FormField label="Org Unit Path" htmlFor="admin-staff-org-unit" labelClassName="text-xs font-medium text-[var(--color-text)]">
              <Input
                id="admin-staff-org-unit"
                value={staffForm.org_unit_path}
                onChange={(event) => setStaffForm((current) => ({ ...current, org_unit_path: event.target.value }))}
                placeholder="/Accounts/Automated/Staff"
                className="text-xs"
              />
            </FormField>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--color-border)]">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowStaffDialog(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              {editingStaff ? "Save Record" : "Create Record"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
