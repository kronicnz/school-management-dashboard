import {
  BookOpen,
  CalendarCheck,
  ClipboardList,
  FolderOpen,
  LayoutDashboard,
  Receipt,
  School,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react"
import { canAccessRoute } from "../../lib/access/routes"
import { ROLE_LABELS, type AppRole } from "../../lib/access/registry"

export type ShellNavItem = {
  to: string
  label: string
  icon: typeof LayoutDashboard
  section: "core" | "operations" | "system"
}

type ShellNavSection = ShellNavItem["section"]

export type ShellNavGroup = {
  section: ShellNavSection
  label: string
  items: ShellNavItem[]
}

export const shellNavItems: ShellNavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, section: "core" },
  { to: "/students", label: "Students", icon: Users, section: "core" },
  { to: "/classes", label: "Classes", icon: BookOpen, section: "core" },
  { to: "/staff", label: "Staff", icon: School, section: "operations" },
  { to: "/attendance", label: "Attendance", icon: CalendarCheck, section: "operations" },
  { to: "/incidents", label: "Incidents", icon: ShieldAlert, section: "operations" },
  { to: "/ict-tickets", label: "ICT Tickets", icon: ClipboardList, section: "operations" },
  { to: "/rm-tickets", label: "R&M Tickets", icon: ClipboardList, section: "operations" },
  { to: "/finance", label: "Finance", icon: Receipt, section: "operations" },
  { to: "/assets", label: "Assets", icon: FolderOpen, section: "system" },
  { to: "/admin", label: "Admin", icon: ShieldCheck, section: "system" },
]

const defaultSectionLabels: Record<ShellNavSection, string> = {
  core: "Core",
  operations: "Operations",
  system: "System",
}

/** Section headings tuned per role, so the nav reads as the user's own desk. */
const roleSectionLabels: Partial<Record<AppRole, Partial<Record<ShellNavSection, string>>>> = {
  site_admin: { core: "Platform", operations: "Operations", system: "Administration" },
  it_admin: { core: "Core", operations: "Support", system: "Systems" },
  it_staff: { core: "Technical support", operations: "Service desk" },
  property_manager: { core: "Facilities desk", operations: "Maintenance workflow" },
  property_staff: { core: "Facilities desk", operations: "Maintenance workflow" },
  counsellor: { core: "Pastoral care", operations: "Wellbeing" },
  staff: { core: "Classroom focus", operations: "Student follow-up" },
  finance_admin: { core: "Finance desk", operations: "Finance workflow" },
  finance_read_only: { core: "Finance desk", operations: "Finance review" },
  board_member: { core: "Board desk", operations: "Finance review" },
}

/** Front-of-nav ordering per role, so the primary desk comes first. */
const roleNavOrder: Partial<Record<AppRole, string[]>> = {
  finance_admin: ["/", "/finance", "/rm-tickets", "/students", "/attendance", "/incidents", "/classes"],
  finance_read_only: ["/", "/finance", "/students", "/attendance", "/incidents", "/classes"],
  board_member: ["/", "/finance", "/students", "/incidents", "/attendance", "/classes"],
  staff: ["/", "/students", "/classes", "/attendance", "/rm-tickets", "/ict-tickets", "/incidents"],
  counsellor: ["/", "/students", "/incidents", "/attendance", "/rm-tickets", "/classes"],
  property_manager: ["/", "/rm-tickets", "/incidents", "/students", "/attendance", "/classes"],
  property_staff: ["/", "/rm-tickets", "/incidents", "/students", "/attendance", "/classes"],
  it_staff: ["/", "/ict-tickets", "/rm-tickets", "/students", "/classes", "/attendance", "/incidents"],
  it_admin: ["/", "/ict-tickets", "/rm-tickets", "/incidents", "/assets", "/students", "/classes", "/attendance"],
  site_admin: ["/", "/students", "/classes", "/attendance", "/incidents", "/ict-tickets", "/rm-tickets", "/staff", "/assets", "/admin", "/finance"],
}

const dashboardMetaByRole: Partial<Record<AppRole, ShellPageMeta>> = {
  site_admin: {
    title: "Site admin dashboard",
    description: "Full application administration and oversight",
    breadcrumb: "Overview",
  },
  it_admin: {
    title: "IT admin dashboard",
    description: "System administration, assets, and access oversight",
    breadcrumb: "Overview",
  },
  finance_admin: {
    title: "Finance dashboard",
    description: "Payment pressure, outstanding value, and review queue",
    breadcrumb: "Overview",
  },
  finance_read_only: {
    title: "Finance dashboard",
    description: "Read-only finance reports and summary statistics",
    breadcrumb: "Overview",
  },
  board_member: {
    title: "Board finance view",
    description: "Read-only finance reports and oversight statistics",
    breadcrumb: "Overview",
  },
  staff: {
    title: "Staff dashboard",
    description: "Assigned students, attendance capture, and own tickets",
    breadcrumb: "Overview",
  },
  counsellor: {
    title: "Pastoral dashboard",
    description: "Wellbeing follow-ups, attendance concerns, and incident review",
    breadcrumb: "Overview",
  },
  property_manager: {
    title: "Facilities dashboard",
    description: "Repairs, inspections, and maintenance follow-up",
    breadcrumb: "Overview",
  },
  property_staff: {
    title: "Facilities dashboard",
    description: "Assigned repairs and maintenance follow-up",
    breadcrumb: "Overview",
  },
  it_staff: {
    title: "Support dashboard",
    description: "Service desk backlog, assets, and maintenance work",
    breadcrumb: "Overview",
  },
}

