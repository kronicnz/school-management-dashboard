import { strict as assert } from "node:assert"
import {
  checkDuplicate,
  checkMathIntegrity,
  checkNzGstRate,
  validateExtraction,
  type ValidationInput,
} from "./validation.ts"
import {
  INVOICE_EXTRACTION_SCHEMA,
  buildExtractionGenerationConfig,
  isStrictExtractionShape,
  mapStrictExtractionToInternal,
} from "./gemini-schema.ts"
import {
  buildReplacementInvoiceNumber,
  chunkForXero,
  isInvoiceNumberCollision,
  XERO_BATCH_SIZE,
  XERO_MAX_CONCURRENT,
  XERO_MAX_PER_MINUTE,
  XeroRateLimiter,
} from "./xero-client.ts"
import { computeFieldDiff, mapWithConcurrency } from "./audit.ts"

function baseInput(overrides: Partial<ValidationInput> = {}): ValidationInput {
  return {
    supplierName: "BrightSpark Ltd",
    invoiceNumber: "BS-2041",
    invoiceDate: "2026-09-03",
    subtotal: 1200,
    gstAmount: 180,
    totalAmount: 1380,
    currency: "NZD",
    lineItemCount: 1,
    ...overrides,
  }
}

// --- Task 2: strict structured output -----------------------------------------

Deno.test("strict schema requires the key financial identifiers", () => {
  const required = INVOICE_EXTRACTION_SCHEMA.required as readonly string[]
  for (const field of ["supplier_name", "invoice_number", "subtotal", "gst_amount", "total_amount", "currency"]) {
    assert.ok(required.includes(field), `${field} must be required so an empty extraction cannot pass`)
  }
  assert.ok(!(INVOICE_EXTRACTION_SCHEMA.properties.currency as { enum: readonly string[] }).enum.includes("GBP"))
})

Deno.test("strict schema line items require the priced fields", () => {
  const lineSchema = INVOICE_EXTRACTION_SCHEMA.properties.line_items.items
  assert.deepEqual([...(lineSchema.required as readonly string[])].sort(), ["amount", "description", "quantity", "unit_price"])
})

Deno.test("generation config pins structured output and a deterministic temperature", () => {
  const config = buildExtractionGenerationConfig()
  assert.equal(config.responseMimeType, "application/json")
  assert.equal(config.responseSchema, INVOICE_EXTRACTION_SCHEMA)
  // A retry must reproduce the same numbers, or the backoff loop oscillates.
  assert.equal(config.temperature, 0)
})

Deno.test("strict extraction maps snake_case into the internal camelCase shape", () => {
  const mapped = mapStrictExtractionToInternal({
    supplier_name: "BrightSpark Ltd",
    gst_number: "123-456-789",
    invoice_number: "BS-2041",
    invoice_date: "2026-09-03",
    due_date: "2026-09-17",
    subtotal: 1200,
    gst_amount: 180,
    total_amount: 1380,
    currency: "NZD",
    line_items: [{ description: "Docking station", quantity: 2, unit_price: 600, amount: 1200, account_code: "" }],
  })

  assert.equal(mapped.supplierName, "BrightSpark Ltd")
  assert.equal(mapped.supplierTaxNumber, "123-456-789")
  assert.equal(mapped.grossTotal, 1380)
  assert.equal(mapped.taxTotal, 180)
  // An absent GL code must stay null so the default account code is applied.
  assert.equal((mapped.lineItems as Array<Record<string, unknown>>)[0].accountCode, null)
  assert.equal((mapped.lineItems as Array<Record<string, unknown>>)[0].unitAmount, 600)
})

Deno.test("strict extraction normalises an unsupported currency to NZD", () => {
  assert.equal(mapStrictExtractionToInternal({ currency: "gbp" }).currency, "NZD")
  assert.equal(mapStrictExtractionToInternal({ currency: "AUD" }).currency, "AUD")
})

Deno.test("an empty required string becomes null so the repair pass still sees the gap", () => {
  const mapped = mapStrictExtractionToInternal({ supplier_name: "", invoice_number: "   " })
  assert.equal(mapped.supplierName, null)
  assert.equal(mapped.invoiceNumber, null)
})

Deno.test("strict shape detection distinguishes the strict schema from the legacy one", () => {
  assert.equal(isStrictExtractionShape({ supplier_name: "X" }), true)
  assert.equal(isStrictExtractionShape({ supplierName: "X" }), false)
})

// --- Task 3: deterministic validation -----------------------------------------

Deno.test("Rule A passes when subtotal plus GST equals the total", () => {
  assert.equal(checkMathIntegrity(1200, 180, 1380), null)
  // Half a cent of drift is within the tolerance.
  assert.equal(checkMathIntegrity(1200, 180, 1380.02), null)
})

