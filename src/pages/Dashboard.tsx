import { useEffect, useMemo, useState, type ReactNode } from "react"
import { format } from "date-fns"
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  FolderOpen,
  School,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Ticket,
  Users,
} from "lucide-react"
import { Link } from "react-router-dom"
import { useAuth } from "../context/useAuth"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card"
import { StatisticCard, StatisticGrid } from "../components/ui/StatisticCard"
import { Button } from "../components/ui/button"
import { Spinner } from "../components/ui/Spinner"
import { TableBadge } from "../components/ui/TableBadge"
import { fetchDashboardStatsForTier, type DashboardStatsForTier } from "../lib/api/supabaseApi"
import { useAsyncTask } from "../hooks/useAsyncTask"
import { logError } from "../utils/logger"
import { labelize } from "../utils/labelize"
import { tierBadgeTones, tierLabels, type RoleTier } from "../lib/role-tier"

type StatusItem = {
  key: string
  label: string
  count: number
  percentage: number
  barClass: string
}

const emptyStats: DashboardStatsForTier = {
  tier: "minimal_access",
  operationalSubtype: "unknown",
}

const studentStatusColors: Record<string, string> = {
  active: "bg-emerald-400",
  graduated: "bg-cyan-400",
  inactive: "bg-amber-400",
  transferred: "bg-rose-400",
}

const ticketStatusColors: Record<string, string> = {
  new: "bg-violet-400",
  assigned: "bg-cyan-400",
  in_progress: "bg-emerald-400",
  pending_user: "bg-amber-400",
  resolved: "bg-indigo-400",
  closed: "bg-slate-400",
  reopened: "bg-rose-400",
  archived: "bg-slate-500",
}

const actionIcons: Record<string, typeof Users> = {
  Dashboard: Users,
  Students: Users,
  Classes: BookOpen,
  Staff: School,
  Attendance: CheckCircle2,
  Incidents: ShieldCheck,
  Tickets: Ticket,
  Assets: FolderOpen,
  Admin: SlidersHorizontal,
}

function toStatusItems(statuses: Record<string, number>, colors: Record<string, string>) {
  const total = Object.values(statuses).reduce((sum, count) => sum + count, 0)

  return Object.entries(statuses)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({
      key,
      label: labelize(key),
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0,
      barClass: colors[key] ?? "bg-indigo-400",
    }))
}

