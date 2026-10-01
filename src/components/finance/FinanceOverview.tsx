import { useEffect, useRef, useState, type DragEvent } from "react"
import { CloudDownload, FileUp, RefreshCw, Send, ShieldCheck, Wallet } from "lucide-react"
import { Button } from "../ui/button"
import { TableBadge } from "../ui/TableBadge"
import { useToast } from "../ui/useToast"
import { cn } from "../../utils/cn"
import { isSupabaseConfigured, supabase } from "../../lib/supabaseClient"
import { enqueueFinanceIntakeItem, processFinanceIntakeQueue, reprocessFinanceIntakeItem, recordFinanceCandidateEdit, uploadFinanceIntakeAttachment } from "../../lib/api/supabaseApi"
import type { DashboardTrendPoint, DashboardWorkItem, FinanceSnapshot } from "../dashboard/types"
import { BarChart, LineChart, PanelHeading, RefreshControl, SectionCard, WorkList } from "../dashboard/blocks"
import { StatisticCard, StatisticGrid } from "../ui/StatisticCard"
import { freshnessFrom } from "../dashboard/freshness"
import { formatCount, formatNZD } from "../../lib/format"
import { extractErrorMessage } from "../../utils/errorMessage"
const EDITABLE_FIELDS: Array<{ name: string; label: string; type: "text" | "number" | "date" }> = [
  { name: "supplierName", label: "Supplier name", type: "text" },
  { name: "invoiceNumber", label: "Invoice number", type: "text" },
  { name: "invoiceDate", label: "Invoice date", type: "date" },
  { name: "dueDate", label: "Due date", type: "date" },
  { name: "subtotal", label: "Subtotal (GST exclusive)", type: "number" },
  { name: "taxTotal", label: "GST amount", type: "number" },
  { name: "grossTotal", label: "Total (GST inclusive)", type: "number" },
]

type ConsumedNumber = {
  candidateId: string
  supplier: string | null
  invoiceNumber: string | null
  xeroStatus: string | null
  xeroUrl: string | null
}

type FinanceOverviewProps = {
  snapshot: FinanceSnapshot | null
  loading: boolean
  /** True when the viewer may ingest, correct, or post. Read-only roles get the report only. */
  canManage?: boolean
  onRefresh?: () => Promise<void>
}

const inputClassName =
  "mt-1 w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-foreground)] outline-none focus:border-[var(--color-primary)] disabled:opacity-60"

function SplitScreenReview({
  item,
  onClose,
  onSaveCorrection,
  onReprocess,
  correctionDraft,
  setCorrectionDraft,
  isSaving,
  isReprocessing,
  canManage,
}: {
  item: DashboardWorkItem
  onClose: () => void
  onSaveCorrection: (event: React.FormEvent) => Promise<void>
  onReprocess: () => void
  correctionDraft: Record<string, string>
  setCorrectionDraft: React.Dispatch<React.SetStateAction<Record<string, string>>>
  isSaving: boolean
  isReprocessing: boolean
  canManage: boolean
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [pdfLoading, setPdfLoading] = useState(true)

  useEffect(() => {
    if (!item.storagePath) {
      setPdfError("No source document available")
      setPdfLoading(false)
      return
    }

    setPdfLoading(true)
    setPdfError(null)

    // Create a signed URL for the PDF. Manual uploads live in the
    // finance-intake-attachments bucket; Gmail messages are fetched directly
    // from the Gmail API, so this only ever resolves storage-backed items.
    supabase?.storage
      .from("finance-intake-attachments")
      .createSignedUrl(item.storagePath, 60 * 60)
      .then(({ data, error }) => {
        if (error || !data?.signedUrl) {
          setPdfError("Failed to load document")
        } else {
          setPdfUrl(data.signedUrl)
        }
        setPdfLoading(false)
      })
  }, [item.storagePath])

  function hasValidationWarning(fieldName: string): boolean {
    if (!item.validationErrorsRaw) return false
    const warnings = item.validationErrorsRaw as unknown as Array<{ field?: string; rule?: string }>
    return warnings.some((warning) => warning?.field === fieldName || warning?.rule?.includes(fieldName))
  }

  function getValidationWarning(fieldName: string): string | null {
    if (!item.validationErrorsRaw) return null
    const warnings = item.validationErrorsRaw as unknown as Array<{ field?: string; rule?: string; message?: string }>
    const warning = warnings.find((entry) => entry?.field === fieldName || entry?.rule?.includes(fieldName))
    return warning?.message ?? null
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--color-foreground)]">{item.title}</p>
          <p className="truncate text-xs text-[var(--color-muted-foreground)]">
            {item.module} · {item.detail}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? <TableBadge tone={item.validationErrorsRaw ? "amber" : "emerald"}>{item.validationErrorsRaw ? "Has warnings" : "Validated"}</TableBadge> : null}
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Close review
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-secondary)] overflow-hidden">
          <div className="border-b border-[var(--color-border)] px-4 py-2">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">Source document</p>
          </div>
          <div className="relative aspect-[4/3] min-h-[480px]">
            {pdfLoading ? (
              <div className="flex h-full items-center justify-center text-[var(--color-muted-foreground)]">Loading document...</div>
            ) : pdfError ? (
              <div className="flex h-full flex-col items-center justify-center p-4 text-center text-[var(--color-destructive)]">
                {pdfError}
                {item.storagePath ? <p className="mt-2 text-xs">Path: {item.storagePath}</p> : null}
              </div>
            ) : pdfUrl ? (
              <iframe src={pdfUrl} className="absolute inset-0 h-full w-full border-0" title={`Source document for ${item.title}`} />
            ) : (
              <div className="flex h-full items-center justify-center text-[var(--color-muted-foreground)]">No document available</div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-secondary)] p-4">
          <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">Extracted data</p>

          <form className="mt-3 space-y-3" onSubmit={onSaveCorrection}>
            {EDITABLE_FIELDS.map((field) => {
              const warning = getValidationWarning(field.name)
              const hasWarning = hasValidationWarning(field.name)
              const fieldId = `review-${item.id ?? "item"}-${field.name}`

              return (
                <div key={field.name} className={cn("space-y-1", hasWarning && "rounded-xl p-2 ring-1 ring-[var(--color-warning)]")}>
                  <label htmlFor={fieldId} className={cn("block text-xs font-medium", hasWarning ? "text-[var(--color-warning)]" : "text-[var(--color-muted-foreground)]")}>
                    {field.label}
                  </label>
                  <input
                    id={fieldId}
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                    step={field.type === "number" ? "0.01" : undefined}
                    value={correctionDraft[field.name] ?? ""}
                    onChange={(event) => setCorrectionDraft((prev) => ({ ...prev, [field.name]: event.target.value }))}
                    className={cn(inputClassName, hasWarning && "border-[var(--color-warning)]")}
                    disabled={!canManage}
                  />
                  {warning ? <p className="text-xs text-[var(--color-warning)]">{warning}</p> : null}
                </div>
              )
            })}

            {canManage ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-[var(--color-border)] pt-3">
                <Button type="submit" size="sm" disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save correction"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={onReprocess} disabled={isReprocessing}>
                  {isReprocessing ? "Re-reading..." : "Re-read invoice"}
                </Button>
              </div>
            ) : (
              <p className="border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-muted-foreground)]">
                Read-only access. Correcting an extraction requires a finance admin role.
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}