Deno.test("Rule A flags a total that does not reconcile", () => {
  const error = checkMathIntegrity(1200, 180, 1500)
  assert.ok(error)
  assert.equal(error!.rule, "math_integrity")
  assert.equal(error!.severity, "error")
  assert.equal(error!.expected, 1380)
  assert.equal(error!.actual, 1500)
  assert.equal(error!.drift, 120)
})

Deno.test("Rule A is skipped when a total is missing entirely", () => {
  assert.equal(checkMathIntegrity(1200, 180, null), null)
})

Deno.test("Rule B passes at 15% and warns on a non-standard rate", () => {
  assert.equal(checkNzGstRate(1200, 180).warning, null)
  assert.equal(checkNzGstRate(1200, 180).effectiveRate, 15)

  const zeroRated = checkNzGstRate(1200, 0)
  assert.equal(zeroRated.error, null)
  assert.ok(zeroRated.warning, "a zero-rated supply is a warning, not a blocker")
  assert.equal(zeroRated.warning!.severity, "warning")

  // A one-cent rounding artefact is not worth flagging.
  assert.equal(checkNzGstRate(1000, 150.03).warning, null)
})

Deno.test("Rule C reports a duplicate on the supplier, number and total triple", async () => {
  const duplicate = await checkDuplicate(baseInput(), async (criteria) => [
    {
      intakeItemId: "item-1",
      candidateId: "candidate-1",
      supplierName: criteria.supplierName,
      invoiceNumber: criteria.invoiceNumber,
      totalAmount: criteria.totalAmount,
      createdAt: "2026-09-01T00:00:00Z",
    },
  ])

  assert.ok(duplicate)
  assert.equal(duplicate!.rule, "duplicate_invoice")
  assert.equal(duplicate!.severity, "warning")
  assert.equal(duplicate!.matchedItemId, "item-1")
})

Deno.test("Rule C stays quiet when nothing matches", async () => {
  assert.equal(await checkDuplicate(baseInput(), async () => []), null)
})

Deno.test("Rule C does not run without a number or a total", async () => {
  let called = false
  const lookup = async () => {
    called = true
    return []
  }
  assert.equal(await checkDuplicate(baseInput({ invoiceNumber: null }), lookup), null)
  assert.equal(await checkDuplicate(baseInput({ totalAmount: null }), lookup), null)
  assert.equal(called, false)
})

Deno.test("a failed duplicate probe warns but never blocks the extraction", async () => {
  const result = await validateExtraction(baseInput(), {
    duplicateLookup: async () => {
      throw new Error("relation unavailable")
    },
  })

  assert.equal(result.requiresReview, false)
  assert.ok(result.warnings.some((warning) => warning.rule === "duplicate_invoice"))
})

Deno.test("a reconciling invoice passes with no errors", async () => {
  const result = await validateExtraction(baseInput())
  assert.equal(result.ok, true)
  assert.equal(result.requiresReview, false)
  assert.equal(result.summary.mathIntegrityOk, true)
  assert.equal(result.summary.nzGstOk, true)
  assert.equal(result.summary.effectiveGstRate, 15)
})

Deno.test("a failed reconciliation routes the item to review", async () => {
  // 1200 + 12 = 1212, but the invoice says 1215.
  const result = await validateExtraction(baseInput({ gstAmount: 12, totalAmount: 1215 }))
  assert.equal(result.ok, false)
  assert.equal(result.requiresReview, true)
  assert.equal(result.summary.mathIntegrityOk, false)
  assert.ok(result.errors.some((error) => error.rule === "math_integrity"))
})

Deno.test("a missing invoice number is blocking", async () => {
  const result = await validateExtraction(baseInput({ invoiceNumber: null }))
  assert.equal(result.requiresReview, true)
  assert.ok(result.errors.some((error) => error.rule === "missing_field" && error.message.includes("invoice number")))
})

// --- Task 4: Xero batching, rate limits and collisions -------------------------

Deno.test("invoice number collisions are detected from the code and the message", () => {
  assert.equal(isInvoiceNumberCollision('{"ErrorNumber":"ERROR-INVOICE-NUMBER-EXISTS"}'), true)
  assert.equal(isInvoiceNumberCollision("Invoice number 1001 already exists"), true)
  assert.equal(isInvoiceNumberCollision("Invoice number 1001 is in use"), true)
  assert.equal(isInvoiceNumberCollision("Account code 400 is invalid"), false)
  assert.equal(isInvoiceNumberCollision(""), false)
})

