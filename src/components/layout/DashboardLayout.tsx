import { BookOpen, CalendarCheck, ClipboardList, FolderOpen, LayoutDashboard, LogOut, Menu, Search, School, ShieldAlert, ShieldCheck, Users } from "lucide-react"
import { useMemo, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../../context/useAuth"
import { getOperationalSubtype, getResolvedRoleTier, isRouteAllowedForTier, tierBadgeTones, tierLabels } from "../../lib/role-tier"
import { labelize } from "../../utils/labelize"
import { Button } from "../ui/button"
import { ThemeToggle } from "../ui/ThemeToggle"
import { TableBadge } from "../ui/TableBadge"

interface DashboardLayoutProps {
  children: React.ReactNode
}

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, tiers: ["it_admin", "leadership", "operational_staff", "minimal_access"] },
  { to: "/students", label: "Students", icon: Users, tiers: ["it_admin", "leadership", "operational_staff"] },
  { to: "/classes", label: "Classes", icon: BookOpen, tiers: ["it_admin", "leadership", "operational_staff"] },
  { to: "/staff", label: "Staff", icon: School, tiers: ["it_admin", "leadership"] },
  { to: "/admin", label: "Admin", icon: ShieldCheck, tiers: ["it_admin"] },
  { to: "/assets", label: "Assets", icon: FolderOpen, tiers: ["it_admin"] },
  { to: "/attendance", label: "Attendance", icon: CalendarCheck, tiers: ["it_admin", "leadership", "operational_staff"] },
  { to: "/incidents", label: "Incidents", icon: ShieldAlert, tiers: ["it_admin", "leadership", "operational_staff"] },
  { to: "/tickets", label: "Tickets", icon: ClipboardList, tiers: ["it_admin", "leadership", "operational_staff"] },
]

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { signOut, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const tier = useMemo(() => getResolvedRoleTier(user?.roles), [user?.roles])
  const operationalSubtype = useMemo(() => getOperationalSubtype(user?.roles), [user?.roles])
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => isRouteAllowedForTier(item.to, tier)),
    [tier]
  )

  async function handleSignOut() {
    await signOut()
    navigate("/login")
  }

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] text-[var(--color-text)]">
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-[var(--color-border)] bg-[var(--color-surface-elevated)] backdrop-blur transition-transform duration-200 sm:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="flex h-16 items-center gap-2 border-b border-[var(--color-border)] px-6">
          <School className="size-6 text-[var(--color-accent)]" />
          <span className="text-lg font-semibold text-[var(--color-text)]">SchoolMgmt</span>
        </div>
        <nav className="space-y-1 p-3">
          {visibleNavItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${location.pathname === item.to || (item.to !== "/" && location.pathname.startsWith(item.to)) ? "bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-text)] ring-1 ring-[var(--color-accent)]/20" : "text-[var(--color-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-text)]"}`}
            >
              <item.icon className="size-5 shrink-0" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 border-t border-[var(--color-border)] p-4">
          <div className="mb-3 px-3">
            <div className="text-sm font-medium text-[var(--color-text)]">{user?.user_metadata?.full_name as string ?? user?.email?.split("@")[0] ?? "User"}</div>
            <div className="text-xs text-[var(--color-muted)]">{user?.email}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <TableBadge tone={tierBadgeTones[tier]}>{tierLabels[tier]}</TableBadge>
              {tier === "operational_staff" ? <TableBadge tone="slate">{labelize(operationalSubtype)}</TableBadge> : null}
            </div>
            <div className="mt-2 text-[11px] leading-4 text-[var(--color-muted)]">
              Roles: {user?.roles.length ? user.roles.join(", ") : "None"}
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={handleSignOut} className="w-full justify-start text-[var(--color-muted)] hover:text-[var(--color-text)]">
            <LogOut className="size-4 mr-2" />
            Sign out
          </Button>
        </div>
      </aside>

      <div className="min-h-screen min-w-0 sm:pl-64">
        <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-canvas)] backdrop-blur-sm">
          <div className="flex h-16 items-center gap-4 px-4 sm:px-6">
            <Button variant="ghost" size="sm" className="sm:hidden" onClick={() => setSidebarOpen(true)}>
              <Menu className="size-5" />
            </Button>
            <div className="flex-1" />
            <ThemeToggle />
            <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
              <Search className="size-4" />
              <span className="hidden sm:inline">Search anything...</span>
            </div>
          </div>
        </header>
        <main className="min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  )
}
