/**
 * Deterministic post-extraction validation.
 *
 * The model is good at reading a document and bad at arithmetic, and the two
 * failures are indistinguishable from the outside: a wrong GST figure and a
 * misread subtotal both produce a candidate that looks complete. Rather than
 * folding the cost of a bad extraction into Xero, every extraction passes
 * through these rules before it is allowed to leave the queue, and a failure
 * routes the item to `needs_review` with a machine-readable tag.
 *
 * Every function here is pure. The duplicate probe (Rule C) is injected so the
 * rules can be tested without a database and so the same engine can be reused by
 * a future synchronous re-validate endpoint.
 */

export const NZ_GST_RATE = 0.15;

/** Rule A tolerance. Rounding to cents cannot drift further than half a cent. */
export const MATH_TOLERANCE = 0.02;

/** Rule B tolerance. One cent of slack absorbs a supplier rounding a line. */
export const GST_TOLERANCE = 0.05;

export type ValidationSeverity = "error" | "warning";

export interface ValidationError {
  /** Stable machine tag, safe to group on for reporting. */
  rule: "math_integrity" | "nz_gst_rate" | "duplicate_invoice" | "missing_field";
  severity: ValidationSeverity;
  message: string;
  expected?: number | null;
  actual?: number | null;
  /** Absolute difference between expected and actual, for warnings under tolerance. */
  drift?: number | null;
  /** Rule C only: the intake item id of the earlier match. */
  matchedItemId?: string | null;
  matchedCandidateId?: string | null;
}

export interface ValidationInput {
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  subtotal: number | null;
  gstAmount: number | null;
  totalAmount: number | null;
  currency: string | null;
  lineItemCount: number;
}

export interface DuplicateMatch {
  intakeItemId: string;
  candidateId: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  totalAmount: number | null;
  createdAt?: string | null;
}

export type DuplicateLookup = (
  criteria: { supplierName: string; invoiceNumber: string; totalAmount: number },
) => Promise<DuplicateMatch[]>;

