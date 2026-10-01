import { useId, useState, type ReactNode } from "react"
import { Link } from "react-router-dom"
import { BarChart3, Clock3, RefreshCw, Table2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "../ui/Card"
import { Button } from "../ui/button"
import type { StatisticTone } from "../ui/StatisticCard"
import { TableBadge } from "../ui/TableBadge"
import { EmptyState } from "../ui/EmptyState"
import { cn } from "../../utils/cn"
import type { DashboardTrendPoint, DashboardWorkItem } from "./types"

/** Token lookup so charts colour by meaning, never by a raw palette value. */
const toneFill: Record<StatisticTone, string> = {
  neutral: "var(--color-muted)",
  primary: "var(--color-primary)",
  success: "var(--color-success)",
  warning: "var(--color-warning)",
  information: "var(--color-information)",
  pending: "var(--color-pending)",
  destructive: "var(--color-destructive)",
  overdue: "var(--color-overdue)",
  completed: "var(--color-completed)",
  inactive: "var(--color-inactive)",
}

function roundForAxis(value: number) {
  if (Math.abs(value) >= 1000) return Math.round(value / 100) * 100
  if (Math.abs(value) >= 10) return Math.round(value)
  return Math.round(value * 10) / 10
}

type ChartDataRow = { label: string; cells: string[] }

type ChartFrameProps = {
  children: ReactNode
  /** Describes the series for assistive tech, e.g. "Open tickets, last 7 days, 42 today". */
  seriesLabel: string
  seriesNames: string[]
  rows: ChartDataRow[]
  unit?: string
  minLabel: string
  maxLabel: string
  /** Latest value, shown as a visible readout so the chart needs no hover to be read. */
  readout: ReactNode
  legend?: ReactNode
}

function ChartFrame({
  children,
  seriesLabel,
  seriesNames,
  rows,
  unit,
  minLabel,
  maxLabel,
  readout,
  legend,
}: ChartFrameProps) {
  const [showTable, setShowTable] = useState(false)
  const tableId = useId()

  return (
    <figure className="m-0 w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-3 sm:p-4">
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 text-xs text-[var(--color-muted)]">
          <span className="font-medium text-[var(--color-text)]">{maxLabel}</span>
          {unit ? <span className="ml-1 text-[var(--color-subtle)]">{unit}</span> : null}
        </div>
        <div className="text-xs text-[var(--color-muted)]">{readout}</div>
      </div>

      <div className="mt-2 flex h-[9.5rem] w-full items-end sm:h-[11rem]">{children}</div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-subtle)]">
        <span>{minLabel}</span>
        {legend ? <span className="flex flex-wrap items-center gap-3">{legend}</span> : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-11 px-2 text-xs"
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((previous) => !previous)}
        >
          {showTable ? <BarChart3 className="size-3.5" aria-hidden="true" /> : <Table2 className="size-3.5" aria-hidden="true" />}
          {showTable ? "Hide data table" : "Show data table"}
        </Button>
      </div>

      <div id={tableId} hidden={!showTable} className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[16rem] border-collapse text-left text-xs">
          <caption className="sr-only">{seriesLabel}</caption>
          <thead>
            <tr className="border-b border-[var(--color-border)] text-[var(--color-muted)]">
              <th scope="col" className="py-1.5 pr-3 font-medium">Period</th>
              {seriesNames.map((name) => (
                <th key={name} scope="col" className="py-1.5 pr-3 text-right font-medium">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-[var(--color-border-muted)] last:border-b-0">
                <th scope="row" className="py-1.5 pr-3 font-medium text-[var(--color-text)]">{row.label}</th>
                {row.cells.map((cell, cellIndex) => (
                  <td key={`${row.label}-${cellIndex}`} className="py-1.5 pr-3 text-right tabular-nums text-[var(--color-text)]">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  )
}

function ChartEmptyState({ message }: { message: string }) {
  return <EmptyState icon={BarChart3} description={message} className="min-h-[9.5rem]" />
}

function buildLinePath(points: DashboardTrendPoint[], width: number, height: number, padding = 8) {
  const values = points.map((point) => point.value)
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = Math.max(max - min, 1)
  const step = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0

  const coordinate = (index: number, value: number) => {
    const x = padding + index * step
    const y = height - padding - ((value - min) / range) * (height - padding * 2)
    return { x, y }
  }

  const path = points
    .map((point, index) => {
      const { x, y } = coordinate(index, point.value)
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(" ")

  const start = coordinate(0, points[0]?.value ?? 0)
  const end = coordinate(points.length - 1, points[points.length - 1]?.value ?? 0)
  const area = `${path} L ${end.x.toFixed(2)} ${height - padding} L ${start.x.toFixed(2)} ${height - padding} Z`

  return { path, area, max, min }
}

type LineChartProps = {
  data: DashboardTrendPoint[]
  /** Names the series and the window, and is used verbatim as the chart's accessible name. */
  seriesLabel: string
  /** Unit shown next to the axis maximum, e.g. "tickets" or "NZD". */
  unit?: string
  formatValue?: (value: number) => string
  emptyMessage?: string
}

export function LineChart({ data, seriesLabel, unit, formatValue, emptyMessage = "No data recorded yet." }: LineChartProps) {
  const gradientId = useId()
  const format = formatValue ?? ((value: number) => String(roundForAxis(value)))

  if (data.length === 0) {
    return <ChartEmptyState message={emptyMessage} />
  }

  const points = buildLinePath(data, 100, 60, 7)
  const latest = data[data.length - 1]
  const minValue = Math.min(...data.map((point) => point.value))
  const maxValue = Math.max(...data.map((point) => point.value))

  return (
    <ChartFrame
      seriesLabel={seriesLabel}
      seriesNames={[unit ?? "Value"]}
      unit={unit}
      minLabel={`${data[0]?.label ?? ""} low ${format(minValue)}`}
      maxLabel={`Peak ${format(maxValue)}`}
      readout={
        <>
          {latest?.label}: <span className="font-medium tabular-nums text-[var(--color-text)]">{formatValue ? formatValue(latest.value) : roundForAxis(latest.value)}</span>
        </>
      }
      rows={data.map((point) => ({ label: point.label, cells: [formatValue ? formatValue(point.value) : String(roundForAxis(point.value))] }))}
    >
      <svg
        viewBox="0 0 100 60"
        preserveAspectRatio="none"
        className="h-full w-full"
        role="img"
        aria-label={`${seriesLabel}. ${data.length} points, latest ${formatValue ? formatValue(latest.value) : roundForAxis(latest.value)}, high ${format(maxValue)}, low ${format(minValue)}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={points.area} fill={`url(#${gradientId})`} />
        <path d={points.path} fill="none" stroke="var(--color-primary)" strokeWidth="2.25" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        {data.map((point, index) => {
          const step = data.length > 1 ? 86 / (data.length - 1) : 0
          const x = 7 + index * step
          const y = 53 - ((point.value - points.min) / Math.max(points.max - points.min, 1)) * 46
          return <circle key={`${point.label}-${index}`} cx={x} cy={y} r="1.4" fill="var(--color-card)" stroke="var(--color-primary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        })}
      </svg>
    </ChartFrame>
  )
}

type BarChartProps = {
  data: DashboardTrendPoint[]
  seriesLabel: string
  unit?: string
  tone?: StatisticTone
  formatValue?: (value: number) => string
  emptyMessage?: string
}

export function BarChart({ data, seriesLabel, unit, tone = "primary", formatValue, emptyMessage }: BarChartProps) {
  const format = formatValue ?? ((value: number) => String(value))

  if (data.length === 0) {
    return <ChartEmptyState message={emptyMessage ?? "No data recorded yet."} />
  }

  // A flex row sizes itself to the data, so any number of periods renders without
  // a hardcoded column count.
  const max = Math.max(...data.map((point) => point.value), 1)
  const peak = data.reduce((best, point) => (point.value > best.value ? point : best), data[0])
  const fill = toneFill[tone]

  return (
    <ChartFrame
      seriesLabel={seriesLabel}
      seriesNames={[unit ?? "Count"]}
      unit={unit}
      minLabel={`${data[0]?.label ?? ""} to ${data[data.length - 1]?.label ?? ""}`}
      maxLabel={`Peak ${format(peak.value)}`}
      readout={
        <>
          {data[data.length - 1]?.label}:{" "}
          <span className="font-medium tabular-nums text-[var(--color-text)]">{format(data[data.length - 1]?.value ?? 0)}</span>
        </>
      }
      rows={data.map((point) => ({ label: point.label, cells: [format(point.value)] }))}
    >
      <div className="flex h-full w-full items-end gap-1.5 sm:gap-2">
        {data.map((point) => (
          <div key={point.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
            <div className="flex w-full flex-1 items-end rounded-md bg-[color-mix(in_srgb,var(--color-border)_45%,transparent)] px-1 py-1">
              <div className="w-full rounded-md" style={{ height: `${Math.max((point.value / max) * 100, 2)}%`, backgroundColor: fill }} />
            </div>
            <span className="w-full truncate text-center text-xs text-[var(--color-muted)]">{point.label}</span>
          </div>
        ))}
      </div>
    </ChartFrame>
  )
}

type StackedCompletionChartProps = {
  data: { label: string; completed: number; overdue: number }[]
  seriesLabel: string
  emptyMessage?: string
}

export function StackedCompletionChart({ data, seriesLabel, emptyMessage = "No check activity recorded yet." }: StackedCompletionChartProps) {
  if (data.length === 0) {
    return <ChartEmptyState message={emptyMessage} />
  }

  const max = Math.max(...data.map((point) => point.completed + point.overdue), 1)
  const totals = data.reduce(
    (acc, point) => ({ completed: acc.completed + point.completed, overdue: acc.overdue + point.overdue }),
    { completed: 0, overdue: 0 },
  )

  return (
    <ChartFrame
      seriesLabel={seriesLabel}
      seriesNames={["Complete", "Overdue"]}
      unit="checks"
      minLabel={`${data[0]?.label ?? ""} to ${data[data.length - 1]?.label ?? ""}`}
      maxLabel={`Peak ${Math.max(...data.map((point) => point.completed + point.overdue))}`}
      readout={
        <>
          {totals.completed} complete · {totals.overdue} overdue
        </>
      }
      rows={data.map((point) => ({ label: point.label, cells: [String(point.completed), String(point.overdue)] }))}
      legend={
        <>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-[var(--color-success)]" aria-hidden="true" />
            Complete
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-[var(--color-overdue)]" aria-hidden="true" />
            Overdue
          </span>
        </>
      }
    >
      <div className="flex h-full w-full items-end gap-1.5 sm:gap-2">
        {data.map((point) => (
          <div key={point.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
            <div className="flex w-full flex-1 flex-col items-stretch justify-end rounded-md bg-[color-mix(in_srgb,var(--color-border)_45%,transparent)] p-1">
              <div className="w-full rounded-sm bg-[var(--color-overdue)]" style={{ height: `${Math.max((point.overdue / max) * 100, 2)}%` }} />
              <div className="mt-0.5 w-full rounded-sm bg-[var(--color-success)]" style={{ height: `${Math.max((point.completed / max) * 100, 2)}%` }} />
            </div>
            <span className="w-full truncate text-center text-xs text-[var(--color-muted)]">{point.label}</span>
          </div>
        ))}
      </div>
    </ChartFrame>
  )
}

export function SectionCard({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-0">
      <CardHeader className="mb-0 flex-col items-start gap-3 border-b border-[var(--color-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <p className="mt-1 text-sm text-[var(--color-muted)]">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent className="px-5 py-5">{children}</CardContent>
    </Card>
  )
}

export function WorkList({ items, onEdit, onReview, canEdit = true, emptyMessage = "Nothing to show here yet." }: { items: DashboardWorkItem[]; onEdit?: (item: DashboardWorkItem) => void; onReview?: (item: DashboardWorkItem) => void; canEdit?: boolean; emptyMessage?: string }) {
  if (items.length === 0) {
    return <EmptyState description={emptyMessage} />
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map((item, index) => {
        const canCorrect = Boolean(canEdit && onEdit && item.candidateId && !item.href && item.status !== "Synced")
        const canReview = Boolean(onReview && item.storagePath)
        // Rows with their own action controls cannot also be a link, otherwise the
        // row would wrap the buttons in a second interactive ancestor.
        const isStretchLink = Boolean(item.href) && !canCorrect && !canReview

        return (
          <div
            key={`${item.title}-${item.due}-${index}`}
            className={cn(
              "relative flex min-w-0 items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-soft)] p-4 transition-colors motion-reduce:transition-none",
              isStretchLink && "hover:border-[color-mix(in_srgb,var(--color-primary)_32%,var(--color-border))]",
              isStretchLink && "focus-within:border-[color-mix(in_srgb,var(--color-primary)_45%,var(--color-border))]",
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className={cn("truncate text-sm font-medium text-[var(--color-text)]", isStretchLink && "after:absolute after:inset-0 after:content-['']")}>{item.title}</p>
                <TableBadge tone={item.tone}>{item.module}</TableBadge>
              </div>
              <p className="mt-1 text-xs leading-5 text-[var(--color-muted)]">{item.detail}</p>
              {item.validationErrors && item.validationErrors.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
                  {item.validationErrors.map((issue, issueIndex) => (
                    <li
                      key={`${item.id ?? index}-${issue.rule}-${issueIndex}`}
                      className="flex items-start gap-1.5 text-xs leading-5 text-[var(--color-muted)]"
                    >
                      <TableBadge tone={issue.severity === "error" ? "rose" : "amber"}>{issue.rule}</TableBadge>
                      <span>{issue.message}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted)]">
                <Clock3 className="size-3.5" aria-hidden="true" />
                <span>{item.due}</span>
                {item.amount ? <span className="font-medium text-[var(--color-text)]">{item.amount}</span> : null}
              </div>
            </div>
            <div className="relative z-10 flex flex-col items-end gap-2">
              <TableBadge tone={item.tone}>{item.status}</TableBadge>
              {canCorrect ? (
                <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={() => onEdit?.(item)}>
                  Correct
                  <span className="sr-only"> {item.title}</span>
                </Button>
              ) : null}
              {canReview ? (
                <Button type="button" size="sm" variant="outline" className="min-h-11" onClick={() => onReview?.(item)}>
                  Review
                  <span className="sr-only"> {item.title}</span>
                </Button>
              ) : null}
              {item.href && !isStretchLink ? (
                <Button asChild size="sm" variant="ghost" className="min-h-11">
                  <Link to={item.href}>
                    Open module
                    <span className="sr-only">: {item.title}</span>
                  </Link>
                </Button>
              ) : null}
            </div>
            {isStretchLink ? <span className="sr-only">Linked to {item.module}</span> : null}
          </div>
        )
      })}
    </div>
  )
}

/** A real refresh control. The `onRefresh` prop was previously accepted and ignored. */
export function RefreshControl({ onRefresh, busy, label = "Refresh" }: { onRefresh?: () => Promise<void> | void; busy?: boolean; label?: string }) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const working = Boolean(busy) || isRefreshing

  if (!onRefresh) return null

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="min-h-11"
      disabled={working}
      aria-busy={working}
      onClick={() => {
        setIsRefreshing(true)
        void Promise.resolve(onRefresh()).finally(() => setIsRefreshing(false))
      }}
    >
      <RefreshCw className={cn("size-4", working && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
      {working ? "Refreshing" : label}
    </Button>
  )
}

export function PanelHeading({ step, title, description, action }: { step: number; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-border)] pb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-xs font-semibold tabular-nums text-[var(--color-primary)]",
            )}
          >
            {step}
          </span>
          <h2 className="text-base font-semibold tracking-tight text-[var(--color-text)]">{title}</h2>
        </div>
        {description ? <p className="mt-1.5 text-sm text-[var(--color-muted)]">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  )
}
