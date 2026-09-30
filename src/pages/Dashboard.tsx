import { useCallback, useEffect, useState } from "react"
import { format } from "date-fns"
import { useAuth } from "../context/useAuth"
import { logError } from "../utils/logger"
import { fetchAssets, fetchAttendanceRecords, fetchDashboardStatsForRole, fetchFinanceDashboardData, fetchIncidents, fetchStaff, fetchStudents, fetchTickets, fetchRmTickets } from "../lib/api/supabaseApi"
import type { Asset, Attendance, Incident, Student, Ticket } from "../lib/api/database.types"
import type { StaffDirectoryRow } from "../lib/api/supabaseApi"
import type { DashboardStatsForRole, FinanceDashboardData } from "../lib/api/supabaseApi"
import type { DashboardActivityItem, DashboardMetric, DashboardShortcut, DashboardSnapshot, DashboardStackedPoint, DashboardTrendPoint, DashboardWorkItem } from "../components/dashboard/DashboardOverview"
import { DashboardOverview } from "../components/dashboard/DashboardOverview"
import { buildFinanceSnapshot } from "../lib/finance/financeSnapshot"
import type { AppRole } from "../lib/access/registry"
import { canAccessRoute } from "../lib/access/routes"
import { can, canAny, toAppRoles } from "../lib/access/permissions"
import { getDashboardProfile, type DashboardMetricKey } from "../lib/dashboard/profiles"
import { todayInSchoolZone } from "../lib/school-time"
import { labelize } from "../utils/labelize"
import { CalendarDays, CircleDollarSign, HardDrive, Receipt, School, ShieldAlert, Ticket as TicketIcon, TrendingUp, Users, Wrench } from "lucide-react"

type DashboardData = {
  students: Student[]
  staff: StaffDirectoryRow[]
  assets: Asset[]
  tickets: Ticket[]
  rmTickets: Ticket[]
  attendance: Attendance[]
  incidents: Incident[]
}

const demoNumbers = {
  students: 842,
  staff: 146,
  assets: 318,
  openItTickets: 24,
  overdueChecks: 7,
  pendingInvoices: 18,
  outstandingValue: 72500,
  revenue: 185400,
  expenses: 132950,
  cashBalance: 247300,
}

const moduleShortcuts: DashboardShortcut[] = [
  { label: "Students", description: "Roster and enrolment", to: "/students", icon: Users },
  { label: "Staff", description: "People and roles", to: "/staff", icon: School },
  { label: "Assets", description: "ICT inventory", to: "/assets", icon: HardDrive },
  { label: "ICT Tickets", description: "ICT support queue", to: "/ict-tickets", icon: TicketIcon },
  { label: "R&M Tickets", description: "Property repairs queue", to: "/rm-tickets", icon: Wrench },
  { label: "Attendance", description: "Daily tracking", to: "/attendance", icon: CalendarDays },
  { label: "Incidents", description: "Safety workflow", to: "/incidents", icon: ShieldAlert },
  { label: "Classes", description: "Teaching scope", to: "/classes", icon: TrendingUp },
  { label: "Finance", description: "Invoices and billing", to: "/finance", icon: Receipt },
  { label: "Admin", description: "Access control", to: "/admin", icon: CircleDollarSign },
]


function sortByPreference<T extends { to?: string; key?: string }>(items: T[], preference: string[]) {
  return items
    .slice()
    .sort((left, right) => {
      const leftKey = left.to ?? left.key ?? ""
      const rightKey = right.to ?? right.key ?? ""
      const leftIndex = preference.indexOf(leftKey)
      const rightIndex = preference.indexOf(rightKey)

      if (leftIndex === -1 && rightIndex === -1) return 0
      if (leftIndex === -1) return 1
      if (rightIndex === -1) return -1
      return leftIndex - rightIndex
    })
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-NZ").format(value)
}