function IngestPanel({
  canManage,
  isUploading,
  isPulling,
  isPosting,
  isDragging,
  queueDepth,
  inputRef,
  onBrowse,
  onDrop,
  onDragOver,
  onDragLeave,
  onFiles,
  onGmailPull,
  onPost,
}: {
  canManage: boolean
  isUploading: boolean
  isPulling: boolean
  isPosting: boolean
  isDragging: boolean
  uploadNote: string | null
  inputRef: React.RefObject<HTMLInputElement | null>
  onBrowse: () => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onFiles: (files: FileList | File[]) => void
  onGmailPull: () => void
  onPost: () => void
  queueDepth: number
}) {
  if (!canManage) {
    return (
      <div className="flex min-h-28 flex-col items-center justify-center rounded-2xl bg-[var(--color-secondary)] px-4 py-6 text-center">
        <ShieldCheck className="size-5 text-[var(--color-muted-foreground)]" />
        <p className="mt-2 text-sm font-semibold text-[var(--color-foreground)]">Read-only finance access</p>
        <p className="mt-1 max-w-lg text-sm text-[var(--color-muted-foreground)]">
          You can review the finance mirror, the intake queue, and every extracted bill. Uploading invoices, pulling from Gmail, correcting extractions, and posting to Xero require a finance admin role.
        </p>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed px-4 py-6 text-center transition-colors",
        isDragging
          ? "border-[color-mix(in_srgb,var(--color-primary)_45%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-primary)_12%,var(--color-secondary))]"
          : "border-[color-mix(in_srgb,var(--color-primary)_25%,var(--color-border))] bg-[var(--color-secondary)]",
        isUploading && "opacity-80",
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onBrowse}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onBrowse()
        }
      }}
      aria-label="Upload finance invoice files"
    >
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple
        accept=".pdf,.png,.jpg,.jpeg,.heic,.tif,.tiff,.eml,.msg"
        onChange={(event) => {
          if (event.target.files) onFiles(event.target.files)
        }}
      />
      <div className="flex items-center gap-2 text-sm font-semibold text-[var(--color-foreground)]">
        <FileUp className="size-4" />
        Drop invoice files here
      </div>
      <p className="mt-1 max-w-lg text-sm text-[var(--color-muted-foreground)]">
        {queueDepth > 0
          ? `${formatCount(queueDepth)} item${queueDepth === 1 ? "" : "s"} already waiting in the intake lane.`
          : "The intake lane is clear. Manual uploads and Gmail invoices share the same queue, duplicate fingerprinting, and review path."}
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onBrowse() }}>
          Choose files
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={(event) => { event.stopPropagation(); onGmailPull() }} disabled={isPulling}>
          <CloudDownload className="size-4" />
          {isPulling ? "Pulling Gmail..." : "Pull Gmail invoices"}
        </Button>
        <Button type="button" size="sm" onClick={(event) => { event.stopPropagation(); onPost() }} disabled={isPosting}>
          <Send className="size-4" />
          {isPosting ? "Posting to Xero..." : "Send to Xero"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">Accepted: PDF, images, and raw email exports. Stored in Supabase Storage.</p>
    </div>
  )
}

