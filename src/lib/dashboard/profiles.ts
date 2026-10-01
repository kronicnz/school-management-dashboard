import type { AppRole } from "../access/registry"

/**
 * Role-keyed dashboard registry.
 *
 * This replaces the old `RoleTier` + `OperationalSubtype` indirection. The
 * `activeRole` from AuthContext selects the profile and the copy; both are
 * presentation only and never gate access. Every link a profile emits is still
 * post-filtered by `canAccessRoute`, so a copy change can never widen or narrow
 * what someone may open.
 */

export type DashboardMetricKey =
  | "students"
  | "classes"
  | "staff"
  | "attendance"
  | "tickets"
  | "incidents"
  | "followUps"
  | "assets"
  | "propertyRm"
  | "pendingInvoices"
  | "outstandingValue"
  | "unassignedTickets"
  | "roleUpdates"

export type DashboardProfile = {
  summary: string
  secondaryNote: string
  metricOrder: DashboardMetricKey[]
  shortcutOrder: string[]
}

export const defaultProfile: DashboardProfile = {
  summary: "A unified operational overview for school-wide business management.",
  secondaryNote:
    "Live records are used where available for students, staff, assets, tickets, attendance, and incidents. Property R&M surfaces from the live ticket queue, while cyclical check and accounting panels remain structured demo data.",
  metricOrder: ["students", "staff", "assets", "tickets", "incidents", "attendance", "followUps"],
  shortcutOrder: ["/students", "/classes", "/attendance", "/tickets", "/incidents", "/assets", "/admin"],
}

const financeMetricOrder: DashboardMetricKey[] = ["pendingInvoices", "outstandingValue", "tickets", "students", "attendance", "incidents", "staff"]
const financeShortcutOrder = ["/finance", "/tickets", "/students", "/attendance", "/incidents", "/classes"]

export const DASHBOARD_PROFILES: Record<AppRole, DashboardProfile> = {
  site_admin: {
    summary: "Full application administration and oversight.",
    secondaryNote: "All modules and operational queues stay visible for platform-wide administration.",
    metricOrder: ["tickets", "unassignedTickets", "roleUpdates", "assets", "incidents", "staff", "students"],
    shortcutOrder: ["/tickets", "/assets", "/admin", "/students", "/incidents", "/attendance"],
  },
  it_admin: {
    summary: "System health, service desk backlog, and access oversight.",
    secondaryNote: "Live tickets, incidents, and role rows stay visible here so IT admin can keep the platform stable.",
    metricOrder: ["tickets", "unassignedTickets", "roleUpdates", "assets", "incidents", "staff", "students"],
    shortcutOrder: ["/tickets", "/assets", "/admin", "/students", "/incidents", "/attendance"],
  },
  it_staff: {
    summary: "Technical support, service queue, and asset maintenance.",
    secondaryNote: "Support work leads the view while live asset and incident signals sit just behind it.",
    metricOrder: ["tickets", "assets", "incidents", "staff", "students", "attendance", "followUps"],
    shortcutOrder: ["/tickets", "/students", "/classes", "/attendance", "/incidents"],
  },
  staff: {
    summary: "Classroom delivery, attendance capture, and student follow-up.",
    secondaryNote: "The first row is tuned for classroom work, then broader school tasks follow behind it.",
    metricOrder: ["classes", "students", "attendance", "tickets", "incidents", "followUps", "staff"],
    shortcutOrder: ["/students", "/classes", "/attendance", "/tickets", "/incidents"],
  },
  counsellor: {
    summary: "Pastoral care, wellbeing follow-up, and incident review.",
    secondaryNote: "Student support items rise to the top while attendance and queue work stay close by.",
    metricOrder: ["students", "incidents", "followUps", "attendance", "tickets", "classes", "staff"],
    shortcutOrder: ["/students", "/incidents", "/attendance", "/tickets", "/classes"],
  },
  property_manager: {
    summary: "Facilities, maintenance backlog, and inspection follow-up.",
    secondaryNote: "Live repair signals stay close to the top while demo-backed compliance context remains clearly labelled.",
    metricOrder: ["propertyRm", "tickets", "incidents", "assets", "students", "attendance", "staff"],
    shortcutOrder: ["/rm-tickets", "/tickets", "/incidents", "/students", "/attendance", "/classes"],
  },
  property_staff: {
    summary: "Assigned repairs, maintenance updates, and follow-up.",
    secondaryNote: "Assigned work leads the page while broader school modules stay out of the way.",
    metricOrder: ["propertyRm", "tickets", "incidents", "assets", "students", "attendance", "staff"],
    shortcutOrder: ["/rm-tickets", "/tickets", "/incidents"],
  },
  finance_admin: {
    summary: "Finance processing, payment pressure, and review queue.",
    secondaryNote: "Finance cards are marked as illustrative where the backend has no live finance dataset yet.",
    metricOrder: financeMetricOrder,
    shortcutOrder: financeShortcutOrder,
  },
  finance_read_only: {
    summary: "Read-only finance oversight and summary review.",
    secondaryNote: "Finance cards remain read-only and focused on summary reporting.",
    metricOrder: financeMetricOrder,
    shortcutOrder: financeShortcutOrder,
  },
  board_member: {
    summary: "Read-only finance oversight and summary review.",
    secondaryNote: "Board reporting is read-only and limited to the finance mirror.",
    metricOrder: financeMetricOrder,
    shortcutOrder: financeShortcutOrder,
  },
  // Retired into `staff`; kept so a pre-migration grant still renders.
  teacher: defaultProfile,
}