function formatNZD(value: number) {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function preferLiveCount(reported: number | null | undefined, liveCount: number) {
  if ((reported ?? 0) > 0) {
    return reported as number
  }

  return liveCount
}

function isFinalTicket(ticket: Ticket) {
  return ["resolved", "closed", "archived"].includes(ticket.status ?? "")
}

function isOpenTicket(ticket: Ticket) {
  return !isFinalTicket(ticket)
}

/**
 * Mirrors the read rule used by the ticket pages: `*.view_all` sees the whole
 * queue, `*.view_assigned` sees tickets assigned to the viewer, and
 * `*.view_own` sees anything the viewer raised. Passing a capability prefix
 * keeps ICT and R&M on the same code path with their own capability names.
 */
function canViewTicket(ticket: Ticket, module: "ict" | "rm", roles: AppRole[], userId: string | null) {
  if (can(roles, `${module}.view_all`)) return true
  if (!userId) return false
  if (can(roles, `${module}.view_assigned`) && ticket.assigned_to === userId) return true
  if (can(roles, `${module}.view_own`) && ticket.requester_id === userId) return true
  return false
}

function isVisibleOpenTicket(ticket: Ticket, module: "ict" | "rm", roles: AppRole[], userId: string | null) {
  return isOpenTicket(ticket) && canViewTicket(ticket, module, roles, userId)
}

/**
 * The property desk leads when the viewer can only work R&M; otherwise ICT is
 * the primary queue. This picks a label, never a permission.
 */
function getPrimaryTicketRoute(roles: AppRole[]) {
  const rmOnly = can(roles, "rm.view_all") || canAny(roles, ["rm.view_assigned", "rm.view_own"])
  const ictAccess = canAny(roles, ["ict.view_all", "ict.view_assigned", "ict.view_own"])

  if (rmOnly && !ictAccess) return "/rm-tickets"

  return "/ict-tickets"
}

function priorityTone(priority: string | null | undefined) {
  switch ((priority ?? "").toLowerCase()) {
    case "critical":
      return "rose"
    case "high":
      return "amber"
    case "medium":
      return "cyan"
    default:
      return "slate"
  }
}

function groupDates(values: string[]) {
  return values.reduce<Record<string, number>>((acc, date) => {
    acc[date] = (acc[date] ?? 0) + 1
    return acc
  }, {})
}

function recentDates(days: number) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (days - 1 - index))
    return format(date, "EEE")
  })
}

function buildTicketTrend(tickets: Ticket[]): DashboardTrendPoint[] {
  const openTickets = tickets.filter(isOpenTicket)
  const byDay = groupDates(openTickets.map((ticket) => format(new Date(ticket.updated_at), "EEE")))
  return recentDates(7).map((label, index) => ({ label, value: byDay[label] ?? Math.max(0, openTickets.length - index * 2) }))
}

function buildAttendanceTrend(attendance: Attendance[]): DashboardTrendPoint[] {
  const orderedDates = Array.from(new Set(attendance.map((row) => row.date))).sort().slice(-7)
  return orderedDates.map((date) => {
    const rows = attendance.filter((row) => row.date === date)
    const present = rows.filter((row) => row.status === "present").length
    const rate = rows.length > 0 ? Math.round((present / rows.length) * 100) : 0
    return { label: format(new Date(date), "EEE"), value: rate }
  })
}

function buildDemoTrend(labels: string[], base: number, variance: number): DashboardTrendPoint[] {
  return labels.map((label, index) => ({
    label,
    value: base + Math.round(Math.sin(index * 1.3) * variance + (index % 2 === 0 ? variance / 3 : -variance / 4)),
  }))
}

function buildComplianceTrend(): DashboardStackedPoint[] {
  return [
    { label: "Mon", completed: 14, overdue: 2 },
    { label: "Tue", completed: 16, overdue: 1 },
    { label: "Wed", completed: 13, overdue: 3 },
    { label: "Thu", completed: 18, overdue: 1 },
    { label: "Fri", completed: 17, overdue: 0 },
    { label: "Sat", completed: 15, overdue: 1 },
    { label: "Sun", completed: 12, overdue: 2 },
  ]
}