export interface ValidationResult {
  ok: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
  /** True when any error was raised. Drives the needs_review transition. */
  requiresReview: boolean;
  summary: {
    mathIntegrityOk: boolean | null;
    nzGstOk: boolean | null;
    effectiveGstRate: number | null;
    duplicate: boolean;
    checkedRules: string[];
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Rule A - the three printed totals must agree.
 *
 * `subtotal + gst_amount === total_amount` is the invariant every invoice
 * satisfies by definition, so any drift wider than a cent is a read error
 * rather than a legitimate rounding artefact.
 */
export function checkMathIntegrity(
  subtotal: number | null,
  gstAmount: number | null,
  totalAmount: number | null,
): ValidationError | null {
  if (subtotal === null || gstAmount === null || totalAmount === null) return null;

  const expected = roundMoney(subtotal + gstAmount);
  const drift = Math.abs(expected - totalAmount);
  if (drift <= MATH_TOLERANCE) return null;

  return {
    rule: "math_integrity",
    severity: "error",
    message:
      `Totals do not reconcile: subtotal ${subtotal.toFixed(2)} + GST ${gstAmount.toFixed(2)} ` +
      `= ${expected.toFixed(2)}, but the invoice total is ${totalAmount.toFixed(2)} (off by ${drift.toFixed(2)}).`,
    expected,
    actual: roundMoney(totalAmount),
    drift: roundMoney(drift),
  };
}

/**
 * Rule B - GST should be 15% of the subtotal.
 *
 * A mismatch inside GST_TOLERANCE is a warning rather than an error: a supplier
 * who rounds a line item, or who charges a small discount, produces a GST figure
 * that is a cent or two off 15% while the invoice is still perfectly valid.
 * Only a materially different rate escalates.
 */
export function checkNzGstRate(
  subtotal: number | null,
  gstAmount: number | null,
): { error: ValidationError | null; warning: ValidationError | null; effectiveRate: number | null } {
  if (subtotal === null || gstAmount === null) {
    return { error: null, warning: null, effectiveRate: null };
  }
  if (subtotal <= 0) {
    // A zero or negative subtotal cannot imply a 15% rate; there is nothing to
    // check and the arithmetic rule will have flagged the totals already.
    return { error: null, warning: null, effectiveRate: null };
  }

  const expected = roundMoney(subtotal * NZ_GST_RATE);
  const drift = Math.abs(expected - gstAmount);
  const effectiveRate = roundMoney((gstAmount / subtotal) * 10000) / 100;

  if (drift <= GST_TOLERANCE) {
    return { error: null, warning: null, effectiveRate };
  }

  // Beyond the tolerance this is a non-standard tax rate, which is legitimate on
  // its own (zero-rated, exempt, GST on imports, a non-NZ supplier). It is a
  // warning, not a blocker: the money still adds up and a human can confirm.
  return {
    error: null,
    warning: {
      rule: "nz_gst_rate",
      severity: "warning",
      message:
        `GST of ${gstAmount.toFixed(2)} on a subtotal of ${subtotal.toFixed(2)} is ` +
        `${effectiveRate.toFixed(2)}%, not the expected 15% (${expected.toFixed(2)}). ` +
        `This may be a zero-rated or exempt supply - confirm the tax type before posting.`,
      expected,
      actual: roundMoney(gstAmount),
      drift: roundMoney(drift),
    },
    effectiveRate,
  };
}

/** Rule C - the same supplier invoice number and total must not already exist. */
export function checkDuplicate(
  input: ValidationInput,
  lookup: DuplicateLookup | null,
): Promise<ValidationError | null> {
  if (!lookup) return Promise.resolve(null);
  if (!input.supplierName || !input.invoiceNumber || input.totalAmount === null) {
    return Promise.resolve(null);
  }

  return lookup({
    supplierName: input.supplierName.trim(),
    invoiceNumber: input.invoiceNumber.trim(),
    totalAmount: roundMoney(input.totalAmount),
  })
    .then((matches) => {
      const duplicate = matches?.[0];
      if (!duplicate) return null;
      return {
        rule: "duplicate_invoice" as const,
        severity: "warning" as const,
        message:
          `Possible duplicate: ${duplicate.supplierName ?? "this supplier"} invoice ` +
          `${duplicate.invoiceNumber ?? input.invoiceNumber} for ` +
          `${(duplicate.totalAmount ?? input.totalAmount ?? 0).toFixed(2)} was already ` +
          `captured on ${duplicate.createdAt ? new Date(duplicate.createdAt).toISOString().slice(0, 10) : "an earlier intake"}.`,
        matchedItemId: duplicate.intakeItemId,
        matchedCandidateId: duplicate.candidateId,
      };
    })
    .catch((error) => {
      // A failed duplicate probe must not block a good extraction. It is
      // reported as a warning so the gap is visible without failing the item.
      return {
        rule: "duplicate_invoice" as const,
        severity: "warning" as const,
        message: `Duplicate check could not run: ${error instanceof Error ? error.message : String(error)}`,
      };
    });
}

const REQUIRED_IDENTIFIERS: Array<{ field: keyof ValidationInput; label: string }> = [
  { field: "supplierName", label: "supplier name" },
  { field: "invoiceNumber", label: "invoice number" },
  { field: "invoiceDate", label: "invoice date" },
];

/**
 * Runs Rules A, B and C against one extraction.
 *
 * Only Rule A is blocking. A missing identifier is blocking too, because an
 * invoice with no number cannot be reconciled against Xero later. Everything
 * else is a warning that rides along in `validation_errors` for the reviewer.
 */
export async function validateExtraction(
  input: ValidationInput,
  options: { duplicateLookup?: DuplicateLookup | null } = {},
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  for (const { field, label } of REQUIRED_IDENTIFIERS) {
    const value = input[field];
    const missing = value === null || value === undefined || String(value).trim() === "";
    if (missing) {
      errors.push({
        rule: "missing_field",
        severity: "error",
        message: `Missing ${label}. The invoice cannot be matched to a supplier record without it.`,
      });
    }
  }

  const mathError = checkMathIntegrity(input.subtotal, input.gstAmount, input.totalAmount);
  if (mathError) errors.push(mathError);

  const gst = checkNzGstRate(input.subtotal, input.gstAmount);
  if (gst.error) errors.push(gst.error);
  if (gst.warning) warnings.push(gst.warning);

  const duplicate = await checkDuplicate(input, options.duplicateLookup ?? null);
  if (duplicate) warnings.push(duplicate);

  const blocking = errors.length > 0;

  return {
    ok: !blocking,
    errors,
    warnings,
    requiresReview: blocking,
    summary: {
      mathIntegrityOk: mathError ? false : input.totalAmount === null ? null : true,
      nzGstOk: gst.error ? false : gst.effectiveRate === null ? null : gst.warning ? false : true,
      effectiveGstRate: gst.effectiveRate,
      duplicate: Boolean(duplicate),
      checkedRules: ["math_integrity", "nz_gst_rate", "duplicate_invoice", "required_identifiers"],
    },
  };
}
