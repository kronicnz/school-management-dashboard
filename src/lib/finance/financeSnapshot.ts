import { format } from "date-fns"
import type { TableBadgeTone } from "../../components/ui/TableBadge"
import type {
  DashboardFinanceAgingPoint,
  DashboardFinanceSnapshot,
  DashboardWorkItem,
  FinanceSnapshot,
  FinanceValidationIssue,
} from "../../components/dashboard/types"
import type { FinanceDashboardData } from "../api/supabaseApi"
import type { FinanceInvoiceCandidate } from "../api/database.types"
import { labelize } from "../../utils/labelize"

function formatNZD(value: number) {
  return new Intl.NumberFormat("en-NZ", {
    style: "currency",
    currency: "NZD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Reads the validation errors the extraction pipeline attached to a candidate.
 *
 * Guarded because the column is jsonb and predates the current row shape: a
 * candidate written before the migration has no such key, and a malformed value
 * must degrade to "no issues" rather than take the whole finance page down.
 */
export function readValidationErrors(candidate: FinanceInvoiceCandidate | undefined): FinanceValidationIssue[] {
  const raw = (candidate as { validation_errors?: unknown } | undefined)?.validation_errors
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (entry): entry is FinanceValidationIssue =>
      Boolean(entry) && typeof entry === "object" && typeof (entry as FinanceValidationIssue).message === "string",
  )
}

/** Human wording for the finance intake queue states the worker can leave behind. */
export function financeQueueStatusLabel(status: string): string {
  switch (status) {
    case "exception":
      return "Needs review"
    case "needs_review":
      return "Validation failed"
    case "failed_review":
      return "Extraction failed"
    case "extracting":
      return "Extracting"
    default:
      return labelize(status)
  }
}

export function financeQueueStatusTone(status: string): TableBadgeTone {
  if (status === "failed_review" || status === "exception") return "rose"
  if (status === "needs_review" || status === "draft") return "amber"
  if (status === "extracting") return "cyan"
  return "slate"
}

export function formatShortDate(date: string | null | undefined) {
  if (!date) return ""
  return format(new Date(date), "dd MMM")
}

export function toNZD(value: number) {
  return Number.isFinite(value) ? formatNZD(value) : formatNZD(0)
}

export function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0)
}