function buildFinanceTrend(): Array<{ label: string; inflow: number; outflow: number }> {
  return [
    { label: "Jan", inflow: 168000, outflow: 141200 },
    { label: "Feb", inflow: 176500, outflow: 138400 },
    { label: "Mar", inflow: 182300, outflow: 144900 },
    { label: "Apr", inflow: 191400, outflow: 149700 },
    { label: "May", inflow: 186200, outflow: 146800 },
    { label: "Jun", inflow: 194100, outflow: 151300 },
  ]
}

function buildPriorityWork(openTickets: Ticket[], moduleLabel: string, route: string) {
  const criticalTickets = openTickets
    .filter((ticket) => ["critical", "high"].includes((ticket.priority ?? "").toLowerCase()))
    .slice(0, 2)
    .map<DashboardWorkItem>((ticket) => ({
      title: `${ticket.ticket_number} ${ticket.title}`,
      module: moduleLabel,
      detail: ticket.summary ?? "Priority support work needs attention.",
      status: labelize(ticket.priority ?? "High"),
      tone: priorityTone(ticket.priority),
      due: `Updated ${format(new Date(ticket.updated_at), "dd MMM, HH:mm")}`,
      href: route,
    }))

  const demoItems: DashboardWorkItem[] = [
    {
      title: "Roof leak in Block C",
      module: "Property R&M",
      detail: "Contractor quote approved. Repair work remains overdue and cost pressure is rising.",
      status: "Overdue",
      tone: "rose",
      due: "2 days overdue",
      amount: formatNZD(8450),
    },
    {
      title: "Term 3 cyclical checks",
      module: "Compliance",
      detail: "Inspection sign-off queue still has unresolved review items.",
      status: "Pending",
      tone: "violet",
      due: "Due yesterday",
      amount: "7 checks pending",
    },
    {
      title: "Invoices awaiting approval",
      module: "Accounting",
      detail: "Accounts payable review is holding the payment batch.",
      status: "Pending",
      tone: "amber",
      due: "Finance review today",
      amount: formatNZD(72500),
    },
  ]

  return [...criticalTickets, ...demoItems].slice(0, 4)
}

function buildRecentActivity(data: DashboardData): DashboardActivityItem[] {
  const ticketActivity = data.tickets
    .slice()
    .sort((a, b) => +new Date(b.updated_at) - +new Date(a.updated_at))
    .slice(0, 1)
    .map<DashboardActivityItem>((ticket) => ({
      title: `${ticket.ticket_number} updated`,
      meta: `${ticket.title} · ${format(new Date(ticket.updated_at), "dd MMM HH:mm")}`,
      tone: priorityTone(ticket.priority),
      icon: TicketIcon,
    }))

  const assetActivity = data.assets
    .slice()
    .sort((a, b) => +new Date(b.updated_at ?? b.created_at ?? 0) - +new Date(a.updated_at ?? a.created_at ?? 0))
    .slice(0, 1)
    .map<DashboardActivityItem>((asset) => ({
      title: `${asset.asset_tag} allocation changed`,
      meta: `${asset.name} · ${format(new Date(asset.updated_at ?? asset.created_at ?? Date.now()), "dd MMM HH:mm")}`,
      tone: "cyan",
      icon: HardDrive,
    }))

  const attendanceActivity = data.attendance
    .slice()
    .sort((a, b) => +new Date(b.created_at ?? b.date) - +new Date(a.created_at ?? a.date))
    .slice(0, 1)
    .map<DashboardActivityItem>((row) => ({
      title: `Attendance batch ${row.status} recorded`,
      meta: `${format(new Date(row.date), "dd MMM yyyy")} · live classroom update`,
      tone: row.status === "present" ? "emerald" : "amber",
      icon: CalendarDays,
    }))

  const incidentActivity = data.incidents
    .slice()
    .sort((a, b) => +new Date(b.reported_at) - +new Date(a.reported_at))
    .slice(0, 1)
    .map<DashboardActivityItem>((incident) => ({
      title: `Incident ${incident.id.slice(0, 8)} reviewed`,
      meta: `${labelize(incident.status)} · ${format(new Date(incident.reported_at), "dd MMM HH:mm")}`,
      tone: incident.severity.toLowerCase().includes("critical") ? "rose" : "violet",
      icon: ShieldAlert,
    }))

  const staffActivity = data.staff
    .slice()
    .sort((a, b) => +new Date(b.updated_at ?? 0) - +new Date(a.updated_at ?? 0))
    .slice(0, 1)
    .map<DashboardActivityItem>((staff) => ({
      title: `${staff.first_name} ${staff.last_name} profile updated`,
      meta: `${staff.department ?? "General"} · staff maintenance`,
      tone: "slate",
      icon: School,
    }))

  const financeActivity: DashboardActivityItem = {
    title: "Invoice extraction completed",
    meta: "AI review reached 98% confidence on the latest batch.",
    tone: "violet",
    icon: CircleDollarSign,
  }

  return [...ticketActivity, ...assetActivity, ...attendanceActivity, ...incidentActivity, ...staffActivity, financeActivity].slice(0, 6)
}