Deno.test("a replacement number keeps the original as its prefix and stays within the length cap", () => {
  const now = new Date("2026-09-29T00:00:00Z")
  const replacement = buildReplacementInvoiceNumber("2-10009929258", { now })
  assert.ok(replacement)
  assert.ok(replacement!.startsWith("2-10009929258"), "the original must stay intact and legible")
  assert.notEqual(replacement, "2-10009929258")
  assert.ok(replacement!.length <= 20, `Xero caps InvoiceNumber at 20 characters, got ${replacement}`)

  // A long original shortens the suffix rather than the number itself.
  const long = buildReplacementInvoiceNumber("INV-2026-0001234567", { now })
  assert.ok(long!.startsWith("INV-2026-0001234567"))
  assert.ok(long!.length <= 20)

  // When the original cannot fit at all, no number is invented.
  assert.equal(buildReplacementInvoiceNumber("X".repeat(25), { now }), null)
})

Deno.test("a replacement number is not produced for a blank original", () => {
  const now = new Date("2026-09-29T00:00:00Z")
  assert.equal(buildReplacementInvoiceNumber(""), null)
  assert.equal(buildReplacementInvoiceNumber(null), null)
  // Xero identifiers cannot contain quotes, so they are stripped before the suffix.
  assert.equal(buildReplacementInvoiceNumber('  "quoted"  ', { now }), "quoted-R260929")
  assert.equal(buildReplacementInvoiceNumber('  "quoted"  ', { now, maxLength: 8 }), "quoted")
})

Deno.test("batches are capped at 50 items per pass", () => {
  const items = Array.from({ length: 120 }, (_, index) => index)
  const chunks = chunkForXero(items)
  assert.equal(chunks.length, 3)
  assert.deepEqual(chunks.map((chunk) => chunk.length), [50, 50, 20])
  assert.equal(XERO_BATCH_SIZE, 50)
  assert.equal(XERO_MAX_CONCURRENT, 5)
  // Order is preserved across chunks so the UI summary stays stable.
  assert.deepEqual(chunks.flat(), items)
})

Deno.test("the worker pool never exceeds the concurrency cap and keeps input order", async () => {
  let inFlight = 0
  let peak = 0
  const results = await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 5, async (value) => {
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 1))
    inFlight -= 1
    return value * 2
  })

  assert.equal(peak, 5)
  assert.deepEqual(results, Array.from({ length: 20 }, (_, i) => i * 2))
})

Deno.test("the rate limiter caps concurrency at five and releases every slot", async () => {
  const limiter = new XeroRateLimiter()
  let inFlight = 0
  let peak = 0

  await mapWithConcurrency(Array.from({ length: 14 }, (_, i) => i), 14, async (value) => {
    await limiter.acquire()
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 2))
    inFlight -= 1
    limiter.releaseSlot()
    return value
  })

  assert.equal(peak, XERO_MAX_CONCURRENT)
  // No leaked slots: a saturated limiter would leave active > 0 here.
  assert.deepEqual(limiter.snapshot(), { active: 0, lastMinute: 14 })
  assert.ok(14 <= XERO_MAX_PER_MINUTE)
})

// --- Task 5: field-level audit diffs ------------------------------------------

Deno.test("a correction logs only the fields that actually changed", () => {
  const diffs = computeFieldDiff(
    { supplierName: "BrightSpark Ltd", taxTotal: 12.5, invoiceNumber: "BS-2041" },
    { supplierName: "Bright Spark Ltd", taxTotal: 15, invoiceNumber: "BS-2041" },
  )

  assert.equal(diffs.length, 2)
  const gst = diffs.find((diff) => diff.field === "taxTotal")
  assert.equal(gst?.original, 12.5)
  assert.equal(gst?.updated, 15)
})

Deno.test("an unchanged field is not logged as a correction", () => {
  // The form sends "12.50" and the column holds 12.5 - the same money, not an edit.
  const diffs = computeFieldDiff(
    { supplierName: "BrightSpark Ltd", taxTotal: 12.5 },
    { supplierName: "BrightSpark Ltd", taxTotal: "12.50" as unknown as number },
  )
  assert.deepEqual(diffs, [])
})

Deno.test("clearing a field is recorded, and a non-auditable field is ignored", () => {
  assert.deepEqual(computeFieldDiff({ dueDate: null }, { dueDate: "2026-10-01" }), [
    { field: "dueDate", original: null, updated: "2026-10-01" },
  ])
  assert.deepEqual(computeFieldDiff({ dueDate: "2026-10-01" }, { dueDate: null }), [
    { field: "dueDate", original: "2026-10-01", updated: null },
  ])
  // "reference" is carried inside extraction_payload, not an auditable column, so a
  // change to it must not fabricate a diff row.
  assert.deepEqual(computeFieldDiff({ reference: "PO-1" as never }, { reference: "PO-2" as never }), [])
})
