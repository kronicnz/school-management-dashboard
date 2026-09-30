import { Link } from "react-router-dom"
import { Activity, Sparkles } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "../ui/button"
import { StatisticCard, StatisticGrid, type StatisticTone } from "../ui/StatisticCard"
import { TableBadge, type TableBadgeTone } from "../ui/TableBadge"
import { cn } from "../../utils/cn"
import { labelize } from "../../utils/labelize"
import {
  BarChart,
  LineChart,
  PanelHeading,
  RefreshControl,
  SectionCard,
  StackedCompletionChart,
  WorkList,
} from "./blocks"
import { freshnessFrom } from "./freshness"
import { getDashboardCopy, type DashboardCopy } from "../../lib/dashboard/profiles"
import { formatCount, formatNZD } from "../../lib/format"
import { toneForActivity } from "../../lib/tone"
import type {
  DashboardActivityItem,
  DashboardMetric,
  DashboardShortcut,
  DashboardSnapshot,
} from "./types"

// The snapshot contract lives in ./types so the finance module can build the same shapes
// without importing this component. Re-exported here because callers already import the
// types from this module.
export type {
  DashboardActivityItem,
  DashboardFinanceAgingPoint,
  DashboardFinancePoint,
  DashboardFinanceSnapshot,
  DashboardFinanceSummary,
  DashboardMetric,
  DashboardShortcut,
  DashboardSnapshot,
  DashboardStackedPoint,
  DashboardTrendPoint,
  DashboardWorkItem,
  FinanceValidationIssue,
} from "./types"

type DashboardOverviewProps = {
  snapshot: DashboardSnapshot | null
  loading: boolean
  onRefresh?: () => Promise<void>
}

/** Badge tone is a display name; the KPI primitive only accepts a semantic token. */
function metricTone(tone: TableBadgeTone): StatisticTone {
  switch (tone) {
    case "emerald":
      return "success"
    case "cyan":
      return "information"
    case "amber":
      return "warning"
    case "rose":
      return "destructive"
    case "violet":
    case "purple":
      return "pending"
    case "indigo":
      return "primary"
    default:
      return "neutral"
  }
}

function MetricCard({ metric }: { metric: DashboardMetric }) {
  return (
    <StatisticCard
      label={metric.label}
      value={metric.value}
      icon={metric.icon}
      description={metric.detail}
      tone={metricTone(metric.tone)}
      href={metric.href}
    />
  )
}

function SummaryPanel({ snapshot, copy, showShortcuts }: { snapshot: DashboardSnapshot; copy: DashboardCopy; showShortcuts: boolean }) {
  const { summary, secondaryNote, attendanceRate, shortcuts, priorityWork, role, openItTickets } = snapshot
  const criticalCount = priorityWork.filter((item) => item.tone === "rose").length

  return (
    <div className="space-y-4">
      <SectionCard title="Organisation overview" description="The headline for this role, and the scope it covers.">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.8fr)] xl:items-start">
          <div className="min-w-0 space-y-4">
            <div>
              <h3 className="text-2xl font-semibold tracking-tight text-[var(--color-text)] sm:text-3xl">{summary}</h3>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">{secondaryNote}</p>
            </div>

            <StatisticGrid>
              <StatisticCard label="Attendance rate" value={`${attendanceRate}%`} description="Current weekly attendance signal" tone="success" />
              <StatisticCard label="Critical queue" value={formatCount(criticalCount)} description="Items requiring immediate action" tone={criticalCount > 0 ? "destructive" : "neutral"} />
              <StatisticCard label="Open work" value={formatCount(priorityWork.length)} description="Priority items across all modules" tone="warning" />
              <StatisticCard label="Open tickets" value={formatCount(openItTickets)} description="Backlog from the primary live ticket source" tone="information" />
            </StatisticGrid>
          </div>

          <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">{copy.currentStateLabel}</p>
                <p className="mt-1 text-base font-semibold text-[var(--color-text)]">{copy.currentStateTitle}</p>
              </div>
              <Sparkles className="size-5 text-[var(--color-primary)]" aria-hidden="true" />
            </div>

            <dl className="mt-4 space-y-3">
              <div className="rounded-xl border border-[var(--color-border-muted)] bg-[var(--color-surface-elevated)] px-4 py-3">
                <dt className="sr-only">Current state</dt>
                <dd className="text-base font-semibold text-[var(--color-text)]">{copy.currentStateDescription}</dd>
                <dd className="mt-1 text-sm text-[var(--color-muted)]">{secondaryNote}</dd>
              </div>
              <div className="rounded-xl border border-[var(--color-border-muted)] bg-[var(--color-surface-elevated)] px-4 py-3">
                <dt className="flex items-center justify-between gap-2 text-sm font-medium text-[var(--color-text)]">
                  <span className="inline-flex items-center gap-2">
                    <Activity className="size-4 text-[var(--color-success)]" aria-hidden="true" />
                    Data source
                  </span>
                  <TableBadge tone="emerald">Live + demo where unconnected</TableBadge>
                </dt>
                <dd className="mt-2 text-sm text-[var(--color-muted)]">
                  Live records drive students, staff, assets, tickets, attendance, and incidents. Cyclical check and accounting panels remain structured demo values where no live source
                  exists yet.
                </dd>
              </div>
              <div className="rounded-xl border border-[var(--color-border-muted)] bg-[var(--color-surface-elevated)] px-4 py-3">
                <dt className="text-sm font-medium text-[var(--color-text)]">Access scope</dt>
                <dd className="mt-1 text-sm text-[var(--color-muted)]">
                  {role ? `${labelize(role)} workflow focus applied.` : "All accessible records in view."}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </SectionCard>

      {showShortcuts ? (
        <SectionCard title="Jump to a module" description="Only the modules this role can open are listed.">
          <ShortcutGrid shortcuts={shortcuts} />
        </SectionCard>
      ) : null}
    </div>
  )
}