export function getDashboardProfile(role: AppRole | null): DashboardProfile {
  if (role && DASHBOARD_PROFILES[role]) {
    return DASHBOARD_PROFILES[role]
  }

  return defaultProfile
}

export type DashboardCopy = {
  metricsEyebrow: string
  metricsTitle: string
  metricsDescription: string
  financeEyebrow: string
  financeTitle: string
  financeDescription: string
  currentStateLabel: string
  currentStateTitle: string
  currentStateDescription: string
  trendsEyebrow: string
  trendsTitle: string
  trendsDescription: string
  ticketTitle: string
  ticketDescription: string
  maintenanceTitle: string
  maintenanceDescription: string
  attendanceTitle: string
  attendanceDescription: string
  priorityTitle: string
  priorityDescription: string
  upcomingTitle: string
  upcomingDescription: string
  recentTitle: string
  recentDescription: string
}

const financeCopy: DashboardCopy = {
  metricsEyebrow: "Finance KPI layer",
  metricsTitle: "Payment pressure and review metrics",
  metricsDescription: "Finance cards are marked as illustrative where no live finance dataset exists.",
  financeEyebrow: "Finance mirror",
  financeTitle: "Ingestion queue and budget view",
  financeDescription: "Mirror-backed intake, approval, and budget panels are kept in one place.",
  currentStateLabel: "Current state",
  currentStateTitle: "Finance command center",
  currentStateDescription: "Payment pressure, review queue, and outstanding work stay visible.",
  trendsEyebrow: "Finance overview",
  trendsTitle: "Cash and review signals",
  trendsDescription: "Illustrative finance pressure and review signals are kept separate from live queues.",
  ticketTitle: "IT ticket trends",
  ticketDescription: "Open queue volume and movement over the last week.",
  maintenanceTitle: "Finance support activity",
  maintenanceDescription: "Illustrative payment pressure by day.",
  attendanceTitle: "Attendance and compliance",
  attendanceDescription: "Attendance momentum alongside cyclical check completion.",
  priorityTitle: "Priority work",
  priorityDescription: "High-impact work across finance, support, and follow-up tasks.",
  upcomingTitle: "Upcoming work",
  upcomingDescription: "Deadlines and approvals already in the pipeline.",
  recentTitle: "Recent activity",
  recentDescription: "A concise event trail across tickets, staffing, attendance, and finance.",
}