export function buildFinanceSnapshot(financeData: FinanceDashboardData | null): DashboardFinanceSnapshot {
  const activeData = financeData ?? {
    intakeBatches: [],
    intakeItems: [],
    invoiceCandidates: [],
    xeroLinks: [],
    processingEvents: [],
    budgets: [],
    forecastSnapshots: [],
  }

  const candidatesById = new Map(activeData.invoiceCandidates.map((candidate) => [candidate.intake_item_id, candidate]))
  const latestForecasts = activeData.forecastSnapshots
    .slice()
    .sort((left, right) => +new Date(left.snapshot_date) - +new Date(right.snapshot_date))
    .slice(-6)

  const latestSnapshot = activeData.forecastSnapshots
    .slice()
    .sort((left, right) => +new Date(right.snapshot_date) - +new Date(left.snapshot_date) || right.horizon_weeks - left.horizon_weeks)[0]

  const budgetTotal = sum(activeData.budgets.filter((budget) => budget.is_active).map((budget) => budget.budget_amount))
  const actualTotal = sum(activeData.budgets.filter((budget) => budget.is_active).map((budget) => budget.actual_amount))
  const forecastTotal = sum(activeData.budgets.filter((budget) => budget.is_active).map((budget) => budget.forecast_amount))

  const dueBuckets = activeData.invoiceCandidates.reduce(
    (acc, candidate) => {
      if (!candidate.due_date) return acc

      const dueDate = new Date(candidate.due_date)
      const ageDays = Math.floor((Date.now() - dueDate.getTime()) / 86_400_000)
      const amount = Number(candidate.gross_total ?? 0)

      if (ageDays <= 7) acc.due7 += amount
      if (ageDays <= 30) acc.due30 += amount
      if (ageDays > 30 && ageDays <= 60) acc.age31_60 += amount
      if (ageDays > 60 && ageDays <= 90) acc.age61_90 += amount
      if (ageDays > 90) acc.age90 += amount

      return acc
    },
    { due7: 0, due30: 0, age31_60: 0, age61_90: 0, age90: 0 }
  )

  const queueItems: DashboardWorkItem[] = activeData.intakeItems
    .slice()
    .sort((left, right) => +new Date(right.created_at) - +new Date(left.created_at))
    // needs_review and failed_review are both terminal-for-the-worker states and must be
    // listed here, or a validation failure or an exhausted retry would leave an item
    // sitting in the queue with no visible owner.
    .filter((item) => ["pending", "extracting", "review", "needs_review", "draft", "exception", "failed", "failed_review"].includes(item.status))
    .slice(0, 6)
    .map((item) => {
      const candidate = candidatesById.get(item.id)
      const amount = candidate ? toNZD(candidate.gross_total) : undefined
      const detail = candidate
        ? `${candidate.supplier_name}${candidate.invoice_number ? ` · ${candidate.invoice_number}` : ""}`
        : item.subject || item.file_name || item.source_key || "Awaiting extraction"

      // A blocking validation error is the most actionable thing on the card, so it is
      // surfaced in the detail line rather than hidden behind a status badge.
      const validationErrors = readValidationErrors(candidate)
      const blockingError = validationErrors.find((entry) => entry.severity === "error")
      const reason = item.failure_reason?.trim() || item.subject || item.file_name || null
      return {
        id: item.id,
        candidateId: candidate?.id ?? null,
        title: item.subject || item.file_name || item.source_key || "Invoice intake item",
        module: item.source_type === "gmail" ? "Gmail intake" : "Manual upload",
        detail: blockingError?.message ?? (item.status === "failed_review" ? reason : detail) ?? "Awaiting extraction",
        status: financeQueueStatusLabel(item.status),
        tone: financeQueueStatusTone(item.status),
        due: formatShortDate(item.received_at || item.created_at),
        amount,
        validationErrors,
        storagePath: item.storage_path,
        validationErrorsRaw: (item as any).validation_errors,
      }
    })

  const budgetRows: DashboardWorkItem[] = activeData.budgets
    .slice()
    .sort((left, right) => Math.abs((right.actual_amount ?? 0) - (right.budget_amount ?? 0)) - Math.abs((left.actual_amount ?? 0) - (left.budget_amount ?? 0)))
    .slice(0, 6)
    .map((budget) => ({
      title: `${budget.department} · ${budget.category}`,
      module: budget.budget_code,
      detail: `Budget ${toNZD(budget.budget_amount)} · Forecast ${toNZD(budget.forecast_amount)}`,
      status: budget.actual_amount > budget.budget_amount ? "Overspent" : budget.is_active ? "On plan" : "Archived",
      tone: budget.actual_amount > budget.budget_amount ? "amber" : budget.is_active ? "emerald" : "slate",
      due: `Variance ${toNZD(budget.actual_amount - budget.budget_amount)}`,
      amount: toNZD(budget.actual_amount),
    }))

  const supplierTotals = activeData.invoiceCandidates.reduce<Record<string, { amount: number; count: number }>>((acc, candidate) => {
    const key = candidate.supplier_name.trim() || "Unmatched supplier"
    const current = acc[key] ?? { amount: 0, count: 0 }
    current.amount += Number(candidate.gross_total ?? 0)
    current.count += 1
    acc[key] = current
    return acc
  }, {})

  const suppliers: DashboardWorkItem[] = Object.entries(supplierTotals)
    .sort((left, right) => right[1].amount - left[1].amount)
    .slice(0, 6)
    .map(([supplier, value]) => ({
      title: supplier,
      module: "Supplier",
      detail: `${value.count} open bill${value.count === 1 ? "" : "s"}`,
      status: value.count > 2 ? "High concentration" : "Balanced",
      tone: value.count > 2 ? "amber" : "cyan",
      due: `${value.count} bill${value.count === 1 ? "" : "s"}`,
      amount: toNZD(value.amount),
    }))

  const candidateRows: DashboardWorkItem[] = activeData.invoiceCandidates
    .slice()
    .sort((left, right) => +new Date(right.created_at) - +new Date(left.created_at))
    .slice(0, 8)
    .map((candidate) => ({
      id: candidate.id,
      candidateId: candidate.id,
      title: candidate.supplier_name,
      module: candidate.invoice_number || "Unnumbered bill",
      detail: `${candidate.match_state === "manual_review" ? "Manual review" : candidate.match_state === "high" ? "Ready for Xero" : "Needs validation"} · ${candidate.currency}`,
      status: candidate.status === "written" ? "Posted" : candidate.status === "validated" ? "Ready" : candidate.status === "rejected" ? "Blocked" : "Review",
      tone: candidate.match_state === "high" ? "emerald" : candidate.match_state === "manual_review" ? "amber" : candidate.match_state === "blocked" ? "rose" : "cyan",
      due: candidate.invoice_date ? formatShortDate(candidate.invoice_date) : candidate.due_date ? formatShortDate(candidate.due_date) : "No invoice date",
      amount: toNZD(candidate.gross_total),
    }))

  const forecastTrend = latestForecasts.map((snapshot) => ({
    label: format(new Date(snapshot.snapshot_date), "dd MMM"),
    inflow: snapshot.projected_inflow,
    outflow: snapshot.projected_outflow,
  }))

  return {
    summary: {
      cashOnHand: latestSnapshot?.cash_balance ?? 0,
      apDue7Days: dueBuckets.due7,
      apDue30Days: dueBuckets.due30,
      monthBudget: budgetTotal,
      monthActual: actualTotal,
      monthForecast: forecastTotal,
      awaitingApproval: latestSnapshot?.awaiting_approval_count ?? activeData.xeroLinks.filter((link) => link.create_status === "submitted" || link.xero_status === "SUBMITTED").length,
      draftBills: latestSnapshot?.draft_bill_count ?? activeData.xeroLinks.filter((link) => link.create_status === "draft" || link.xero_status === "DRAFT").length,
      exceptions: latestSnapshot?.exception_count ?? activeData.intakeItems.filter((item) => ["exception", "failed"].includes(item.status)).length,
    },
    queue: queueItems,
    aging: [
      { label: "Current", amount: dueBuckets.due7, tone: "emerald" },
      { label: "1-30", amount: dueBuckets.due30, tone: "cyan" },
      { label: "31-60", amount: dueBuckets.age31_60, tone: "amber" },
      { label: "61-90", amount: dueBuckets.age61_90, tone: "rose" },
      { label: "90+", amount: dueBuckets.age90, tone: "violet" },
    ] as DashboardFinanceAgingPoint[],
    budgets: budgetRows,
    forecast: forecastTrend,
    suppliers,
    candidates: candidateRows,
    latestBatchStatus: activeData.intakeBatches[0]?.status ?? "queued",
  }
}

export function buildFinanceViewSnapshot(financeData: FinanceDashboardData | null): FinanceSnapshot {
  const base = buildFinanceSnapshot(financeData)

  return {
    ...base,
    lastUpdated: new Date(),
    batchStatusLabel: base.latestBatchStatus,
    mirrorHealthLabel: base.summary.exceptions > 0 ? "Review required" : "Healthy",
    // The finance page never substitutes demo figures. When the mirror has no rows at all,
    // the page shows an explicit empty state rather than a plausible-looking number.
    hasLiveData: Boolean(
      financeData &&
        (financeData.invoiceCandidates.length > 0 ||
          financeData.intakeItems.length > 0 ||
          financeData.budgets.length > 0 ||
          financeData.forecastSnapshots.length > 0 ||
          financeData.xeroLinks.length > 0),
    ),
  }
}
