import { useCallback, useEffect, useMemo, useState, type FormEventHandler } from "react"
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Copy,
  Crown,
  Download,
  Filter,
  Layers3,
  RefreshCw,
  School,
  Search,
  Pencil,
  ShieldCheck,
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
  fetchClasses,
  fetchCurrentUserRoles,
  fetchIncidents,
  fetchStaff,
  fetchStudents,
  replaceStaffRolesByProfileId,
  resolveProfileIdByEmail,
  syncStaffFromGoogleWorkspace,
  syncStudentsFromGoogleWorkspace,
  updateStaff,
  type StaffDirectoryRow,
} from "../lib/api/supabaseApi"
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

const roleOptions = [
  "teacher",
  "counsellor",
  "principal",
  "deputy_principal",
  "counsellor_delegate",
  "leadership_delegate",
  "it_staff",
  "it_admin",
]

type StaffRole = (typeof roleOptions)[number]

const statusOptions = ["active", "inactive", "pending"]

const scopeModeOptions = ["primary_teacher", "co_teacher", "manual_inclusion", "manual_exclusion"]

function getRoleBadgeTone(value: string) {
  if (["principal", "deputy_principal", "it_admin"].includes(value)) return "violet"
  if (["teacher", "counsellor", "it_staff"].includes(value)) return "cyan"
  if (["counsellor_delegate", "leadership_delegate"].includes(value)) return "amber"
  return "slate"
}