const defaultCopy: DashboardCopy = {
  metricsEyebrow: "Primary KPI layer",
  metricsTitle: "Cross-platform operational metrics",
  metricsDescription: "Live and structured school signals arranged for quick scanning.",
  financeEyebrow: "Finance mirror",
  financeTitle: "Ingestion queue and budget view",
  financeDescription: "Mirror-backed finance data can be scanned alongside the rest of the dashboard.",
  currentStateLabel: "Current state",
  currentStateTitle: "Operational command center",
  currentStateDescription: "School activity stays condensed into the current working state.",
  trendsEyebrow: "Operational overview",
  trendsTitle: "Cross-platform trend signals",
  trendsDescription: "Live and structured school signals arranged for quick scanning.",
  ticketTitle: "IT ticket trends",
  ticketDescription: "Open queue volume and movement over the last week.",
  maintenanceTitle: "Property maintenance activity",
  maintenanceDescription: "Illustrative request volume by day with cost pressure.",
  attendanceTitle: "Attendance and compliance",
  attendanceDescription: "Attendance momentum alongside cyclical check completion.",
  priorityTitle: "Priority work",
  priorityDescription: "High-impact work across support, compliance, finance, and facilities.",
  upcomingTitle: "Upcoming work",
  upcomingDescription: "Deadlines, inspections, and approvals already in the pipeline.",
  recentTitle: "Recent activity",
  recentDescription: "A concise event trail across support, assets, staffing, attendance, and finance.",
}