function TrendsPanel({ snapshot, copy }: { snapshot: DashboardSnapshot; copy: DashboardCopy }) {
  const { ticketTrend, maintenanceTrend, attendanceTrend, complianceTrend, financeTrend, attendanceRate } = snapshot
  const lastTicketValue = ticketTrend[ticketTrend.length - 1]?.value ?? 0
  const lastAttendanceValue = attendanceTrend[attendanceTrend.length - 1]?.value ?? 0
  const lastFinanceValue = financeTrend.length > 0 ? financeTrend[financeTrend.length - 1].inflow - financeTrend[financeTrend.length - 1].outflow : 0

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SectionCard title={copy.ticketTitle} description={copy.ticketDescription}>
        <div className="space-y-4">
          <LineChart
            data={ticketTrend}
            seriesLabel={`Open tickets over the last ${ticketTrend.length} days`}
            unit="open tickets"
            emptyMessage="No ticket movement recorded yet."
          />
          <StatisticGrid>
            <StatisticCard label="Current open tickets" value={formatCount(snapshot.openItTickets)} description="Live service desk backlog" tone="information" />
            <StatisticCard label={`Latest daily open (${ticketTrend[ticketTrend.length - 1]?.label ?? "n/a"})`} value={formatCount(lastTicketValue)} description="Point on the line above" tone="neutral" />
          </StatisticGrid>
        </div>
      </SectionCard>

      <SectionCard title={copy.maintenanceTitle} description={copy.maintenanceDescription}>
        <div className="space-y-4">
          <BarChart
            data={maintenanceTrend}
            seriesLabel={`Property maintenance activity across ${maintenanceTrend.length} days`}
            unit="repairs per day"
            tone="warning"
            emptyMessage="No maintenance activity recorded yet."
          />
          <p className="rounded-xl border border-[var(--color-border-muted)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm text-[var(--color-muted)]">
            Overdue repairs and contractor work are kept separate from ticketing so facilities backlog is easy to read at a glance.
          </p>
        </div>
      </SectionCard>

      <SectionCard title={copy.attendanceTitle} description={copy.attendanceDescription}>
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-[var(--color-text)]">Attendance trend</span>
              <span className="text-[var(--color-muted)]">Weekly rate · {attendanceRate}% average</span>
            </div>
            <LineChart
              data={attendanceTrend}
              seriesLabel={`Attendance rate across the last ${attendanceTrend.length} recorded days`}
              unit="percent present"
              formatValue={(value) => `${Math.round(value)}%`}
              emptyMessage="No attendance records yet."
            />
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              Latest recorded rate {formatCount(lastAttendanceValue)}%.
            </p>
          </div>
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-[var(--color-text)]">Check completion</span>
              <span className="text-[var(--color-muted)]">Completed vs overdue</span>
            </div>
            <StackedCompletionChart data={complianceTrend} seriesLabel="Cyclical checks completed versus overdue by day" />
          </div>
        </div>
      </SectionCard>

      <SectionCard title={copy.financeTitle} description={copy.financeDescription}>
        <div className="space-y-4">
          <LineChart
            data={financeTrend.map((point) => ({ label: point.label, value: point.inflow - point.outflow }))}
            seriesLabel={`Net cash flow across ${financeTrend.length} forecast snapshots`}
            unit="NZD net"
            formatValue={formatNZD}
            emptyMessage="No cash-flow trend is available yet."
          />
          <StatisticGrid>
            <StatisticCard label="Revenue" value={formatNZD(snapshot.financialSummary.revenue)} description="Forecast inflow for the period" tone="success" />
            <StatisticCard label="Expenses" value={formatNZD(snapshot.financialSummary.expenses)} description="Recorded spend for the period" tone="warning" />
            <StatisticCard label="Latest net position" value={formatNZD(lastFinanceValue)} description="Inflow less outflow on the newest snapshot" tone="information" />
          </StatisticGrid>
        </div>
      </SectionCard>
    </div>
  )
}