function DistributionCard({
  title,
  emptyLabel,
  items,
}: {
  title: string
  emptyLabel: string
  items: StatusItem[]
}) {
  return (
    <Card className="h-full p-0">
      <CardHeader className="mb-0 border-b border-white/10 px-5 py-4">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-5 py-5">
        {items.length === 0 ? (
          <p className="text-sm text-slate-400">{emptyLabel}</p>
        ) : (
          <div className="space-y-4">
            {items.map((item) => (
              <div key={item.key} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-300">{item.label}</span>
                  <span className="font-medium text-white">{item.count}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/10">
                  <div className={`h-full rounded-full ${item.barClass}`} style={{ width: `${item.percentage}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SummaryCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-0">
      <CardHeader className="mb-0 border-b border-white/10 px-5 py-4">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 px-5 py-5 text-sm text-slate-300">{children}</CardContent>
    </Card>
  )
}

function buildActionItems(tier: RoleTier) {
  switch (tier) {
    case "leadership":
      return [
        { label: "Review Incidents", to: "/incidents" },
        { label: "Inspect Staff", to: "/staff" },
        { label: "Open Tickets", to: "/tickets" },
        { label: "View Students", to: "/students" },
      ]
    case "operational_staff":
      return [
        { label: "Take Attendance", to: "/attendance" },
        { label: "Update Incidents", to: "/incidents" },
        { label: "Work Tickets", to: "/tickets" },
        { label: "Review Classes", to: "/classes" },
      ]
    case "it_admin":
      return [
        { label: "Assign Tickets", to: "/tickets" },
        { label: "Manage Assets", to: "/assets" },
        { label: "Edit Roles", to: "/admin" },
        { label: "Check Staff", to: "/staff" },
      ]
    default:
      return []
  }
}

function getCardConfig(stats: DashboardStatsForTier) {
  switch (stats.tier) {
    case "leadership": {
      const leadership = stats.leadership ?? emptyStats.leadership
      return {
        title: "School leadership dashboard",
        badge: tierLabels.leadership,
        summary:
          "School-wide metrics, risk indicators, and review actions surfaced first so leaders can scan the whole picture quickly.",
        cards: [
          { label: "Students", value: leadership?.totalStudents ?? 0, icon: Users, accent: "text-cyan-300", description: "Current enrollment across the school" },
          { label: "Classes", value: leadership?.totalClasses ?? 0, icon: BookOpen, accent: "text-rose-300", description: "Sections currently scheduled" },
          { label: "Staff", value: leadership?.totalStaff ?? 0, icon: School, accent: "text-amber-300", description: "Active staff records on file" },
          { label: "Active Incidents", value: leadership?.activeIncidents ?? 0, icon: ShieldCheck, accent: "text-emerald-300", description: "Open or in-review incidents" },
          { label: "Open Tickets", value: leadership?.openTickets ?? 0, icon: Ticket, accent: "text-violet-300", description: "Support requests still waiting on action" },
          { label: "Attendance Today", value: leadership?.attendanceToday ?? 0, icon: CheckCircle2, accent: "text-cyan-300", description: "Attendance records captured today" },
        ],
        leftPanel: leadership ? (
          <SummaryCard title="Leadership overview">
            <p>{leadership.activeIncidents} active incidents and {leadership.openTickets} open tickets are currently in motion.</p>
            <p>{leadership.totalStudents} students across {leadership.totalClasses} classes and {leadership.totalStaff} staff members are visible in the school-wide view.</p>
            <p>Attendance today: {leadership.attendanceToday} records.</p>
          </SummaryCard>
        ) : null,
        rightPanel: leadership ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <DistributionCard title="Student status" emptyLabel="No student data available" items={toStatusItems(leadership.studentsByStatus, studentStatusColors)} />
            <DistributionCard title="Ticket status" emptyLabel="No ticket data available" items={toStatusItems(leadership.ticketsByStatus, ticketStatusColors)} />
          </div>
        ) : null,
      }
    }
    case "operational_staff": {
      const operational = stats.operational ?? emptyStats.operational
      return {
        title: "Operational staff dashboard",
        badge: tierLabels.operational_staff,
        summary:
          "Task-centric workload, scoped students, and active follow-ups are prioritized for day-to-day delivery work.",
        cards: [
          { label: "Classes in Scope", value: operational?.classesInScope ?? 0, icon: BookOpen, accent: "text-cyan-300", description: "Assigned or scoped classes" },
          { label: "Students in Scope", value: operational?.studentsInScope ?? 0, icon: Users, accent: "text-emerald-300", description: "Students currently in scope" },
          { label: "Incidents in Work", value: operational?.incidentsInWork ?? 0, icon: ShieldCheck, accent: "text-rose-300", description: "Incidents you created or own" },
          { label: "Open Tickets", value: operational?.openTickets ?? 0, icon: Ticket, accent: "text-violet-300", description: "Your visible ticket queue" },
          { label: "Follow-ups Due", value: operational?.followUpsDue ?? 0, icon: ClipboardList, accent: "text-amber-300", description: "Open follow-ups needing attention" },
        ],
        leftPanel: operational ? (
          <SummaryCard title="Workload summary">
            <p>{operational.classesInScope} classes and {operational.studentsInScope} students are currently in your scoped view.</p>
            <p>{operational.incidentsInWork} incidents and {operational.openTickets} open tickets are active in your queue.</p>
            <p>{operational.followUpsDue} follow-ups still need attention.</p>
          </SummaryCard>
        ) : null,
        rightPanel: operational ? (
          <DistributionCard title="Ticket status" emptyLabel="No scoped ticket data available" items={toStatusItems(operational.ticketsByStatus, ticketStatusColors)} />
        ) : null,
      }
    }
    case "it_admin": {
      const admin = stats.itAdmin ?? emptyStats.itAdmin
      return {
        title: "IT admin dashboard",
        badge: tierLabels.it_admin,
        summary:
          "System health, ticket backlog, role changes, and assignment pressure are grouped for admin triage and oversight.",
        cards: [
          { label: "Total Tickets", value: admin?.totalTickets ?? 0, icon: Ticket, accent: "text-cyan-300", description: "All ICT requests on record" },
          { label: "Unassigned", value: admin?.unassignedTickets ?? 0, icon: ClipboardList, accent: "text-amber-300", description: "Tickets still waiting for an owner" },
          { label: "Active IT Staff", value: admin?.activeItStaff ?? 0, icon: School, accent: "text-emerald-300", description: "Active support staff with IT roles" },
          { label: "Open Incidents", value: admin?.openIncidents ?? 0, icon: ShieldCheck, accent: "text-rose-300", description: "Incidents still open or under review" },
          { label: "Role Updates", value: admin?.pendingRoleUpdates ?? 0, icon: SlidersHorizontal, accent: "text-violet-300", description: "Inactive or queued user role rows" },
        ],
        leftPanel: admin ? (
          <SummaryCard title="Admin summary">
            <p>{admin.unassignedTickets} unassigned tickets are waiting for assignment.</p>
            <p>{admin.activeItStaff} active IT staff and {admin.openIncidents} open incidents are visible in the admin view.</p>
            <p>{admin.pendingRoleUpdates} role rows are currently inactive.</p>
          </SummaryCard>
        ) : null,
        rightPanel: admin ? (
          <SummaryCard title="Role distribution">
            {Object.entries(admin.roleDistribution).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(admin.roleDistribution)
                  .sort((a, b) => b[1] - a[1])
                  .map(([role, count]) => (
                    <div key={role} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2">
                      <span>{labelize(role)}</span>
                      <TableBadge tone="slate">{count}</TableBadge>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-slate-400">No role distribution data available.</p>
            )}
          </SummaryCard>
        ) : null,
      }
    }
    default:
      return {
        title: "Limited access dashboard",
        badge: tierLabels.minimal_access,
        summary: "This account does not currently have a role mapped to a presentation tier.",
        cards: [
          { label: "Access", value: "Limited", icon: ShieldCheck, accent: "text-slate-300", description: "Only the dashboard landing page is available" },
        ],
        leftPanel: (
          <SummaryCard title="Access note">
            <p>No presentation tier could be resolved for this account.</p>
            <p>Ask leadership or IT admin to add an active role in `user_roles`.</p>
          </SummaryCard>
        ),
        rightPanel: null,
      }
  }
}

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStatsForTier | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const { user } = useAuth()
  const { loading, run } = useAsyncTask()

  useEffect(() => {
    if (!user) return

    void run(async () => {
      const data = await fetchDashboardStatsForTier()
      setStats(data)
      setLastUpdated(new Date())
    }, {
      onError: (error) => {
        logError("Failed to load dashboard stats", error)
        setStats(emptyStats)
      },
    })
  }, [run, user])

  const config = useMemo(() => getCardConfig(stats ?? emptyStats), [stats])
  const actions = useMemo(() => buildActionItems((stats ?? emptyStats).tier), [stats])

  if (loading || !stats) {
    return (
      <div className="flex h-72 w-full items-center justify-center rounded-2xl border border-white/10 bg-slate-900/40">
        <Spinner size="xl" className="text-cyan-400" />
      </div>
    )
  }

  const roleTier = stats.tier
  const operationalSubtype = stats.operationalSubtype

  return (
    <div className="space-y-6 xl:space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.45)] sm:p-6 xl:p-8">
        <div className="pointer-events-none absolute -right-14 -top-16 h-52 w-52 rounded-full bg-cyan-500/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 left-16 h-52 w-52 rounded-full bg-indigo-500/10 blur-3xl" />
        <div className="relative grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,360px)] xl:items-start">
          <div className="min-w-0">
            <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium uppercase tracking-wide text-cyan-200">
              <ShieldCheck className="size-3.5" />
              Tiered overview
            </p>
            <h1 className="text-2xl font-semibold text-white sm:text-3xl">{config.title}</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">{config.summary}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-300 shadow-[0_16px_40px_-28px_rgba(15,23,42,0.6)]">
            <p className="text-xs uppercase tracking-wide text-slate-400">Last updated</p>
            <p className="mt-1 font-medium text-white">{lastUpdated ? format(lastUpdated, "dd MMM yyyy, HH:mm") : "Not available"}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <TableBadge tone={tierBadgeTones[roleTier]}>{config.badge}</TableBadge>
              {roleTier === "operational_staff" ? <TableBadge tone="slate">{operationalSubtype}</TableBadge> : null}
            </div>
          </div>
        </div>
      </section>

      <StatisticGrid>
        {config.cards.map((card) => {
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
                card.label.includes("Unassigned")
                  ? "from-amber-400/25 via-amber-400/10 to-transparent"
                  : card.label.includes("Incidents")
                    ? "from-rose-400/25 via-rose-400/10 to-transparent"
                    : card.label.includes("Tickets")
                      ? "from-cyan-400/25 via-cyan-400/10 to-transparent"
                      : "from-emerald-400/25 via-emerald-400/10 to-transparent"
              }
            />
          )
        })}
      </StatisticGrid>

      <section className="grid gap-4 lg:grid-cols-2">
        {config.leftPanel}
        {config.rightPanel}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(320px,1fr)]">
        <Card className="p-0">
          <CardHeader className="mb-0 border-b border-white/10 px-5 py-4">
            <CardTitle className="text-base">Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 px-5 py-5 sm:grid-cols-2">
            {actions.length > 0 ? (
              actions.map((action) => {
                const Icon = actionIcons[action.label] ?? ArrowRight
                return (
                  <Button key={action.to} asChild variant="outline" className="w-full justify-between">
                    <Link to={action.to}>
                      {action.label}
                      <Icon className="size-4" />
                    </Link>
                  </Button>
                )
              })
            ) : (
              <div className="col-span-full rounded-xl border border-dashed border-white/10 bg-slate-950/40 p-4 text-sm text-slate-400">
                No quick actions are available for this access level.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="p-0">
          <CardHeader className="mb-0 border-b border-white/10 px-5 py-4">
            <CardTitle className="text-base">Access context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 px-5 py-5">
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
              <p className="text-xs uppercase tracking-wide text-slate-400">Visible roles</p>
              <p className="mt-1 text-white">{user?.roles.length ? user.roles.join(", ") : "None"}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
              <p className="text-xs uppercase tracking-wide text-slate-400">Presentation tier</p>
              <p className="mt-1 text-white">{tierLabels[roleTier]}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/40 p-4 text-sm text-slate-300">
              <p className="text-xs uppercase tracking-wide text-slate-400">Focus</p>
              <p className="mt-1 text-white">
                {roleTier === "it_admin"
                  ? "System health and administrative throughput"
                  : roleTier === "leadership"
                    ? "Oversight and school-wide review"
                    : roleTier === "operational_staff"
                      ? "Scoped day-to-day task completion"
                      : "Sparse landing page only"}
              </p>
            </div>
          </CardContent>
        </Card>
      </section>

      {roleTier === "minimal_access" ? (
        <section className="rounded-2xl border border-dashed border-white/10 bg-slate-950/40 p-6 text-sm text-slate-400">
          <Sparkles className="mb-2 size-5 text-slate-500" />
          This account has no active presentation tier. The dashboard stays sparse until a role is assigned.
        </section>
      ) : null}
    </div>
  )
}