function buildUpcomingWork(): DashboardWorkItem[] {
  return [
    {
      title: "Term 3 cyclical inspection",
      module: "Compliance",
      detail: "North block review due for completion and digital sign-off.",
      status: "Due tomorrow",
      tone: "violet",
      due: "Tomorrow 9:00 AM",
    },
    {
      title: "Fire door maintenance walk-through",
      module: "Property R&M",
      detail: "Contractor visit scheduled for the afternoon slot.",
      status: "Scheduled",
      tone: "amber",
      due: "Friday 1:30 PM",
    },
    {
      title: "Invoice approval batch",
      module: "Accounting",
      detail: "AP queue ready for finance review and release.",
      status: "Pending",
      tone: "cyan",
      due: "Today 3:00 PM",
      amount: formatNZD(72500),
    },
    {
      title: "Asset warranty review",
      module: "Assets",
      detail: "Devices expiring in the next 30 days need confirmation.",
      status: "Warning",
      tone: "amber",
      due: "Mon 10:00 AM",
      amount: "14 devices",
    },
  ]
}

function buildMetrics(
  data: DashboardData,
  stats: DashboardStatsForRole | null,
  role: AppRole | null,
  roles: AppRole[],
  userId: string | null,
  financeSummary: { awaitingApproval: number; apDue30Days: number } | null
) {
  const profile = getDashboardProfile(role)
  // Compared against `attendance.date`, which is a plain calendar date recorded
  // at the school. The UTC form of this made "attendance today" read as
  // yesterday for every viewer east of Greenwich. See src/lib/school-time.ts.
  const today = todayInSchoolZone()
  // `students.view_all` is the capability that means "school-wide roster", which
  // is what the old unreachable `leadership` tier was reaching for.
  const wholeSchool = can(roles, "students.view_all")
  const studentCount = preferLiveCount(stats?.schoolWide?.totalStudents ?? stats?.assigned?.studentsInScope, data.students.length)
  const staffCount = preferLiveCount(stats?.schoolWide?.totalStaff ?? stats?.itAdmin?.activeItStaff, data.staff.length)
  const classCount = preferLiveCount(stats?.schoolWide?.totalClasses ?? stats?.assigned?.classesInScope, 0)
  const assetCount = data.assets.length || demoNumbers.assets
  const attendanceToday = preferLiveCount(stats?.schoolWide?.attendanceToday, data.attendance.filter((row) => row.date === today).length)
  const openTickets = preferLiveCount(
    stats?.schoolWide?.openTickets ?? stats?.assigned?.openTickets ?? stats?.itAdmin?.totalTickets,
    data.tickets.filter(isOpenTicket).length
  )
  const incidentsInWork = preferLiveCount(
    stats?.schoolWide?.activeIncidents ?? stats?.assigned?.incidentsInWork ?? stats?.itAdmin?.openIncidents,
    data.incidents.length
  )
  const followUpsDue = stats?.assigned?.followUpsDue ?? 0
  const unassignedTickets = preferLiveCount(stats?.itAdmin?.unassignedTickets, data.tickets.filter((ticket) => isOpenTicket(ticket) && !ticket.assigned_to).length)
  const pendingRoleUpdates = stats?.itAdmin?.pendingRoleUpdates ?? 0
  const openProperty = data.rmTickets.filter((ticket) => isVisibleOpenTicket(ticket, "rm", roles, userId)).length
  const primaryRoute = getPrimaryTicketRoute(roles)
  const primaryModule = primaryRoute === "/rm-tickets" ? "R&M tickets" : "ICT tickets"

  // Deltas are omitted rather than invented. The snapshot exposes current values
  // only, so a movement badge would need a prior-period figure that does not
  // exist here. A fabricated delta is worse than none.
  const metricMap: Record<DashboardMetricKey, DashboardMetric> = {
    students: {
      label: wholeSchool ? "Student count" : "Students in scope",
      value: formatCount(studentCount),
      detail: wholeSchool ? "Live roster coverage across the school" : "Scoped student coverage for this workflow",
      tone: "cyan",
      icon: Users,
      href: "/students",
    },
    classes: {
      label: wholeSchool ? "Class count" : "Classes in scope",
      value: formatCount(classCount),
      detail: wholeSchool ? "Teaching groups currently active" : "Assigned classes for this role",
      tone: "emerald",
      icon: School,
      href: "/classes",
    },
    staff: {
      label: can(roles, "ict.view_all") ? "Active IT staff" : "Staff count",
      value: formatCount(staffCount),
      detail: can(roles, "ict.view_all") ? "Support staff currently active" : "Active staff and support roles in view",
      tone: "emerald",
      icon: School,
      href: "/staff",
    },
    attendance: {
      label: wholeSchool ? "Attendance today" : "Attendance signal",
      value: formatCount(attendanceToday),
      detail: "Current attendance activity from live records",
      tone: "cyan",
      icon: CalendarDays,
      href: "/attendance",
    },
    tickets: {
      label: can(roles, "ict.view_all") || can(roles, "rm.view_all") ? "Total tickets" : "Open tickets",
      value: formatCount(openTickets),
      detail: can(roles, "ict.view_all") || can(roles, "rm.view_all")
        ? "Live service desk volume"
        : primaryModule === "R&M tickets"
          ? "Current property backlog"
          : "Current service desk backlog",
      tone: "amber",
      icon: TicketIcon,
      href: primaryRoute,
    },
    incidents: {
      label: wholeSchool ? "Active incidents" : "Incidents in work",
      value: formatCount(incidentsInWork),
      detail: "Safety and behaviour items still needing attention",
      tone: "rose",
      icon: ShieldAlert,
      href: "/incidents",
    },
    followUps: {
      label: "Follow-ups due",
      value: formatCount(followUpsDue || demoNumbers.overdueChecks),
      detail: can(roles, "students.view_assigned") ? "Student follow-up waiting for action" : "Queued follow-up work still open",
      tone: "amber",
      icon: TrendingUp,
      href: "/incidents",
    },
    assets: {
      label: "ICT assets",
      value: formatCount(assetCount),
      detail: "Managed devices and allocated hardware",
      tone: "violet",
      icon: HardDrive,
      href: "/assets",
    },
    propertyRm: {
      label: "Open Property R&M",
      value: formatCount(openProperty),
      detail: "Viewer-visible repairs requiring action",
      tone: "rose",
      icon: Wrench,
      href: "/rm-tickets",
    },
    pendingInvoices: {
      label: "Pending invoices",
      value: formatCount(financeSummary?.awaitingApproval ?? demoNumbers.pendingInvoices),
      detail: financeSummary ? "Bills awaiting approval in the finance mirror" : "Illustrative finance queue where no live finance source exists",
      tone: "violet",
      icon: CircleDollarSign,
      href: "/finance",
    },
    outstandingValue: {
      label: "Outstanding value",
      value: formatNZD(financeSummary?.apDue30Days ?? demoNumbers.outstandingValue),
      detail: financeSummary ? "AP due in the next 30 days from the finance mirror" : "Illustrative payment pressure where no live finance source exists",
      tone: "indigo",
      icon: CircleDollarSign,
      href: "/finance",
    },
    unassignedTickets: {
      label: "Unassigned tickets",
      value: formatCount(unassignedTickets),
      detail: "Tickets waiting for triage",
      tone: "amber",
      icon: TicketIcon,
      href: primaryRoute,
    },
    roleUpdates: {
      label: "Pending role updates",
      value: formatCount(pendingRoleUpdates),
      detail: "Inactive role rows awaiting review",
      tone: "cyan",
      icon: Users,
      href: "/admin",
    },
  }

  return profile.metricOrder.map((key) => metricMap[key]).filter((metric): metric is DashboardMetric => Boolean(metric))
}