function WorkloadPanel({ snapshot, copy, showPriorityAction }: { snapshot: DashboardSnapshot; copy: DashboardCopy; showPriorityAction: boolean }) {
  const { priorityWork, upcomingWork } = snapshot
  const canOpenFinance = snapshot.shortcuts.some((shortcut) => shortcut.to === "/finance")

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      {priorityWork.length > 0 ? (
        <SectionCard
          title={copy.priorityTitle}
          description={copy.priorityDescription}
          action={showPriorityAction ? <Button asChild variant="outline" size="sm"><Link to="/tickets">Open queue</Link></Button> : undefined}
        >
          <WorkList items={priorityWork} emptyMessage="Nothing is flagged as priority work right now." />
        </SectionCard>
      ) : null}

      <div className="grid gap-4">
        <SectionCard title={copy.upcomingTitle} description={copy.upcomingDescription}>
          <WorkList items={upcomingWork} emptyMessage="Nothing is scheduled ahead." />
        </SectionCard>

        {canOpenFinance ? (
          <SectionCard
            title="Finance"
            description="The invoice module has its own dashboard."
            action={<Button asChild variant="outline" size="sm"><Link to="/finance">Open finance</Link></Button>}
          >
            <p className="rounded-xl border border-[var(--color-border-muted)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm text-[var(--color-muted)]">
              Intake, position, review, billing, exposure, and budget all live on the finance dashboard in that order, so a single page can be worked top to bottom without the operational
              dashboard competing for attention.
            </p>
          </SectionCard>
        ) : null}
      </div>
    </div>
  )
}

function ActivityPanel({ copy, recentActivity }: { copy: DashboardCopy; recentActivity: DashboardActivityItem[] }) {
  return (
    <SectionCard title={copy.recentTitle} description={copy.recentDescription}>
      <ActivityFeed items={recentActivity} />
    </SectionCard>
  )
}

function ActivityFeed({ items }: { items: DashboardActivityItem[] }) {
  if (items.length === 0) {
    return <p className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-soft)] px-4 py-6 text-center text-sm text-[var(--color-muted)]">No recorded activity yet.</p>
  }

  return (
    <ol className="flex flex-col gap-3">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <li key={`${item.title}-${item.meta}`} className="flex gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-soft)] px-4 py-3">
            <div className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", toneToSurface(item.tone))}>
              <Icon className="size-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium text-[var(--color-text)]">{item.title}</p>
                <TableBadge tone={toneForActivity(item.tone)}>{labelize(item.tone)}</TableBadge>
              </div>
              <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">{item.meta}</p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function toneToSurface(tone: TableBadgeTone) {
  switch (tone) {
    case "emerald":
      return "bg-[color-mix(in_srgb,var(--color-success)_18%,transparent)] text-[var(--color-success)]"
    case "cyan":
      return "bg-[color-mix(in_srgb,var(--color-information)_18%,transparent)] text-[var(--color-information)]"
    case "amber":
      return "bg-[color-mix(in_srgb,var(--color-warning)_18%,transparent)] text-[var(--color-warning)]"
    case "rose":
      return "bg-[color-mix(in_srgb,var(--color-destructive)_18%,transparent)] text-[var(--color-destructive)]"
    case "violet":
      return "bg-[color-mix(in_srgb,var(--color-pending)_18%,transparent)] text-[var(--color-pending)]"
    case "indigo":
      return "bg-[color-mix(in_srgb,var(--color-primary)_18%,transparent)] text-[var(--color-primary)]"
    default:
      return "bg-[var(--color-secondary)] text-[var(--color-text)]"
  }
}