export const DASHBOARD_COPY: Record<AppRole, DashboardCopy> = {
  site_admin: {
    metricsEyebrow: "Platform KPI layer",
    metricsTitle: "Full application administration",
    metricsDescription: "Every live queue and governance surface is arranged for platform oversight.",
    financeEyebrow: "Finance mirror",
    financeTitle: "Ingestion queue and budget view",
    financeDescription: "Local mirror data keeps finance reporting, intake, and review visible for administrators.",
    currentStateLabel: "Current state",
    currentStateTitle: "Site admin command center",
    currentStateDescription: "All modules, access rows, and operational queues stay visible.",
    trendsEyebrow: "Platform overview",
    trendsTitle: "Cross-system signals",
    trendsDescription: "School-wide trends across tickets, attendance, incidents, finance, and administration.",
    ticketTitle: "IT ticket trends",
    ticketDescription: "Open queue volume and movement over the last week.",
    maintenanceTitle: "Property maintenance activity",
    maintenanceDescription: "Request volume and response pressure by day.",
    attendanceTitle: "Attendance and compliance",
    attendanceDescription: "Attendance momentum alongside cyclical check completion.",
    priorityTitle: "Priority work",
    priorityDescription: "High-impact work across support, compliance, finance, and facilities.",
    upcomingTitle: "Upcoming work",
    upcomingDescription: "Deadlines, inspections, and approvals already in the pipeline.",
    recentTitle: "Recent activity",
    recentDescription: "A concise event trail across support, assets, staffing, attendance, finance, and access.",
  },
  it_admin: {
    metricsEyebrow: "System KPI layer",
    metricsTitle: "Service health and access control",
    metricsDescription: "Platform status, live queue pressure, and admin actions.",
    financeEyebrow: "Finance mirror",
    financeTitle: "Ingestion queue and budget view",
    financeDescription: "Mirror-backed finance data stays visible alongside the rest of the platform.",
    currentStateLabel: "Current state",
    currentStateTitle: "IT command center",
    currentStateDescription: "Support work, assets, and access rows stay close to the top.",
    trendsEyebrow: "Operational overview",
    trendsTitle: "Service signals",
    trendsDescription: "Ticket, asset, and compliance trends from the live and structured sources.",
    ticketTitle: "IT ticket trends",
    ticketDescription: "Open queue volume and movement over the last week.",
    maintenanceTitle: "Asset maintenance activity",
    maintenanceDescription: "Illustrative hardware and maintenance pressure by day.",
    attendanceTitle: "Attendance and compliance",
    attendanceDescription: "Attendance momentum alongside cyclical check completion.",
    priorityTitle: "Priority work",
    priorityDescription: "High-impact work across support, compliance, finance, and facilities.",
    upcomingTitle: "Upcoming work",
    upcomingDescription: "Deadlines, inspections, and approvals already in the pipeline.",
    recentTitle: "Recent activity",
    recentDescription: "A concise event trail across support, assets, staffing, attendance, and finance.",
  },
  it_staff: {
    metricsEyebrow: "Support KPI layer",
    metricsTitle: "Technical support and asset metrics",
    metricsDescription: "Support queue, assets, and maintenance work lead the page.",
    financeEyebrow: "Finance mirror",
    financeTitle: "Ingestion queue and budget view",
    financeDescription: "Mirror data remains available for platform-wide oversight.",
    currentStateLabel: "Current state",
    currentStateTitle: "Support command center",
    currentStateDescription: "Technical work, assets, and incidents stay close to the top.",
    trendsEyebrow: "Support overview",
    trendsTitle: "Service desk signals",
    trendsDescription: "Ticket and asset signals framed for technical support work.",
    ticketTitle: "IT ticket trends",
    ticketDescription: "Open queue volume and movement over the last week.",
    maintenanceTitle: "Asset maintenance activity",
    maintenanceDescription: "Illustrative device pressure by day.",
    attendanceTitle: "Attendance and compliance",
    attendanceDescription: "Attendance momentum alongside cyclical check completion.",
    priorityTitle: "Priority work",
    priorityDescription: "High-impact work across support, assets, and follow-up tasks.",
    upcomingTitle: "Upcoming work",
    upcomingDescription: "Deadlines and maintenance tasks already in the pipeline.",
    recentTitle: "Recent activity",
    recentDescription: "A concise event trail across tickets, assets, staffing, and support.",
  },
  staff: {
    metricsEyebrow: "Classroom KPI layer",
    metricsTitle: "Teaching and follow-up metrics",
    metricsDescription: "Classroom delivery, attendance, and student follow-up arranged first.",
    financeEyebrow: "Finance mirror",
    financeTitle: "Ingestion queue and budget view",
    financeDescription: "Finance signals stay available without overwhelming classroom workflows.",
    currentStateLabel: "Current state",
    currentStateTitle: "Classroom command center",
    currentStateDescription: "Teaching scope, attendance, and student support stay close to the top.",
    trendsEyebrow: "Classroom overview",
    trendsTitle: "Daily trend signals",
    trendsDescription: "Attendance, ticket, and support signals framed for classroom follow-up.",
    ticketTitle: "IT ticket trends",
    ticketDescription: "Open queue volume and movement over the last week.",
    maintenanceTitle: "Classroom support activity",
    maintenanceDescription: "Illustrative support pressure by day for classroom work.",
    attendanceTitle: "Attendance and follow-up",
    attendanceDescription: "Attendance momentum alongside the intervention queue.",
    priorityTitle: "Priority work",
    priorityDescription: "High-impact work across support, classroom, and follow-up tasks.",
    upcomingTitle: "Upcoming work",
    upcomingDescription: "Deadlines and queued tasks already in the pipeline.",
    recentTitle: "Recent activity",
    recentDescription: "A concise event trail across students, attendance, incidents, and support.",
  },
  counsellor: {
    metricsEyebrow: "Pastoral KPI layer",
    metricsTitle: "Caseload and wellbeing metrics",
    metricsDescription: "Student support, incidents, and follow-up work arranged first.",
    financeEyebrow: "Finance mirror",
    financeTitle: "Ingestion queue and budget view",
    financeDescription: "Finance signals stay available without competing with pastoral work.",
    currentStateLabel: "Current state",
    currentStateTitle: "Pastoral command center",
    currentStateDescription: "Caseload, attendance concerns, and incident review stay close to the top.",
    trendsEyebrow: "Pastoral overview",
    trendsTitle: "Caseload trend signals",
    trendsDescription: "Attendance, incident, and follow-up signals framed for student support work.",
    ticketTitle: "IT ticket trends",
    ticketDescription: "Open queue volume and movement over the last week.",
    maintenanceTitle: "Pastoral support activity",
    maintenanceDescription: "Illustrative support pressure by day for pastoral follow-up.",
    attendanceTitle: "Attendance and follow-up",
    attendanceDescription: "Attendance momentum alongside the intervention queue.",
    priorityTitle: "Priority work",
    priorityDescription: "High-impact work across pastoral, classroom, and follow-up tasks.",
    upcomingTitle: "Upcoming work",
    upcomingDescription: "Deadlines and queued tasks already in the pipeline.",
    recentTitle: "Recent activity",
    recentDescription: "A concise event trail across students, attendance, incidents, and support.",
  },
  property_manager: {
    metricsEyebrow: "Facilities KPI layer",
    metricsTitle: "Maintenance and inspection metrics",
    metricsDescription: "Repair pressure, ticket triage, and inspections lead the page.",
    financeEyebrow: "Finance mirror",
    financeTitle: "Ingestion queue and budget view",
    financeDescription: "Local finance summary data stays available for facilities oversight.",
    currentStateLabel: "Current state",
    currentStateTitle: "Facilities command center",
    currentStateDescription: "Maintenance work, inspections, and follow-up stay easy to scan.",
    trendsEyebrow: "Facilities overview",
    trendsTitle: "Repair and compliance signals",
    trendsDescription: "Property, ticket, and compliance signals framed for facilities work.",
    ticketTitle: "IT ticket trends",
    ticketDescription: "Open queue volume and movement over the last week.",
    maintenanceTitle: "Property maintenance activity",
    maintenanceDescription: "Illustrative request volume by day with cost pressure.",
    attendanceTitle: "Attendance and compliance",
    attendanceDescription: "Attendance momentum alongside cyclical check completion.",
    priorityTitle: "Priority work",
    priorityDescription: "High-impact work across maintenance, support, and follow-up tasks.",
    upcomingTitle: "Upcoming work",
    upcomingDescription: "Deadlines, inspections, and approvals already in the pipeline.",
    recentTitle: "Recent activity",
    recentDescription: "A concise event trail across repairs, assets, staffing, and finance.",
  },
  property_staff: {
    metricsEyebrow: "Facilities KPI layer",
    metricsTitle: "Assigned repairs and maintenance metrics",
    metricsDescription: "Assigned work, follow-up, and day-to-day repair pressure lead the page.",
    financeEyebrow: "Finance mirror",
    financeTitle: "Ingestion queue and budget view",
    financeDescription: "Finance summary cards remain available while assigned work stays in focus.",
    currentStateLabel: "Current state",
    currentStateTitle: "Facilities assistant view",
    currentStateDescription: "Assigned maintenance work and follow-up stay visible without excess clutter.",
    trendsEyebrow: "Facilities overview",
    trendsTitle: "Assigned repair signals",
    trendsDescription: "Assigned R&M work and maintenance updates are framed for the current queue.",
    ticketTitle: "R&M ticket trends",
    ticketDescription: "Open queue volume and movement over the last week.",
    maintenanceTitle: "Assigned maintenance activity",
    maintenanceDescription: "Illustrative request volume by day with task pressure.",
    attendanceTitle: "Attendance and compliance",
    attendanceDescription: "Attendance momentum alongside cyclical check completion.",
    priorityTitle: "Priority work",
    priorityDescription: "High-impact work across maintenance, support, and follow-up tasks.",
    upcomingTitle: "Upcoming work",
    upcomingDescription: "Deadlines, inspections, and approvals already in the pipeline.",
    recentTitle: "Recent activity",
    recentDescription: "A concise event trail across repairs, assets, staffing, and follow-up.",
  },
  finance_admin: financeCopy,
  finance_read_only: {
    ...financeCopy,
    metricsEyebrow: "Finance KPI layer",
    metricsTitle: "Read-only finance metrics",
    metricsDescription: "Finance reports and summary statistics are framed for oversight only.",
    currentStateTitle: "Finance review view",
    currentStateDescription: "Payment pressure and summary statistics stay visible without edit controls.",
  },
  board_member: {
    ...financeCopy,
    metricsEyebrow: "Board finance layer",
    metricsTitle: "Board finance oversight metrics",
    metricsDescription: "Finance reports and summary statistics are framed for oversight only.",
    currentStateTitle: "Board finance view",
    currentStateDescription: "Finance reports and summary statistics stay visible without edit controls.",
  },
  teacher: defaultCopy,
}

export function getDashboardCopy(role: AppRole | null): DashboardCopy {
  if (role && DASHBOARD_COPY[role]) {
    return DASHBOARD_COPY[role]
  }

  return defaultCopy
}