function getStatusBadgeTone(value: string) {
  if (value === "active") return "emerald"
  if (value === "pending") return "amber"
  if (value === "inactive") return "slate"
  return "slate"
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
  })
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
      const [staffData, studentData, classData, incidentData, roleData] = await Promise.all([
        fetchStaff(),
        fetchStudents(),
        fetchClasses(),
        fetchIncidents(),
        fetchCurrentUserRoles(),
      ])
      setStaff(staffData)
      setStudents(studentData)
      setClasses(classData)
      setIncidents(incidentData)
      setRoles(roleData)
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
    ["principal", "deputy_principal", "counsellor_delegate", "leadership_delegate"].includes(role)
  )
  
  const selectedStaff = selectedStaffId ? staff.find((entry) => entry.id === selectedStaffId) ?? null : null

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
  const teacherCount = staff.filter((entry) => entry.roles.some((role) => role.toLowerCase().includes("teacher"))).length
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
            <div className="font-medium text-white">{row.first_name} {row.last_name}</div>
            <div className="text-xs text-slate-400">{row.org_unit_path || "No org unit"}</div>
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
          <span className="text-slate-400">{String(value ?? "-")}</span>
          {Boolean(value) && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleCopyEmail(String(value))
              }}
              className="text-slate-500 hover:text-cyan-400 transition-colors"
              title="Copy email"
            >
              {copiedEmail === String(value) ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
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
      accessor: "department",
      header: "Department",
      sortable: true,
      className: "whitespace-nowrap min-w-[180px]",
      cell: (value: unknown) => <span className="text-slate-400">{String(value ?? "-")}</span>,
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
            <UserPlus className="size-4 text-cyan-400" />
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
    })
  }

  function handleEditStaff(row: StaffDirectoryRow) {
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
      roles: row.roles.length > 0 ? row.roles as StaffRole[] : row.role ? [row.role as StaffRole] : [],
    })
    setShowStaffDialog(true)
  }

  const handleSubmitStaff: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault()
    try {
      const resolvedProfileId =
        editingStaff?.profile_id?.trim() ||
        staffForm.profile_id.trim() ||
        (staffForm.email.trim() ? await resolveProfileIdByEmail(staffForm.email.trim()) : null) ||
        null

      const payload = {
        first_name: staffForm.first_name,
        last_name: staffForm.last_name,
        email: staffForm.email,
        phone: staffForm.phone || null,
        department: staffForm.department || null,
        status: staffForm.status,
        org_unit_path: staffForm.org_unit_path || null,
        profile_id: resolvedProfileId,
      }

      if (editingStaff) {
        await updateStaff(editingStaff.id, payload)
      } else {
        await createStaff(payload)
      }

      if (resolvedProfileId) {
        await replaceStaffRolesByProfileId(resolvedProfileId, staffForm.roles)
      }
      toast.success(editingStaff ? "Staff user updated" : "Staff user created", `${staffForm.first_name} ${staffForm.last_name} was saved successfully.`)
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
      <div className="flex h-72 w-full items-center justify-center rounded-2xl border border-white/10 bg-slate-900/40">
        <Spinner size="xl" className="text-cyan-400" />
      </div>
    )
  }

  return (
    <div className="w-full max-w-full min-w-0 space-y-6">
      {/* 2-Column Asymmetric Hero Header */}
      <section className="relative overflow-hidden rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-slate-900 via-slate-900/90 to-cyan-950/40 p-6 sm:p-8 shadow-xl">
        <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 left-12 h-52 w-52 rounded-full bg-indigo-500/10 blur-3xl" />
        
        <div className="relative grid gap-6 md:grid-cols-[1.6fr_1fr] items-center">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-cyan-200 backdrop-blur-md">
              <ShieldCheck className="size-3.5 text-cyan-400" />
              Admin Control Center
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              User Directory & Scope Workspace
            </h1>
            <p className="text-sm text-slate-300 sm:text-base leading-relaxed">
              Manage staff accounts, assign granular role permissions, establish teaching scope rules, and execute Google Workspace sync operations.
            </p>
            <div className="flex flex-wrap gap-2 pt-1 text-xs text-slate-300">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-slate-950/40 px-3 py-1">
                <span className="size-2 rounded-full bg-emerald-400 animate-pulse" /> Live Directory
              </span>
              <span className="rounded-full border border-white/10 bg-slate-950/40 px-3 py-1">
                {assignmentDrafts.length} Queued Drafts
              </span>
              <span className="rounded-full border border-white/10 bg-slate-950/40 px-3 py-1">
                {activeIncidents} Active Incidents
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-950/80 p-4 text-xs text-slate-300 backdrop-blur-md w-full">
            <div className="flex items-center gap-2 font-medium text-white">
              <BadgeCheck className="size-4 text-emerald-400" />
              {isAdmin ? "Administrative Access Granted" : "Read-Only Governance View"}
            </div>
            <div className="truncate text-slate-400">User: <span className="text-slate-200">{user?.email}</span></div>
            <div className="text-slate-400">Active Roles: <span className="text-cyan-300 font-medium">{roles.length > 0 ? roles.map(labelize).join(", ") : "None"}</span></div>
            
            <div className="pt-2 border-t border-white/10 flex items-center justify-between">
              <span className="text-slate-400">System Status</span>
              <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                <CheckCircle2 className="size-3.5" /> Operational
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Statistic Cards */}
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Live Metrics</h2>
            <p className="text-xs text-slate-400">Six governance KPIs arranged for a three-column rhythm on larger screens.</p>
          </div>
        </div>
        <StatisticGrid>
          {[
          { label: "Staff Accounts", value: totalStaff, icon: Users, accent: "text-cyan-400", description: "Users with linked staff records" },
          { label: "Teaching Staff", value: teacherCount, icon: School, accent: "text-emerald-400", description: "Staff assigned to classroom teaching" },
          { label: "Total Students", value: totalStudents, icon: BookOpen, accent: "text-amber-400", description: "Learner records available to governance" },
          { label: "Total Classes", value: totalClasses, icon: ClipboardList, accent: "text-rose-400", description: "Class sections tracked in the schedule" },
          { label: "Open Incidents", value: activeIncidents, icon: AlertTriangle, accent: "text-cyan-400", description: "Unresolved governance and safety items" },
          { label: "Departments", value: departmentCount, icon: Layers3, accent: "text-emerald-400", description: "Distinct departments represented" },
        ].map((card) => {
          const Icon = card.icon
          return (
            <StatisticCard
              key={card.label}
              label={card.label}
              value={card.value}
              icon={Icon}
              description={card.description}
              accentClassName={card.accent}
              glowClassName={
                card.label === "Open Incidents"
                  ? "from-rose-400/25 via-rose-400/10 to-transparent"
                  : card.label === "Teaching Staff"
                    ? "from-emerald-400/25 via-emerald-400/10 to-transparent"
                    : card.label === "Total Students"
                      ? "from-amber-400/25 via-amber-400/10 to-transparent"
                      : "from-cyan-400/25 via-cyan-400/10 to-transparent"
              }
            />
          )
        })}
        </StatisticGrid>
      </section>

      {/* Interactive Navigation Tabs */}
      <div className="flex border-b border-white/10 gap-2 overflow-x-auto pb-1">
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
              onClick={() => setActiveTab(tab.id as DashboardTab)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-all whitespace-nowrap ${
                isActive
                  ? "bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 shadow-sm"
                  : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
              }`}
            >
              <Icon className={`size-4 ${isActive ? "text-cyan-400" : "text-slate-500"}`} />
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className={`ml-1 px-2 py-0.5 text-xs rounded-full ${
                  isActive ? "bg-cyan-400/20 text-cyan-200" : "bg-white/10 text-slate-300"
                }`}>
                  {tab.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* TAB 1: USER DIRECTORY & SELECTION */}
      {activeTab === "directory" && (
        <section className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,2.35fr)_minmax(300px,0.9fr)]">
          <Card className="min-w-0 overflow-hidden p-0 border-white/10">
            <CardHeader className="mb-0 flex-col items-start justify-start border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="size-4 text-cyan-400" />
                  Staff Directory
                </CardTitle>
                <p className="mt-1 text-xs text-slate-400">Search, filter, and inspect staff metadata and active assignments.</p>
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
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
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
                <div className="flex min-w-0 flex-col gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-400 sm:flex-row sm:items-center">
                  <Filter className="size-3 text-cyan-400" />
                  <span className="min-w-0 break-words sm:flex-1">Filters active: showing {filteredStaff.length} of {staff.length} users</span>
                  <button
                    onClick={() => {
                      setSearch("")
                      setRoleFilter("")
                      setDepartmentFilter("")
                      setStatusFilter("")
                    }}
                    className="text-left font-medium text-cyan-400 hover:underline sm:ml-auto sm:text-right"
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
            <Card className="p-0 border-white/10 sticky top-4">
              <CardHeader className="mb-0 border-b border-white/10 px-5 py-4">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <UserCheck className="size-4 text-emerald-400" />
                    Account Overview
                  </CardTitle>
                  <p className="mt-1 text-xs text-slate-400">Detailed parameters for the selected account.</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 px-5 py-5">
                {selectedStaff ? (
                  <>
                    <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-bold text-white">
                            {selectedStaff.first_name} {selectedStaff.last_name}
                          </div>
                          <div className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                            {selectedStaff.email}
                            <button
                              onClick={() => handleCopyEmail(selectedStaff.email)}
                              className="text-slate-500 hover:text-cyan-400"
                              title="Copy email"
                            >
                              <Copy className="size-3" />
                            </button>
                          </div>
                        </div>
                        <TableBadge tone={getStatusBadgeTone(selectedStaff.status ?? "active")}>
                          {labelize(selectedStaff.status ?? "active")}
                        </TableBadge>
                      </div>

                      <div className="pt-2 border-t border-white/10 grid gap-2 text-xs text-slate-300">
                        <div className="flex justify-between"><span className="text-slate-500">Roles:</span> <span className="font-medium text-slate-200">{selectedStaff.roles.length > 0 ? selectedStaff.roles.map(labelize).join(", ") : "Unassigned"}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Department:</span> <span className="font-medium text-slate-200">{selectedStaff.department || "Unassigned"}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Phone:</span> <span className="font-medium text-slate-200">{selectedStaff.phone || "Not provided"}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Org Unit:</span> <span className="font-medium text-slate-200 truncate max-w-[180px]">{selectedStaff.org_unit_path || "Root"}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Drafted Queue:</span> <span className="font-medium text-cyan-400">{selectedDrafts.length} updates</span></div>
                      </div>
                    </div>

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
                        className="justify-between text-xs border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10"
                      >
                        <span>Queue New Scope Assignment</span>
                        <ClipboardList className="size-3.5" />
                      </Button>
                    </div>

                    {selectedDrafts.length > 0 && (
                      <div className="space-y-2 pt-2 border-t border-white/10">
                        <span className="text-xs font-semibold text-slate-300">Pending Drafts for User:</span>
                        {selectedDrafts.map((draft) => (
                          <div key={draft.id} className="rounded-lg border border-cyan-500/20 bg-cyan-950/20 p-2.5 text-xs">
                            <div className="flex items-center justify-between font-medium text-cyan-200">
                              <span>{draft.targetName} ({labelize(draft.targetType)})</span>
                              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-cyan-400/10 border border-cyan-400/20">{draft.mode}</span>
                            </div>
                            <div className="mt-1 text-slate-400 text-[11px]">{draft.notes || "No notes"}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="py-8 text-center text-xs text-slate-400">
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
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Card className="p-0 border-white/10">
            <CardHeader className="mb-0 border-b border-white/10 px-5 py-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <SlidersHorizontal className="size-4 text-cyan-400" />
                  Scope & Role Assignment Form
                </CardTitle>
                <p className="mt-1 text-xs text-slate-400">Draft granular permission updates and teaching scope bindings.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-300 font-medium">
                  {assignmentDrafts.length} Pending
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-5 py-5">
              <form onSubmit={handleQueueAssignment} className="space-y-4 rounded-xl border border-white/10 bg-slate-950/60 p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <FormField label="Assignment Scope" htmlFor="assignment-scope" labelClassName="text-xs font-medium text-slate-300">
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

                  <FormField label="Target Staff Account" htmlFor="assignment-owner" labelClassName="text-xs font-medium text-slate-300">
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
                  <FormField label="Target Object Type" htmlFor="assignment-target-type" labelClassName="text-xs font-medium text-slate-300">
                    <Select
                      id="assignment-target-type"
                      value={assignmentForm.targetType}
                      onChange={(event) => setAssignmentForm((current) => ({ ...current, targetType: event.target.value as AssignmentDraft["targetType"], targetId: "" }))}
                    >
                      <option value="class">Class</option>
                      <option value="student">Student</option>
                    </Select>
                  </FormField>

                  <FormField label="Scope Inclusion Mode" htmlFor="assignment-mode" labelClassName="text-xs font-medium text-slate-300">
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
                  <FormField label={`Select Target ${assignmentForm.targetType === "class" ? "Class" : "Student"}`} htmlFor="assignment-target" labelClassName="text-xs font-medium text-slate-300">
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

                  <FormField label="Source Provenance" htmlFor="assignment-source" labelClassName="text-xs font-medium text-slate-300">
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
                  <FormField label="Effective Start Date" htmlFor="assignment-effective-from" labelClassName="text-xs font-medium text-slate-300">
                    <Input id="assignment-effective-from" type="date" value={assignmentForm.effectiveFrom} onChange={(event) => setAssignmentForm((current) => ({ ...current, effectiveFrom: event.target.value }))} className="text-xs" />
                  </FormField>
                  <FormField label="Effective Expiry Date" htmlFor="assignment-effective-to" labelClassName="text-xs font-medium text-slate-300">
                    <Input id="assignment-effective-to" type="date" value={assignmentForm.effectiveTo} onChange={(event) => setAssignmentForm((current) => ({ ...current, effectiveTo: event.target.value }))} className="text-xs" />
                  </FormField>
                </div>

                <FormField label="Audit Justification & Notes" htmlFor="assignment-notes" labelClassName="text-xs font-medium text-slate-300">
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
          <Card className="p-0 border-white/10">
            <CardHeader className="mb-0 border-b border-white/10 px-5 py-4">
              <div>
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Queued Drafts ({assignmentDrafts.length})</span>
                  {assignmentDrafts.length > 0 && (
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={handleExportDrafts} title="Export JSON">
                        <Download className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setAssignmentDrafts([])} className="text-rose-400 hover:text-rose-300">
                        Clear All
                      </Button>
                    </div>
                  )}
                </CardTitle>
                <p className="mt-1 text-xs text-slate-400">Staged changes ready for governance review and deployment.</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 px-5 py-5 max-h-[550px] overflow-y-auto">
              {assignmentDrafts.length > 0 ? (
                assignmentDrafts.map((draft) => (
                  <div key={draft.id} className="group relative rounded-xl border border-white/10 bg-slate-950/60 p-3.5 hover:border-cyan-500/30 transition-colors">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-xs text-white flex items-center gap-1.5">
                          <span>{draft.ownerName}</span>
                          <ArrowRight className="size-3 text-slate-500" />
                          <span className="text-cyan-300">{draft.targetName}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-400">
                          {labelize(draft.scopeType)} via <span className="text-slate-300">{labelize(draft.source)}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteDraft(draft.id)}
                        className="text-slate-500 hover:text-rose-400 transition-colors p-1"
                        title="Remove draft"
                      >
                        <Trash2 className="size-4 text-rose-400" />
                      </button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                      <TableBadge tone={getModeBadgeTone(draft.mode)} className="px-2 py-0.5 text-[10px] font-medium">
                        {labelize(draft.mode)}
                      </TableBadge>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-slate-300">
                        {draft.targetType.toUpperCase()}
                      </span>
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-slate-400">
                        {formatWindow(draft.effectiveFrom, draft.effectiveTo)}
                      </span>
                    </div>

                    {draft.notes && (
                      <p className="mt-2 text-[11px] text-slate-400 italic bg-white/5 p-2 rounded">
                        "{draft.notes}"
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/30 p-8 text-center text-xs text-slate-400">
                  <Sparkles className="mx-auto size-6 text-slate-600 mb-2" />
                  No changes queued. Fill out the scope form to stage updates before applying.
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* TAB 3: WORKSPACE SYNC & GOVERNANCE */}
      {activeTab === "sync" && (
        <section className="grid gap-6 xl:grid-cols-2">
          <Card className="p-0 border-white/10">
            <CardHeader className="mb-0 border-b border-white/10 px-5 py-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <RefreshCw className="size-4 text-cyan-400" />
                  Google Workspace Automated Synchronization
                </CardTitle>
                <p className="mt-1 text-xs text-slate-400">Synchronize accounts and organizational units directly from Google Workspace.</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 px-5 py-5">
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white">Staff Organizational Unit</div>
                    <div className="text-xs text-slate-400">/Accounts/Automated/Staff</div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSyncStaff}
                    disabled={syncing === "staff"}
                  >
                    {syncing === "staff" ? <Spinner size="sm" className="mr-2" /> : <RefreshCw className="mr-2 size-3.5 text-cyan-400" />}
                    Sync Staff OU
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-white">Students Organizational Units</div>
                    <div className="text-xs text-slate-400">Year 7 & Year 8 Active Cohorts</div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSyncStudents}
                    disabled={syncing === "students"}
                  >
                    {syncing === "students" ? <Spinner size="sm" className="mr-2" /> : <RefreshCw className="mr-2 size-3.5 text-amber-400" />}
                    Sync Students OU
                  </Button>
                </div>
              </div>

              <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-4 text-xs text-slate-300 space-y-2">
                <div className="font-semibold text-cyan-200 flex items-center gap-2">
                  <ShieldCheck className="size-4 text-cyan-400" /> Sync Policy & Conflict Resolution
                </div>
                <p>
                  Automated sync actions reconcile user email addresses, full names, and group memberships. Manual overrides created in this dashboard take priority over incoming automated Google Workspace payload attributes.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="p-0 border-white/10">
            <CardHeader className="mb-0 border-b border-white/10 px-5 py-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Crown className="size-4 text-amber-400" />
                  Role Distribution Breakdown
                </CardTitle>
                <p className="mt-1 text-xs text-slate-400">Live breakdown of privileged roles across active staff.</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 px-5 py-5">
              {Object.keys(roleBreakdown).length > 0 ? (
                Object.entries(roleBreakdown).map(([role, count]) => {
                  const percentage = Math.round((count / staff.length) * 100) || 0
                  return (
                    <div key={role} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-slate-200">{labelize(role)}</span>
                        <span className="text-slate-400">{count} accounts ({percentage}%)</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-950 overflow-hidden border border-white/5">
                        <div
                          className="h-full bg-cyan-400 rounded-full transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  )
                })
              ) : (
                <p className="text-xs text-slate-400">No role metadata available.</p>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* TAB 4: ANALYTICS & QUICK SHORTCUTS */}
      {activeTab === "analytics" && (
        <section className="grid gap-6 xl:grid-cols-2">
          <Card className="p-0 border-white/10">
            <CardHeader className="mb-0 border-b border-white/10 px-5 py-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="size-4 text-rose-400" />
                  Active Incident & Safeguarding Queue
                </CardTitle>
                <p className="mt-1 text-xs text-slate-400">Real-time status of incidents requiring leadership action.</p>
              </div>
              <Button asChild variant="outline" size="sm" className="text-xs">
                <Link to="/incidents">
                  Open Incident Manager <ChevronRight className="ml-1 size-3.5" />
                </Link>
              </Button>
            </CardHeader>
            <CardContent className="space-y-3 px-5 py-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
                  <div className="text-xs text-slate-400">Open Incidents</div>
                  <div className="mt-1 text-2xl font-bold text-rose-400">{activeIncidents}</div>
                  <div className="mt-1 text-[11px] text-slate-500">Requires triage or delegate assignment</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
                  <div className="text-xs text-slate-400">Total Logged</div>
                  <div className="mt-1 text-2xl font-bold text-white">{incidents.length}</div>
                  <div className="mt-1 text-[11px] text-slate-500">Lifetime system incident logs</div>
                </div>
              </div>

              <div className="pt-2 border-t border-white/10 space-y-2">
                <div className="text-xs font-semibold text-slate-300">Quick Navigation Shortcuts</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Button asChild variant="outline" size="sm" className="w-full justify-between text-xs">
                    <Link to="/staff">
                      <span>Staff Directory</span>
                      <ArrowRight className="size-3 text-slate-500" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="w-full justify-between text-xs">
                    <Link to="/classes">
                      <span>Class Management</span>
                      <ArrowRight className="size-3 text-slate-500" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="sm" className="w-full justify-between text-xs">
                    <Link to="/incidents">
                      <span>Incidents</span>
                      <ArrowRight className="size-3 text-slate-500" />
                    </Link>
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="p-0 border-white/10">
            <CardHeader className="mb-0 border-b border-white/10 px-5 py-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <Layers3 className="size-4 text-cyan-400" />
                  Governance Guidelines
                </CardTitle>
                <p className="mt-1 text-xs text-slate-400">Key safeguards and audit principles for system operators.</p>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 px-5 py-5 text-xs text-slate-300">
              <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3.5">
                <Layers3 className="mt-0.5 size-4 text-cyan-400 shrink-0" />
                <div>
                  <div className="font-semibold text-white">Explicit Role Grants</div>
                  <div className="text-slate-400 mt-0.5">Always verify staff access rights before granting leadership or delegate role overrides.</div>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3.5">
                <BookOpen className="mt-0.5 size-4 text-emerald-400 shrink-0" />
                <div>
                  <div className="font-semibold text-white">Teaching Scope Isolation</div>
                  <div className="text-slate-400 mt-0.5">Scope follows explicit class assignments first, followed by manual inclusion/exclusion rules.</div>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-3.5">
                <Clock3 className="mt-0.5 size-4 text-amber-400 shrink-0" />
                <div>
                  <div className="font-semibold text-white">Audit Windowing</div>
                  <div className="text-slate-400 mt-0.5">Temporary relief teachers should always have strict effective start and expiry date windows.</div>
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
            <FormField label="First Name *" htmlFor="admin-staff-first-name" labelClassName="text-xs font-medium text-slate-300">
              <Input
                id="admin-staff-first-name"
                value={staffForm.first_name}
                onChange={(event) => setStaffForm((current) => ({ ...current, first_name: event.target.value }))}
                required
                className="text-xs"
              />
            </FormField>
            <FormField label="Last Name *" htmlFor="admin-staff-last-name" labelClassName="text-xs font-medium text-slate-300">
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
            <FormField label="Email Address *" htmlFor="admin-staff-email" labelClassName="text-xs font-medium text-slate-300">
              <Input
                id="admin-staff-email"
                type="email"
                value={staffForm.email}
                onChange={(event) => setStaffForm((current) => ({ ...current, email: event.target.value }))}
                required
                className="text-xs"
              />
            </FormField>
            <FormField label="Phone Number" htmlFor="admin-staff-phone" labelClassName="text-xs font-medium text-slate-300">
              <Input
                id="admin-staff-phone"
                value={staffForm.phone}
                onChange={(event) => setStaffForm((current) => ({ ...current, phone: event.target.value }))}
                className="text-xs"
              />
            </FormField>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Account Status" htmlFor="admin-staff-status" labelClassName="text-xs font-medium text-slate-300">
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

          <FormField label="Roles" htmlFor="admin-staff-roles" labelClassName="text-xs font-medium text-slate-300">
            <div id="admin-staff-roles" className="space-y-3 rounded-xl border border-white/10 bg-slate-950/60 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">Manage all active roles for this staff member.</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => setStaffForm((current) => ({ ...current, roles: [] }))} disabled={staffForm.roles.length === 0}>
                  Clear
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {roleOptions.map((role) => {
                  const selected = staffForm.roles.includes(role)

                  return (
                    <label
                      key={role}
                      className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm transition ${selected ? "border-cyan-500/50 bg-cyan-500/10 text-white" : "border-white/10 bg-slate-900/50 text-slate-300 hover:border-white/20"}`}
                    >
                      <span>{labelize(role)}</span>
                      <input
                        type="checkbox"
                        className="rounded border-white/20 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
                        checked={selected}
                        onChange={() => {
                          setStaffForm((current) => ({
                            ...current,
                            roles: selected ? current.roles.filter((value) => value !== role) : [...current.roles, role],
                          }))
                        }}
                      />
                    </label>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                {staffForm.roles.length > 0 ? staffForm.roles.map((role) => (
                  <span key={role} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200">
                    {labelize(role)}
                  </span>
                )) : (
                  <span className="text-xs text-slate-500">No roles selected</span>
                )}
              </div>
            </div>
          </FormField>

          <div className="grid gap-3 md:grid-cols-2">
            <FormField label="Department" htmlFor="admin-staff-department" labelClassName="text-xs font-medium text-slate-300">
              <Input
                id="admin-staff-department"
                value={staffForm.department}
                onChange={(event) => setStaffForm((current) => ({ ...current, department: event.target.value }))}
                className="text-xs"
              />
            </FormField>
            <FormField label="Org Unit Path" htmlFor="admin-staff-org-unit" labelClassName="text-xs font-medium text-slate-300">
              <Input
                id="admin-staff-org-unit"
                value={staffForm.org_unit_path}
                onChange={(event) => setStaffForm((current) => ({ ...current, org_unit_path: event.target.value }))}
                placeholder="/Accounts/Automated/Staff"
                className="text-xs"
              />
            </FormField>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
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