function ShortcutGrid({ shortcuts }: { shortcuts: DashboardShortcut[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {shortcuts.map((shortcut) => {
        const Icon = shortcut.icon
        return (
          <Button key={shortcut.to} asChild variant="outline" className="h-auto min-h-11 justify-start rounded-2xl px-4 py-3">
            <Link to={shortcut.to}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-medium">{shortcut.label}</span>
                <span className="block truncate text-xs text-[var(--color-muted)]">{shortcut.description}</span>
              </span>
            </Link>
          </Button>
        )
      })}
    </div>
  )
}

export function DashboardLoadingState() {
  return (
    <div className="space-y-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading dashboard metrics</span>
      <section className="space-y-3">
        <div className="h-7 w-48 animate-pulse rounded-lg bg-[var(--color-surface-soft)] motion-reduce:animate-none" />
        <StatisticGrid>
          {[0, 1, 2, 3].map((slot) => (
            <div key={slot} className="h-[7.5rem] animate-pulse rounded-2xl bg-[var(--color-surface-soft)] motion-reduce:animate-none" />
          ))}
        </StatisticGrid>
      </section>
      <section className="space-y-3">
        <div className="h-7 w-56 animate-pulse rounded-lg bg-[var(--color-surface-soft)] motion-reduce:animate-none" />
        <div className="h-72 animate-pulse rounded-2xl bg-[var(--color-surface-soft)] motion-reduce:animate-none" />
      </section>
      <section className="space-y-3">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-[var(--color-surface-soft)] motion-reduce:animate-none" />
        <div className="grid gap-4 xl:grid-cols-2">
          {[0, 1, 2, 3].map((slot) => (
            <div key={slot} className="h-72 animate-pulse rounded-2xl bg-[var(--color-surface-soft)] motion-reduce:animate-none" />
          ))}
        </div>
      </section>
    </div>
  )
}

function FreshnessBar({ snapshot, onRefresh }: { snapshot: DashboardSnapshot; onRefresh?: () => Promise<void> }) {
  // Re-reads on an interval so a tab left open overnight does not keep claiming to be fresh.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  const freshness = freshnessFrom(snapshot.lastUpdated, now)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <TableBadge tone={snapshot.statusTone}>{snapshot.statusLabel}</TableBadge>
      <TableBadge tone={freshness.tone}>{freshness.label}</TableBadge>
      {snapshot.role ? <TableBadge tone="violet">{labelize(snapshot.role)}</TableBadge> : null}
      <RefreshControl onRefresh={onRefresh} label="Refresh dashboard" />
    </div>
  )
}

export function DashboardOverview({ snapshot, loading, onRefresh }: DashboardOverviewProps) {
  if (loading || !snapshot) {
    return <DashboardLoadingState />
  }

  const { metrics, shortcuts, priorityWork, recentActivity, upcomingWork } = snapshot
  const copy = getDashboardCopy(snapshot.role)
  const showShortcuts = shortcuts.length > 0

  return (
    <div className="space-y-6">
      <FreshnessBar snapshot={snapshot} onRefresh={onRefresh} />

      <section className="space-y-3">
        <PanelHeading
          step={1}
          title="Key metrics"
          description={copy.metricsDescription}
          action={<TableBadge tone="slate">{copy.metricsEyebrow}</TableBadge>}
        />
        <StatisticGrid>
          {metrics.map((metric) => (
            <MetricCard key={metric.label} metric={metric} />
          ))}
        </StatisticGrid>
      </section>

      <section className="space-y-3">
        <PanelHeading step={2} title="Overview" description={copy.metricsTitle} />
        <SummaryPanel snapshot={snapshot} copy={copy} showShortcuts={showShortcuts} />
      </section>

      <section className="space-y-3">
        <PanelHeading
          step={3}
          title="Signals"
          description="Movement across tickets, maintenance, attendance, compliance, and cash flow."
          action={<TableBadge tone="violet">4 charts</TableBadge>}
        />
        <TrendsPanel snapshot={snapshot} copy={copy} />
      </section>

      <section className="space-y-3">
        <PanelHeading
          step={4}
          title="Workload"
          description="What needs a decision now, and what is already on the way."
          action={<TableBadge tone={priorityWork.length > 0 ? "amber" : "emerald"}>{formatCount(priorityWork.length + upcomingWork.length)} items</TableBadge>}
        />
        <WorkloadPanel snapshot={snapshot} copy={copy} showPriorityAction={priorityWork.length > 0} />
      </section>

      <section className="space-y-3">
        <PanelHeading
          step={5}
          title="Activity"
          description="A concise event trail across the modules this role can see."
          action={<TableBadge tone="slate">{formatCount(recentActivity.length)} updates</TableBadge>}
        />
        <ActivityPanel copy={copy} recentActivity={recentActivity} />
      </section>

      <SectionCard title="Read access" description="What this view is allowed to show.">
        <div className="flex flex-wrap items-center gap-2">
          {snapshot.role ? <TableBadge tone="violet">Viewing as {labelize(snapshot.role)}</TableBadge> : <TableBadge tone="violet">Assigned scope</TableBadge>}
          {snapshot.roles.map((heldRole) => (
            <TableBadge key={heldRole} tone="slate">{labelize(heldRole)}</TableBadge>
          ))}
          <TableBadge tone="cyan">Live + demo blended</TableBadge>
        </div>
        <p className="mt-3 text-sm text-[var(--color-muted)]">
          Live records drive students, staff, assets, tickets, attendance, and incidents. Cyclical check and accounting panels remain structured demo values where no live source exists yet, and
          the invoice module lives on its own finance dashboard.
        </p>
      </SectionCard>
    </div>
  )
}
