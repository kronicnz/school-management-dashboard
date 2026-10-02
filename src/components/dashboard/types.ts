import type { LucideIcon } from "lucide-react"
import type { TableBadgeTone } from "../ui/TableBadge"
import type { Json } from "../../lib/api/database.types"
import type { AppRole } from "../../lib/access/registry"

export type DashboardMetric = {
  label: string
  value: string
  detail: string
  /**
   * Only set when a real prior-period figure exists for the metric. A movement
   * badge is never synthesised, because an unsupported delta is a fabricated
   * number on the dashboard.
   */
  delta?: string
  tone: TableBadgeTone
  icon: LucideIcon
  href?: string
}

export type DashboardTrendPoint = {
  label: string
  value: number
}

export type DashboardStackedPoint = {
  label: string
  completed: number
  overdue: number
}

export type DashboardFinancePoint = {
  label: string
  inflow: number
  outflow: number
}

export type DashboardFinanceAgingPoint = {
  label: string
  amount: number
  tone: TableBadgeTone
}

export type DashboardFinanceSummary = {
  cashOnHand: number
  apDue7Days: number
  apDue30Days: number
  monthBudget: number
  monthActual: number
  monthForecast: number
  awaitingApproval: number
  draftBills: number
  exceptions: number
}

export type DashboardFinanceSnapshot = {
  summary: DashboardFinanceSummary
  queue: DashboardWorkItem[]
  aging: DashboardFinanceAgingPoint[]
  budgets: DashboardWorkItem[]
  forecast: DashboardFinancePoint[]
  suppliers: DashboardWorkItem[]
  candidates: DashboardWorkItem[]
  latestBatchStatus: string
}

export type DashboardShortcut = {
  label: string
  description: string
  to: string
  icon: LucideIcon
}

export type FinanceValidationIssue = {
  rule: string
  severity: "error" | "warning"
  message: string
  drift?: number | null
}

export type DashboardWorkItem = {
  id?: string
  candidateId?: string | null
  title: string
  module: string
  detail: string
  status: string
  tone: TableBadgeTone
  due: string
  href?: string
  amount?: string
  validationErrors?: FinanceValidationIssue[]
  storagePath?: string | null
  validationErrorsRaw?: Json
}

export type DashboardActivityItem = {
  title: string
  meta: string
  tone: TableBadgeTone
  icon: LucideIcon
}

export type DashboardSnapshot = {
  /** Presentation selector only. Capability checks remain the source of access truth. */
  role: AppRole | null
  /** Every role the signed-in user holds, so views can be capability-checked. */
  roles: AppRole[]
  lastUpdated: Date | null
  statusLabel: string
  statusTone: TableBadgeTone
  summary: string
  secondaryNote: string
  attendanceRate: number
  metrics: DashboardMetric[]
  shortcuts: DashboardShortcut[]
  ticketTrend: DashboardTrendPoint[]
  maintenanceTrend: DashboardTrendPoint[]
  attendanceTrend: DashboardTrendPoint[]
  complianceTrend: DashboardStackedPoint[]
  financeTrend: DashboardFinancePoint[]
  priorityWork: DashboardWorkItem[]
  recentActivity: DashboardActivityItem[]
  upcomingWork: DashboardWorkItem[]
  financialSummary: {
    revenue: number
    expenses: number
    cashBalance: number
    outstanding: number
    pendingInvoices: number
  }
  finance: DashboardFinanceSnapshot
  openItTickets: number
}

/** The minimal shape the finance module needs, independent of the operational snapshot. */
export type FinanceSnapshot = DashboardFinanceSnapshot & {
  lastUpdated: Date
  batchStatusLabel: string
  mirrorHealthLabel: string
  /** False when the finance mirror returned no rows, so the page shows an empty state. */
  hasLiveData: boolean
}