const quickNoteByRole: Partial<Record<AppRole, string>> = {
  site_admin: "Full application administration and oversight",
  it_admin: "Ticket administration, assets, and access oversight",
  it_staff: "Support queue and technical delivery",
  property_manager: "Facilities backlog and maintenance follow-up",
  property_staff: "Assigned repairs and maintenance follow-up",
  staff: "Assigned students, attendance, and own requests",
  counsellor: "Pastoral support and follow-up",
  finance_admin: "Finance processing and payment pressure",
  finance_read_only: "Finance reports and summary review",
  board_member: "Board-level finance oversight",
}

function sortNavItems(items: ShellNavItem[], role: AppRole | null) {
  const preferredOrder = (role && roleNavOrder[role]) ?? shellNavItems.map((item) => item.to)

  return items.slice().sort((left, right) => {
    const leftIndex = preferredOrder.indexOf(left.to)
    const rightIndex = preferredOrder.indexOf(right.to)

    if (leftIndex === -1 && rightIndex === -1) {
      return (
        shellNavItems.findIndex((item) => item.to === left.to) -
        shellNavItems.findIndex((item) => item.to === right.to)
      )
    }

    if (leftIndex === -1) return 1
    if (rightIndex === -1) return -1

    return leftIndex - rightIndex
  })
}

export type ShellPageMeta = {
  title: string
  description: string
  breadcrumb: string
}

const fallbackMeta: ShellPageMeta = {
  title: "School Management",
  description: "Unified operational workspace",
  breadcrumb: "Overview",
}

const pageMetaByPath: Record<string, ShellPageMeta> = {
  "/": {
    title: "Dashboard",
    description: "Operational summary, alerts, and quick actions",
    breadcrumb: "Overview",
  },
  "/students": {
    title: "Students",
    description: "Roster, enrolment, and attendance management",
    breadcrumb: "Records / Students",
  },
  "/classes": {
    title: "Classes",
    description: "Class structure, teaching scope, and schedules",
    breadcrumb: "Records / Classes",
  },
  "/staff": {
    title: "Staff",
    description: "People, departments, and role management",
    breadcrumb: "People / Staff",
  },
  "/attendance": {
    title: "Attendance",
    description: "Daily attendance tracking and review",
    breadcrumb: "Operations / Attendance",
  },
  "/incidents": {
    title: "Incidents",
    description: "Safety and behaviour workflow management",
    breadcrumb: "Operations / Incidents",
  },
  "/ict-tickets": {
    title: "ICT Tickets",
    description: "ICT service desk queue and resolution workflow",
    breadcrumb: "Operations / ICT Tickets",
  },
  "/rm-tickets": {
    title: "R&M Tickets",
    description: "Property repairs and maintenance workflow",
    breadcrumb: "Operations / R&M Tickets",
  },
  "/finance": {
    title: "Finance",
    description: "Invoice intake, position, review, and billing",
    breadcrumb: "Operations / Finance",
  },
  "/assets": {
    title: "Assets",
    description: "ICT inventory, allocation, and maintenance",
    breadcrumb: "Systems / Assets",
  },
  "/admin": {
    title: "Admin",
    description: "Access, configuration, and administration",
    breadcrumb: "Systems / Admin",
  },
  "/sandbox": {
    title: "Sandbox",
    description: "UI development workspace",
    breadcrumb: "Tools / Sandbox",
  },
}

export function getShellPageMeta(pathname: string, role: AppRole | null): ShellPageMeta {
  if (pathname === "/" && role && dashboardMetaByRole[role]) {
    return dashboardMetaByRole[role] as ShellPageMeta
  }

  return pageMetaByPath[pathname] ?? fallbackMeta
}

export function getVisibleShellNavItems(roles: string[], activeRole: AppRole | null) {
  return sortNavItems(
    shellNavItems.filter((item) => canAccessRoute(item.to, roles)),
    activeRole,
  )
}

export function getShellNavGroups(roles: string[], activeRole: AppRole | null): ShellNavGroup[] {
  const visibleItems = getVisibleShellNavItems(roles, activeRole)

  return (["core", "operations", "system"] as const)
    .map((section) => ({
      section,
      label:
        (activeRole ? roleSectionLabels[activeRole]?.[section] : undefined) ??
        defaultSectionLabels[section],
      items: visibleItems.filter((item) => item.section === section),
    }))
    .filter((group) => group.items.length > 0)
}

export function getRoleQuickNote(role: AppRole | null) {
  if (!role) return "Read-only access and overview"
  return quickNoteByRole[role] ?? `${ROLE_LABELS[role]} workspace`
}
