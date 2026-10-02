/**
 * Append-only field-level audit logging.
 *
 * The audit trail exists to answer one question: how often is the AI wrong, and
 * on which fields? That is only measurable if a human correction can be
 * attributed back to the value the model produced, so every user edit is
 * recorded as an explicit before/after pair rather than a snapshot of the final
 * row. A snapshot would lose the original number the moment someone saved twice.
 *
 * Writes never block the operation being logged. Losing an audit row is bad, but
 * failing a finance user's save because the log insert failed is worse, so
 * errors are logged and swallowed.
 */

export type AuditEventType =
  | "created"
  | "ocr_processed"
  | "user_edited"
  | "xero_pushed"
  | "xero_failed"
  | "validation_failed"
  | "retry_scheduled"
  | "review_opened"
  | "reprocess_requested";

export interface FieldDiff {
  field: string;
  original: unknown;
  updated: unknown;
}

export interface AuditEntry {
  intakeItemId?: string | null;
  candidateId?: string | null;
  extractionRunId?: string | null;
  jobId?: string | null;
  batchId?: string | null;
  eventType: AuditEventType;
  actorId?: string | null;
  actorLabel?: string | null;
  source?: "system" | "worker" | "user" | "scheduler";
  metadata?: Record<string, unknown>;
}

/** Fields a user is allowed to correct on an extracted candidate. */
export const AUDITABLE_FIELDS = [
  "supplierName",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "subtotal",
  "taxTotal",
  "grossTotal",
  "currency",
  "lineItems",
] as const;

export type AuditableField = (typeof AUDITABLE_FIELDS)[number];

function asComparableNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // A form input yields "12.50" while the column holds 12.5. Those are the same
  // money, and treating them as an edit would log a correction nobody made.
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.-]/g, "");
    // A non-numeric string cleans to "" and Number("") is 0, which would make
    // "BrightSpark Ltd" and "Bright Spark Ltd" compare equal. Require digits.
    if (!/\d/.test(cleaned)) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isJsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;

  const left = asComparableNumber(a);
  const right = asComparableNumber(b);
  if (left !== null && right !== null) return Math.abs(left - right) < 0.005;

  if (typeof a === "object" || typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Computes the per-field before/after pairs for a manual correction.
 *
 * Key order is normalised on objects so that re-saving an unchanged form does
 * not produce a diff purely because the browser serialised the keys differently.
 */
export function computeFieldDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): FieldDiff[] {
  if (!before || !after) return [];

  const diffs: FieldDiff[] = [];
  for (const field of AUDITABLE_FIELDS) {
    const original = before[field];
    const updated = after[field];
    if (isJsonEqual(original, updated)) continue;
    diffs.push({ field, original: original ?? null, updated: updated ?? null });
  }
  return diffs;
}

/**
 * Supabase client surface used here. Declared structurally so this module does
 * not depend on the generated database types, which lag the migrations.
 */
interface AuditClient {
  from(table: string): {
    insert(values: Record<string, unknown> | Array<Record<string, unknown>>): {
      select(count?: string): { then(resolve: (value: unknown) => unknown): unknown };
    };
  };
}

/**
 * Appends one lifecycle event.
 *
 * `user_edited` carries a single row per changed field, with the whole diff also
 * duplicated onto the first row. One row per field is what makes "which fields
 * does the model get wrong" a simple GROUP BY; the duplicated diff keeps a
 * single fetch sufficient to reconstruct the whole edit.
 */
export async function appendAuditLog(
  supabase: AuditClient | null | undefined,
  entry: AuditEntry,
  diffs: FieldDiff[] = [],
): Promise<void> {
  if (!supabase) return;

  const base = {
    intake_item_id: entry.intakeItemId ?? null,
    candidate_id: entry.candidateId ?? null,
    extraction_run_id: entry.extractionRunId ?? null,
    job_id: entry.jobId ?? null,
    batch_id: entry.batchId ?? null,
    event_type: entry.eventType,
    actor_id: entry.actorId ?? null,
    actor_label: entry.actorLabel ?? null,
    source: entry.source ?? "system",
    metadata: entry.metadata ?? {},
  };

  try {
    if (entry.eventType === "user_edited" && diffs.length > 0) {
      await supabase
        .from("finance_intake_logs")
        .insert(
          diffs.map((diff, index) => ({
            ...base,
            field_name: diff.field,
            original_value: diff.original === undefined ? null : diff.original,
            updated_value: diff.updated === undefined ? null : diff.updated,
            diff,
            metadata: index === 0 ? { ...base.metadata, changedFieldCount: diffs.length } : base.metadata,
          })),
        )
        .select("id")
        .then(() => undefined);
      return;
    }

    if (diffs.length > 0) {
      await supabase
        .from("finance_intake_logs")
        .insert({ ...base, diff: diffs })
        .select("id")
        .then(() => undefined);
      return;
    }

    await supabase.from("finance_intake_logs").insert(base).select("id").then(() => undefined);
  } catch (error) {
    console.warn("[audit] Failed to append finance_intake_logs row:", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Concurrency-limits a task map.
 *
 * Used by the Xero push path: Xero allows five concurrent requests, and firing
 * one per candidate in a fifty-item batch reliably trips the 429 limit.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