function buildSnapshot(
  data: DashboardData,
  stats: DashboardStatsForRole | null,
  role: AppRole | null,
  userId: string | null,
  roles: AppRole[],
  financeData: FinanceDashboardData | null
): DashboardSnapshot {
  const profile = getDashboardProfile(role)
  const financeView = can(roles, "finance.view")
  const attendanceTrend = buildAttendanceTrend(data.attendance)
  const ticketTrend = buildTicketTrend(data.tickets)
  const maintenanceTrend = buildDemoTrend(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], 5, 4)
  const complianceTrend = buildComplianceTrend()
  const finance = buildFinanceSnapshot(financeData)
  const financeTrend = finance.forecast.length
    ? finance.forecast.map((point) => ({ label: point.label, inflow: point.inflow, outflow: point.outflow }))
    : financeView
      ? []
      : buildFinanceTrend()
  const openTickets = data.tickets.filter(isOpenTicket)
  const primaryRoute = getPrimaryTicketRoute(roles)
  const primaryModule = primaryRoute === "/rm-tickets" ? "R&M tickets" : "ICT tickets"
  const metrics = buildMetrics(data, stats, role, roles, userId, finance.summary).filter((metric) => !metric.href || canAccessRoute(metric.href.split("?")[0], roles))
  const priorityWork = buildPriorityWork(openTickets, primaryModule, primaryRoute).filter(
    (item) => !item.href || canAccessRoute(item.href.split("?")[0], roles)
  )
  const recentActivity = buildRecentActivity(data)
  const upcomingWork = buildUpcomingWork()
  const openItTickets = data.tickets.length > 0 ? openTickets.length : demoNumbers.openItTickets

  const attendanceRate = attendanceTrend.length > 0 ? Math.round(attendanceTrend.reduce((sum, point) => sum + point.value, 0) / attendanceTrend.length) : 94
  const openQueue = priorityWork.filter((item) => item.tone === "rose").length

  return {
    role,
    roles,
    lastUpdated: new Date(),
    statusLabel: openQueue > 0 ? "Attention required" : "Operating normally",
    statusTone: openQueue > 0 ? "rose" : "emerald",
    summary: profile.summary,
    secondaryNote: profile.secondaryNote,
    attendanceRate,
    metrics,
    shortcuts: sortByPreference(
      moduleShortcuts.filter((shortcut) => canAccessRoute(shortcut.to.split("?")[0], roles)),
      profile.shortcutOrder
    ),
    ticketTrend: ticketTrend.length > 0 ? ticketTrend : buildDemoTrend(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], 10, 4),
    maintenanceTrend,
    attendanceTrend: attendanceTrend.length > 0 ? attendanceTrend : buildDemoTrend(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], 91, 3),
    complianceTrend,
    financeTrend,
    priorityWork,
    recentActivity,
    upcomingWork,
    financialSummary: {
      revenue: financeData ? finance.summary.monthForecast : financeView ? finance.summary.monthForecast : demoNumbers.revenue,
      expenses: financeData ? finance.summary.monthActual : financeView ? finance.summary.monthActual : demoNumbers.expenses,
      cashBalance: financeData ? finance.summary.cashOnHand : financeView ? finance.summary.cashOnHand : demoNumbers.cashBalance,
      outstanding: financeData ? finance.summary.apDue30Days : financeView ? finance.summary.apDue30Days : demoNumbers.outstandingValue,
      pendingInvoices: financeData ? finance.summary.awaitingApproval : financeView ? finance.summary.awaitingApproval : demoNumbers.pendingInvoices,
    },
    finance,
    openItTickets,
  }
}