export function FinanceOverview({ snapshot, loading, canManage = false, onRefresh }: FinanceOverviewProps) {
  const toast = useToast()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [isPulling, setIsPulling] = useState(false)
  const [isPosting, setIsPosting] = useState(false)
  const [uploadNote, setUploadNote] = useState<string | null>(null)
  // Bills whose number Xero has permanently consumed. They cannot be posted until the
  // user supplies a replacement number, which is deliberate: inventing one would put an
  // identifier in the ledger that never existed in the supplier's system.
  const [consumedNumbers, setConsumedNumbers] = useState<ConsumedNumber[]>([])
  const [numberReplacements, setNumberReplacements] = useState<Record<string, string>>({})
  const [editableCandidateId, setEditableCandidateId] = useState<string | null>(null)
  const [correctionDraft, setCorrectionDraft] = useState<Record<string, string>>({})
  const [isSavingCorrection, setIsSavingCorrection] = useState(false)
  const [reviewQueueItem, setReviewQueueItem] = useState<DashboardWorkItem | null>(null)
  const [isReprocessing, setIsReprocessing] = useState(false)
  // The freshness readout re-evaluates on a timer so a tab left open does not keep
  // claiming the mirror is current.
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])

  // The extraction pipeline runs as a background job, so the client never holds a polling
  // loop open. Anything that lands in the intake lane (Gmail pull, manual upload, or a
  // background worker finishing a batch) is reflected here via Supabase Realtime instead
  // of a setTimeout loop, which means a tab closing or a network blip cannot strand an
  // item in an intermediate state.
  //
  // finance_intake_jobs is subscribed to as well as the item and candidate tables: a retry
  // promoted by the pg_cron drain, or a job parked in failed_review after three attempts,
  // changes no item row that this page would otherwise see.
  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) return
    const client = supabase

    // A single extraction writes to the job, the candidate, the run, the item and the log
    // in quick succession. Without coalescing, one invoice would trigger five full
    // refetches. The trailing debounce collapses a burst into one refresh.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false

    const scheduleRefresh = () => {
      if (disposed || refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        if (!disposed) void onRefresh?.()
      }, 400)
    }

    const channel = client
      .channel("finance_intake_overview")
      .on("postgres_changes", { event: "*", schema: "public", table: "finance_intake_items" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "finance_invoice_candidates" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "finance_xero_links" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "finance_intake_jobs" }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "finance_intake_logs" }, scheduleRefresh)
      .subscribe()

    return () => {
      disposed = true
      if (refreshTimer) clearTimeout(refreshTimer)
      client.removeChannel(channel)
    }
  }, [onRefresh])

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((file) => file.size > 0)
    if (list.length === 0) return

    setIsUploading(true)
    setUploadNote(`Uploading ${list.length} file${list.length === 1 ? "" : "s"} into the finance queue.`)

    try {
      for (const file of list) {
        const { storagePath, sourceFingerprint } = await uploadFinanceIntakeAttachment(file)
        await enqueueFinanceIntakeItem({
          source: "manual_upload",
          sourceType: "manual_upload",
          sourceFingerprint,
          sourceLabel: file.name,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          storagePath,
          itemCount: 1,
          batchStatus: "queued",
          status: "pending",
          confidence: 0,
          duplicateRisk: "unknown",
          metadata: {
            uploadedFrom: "finance-page",
            size: file.size,
            lastModified: file.lastModified,
          },
        })
      }

      toast.success("Uploaded to finance queue", `${list.length} file${list.length === 1 ? "" : "s"} are now waiting in the intake lane.`)
      setUploadNote(`Queued ${list.length} file${list.length === 1 ? "" : "s"} for extraction.`)
      await processFinanceIntakeQueue({ action: "process" })
      await onRefresh?.()
    } catch (error) {
      const message = extractErrorMessage(error)
      toast.error("Finance upload failed", message)
      setUploadNote(message)
    } finally {
      setIsUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  async function handleGmailPull() {
    setIsPulling(true)
    setUploadNote("Pulling Gmail invoices into the finance queue.")

    try {
      const result = await processFinanceIntakeQueue({ action: "sync_gmail" })
      const messageCount = Number((result as { messageCount?: number } | null)?.messageCount ?? 0)

      toast.success("Gmail pull started", `Imported ${messageCount} Gmail invoice message${messageCount === 1 ? "" : "s"}.`)
      setUploadNote(`Imported ${messageCount} Gmail invoice message${messageCount === 1 ? "" : "s"}. Extraction runs in the background; this page updates itself as each invoice lands.`)

      // Kick the background worker off once and let it drain the lane. The component does
      // not poll: Supabase Realtime fires onRefresh whenever an intake item, candidate, or
      // Xero link changes, so the UI reflects progress without a client-side loop holding
      // the request open.
      void processFinanceIntakeQueue({ action: "process" })
        .then((processResult) => {
          const processedCount = Array.isArray((processResult as { results?: unknown[] } | null)?.results)
            ? ((processResult as { results: unknown[] }).results).length
            : 0
          if (processedCount > 0) {
            setUploadNote(`Imported ${messageCount} Gmail invoice message${messageCount === 1 ? "" : "s"} and processed ${processedCount} invoice${processedCount === 1 ? "" : "s"} in the background.`)
          }
        })
        .catch((error) => console.warn("Background extraction failed:", error instanceof Error ? error.message : String(error)))

      await onRefresh?.()
    } catch (error) {
      const message = extractErrorMessage(error)
      toast.error("Gmail pull failed", message)
      setUploadNote(message)
    } finally {
      setIsPulling(false)
    }
  }

  async function handleXeroPost(candidateIds?: string[], invoiceNumberOverrides?: Record<string, string>) {
    setIsPosting(true)
    setUploadNote("Processing invoices for extraction...")
    try {
      let idsToPost = candidateIds ?? []

      if (!candidateIds) {
        const processResult = await processFinanceIntakeQueue({ action: "process" })
        const processResults = Array.isArray((processResult as { results?: unknown[] } | null)?.results)
          ? ((processResult as { results: Array<{ candidateId?: string }> }).results)
          : []

        const candidateIdsFromProcess = processResults.map((entry) => entry.candidateId).filter((id): id is string => Boolean(id))
        const existingCandidateIds = (snapshot?.candidates ?? [])
          .filter((candidate) => ["ready", "review", "posted"].includes(String(candidate.status).toLowerCase()))
          .map((candidate) => candidate.id)
          .filter((id): id is string => Boolean(id))

        idsToPost = [...new Set([...candidateIdsFromProcess, ...existingCandidateIds])]

        if (idsToPost.length === 0) {
          setUploadNote("No ready finance candidates are available for Xero yet. Pull Gmail invoices or upload a file first.")
          toast.error("Nothing to post", "No validated candidates are available for Xero yet.")
          return
        }
      }

      setUploadNote("Posting validated candidates to Xero.")
      const result = await processFinanceIntakeQueue({
        action: "post_xero",
        candidateIds: idsToPost,
        ...(invoiceNumberOverrides ? { invoiceNumberOverrides } : {}),
      })

      const summary = (result as
        | {
            summary?: {
              posted?: number
              linked?: number
              attention?: Array<{ candidateId?: string; supplier?: string | null; invoiceNumber?: string | null; status?: string; error?: string | null; xeroUrl?: string | null; xeroStatus?: string | null }>
            }
          }
        | null)?.summary

      // Surface the consumed numbers so a replacement can be supplied. These are held back
      // from the general attention list because they are fixable, not just reportable.
      const consumed = (summary?.attention ?? []).filter((entry) => entry.status === "number_consumed")
      if (consumed.length > 0) {
        setConsumedNumbers((previous) => {
          const merged = new Map(previous.map((entry) => [entry.candidateId, entry]))
          for (const entry of consumed) {
            if (entry.candidateId) {
              merged.set(entry.candidateId, {
                candidateId: entry.candidateId,
                supplier: entry.supplier ?? null,
                invoiceNumber: entry.invoiceNumber ?? null,
                xeroStatus: entry.xeroStatus ?? null,
                xeroUrl: entry.xeroUrl ?? null,
              })
            }
          }
          return [...merged.values()]
        })
        setNumberReplacements((previous) => {
          const next = { ...previous }
          for (const entry of consumed) {
            if (entry.candidateId && next[entry.candidateId] === undefined) next[entry.candidateId] = ""
          }
          return next
        })
      }

      // Every candidate is attempted before we get here, so a single bad invoice must not
      // discard the bills that were written successfully. Report the batch honestly.
      const writtenCount = (summary?.posted ?? 0) + (summary?.linked ?? 0)
      const attention = summary?.attention ?? []
      const writtenText = `${writtenCount} bill${writtenCount === 1 ? "" : "s"} written to Xero`
      const attentionText = attention
        .map((entry) => `${entry.supplier ?? "Invoice"}${entry.invoiceNumber ? ` ${entry.invoiceNumber}` : ""}: ${extractErrorMessage(entry.error) || entry.status || "failed"}`)
        .join("\n")

      if (writtenCount > 0) {
        if (attention.length > 0) {
          toast.warning("Xero posting finished with exceptions", `${writtenText}. ${attention.length} need attention:\n${attentionText}`)
        } else {
          toast.success("Xero posting complete", `Created ${writtenText}.`)
        }
      } else if (attention.length > 0) {
        toast.error("Xero posting failed", `${attention.length} invoice${attention.length === 1 ? "" : "s"} could not be written:\n${attentionText}`)
      } else {
        toast.success("Xero posting complete", "No validated candidates required writing to Xero.")
      }

      setUploadNote(attention.length > 0 ? `${writtenText}. ${attention.length} need attention: ${attentionText}` : writtenText)
      await onRefresh?.()
      return attention
    } catch (error) {
      const message = extractErrorMessage(error)
      toast.error("Xero posting failed", message)
      setUploadNote(message)
      return []
    } finally {
      setIsPosting(false)
    }
  }

  // Re-posts only the bills whose number Xero has consumed, under a number the user chose.
  // The original number travels with the bill in its Reference field, so renaming never
  // breaks the trail back to the supplier's document.
  async function handleRepostWithReplacementNumbers() {
    const overrides: Record<string, string> = {}
    for (const entry of consumedNumbers) {
      const replacement = (numberReplacements[entry.candidateId] ?? "").trim()
      if (replacement) overrides[entry.candidateId] = replacement
    }

    if (Object.keys(overrides).length === 0) {
      toast.error("No replacement numbers entered", "Enter a new invoice number for each bill before posting.")
      return
    }

    const attention = (await handleXeroPost(Object.keys(overrides), overrides)) ?? []

    // A bill only leaves the list when Xero accepted the replacement. One that is still
    // reported as number_consumed must stay on screen, or the user would lose the one row
    // that tells them which bill still needs a number.
    const stillBlocked = new Set(
      attention.filter((entry) => entry.status === "number_consumed").map((entry) => entry.candidateId).filter((id): id is string => Boolean(id)),
    )

    setConsumedNumbers((previous) =>
      previous.filter((entry) => !(entry.candidateId in overrides) || stillBlocked.has(entry.candidateId)),
    )
    setNumberReplacements((previous) => {
      const next = { ...previous }
      for (const id of Object.keys(overrides)) {
        if (!stillBlocked.has(id)) delete next[id]
      }
      return next
    })
  }

  async function handleSaveCorrection(event: React.FormEvent) {
    event.preventDefault()

    const targetId = reviewQueueItem?.candidateId ?? editableCandidateId
    if (!targetId) return

    setIsSavingCorrection(true)
    try {
      // Only fields the user actually touched are sent, so an untouched field is never
      // rewritten (and never logged as a diff) just because the form rendered it.
      const edits: Record<string, unknown> = {}
      for (const field of EDITABLE_FIELDS) {
        const raw = correctionDraft[field.name]
        if (raw === undefined) continue
        const trimmed = raw.trim()
        if (field.type === "number") {
          if (trimmed === "") continue
          const parsed = Number(trimmed)
          if (Number.isFinite(parsed)) edits[field.name] = parsed
          continue
        }
        edits[field.name] = trimmed === "" ? null : trimmed
      }

      if (Object.keys(edits).length === 0) {
        toast.error("Nothing to save", "Change at least one field before saving.")
        return
      }

      // No actor identity is sent. The edge function derives it from the verified
      // session and ignores any client-supplied actor, so a user cannot attribute a
      // correction to someone else.
      await recordFinanceCandidateEdit({ candidateId: targetId, edits })

      toast.success("Correction saved", "The change was recorded in the finance audit log.")
      setEditableCandidateId(null)
      setReviewQueueItem(null)
      setCorrectionDraft({})
      await onRefresh?.()
    } catch (error) {
      toast.error("Could not save the correction", extractErrorMessage(error))
    } finally {
      setIsSavingCorrection(false)
    }
  }

  async function handleReprocess() {
    const itemId = reviewQueueItem?.id ?? reviewQueueItem?.candidateId ?? null
    if (!itemId) {
      toast.error("No item to re-read", "This queue item has no intake id to reprocess.")
      return
    }

    setIsReprocessing(true)
    try {
      const result = (await reprocessFinanceIntakeItem(itemId)) as { ok?: boolean; message?: string } | null
      if (result?.ok) {
        toast.success("Re-read queued", "The invoice will be re-extracted and the review panel refreshed once the worker finishes.")
        await onRefresh?.()
      } else {
        toast.error("Re-read failed", result?.message ?? "Unknown error")
      }
    } catch (error) {
      toast.error("Re-read failed", extractErrorMessage(error))
    } finally {
      setIsReprocessing(false)
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    if (event.dataTransfer.files.length > 0) {
      void handleFiles(event.dataTransfer.files)
    }
  }

  if (loading || !snapshot) {
    return <FinanceLoadingState />
  }

  const { summary, queue, aging, budgets, forecast, suppliers, candidates } = snapshot
  const forecastData: DashboardTrendPoint[] = forecast.map((point) => ({ label: point.label, value: point.inflow - point.outflow }))
  const agingData: DashboardTrendPoint[] = aging.map((point) => ({ label: point.label, value: point.amount }))
  const editableCandidate = candidates.find((item) => item.candidateId === editableCandidateId) ?? null
  const budgetVariance = summary.monthActual - summary.monthBudget
  const freshness = freshnessFrom(snapshot.lastUpdated, now)
  // With an empty mirror every downstream block would read as a row of zeroes, which looks
  // like a real position rather than an absent one. Only Ingest is meaningful at that
  // point, so the rest of the page stays hidden until something actually exists.
  const hasReporting = snapshot.hasLiveData

  return (
    <div className="space-y-6">
      {!hasReporting ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-card)_92%,var(--color-secondary))] px-6 py-14 text-center">
          <Wallet className="size-6 text-[var(--color-muted-foreground)]" />
          <div>
            <p className="text-sm font-semibold text-[var(--color-foreground)]">No finance records mirrored yet</p>
            <p className="mt-1 max-w-xl text-sm text-[var(--color-muted-foreground)]">
              Position, review, billing, exposure, and budget appear here once invoices land in the intake lane and the extraction pipeline writes to the finance mirror. No placeholder values are shown in the meantime.
            </p>
          </div>
          {canManage ? (
            <Button type="button" size="sm" variant="outline" onClick={() => void handleGmailPull()} disabled={isPulling}>
              <CloudDownload className="size-4" />
              {isPulling ? "Pulling Gmail..." : "Pull Gmail invoices"}
            </Button>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-3">
        <PanelHeading
          step={1}
          title="Ingest"
          description="Bring invoices into the pipeline. Uploads and Gmail messages share one queue, one duplicate fingerprint, and one review lane."
          action={
            <div className="flex flex-wrap items-center gap-2">
              <TableBadge tone={snapshot.batchStatusLabel === "failed" ? "rose" : "slate"}>Batch: {snapshot.batchStatusLabel}</TableBadge>
              <TableBadge tone={freshness.tone}>{freshness.label}</TableBadge>
              <RefreshControl onRefresh={onRefresh} label="Refresh finance" />
            </div>
          }
        />
        <IngestPanel
          canManage={canManage}
          isUploading={isUploading}
          isPulling={isPulling}
          isPosting={isPosting}
          isDragging={isDragging}
          uploadNote={uploadNote}
          inputRef={inputRef}
          queueDepth={queue.length}
          onBrowse={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(event) => { event.preventDefault(); setIsDragging(true) }}
          onDragLeave={() => setIsDragging(false)}
          onFiles={(files) => void handleFiles(files)}
          onGmailPull={() => void handleGmailPull()}
          onPost={() => void handleXeroPost()}
        />
        {uploadNote ? <p className="text-sm text-[var(--color-muted-foreground)]">{uploadNote}</p> : null}

        {consumedNumbers.length > 0 ? (
          <SectionCard
            title="Invoice numbers already used in Xero"
            description="Xero permanently consumes an invoice number the first time it is used, even if that bill is later voided or deleted. Enter a replacement number to post these bills; the original number is kept on the bill for traceability."
          >
            <ul className="flex flex-col gap-3">
              {consumedNumbers.map((entry) => {
                const inputId = `xero-replacement-${entry.candidateId}`
                return (
                  <li key={entry.candidateId} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-secondary)] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-[var(--color-foreground)]">{entry.supplier ?? "Unnamed supplier"}</p>
                      <TableBadge tone="amber">{entry.xeroStatus ?? "used"}</TableBadge>
                    </div>
                    <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">
                      Invoice number <span className="font-medium text-[var(--color-foreground)]">{entry.invoiceNumber ?? "unknown"}</span> is already taken in Xero
                      {entry.xeroUrl ? (
                        <>
                          {" "}by{" "}
                          <a href={entry.xeroUrl} target="_blank" rel="noreferrer" className="font-medium text-[var(--color-primary)] underline">
                            that bill
                          </a>
                        </>
                      ) : null}
                      .
                    </p>
                    <label htmlFor={inputId} className="mt-3 block text-xs font-medium text-[var(--color-muted-foreground)]">
                      Replacement invoice number
                    </label>
                    <input
                      id={inputId}
                      type="text"
                      value={numberReplacements[entry.candidateId] ?? ""}
                      placeholder="e.g. 2-10009929258-2"
                      onChange={(event) => setNumberReplacements((previous) => ({ ...previous, [entry.candidateId]: event.target.value }))}
                      className={inputClassName}
                    />
                  </li>
                )
              })}
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button type="button" size="sm" onClick={() => void handleRepostWithReplacementNumbers()} disabled={isPosting}>
                {isPosting ? "Posting to Xero..." : "Post with these numbers"}
              </Button>
              <p className="text-xs text-[var(--color-muted-foreground)]">Only the bills above are re-sent.</p>
            </div>
          </SectionCard>
        ) : null}
      </section>

      {hasReporting ? (
        <>
      <section className="space-y-3">
        <PanelHeading
          step={2}
          title="Position"
          description="Mirror-backed NZD position. Every figure comes from the finance mirror; nothing here is estimated."
        />
        <StatisticGrid>
          <StatisticCard label="Cash on hand" value={formatNZD(summary.cashOnHand)} description="Latest forecast snapshot balance" tone="success" />
          <StatisticCard label="AP due 7 days" value={formatNZD(summary.apDue7Days)} description="Near-term payables" tone="warning" />
          <StatisticCard label="AP due 30 days" value={formatNZD(summary.apDue30Days)} description="Current liability window" tone="destructive" />
          {/* Spend and budget are separate cards rather than one "a / b" value.
              Two formatted amounts on one line cannot fit the narrowest grid
              cell at a legible size, and forcing them to would mean shrinking
              type below the 12px floor. See statistic-fit.test.ts. */}
          <StatisticCard
            label="MTD spend"
            value={formatNZD(summary.monthActual)}
            description={`Against ${formatNZD(summary.monthBudget)} budgeted`}
            tone={budgetVariance > 0 ? "warning" : "completed"}
          />
          <StatisticCard
            label="Budget variance"
            value={formatNZD(budgetVariance)}
            description={budgetVariance > 0 ? "Over the active budget lines" : "Within the active budget lines"}
            tone={budgetVariance > 0 ? "warning" : "completed"}
          />
          <StatisticCard label="Awaiting approval" value={formatCount(summary.awaitingApproval)} description="Bills routed for finance review" tone="pending" />
          <StatisticCard label="Draft bills" value={formatCount(summary.draftBills)} description="Written but not yet approved" tone="neutral" />
          <StatisticCard
            label="Exceptions"
            value={formatCount(summary.exceptions)}
            description="Bills held back for a decision"
            tone={summary.exceptions > 0 ? "destructive" : "neutral"}
          />
        </StatisticGrid>
      </section>

      <section className="space-y-3">
        <PanelHeading
          step={3}
          title="Review queue"
          description="Everything intake has delivered and finance still owns, newest first. A validation failure stays listed here rather than disappearing into a background job."
          action={<TableBadge tone={queue.length > 0 ? "amber" : "emerald"}>{formatCount(queue.length)} in queue</TableBadge>}
        />
        <SectionCard title="Intake queue" description="Gmail messages and manual uploads move through the same review lane.">
          <WorkList items={queue} onReview={(item) => { setReviewQueueItem(item); setCorrectionDraft({}) }} emptyMessage="The intake lane is clear. Pull Gmail invoices or upload a file to start." />
        </SectionCard>

        {reviewQueueItem ? (
          <SectionCard
            title={`Review: ${reviewQueueItem.title}`}
            description="Compare the source document with the extracted data. Edit any field the model read wrong; validation warnings are highlighted."
          >
            <SplitScreenReview
              item={reviewQueueItem}
              onClose={() => setReviewQueueItem(null)}
              onSaveCorrection={handleSaveCorrection}
              onReprocess={() => void handleReprocess()}
              correctionDraft={correctionDraft}
              setCorrectionDraft={setCorrectionDraft}
              isSaving={isSavingCorrection}
              isReprocessing={isReprocessing}
              canManage={canManage}
            />
          </SectionCard>
        ) : null}
      </section>

      <section className="space-y-3">
        <PanelHeading
          step={4}
          title="Billing"
          description="Bills that are validated and ready to write, or held back for a manual decision."
          action={
            canManage ? (
              <Button type="button" size="sm" onClick={() => void handleXeroPost()} disabled={isPosting}>
                <Send className="size-4" />
                {isPosting ? "Posting to Xero..." : "Post to Xero"}
              </Button>
            ) : (
              <TableBadge tone="slate">Read-only</TableBadge>
            )
          }
        />
        <SectionCard
          title="Validation queue"
          description="Ready to post, needs validation, or must stay in manual review."
          action={
            <div className="flex items-center gap-2">
              <TableBadge tone="emerald">{candidates.filter((item) => item.status === "Ready").length} ready</TableBadge>
              <TableBadge tone="amber">{candidates.filter((item) => item.status === "Review").length} in review</TableBadge>
            </div>
          }
        >
          <WorkList
            items={candidates}
            canEdit={canManage}
            onEdit={(item) => { setEditableCandidateId(item.candidateId ?? null); setCorrectionDraft({}) }}
            emptyMessage="No extracted bills are waiting for a billing decision."
          />
        </SectionCard>

        {editableCandidate ? (
          <SectionCard
            title={`Correct: ${editableCandidate.title}`}
            description="Fix a field the model read wrong. Every change is recorded as a before/after pair so extraction accuracy can be measured per field."
          >
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSaveCorrection}>
              {EDITABLE_FIELDS.map((field) => (
                <div key={field.name}>
                  <label htmlFor={`correction-${field.name}`} className="block text-xs font-medium text-[var(--color-muted-foreground)]">
                    {field.label}
                  </label>
                  <input
                    id={`correction-${field.name}`}
                    type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
                    step={field.type === "number" ? "0.01" : undefined}
                    value={correctionDraft[field.name] ?? ""}
                    onChange={(event) => setCorrectionDraft((previous) => ({ ...previous, [field.name]: event.target.value }))}
                    className={inputClassName}
                  />
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
                <Button type="submit" size="sm" variant="outline" disabled={isSavingCorrection}>
                  {isSavingCorrection ? "Saving..." : "Save correction"}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditableCandidateId(null)}>
                  Cancel
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => void handleXeroPost([editableCandidate.candidateId ?? ""])} disabled={isPosting || !editableCandidate.candidateId}>
                  <RefreshCw className="size-4" />
                  Post this bill
                </Button>
              </div>
            </form>
          </SectionCard>
        ) : null}
      </section>

      <section className="space-y-3">
        <PanelHeading step={5} title="Exposure" description="Who is owed money, for how long, and through which suppliers." />
        <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard title="AP aging" description="Open bill exposure by age bucket.">
            <BarChart
              data={agingData}
              seriesLabel={`Open bill exposure by age bucket, ${agingData.length} buckets`}
              unit="NZD exposure"
              tone="warning"
              formatValue={formatNZD}
              emptyMessage="No dated bills to age yet."
            />
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {aging.map((point) => (
                <div key={point.label} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-secondary)] px-3 py-2">
                  <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">{point.label}</dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--color-foreground)]">{formatNZD(point.amount)}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>

          <SectionCard title="Supplier concentration" description="Top suppliers by open bill exposure.">
            <WorkList items={suppliers} emptyMessage="No supplier exposure recorded yet." />
          </SectionCard>
        </div>
      </section>

      <section className="space-y-3">
        <PanelHeading step={6} title="Plan" description="Budget lines and the rolling cash forecast that sit behind the current position." />
        <div className="grid gap-4 xl:grid-cols-2">
          <SectionCard title="Budget vs actual" description="Active budget lines, ordered by the size of their variance.">
            <WorkList items={budgets} emptyMessage="No budget lines are mirrored yet." />
          </SectionCard>

          <SectionCard title="Cash forecast" description="Projected inflow less projected outflow across the last six snapshots.">
            <LineChart
              data={forecastData}
              seriesLabel={`Net cash position across ${forecastData.length} forecast snapshots`}
              unit="NZD net"
              formatValue={formatNZD}
              emptyMessage="No forecast snapshots have been written yet."
            />
          </SectionCard>
        </div>
      </section>

      <section className="space-y-3">
        <PanelHeading step={7} title="Mirror health" description="How fresh and how trustworthy the finance mirror is right now." />
        <StatisticGrid>
          <StatisticCard label="Latest batch" value={snapshot.batchStatusLabel} description="Status of the newest intake batch" tone={snapshot.batchStatusLabel === "failed" ? "destructive" : "information"} />
          <StatisticCard
            label="Mirror posture"
            value={snapshot.mirrorHealthLabel}
            description={summary.exceptions > 0 ? "Exceptions are held separately so drafts never look approved." : "No exceptions recorded in the mirror."}
            tone={summary.exceptions > 0 ? "warning" : "success"}
          />
          <StatisticCard label="Intake queue" value={formatCount(queue.length)} description="Items finance still owns" tone={queue.length > 0 ? "warning" : "neutral"} />
          <StatisticCard label="Bills awaiting approval" value={formatCount(summary.awaitingApproval)} description="Submitted to Xero and waiting on a decision" tone="pending" />
        </StatisticGrid>
      </section>
        </>
      ) : null}

      <SectionCard title="Read access" description="What this view is allowed to show and change.">
        <div className="flex flex-wrap items-center gap-2">
          <TableBadge tone={canManage ? "emerald" : "slate"}>{canManage ? "Can ingest, correct, and post" : "Read-only"}</TableBadge>
          <TableBadge tone="violet">NZD only</TableBadge>
          <TableBadge tone="cyan">Mirror-backed</TableBadge>
        </div>
        <p className="mt-3 text-sm text-[var(--color-muted-foreground)]">
          {canManage
            ? "Uploading invoices, pulling from Gmail, correcting extractions, and posting to Xero are enabled for your role. Every correction is written to an immutable audit log server-side."
            : "Reporting, the intake queue, and extracted bills are visible. Uploading, pulling from Gmail, correcting extractions, and posting to Xero are refused by the finance function for this role."}
        </p>
      </SectionCard>
    </div>
  )
}

function FinanceLoadingState() {
  return (
    <div className="space-y-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading the finance mirror</span>
      <section className="space-y-3">
        <div className="h-7 w-56 animate-pulse rounded-lg bg-[var(--color-surface-soft)] motion-reduce:animate-none" />
        <div className="h-40 animate-pulse rounded-2xl bg-[var(--color-surface-soft)] motion-reduce:animate-none" />
      </section>
      <section className="space-y-3">
        <div className="h-7 w-40 animate-pulse rounded-lg bg-[var(--color-surface-soft)] motion-reduce:animate-none" />
        <StatisticGrid>
          {[0, 1, 2, 3, 4, 5].map((slot) => (
            <div key={slot} className="h-[7.5rem] animate-pulse rounded-2xl bg-[var(--color-surface-soft)] motion-reduce:animate-none" />
          ))}
        </StatisticGrid>
      </section>
      <section className="space-y-3">
        <div className="h-7 w-48 animate-pulse rounded-lg bg-[var(--color-surface-soft)] motion-reduce:animate-none" />
        <div className="h-64 animate-pulse rounded-2xl bg-[var(--color-surface-soft)] motion-reduce:animate-none" />
      </section>
    </div>
  )
}