async function loadDashboardSnapshot(userId: string | null, rawRoles: string[], role: AppRole | null): Promise<DashboardSnapshot> {
  const roles = toAppRoles(rawRoles)
  const hasFinanceAccess = can(rawRoles, "finance.view")

  const [statsResult, studentsResult, staffResult, assetsResult, ticketsResult, rmTicketsResult, attendanceResult, incidentsResult, financeResult] = await Promise.allSettled([
    fetchDashboardStatsForRole(role),
    fetchStudents(),
    fetchStaff(),
    fetchAssets(),
    fetchTickets(),
    fetchRmTickets(),
    fetchAttendanceRecords(),
    fetchIncidents(),
    hasFinanceAccess ? fetchFinanceDashboardData() : Promise.resolve(null),
  ])

  const stats = statsResult.status === "fulfilled" ? statsResult.value : null
  const students = studentsResult.status === "fulfilled" ? studentsResult.value : []
  const staff = staffResult.status === "fulfilled" ? staffResult.value : []
  const assets = assetsResult.status === "fulfilled" ? assetsResult.value : []
  const tickets = ticketsResult.status === "fulfilled" ? ticketsResult.value : []
  const rmTickets = rmTicketsResult.status === "fulfilled" ? rmTicketsResult.value : []
  const attendance = attendanceResult.status === "fulfilled" ? attendanceResult.value : []
  const incidents = incidentsResult.status === "fulfilled" ? incidentsResult.value : []
  const financeData = financeResult.status === "fulfilled" ? financeResult.value : null

  if (statsResult.status === "rejected") {
    logError("Dashboard stats failed to load", statsResult.reason)
  }

  const primaryTickets = getPrimaryTicketRoute(roles) === "/rm-tickets" ? rmTickets : tickets

  return buildSnapshot(
    {
      students,
      staff,
      assets,
      tickets: primaryTickets,
      rmTickets,
      attendance,
      incidents,
    },
    stats,
    role,
    userId,
    roles,
    financeData
  )
}

export default function DashboardPage() {
  const { user, activeRole } = useAuth()
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false

    void loadDashboardSnapshot(user?.id ?? null, user?.roles ?? [], activeRole)
      .then((result) => {
        if (!cancelled) {
          setSnapshot(result)
        }
      })
      .catch((error) => {
        logError("Failed to load dashboard snapshot", error)
        if (!cancelled) {
          setSnapshot(
            buildSnapshot({ students: [], staff: [], assets: [], tickets: [], rmTickets: [], attendance: [], incidents: [] }, null, activeRole, user?.id ?? null, toAppRoles(user?.roles), null)
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [user?.id, user?.roles, activeRole, reloadToken])

  // The refresh control re-runs the same loader rather than refetching from a
  // different path, so a manual refresh cannot diverge from the initial load.
  const handleRefresh = useCallback(async () => {
    setLoading(true)
    setReloadToken((token) => token + 1)
  }, [])

  return <DashboardOverview snapshot={snapshot} loading={loading} onRefresh={handleRefresh} />
}
