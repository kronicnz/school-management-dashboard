type AnyRecord = Record<string, any>

type FieldObservation = {
  field_name: string
  field_value: unknown
  source_processor: string
  confidence: number
  source_page: number | null
  bounding_box: AnyRecord | null
  evidence_text: string | null
}

type StatusDecision = {
  status: "submitted" | "draft" | "review" | "exception"
  severity: "info" | "warning" | "error"
  failureReason: string | null
}

type HybridResolution = {
  candidatePayload: AnyRecord
  extractionRunPayload: AnyRecord
  fieldObservations: FieldObservation[]
  decision: StatusDecision
  resolvedFields: AnyRecord
  validationFlags: AnyRecord
  processorChain: string[]
}

function sanitizeInvoiceText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\\/g, " ")
    .replace(/[\u2028\u2029]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function parseAmount(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null
  }

  if (value === null || value === undefined || value === "") return null

  const parsed = Number(String(value).replace(/[^0-9.-]/g, ""))
  return Number.isFinite(parsed) ? parsed : null
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

function pad2(value: number) {
  return String(value).padStart(2, "0")
}

export function parseDateString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)

  const raw = String(value).trim()
  if (!raw) return null

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  const ymd = raw.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})/)
  if (ymd) return `${ymd[1]}-${pad2(Number(ymd[2]))}-${pad2(Number(ymd[3]))}`

  const dmy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)
  if (dmy) {
    let year = Number(dmy[3])
    if (dmy[3].length === 2) year += year >= 70 ? 1900 : 2000
    const a = Number(dmy[1])
    const b = Number(dmy[2])
    const day = a > 12 ? a : b > 12 ? b : a
    const month = a > 12 ? b : b > 12 ? a : b
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`
    }
  }

  const monthName = raw.toLowerCase().match(/([a-z]{3,9})/)
  const yearMatch = raw.match(/\d{4}/)
  if (monthName && MONTHS[monthName[1]] && yearMatch) {
    const day = raw.match(/\d{1,2}/g)?.map(Number).find((n) => n !== Number(yearMatch[0]) && n >= 1 && n <= 31)
    if (day !== undefined) return `${yearMatch[0]}-${pad2(MONTHS[monthName[1]])}-${pad2(day)}`
  }

  const fallback = new Date(raw)
  if (!Number.isNaN(fallback.getTime())) return fallback.toISOString().slice(0, 10)
  return null
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

const VALID_TAX_TYPES = new Set([
  "INPUT", "INPUT2", "OUTPUT", "OUTPUT2", "NONE", "GSTONIMPORTS", "ZERO", "EXEMPTOUTPUT", "EXEMPTINPUT",
])

function sanitizeTaxType(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/[\s-]/g, "")
  return VALID_TAX_TYPES.has(normalized) ? normalized : "INPUT2"
}

function normalizeLineItem(lineItem: AnyRecord) {
  const description = sanitizeInvoiceText(String(lineItem?.Description ?? lineItem?.description ?? lineItem?.name ?? lineItem?.item ?? ""))
  const parsedQuantity = parseAmount(lineItem?.Quantity ?? lineItem?.quantity ?? 1) ?? 1
  const quantity = parsedQuantity > 0 ? parsedQuantity : 1
  const unitAmount = parseAmount(
    lineItem?.UnitAmount ?? lineItem?.unitAmount ?? lineItem?.unit_amount ?? lineItem?.Price ?? lineItem?.price ?? lineItem?.Rate ?? lineItem?.rate ?? lineItem?.Amount ?? lineItem?.amount
  )
  const lineAmount = parseAmount(lineItem?.LineAmount ?? lineItem?.lineAmount ?? lineItem?.line_amount)
  const taxType = sanitizeTaxType(lineItem?.TaxType ?? lineItem?.taxType)
  const rawAccountCode = String(lineItem?.AccountCode ?? lineItem?.accountCode ?? lineItem?.account_code ?? "").replace(/[\s-]/g, "").trim()
  const accountCode = /^\d{3,6}$/.test(rawAccountCode) ? rawAccountCode : null

  if (!description && unitAmount === null && lineAmount === null) {
    return null
  }

  const resolvedUnitAmount = unitAmount ?? (lineAmount !== null ? roundMoney(lineAmount / quantity) : null)
  const resolvedLineAmount = lineAmount ?? (resolvedUnitAmount !== null ? roundMoney(resolvedUnitAmount * quantity) : null)

  return {
    Description: sanitizeInvoiceText(description || "Invoice item"),
    Quantity: quantity,
    UnitAmount: resolvedUnitAmount === null ? 0 : roundMoney(resolvedUnitAmount),
    LineAmount: resolvedLineAmount === null ? roundMoney(resolvedUnitAmount === null ? 0 : resolvedUnitAmount * quantity) : roundMoney(resolvedLineAmount),
    TaxType: taxType,
    AccountCode: accountCode,
  }
}

function normalizeLineItems(items: unknown, fallbackSubtotal: number | null, fallbackDescription: string) {
  const lineItems = Array.isArray(items) ? items.map((item) => normalizeLineItem(item)).filter(Boolean) : []

  if (lineItems.length > 0) {
    return lineItems as AnyRecord[]
  }

  // No itemised rows were readable. Xero still needs a line, so emit a single
  // exclusive-amount line using the subtotal (never the GST-inclusive gross,
  // which would inflate the bill once Xero adds tax).
  if (fallbackSubtotal !== null && fallbackSubtotal > 0) {
    return [
      {
        Description: fallbackDescription,
        Quantity: 1,
        UnitAmount: roundMoney(fallbackSubtotal),
        LineAmount: roundMoney(fallbackSubtotal),
        TaxType: "INPUT2",
        AccountCode: null,
      },
    ]
  }

  return []
}

function sumLineItems(lineItems: AnyRecord[]) {
  return lineItems.reduce((sum, lineItem) => {
    const quantity = parseAmount(lineItem?.Quantity ?? lineItem?.quantity ?? 1) ?? 1
    const unitAmount = parseAmount(lineItem?.UnitAmount ?? lineItem?.unitAmount ?? lineItem?.unit_amount ?? lineItem?.Amount ?? lineItem?.amount)
    const lineAmount = parseAmount(lineItem?.LineAmount ?? lineItem?.lineAmount ?? lineItem?.line_amount)
    if (quantity > 0 && unitAmount !== null) {
      return sum + quantity * unitAmount
    }
    return sum + (lineAmount ?? 0)
  }, 0)
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function decideStatus(confidence: number, duplicateRisk: string): StatusDecision {
  if (duplicateRisk === "confirmed" || confidence < 40) {
    return { status: "exception", severity: "error", failureReason: "Low confidence or duplicate risk" }
  }

  if (confidence >= 85 && duplicateRisk === "clear") {
    return { status: "submitted", severity: "info", failureReason: null }
  }

  if (confidence >= 60) {
    return { status: "draft", severity: "warning", failureReason: null }
  }

  return { status: "review", severity: "warning", failureReason: "Needs manual review" }
}

function buildObservation(field_name: string, field_value: unknown, source_processor: string, confidence: number, evidence_text: string | null): FieldObservation {
  return {
    field_name,
    field_value,
    source_processor,
    confidence: clampConfidence(confidence),
    source_page: null,
    bounding_box: null,
    evidence_text,
  }
}

function pickField<T>(
  fieldName: string,
  sources: Array<{ value: T | null | undefined; source: string; confidence: number; evidence?: string | null }>,
  fallback: T | null,
  observations: FieldObservation[],
) {
  for (const source of sources) {
    if (source.value === null || source.value === undefined || source.value === "") continue
    observations.push(buildObservation(fieldName, source.value, source.source, source.confidence, source.evidence ?? null))
    return source.value
  }

  return fallback
}

/**
 * Words that mean the subject is a sentence or a notification, not a company name.
 * "Your May bill for Account 000631263" and "for your order from Repco" are real subject
 * lines that both used to be stored as supplier names, which then failed contact resolution
 * against Xero and left the bill stuck.
 */
const NON_COMPANY_WORDS = new Set([
  "your", "yours", "our", "ours", "my", "the", "this", "that", "these", "those",
  "please", "thank", "thanks", "dear", "hi", "hello", "hey",
  "for", "from", "to", "with", "and", "of", "in", "on", "at", "by", "as", "per",
  "is", "are", "was", "were", "be", "been",
  "attached", "attach", "find", "see", "regards", "cheers", "sincerely", "best",
  "account", "order", "orders", "statement", "invoice", "payment", "due", "overdue",
  "reminder", "autopay", "auto", "pay", "paid", "charge", "charges", "copy", "copies",
  "re", "fw", "fwd", "tr", "ref",
])

/** Company-name suffixes that legitimately end in a full stop. */
const NAME_ABBREVIATIONS = /\b(Ltd|Co|NZ|Inc|LLP|LLC|Ltd|Lim)\.$/i

/** Anything after a full stop starts a new sentence, so it is not part of the name. */
function looksLikeCompanyName(value: string): boolean {
  const name = value.trim()
  if (!name || name.length > 60) return false
  if (!/[A-Za-z]/.test(name)) return false

  const words = name.split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 6) return false

  // A run of digits is a document reference, not a name. Without this,
  // "Invoice IV00004431; From Computer Fusion" resolved the supplier to "IV00004431".
  if (/\d{4,}/.test(name)) return false

  // A full stop that is not part of an abbreviation means this is a sentence.
  const withoutAbbreviations = name.replace(new RegExp(NAME_ABBREVIATIONS.source, "gi"), "")
  if (withoutAbbreviations.includes(".")) return false

  // Reject anything containing a sentence or notification word.
  for (const word of words) {
    const bare = word.replace(/[^\p{L}]/gu, "").toLowerCase()
    if (NON_COMPANY_WORDS.has(bare)) return false
  }

  return true
}

/** A run of capitalised words, which is what a written company name looks like. */
const TITLE_CASE_NAME = /[A-Z][\p{L}\p{Nd}&'’.-]*(?:\s+[A-Z][\p{L}\p{Nd}&'’.-]*){0,4}/gu

/**
 * Finds a company name that is named inside a sentence rather than stated on its own, for
 * example "Invoice for your order from Repco" or "Invoice from Acme Holdings Ltd". Returns
 * null unless the extracted fragment really does look like a name.
 */
function findCompanyNameInSentence(text: string): string | null {
  const candidates: string[] = []
  const title = TITLE_CASE_NAME.source

  for (const match of text.matchAll(new RegExp(`\\bfrom\\s+(${title})`, "giu"))) {
    candidates.push(match[1])
  }
  for (const match of text.matchAll(new RegExp(`\\b(${title})\\s+(?:ltd|limited|co|company|group|holdings|partners|services)\\b`, "giu"))) {
    candidates.push(match[1])
  }

  for (const candidate of candidates) {
    const name = candidate.trim().replace(/[.,;:]+$/, "")
    if (name && looksLikeCompanyName(name)) return name
  }
  return null
}

/**
 * Derives the supplier from an email subject, but only when the subject actually names a
 * company. Returning null is the correct and common outcome: the caller then falls back to
 * the sender domain, and failing that the bill goes to manual review rather than being
 * posted under a sentence from the subject line.
 */
function deriveSupplierFromSubject(subject: string | null | undefined) {
  if (!subject) return null
  const cleaned = String(subject)
    .replace(/^\s*((re|fw|fwd|aw|tr):\s*)+/i, "")
    // Drop reply-chain noise and embedded email addresses before looking for a name.
    .replace(/<[^>]*>/g, " ")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ")
    // Keep only the first sentence.
    .split(/\.\s/)[0]
    .split(/[;|]/)[0]
    .replace(/^\s*(tax\s+)?(invoice|receipt|bill|statement|quote|order|credit note|purchase order)\s*[:#]?\s*/i, "")
    .replace(/^\s*[-–—]\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!cleaned) return null

  // A subject that simply states the name, e.g. "Invoice IV00004431" is a number and
  // "Acme Holdings Ltd" is a name. Try the plain form before digging into the sentence.
  const withoutTrailingReference = cleaned.replace(/\s*\b(?:no|number|#|num)\.?\s*[:#-]?\s*[A-Za-z0-9][A-Za-z0-9\-/_.]{1,40}$/i, "").trim()
  if (looksLikeCompanyName(withoutTrailingReference)) return withoutTrailingReference

  // Otherwise the name may be embedded in a sentence. Search the full subject, because the
  // useful part is often after the clause separator that was trimmed above.
  const full = String(subject)
    .replace(/^\s*((re|fw|fwd|aw|tr):\s*)+/i, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  const embedded = findCompanyNameInSentence(full)
  if (embedded) return embedded

  return null
}
/**
 * Pulls an invoice number out of an email subject such as
 * "Fw: MYOB Tax Invoice 2-10009929258". The subject is a weaker source than the document
 * itself, so this only fills a gap. Values are validated the same way as the structured
 * layer, which is what allows hyphenated numbers like "2-10009929258" through.
 */
function deriveInvoiceNumberFromSubject(subject: string | null | undefined) {
  if (!subject) return null
  const cleaned = String(subject).replace(/^\s*((re|fw|fwd|aw|tr):\s*)+/i, "").split(/[;|]/)[0]
  const patterns = [
    /\b(?:tax\s+)?invoice\s*(?:no|number|#|num)\.?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\-/_.#]{1,40})/i,
    /\binv(?:oice)?\.?\s*(?:no|number|#)\.?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\-/_.#]{1,40})/i,
    // "MYOB Tax Invoice 2-10009929258" - the number follows the document word with no label.
    /\b(?:tax\s+)?invoice\s+([A-Za-z0-9][A-Za-z0-9\-/_.#]{1,40})/i,
  ]
  for (const pattern of patterns) {
    const match = cleaned.match(pattern)
    if (!match) continue
    const candidate = sanitizeInvoiceNumberLikeValue(match[1])
    if (candidate) return candidate
  }
  return null
}

/** Local copy of the number validation so this module stays free of the edge entry point. */
function sanitizeInvoiceNumberLikeValue(value: unknown) {
  if (value === null || value === undefined) return null
  const raw = String(value).replace(/\s+/g, " ").trim()
  if (!raw || raw.length > 60) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9\-/_.:#'()\s&]*$/.test(raw)) return null
  if (!/\d/.test(raw)) return null
  // Reject a bare amount such as "249.00" echoed from the totals block.
  if (!/[a-z]/i.test(raw) && /^\$?\s*[\d,]+(\.\d{1,2})?\s*$/.test(raw) && /[.,]/.test(raw)) return null
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(raw)) return null
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(raw)) return null
  return raw
}

/** Consumer mail providers identify a person, not a supplier. */
const FREEMAIL_DOMAINS = new Set([
  "gmail", "googlemail", "hotmail", "outlook", "live", "msn", "yahoo", "ymail",
  "icloud", "me", "aol", "gmx", "protonmail", "proton", "mail", "fastmail", "zoho",
])

function deriveSupplierFromEmail(senderEmail: string | null | undefined) {
  if (!senderEmail) return null
  const email = String(senderEmail).match(/<([^>]+)>/)?.[1] ?? String(senderEmail)
  const domain = email.split("@")[1]?.toLowerCase()
  if (!domain) return null
  const base = domain.split(".")[0]
  if (!base) return null
  // A personal address such as shaneb_26@hotmail.com is a person forwarding a bill, not
  // the supplier. Inferring "Shaneb 26" as a supplier name guarantees a failed contact
  // lookup, so treat these domains as no signal at all.
  if (FREEMAIL_DOMAINS.has(base)) return null
  if (/^\d+$/.test(base)) return null
  const derived = base
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
  if (!derived || !looksLikeCompanyName(derived)) return null
  return derived
}

export function resolveHybridInvoiceCandidate(item: AnyRecord) {
  const metadata = item?.metadata ?? {}
  const structured =
    metadata.structuredExtraction ??
    metadata.geminiExtraction ??
    metadata.gemini_extraction ??
    metadata.documentAiExtraction ??
    metadata.documentAIExtraction ??
    metadata.document_ai ??
    metadata.llmExtraction ??
    null

  const subject = structured?.subject ?? item.subject ?? null
  const sender = structured?.sender ?? structured?.senderEmail ?? item.sender_email ?? null
  const bodyPreview = structured?.bodyPreview ?? structured?.body_preview ?? ""
  const amount = parseAmount(structured?.grossTotal ?? structured?.gross_total ?? structured?.amount ?? null)
  const invoiceNumber = structured?.invoiceNumber ?? structured?.invoice_number ?? null
  const invoiceDate = parseDateString(structured?.invoiceDate ?? structured?.invoice_date)
  const dueDate = parseDateString(structured?.dueDate ?? structured?.due_date)
  const processor = String(structured?.processor ?? structured?.source ?? "gemini-llm")

  // Fallback chain: issuer from the document, then a subject that genuinely names a
  // company, then the sender domain. Each fallback is allowed to return null: a bill with
  // no identifiable supplier must go to manual review rather than be posted under a
  // sentence from the subject line or a filename.
  const subjectDerivedSupplier = deriveSupplierFromSubject(item.subject)
  const subjectDerivedInvoiceNumber = deriveInvoiceNumberFromSubject(item.subject)
  const emailDerivedSupplier = deriveSupplierFromEmail(item.sender_email)

  // Where the name came from decides how it may be used downstream. A name read off the
  // invoice can be trusted enough to create a Xero contact; a name inferred from a domain
  // is a guess and must be confirmed by a human first.
  const supplierNameSource = structured?.supplierName ?? structured?.supplier_name
    ? "document"
    : subjectDerivedSupplier
      ? "subject"
      : emailDerivedSupplier
        ? "sender-domain"
        : "unresolved"

  const supplierName = String(
    structured?.supplierName ?? structured?.supplier_name ??
    subjectDerivedSupplier ?? emailDerivedSupplier ??
    // "Unmatched supplier" is a deliberate, searchable marker, not a real name. Posting
    // against it would create a junk Xero contact.
    "Unmatched supplier",
  )
  const sourceLineItems = structured?.lineItems ?? structured?.line_items ?? []
  const confidenceSeed = Number(structured?.confidence ?? item.confidence ?? 0)
  const observations: FieldObservation[] = []
  const processorChain = [processor]

  const resolvedSupplierName = sanitizeInvoiceText(
    String(
      pickField(
        "supplier_name",
        [
          { value: structured?.supplierName ?? structured?.supplier_name ?? null, source: processor, confidence: 92, evidence: "Structured supplier name" },
          { value: subjectDerivedSupplier, source: "email-metadata", confidence: 45, evidence: "Cleaned email subject fallback" },
          { value: emailDerivedSupplier, source: "email-metadata", confidence: 30, evidence: "Sender domain fallback" },
        ],
        supplierName,
        observations,
      ) ?? supplierName,
    ),
  ) || "Unmatched supplier"

  const resolvedInvoiceNumber = pickField(
      "invoice_number",
      [
        { value: structured?.invoiceNumber ?? structured?.invoice_number ?? null, source: String(structured?.processor ?? structured?.source ?? "gemini-llm"), confidence: 90, evidence: "Structured invoice number" },
        // The subject often names the document, e.g. "Fw: MYOB Tax Invoice 2-10009929258".
        // It is a weaker source than the page itself, so it only fills a gap the
        // structured layer left rather than overriding a number read from the document.
        { value: subjectDerivedInvoiceNumber, source: "email-metadata", confidence: 55, evidence: "Invoice number named in the email subject" },
      ],
      invoiceNumber,
      observations,
    )

  const resolvedInvoiceDate = pickField(
      "invoice_date",
      [
        { value: structured?.invoiceDate ?? structured?.invoice_date ?? null, source: String(structured?.processor ?? structured?.source ?? "gemini-llm"), confidence: 88, evidence: "Structured invoice date" },
      ],
      invoiceDate,
      observations,
    )

  const resolvedDueDate = pickField(
      "due_date",
      [
        { value: structured?.dueDate ?? structured?.due_date ?? null, source: String(structured?.processor ?? structured?.source ?? "gemini-llm"), confidence: 88, evidence: "Structured due date" },
      ],
      dueDate,
      observations,
    )

  const grossCandidates = [
    { value: parseAmount(structured?.grossTotal ?? structured?.gross_total ?? structured?.amountDue ?? structured?.amount_due ?? amount), source: String(structured?.processor ?? structured?.source ?? "gemini-llm"), confidence: 94, evidence: "Structured total" },
  ]
  const resolvedGrossTotal = grossCandidates.find((entry) => entry.value !== null && entry.value !== undefined)?.value ?? null
  if (resolvedGrossTotal !== null) {
    observations.push(buildObservation("gross_total", resolvedGrossTotal, grossCandidates.find((entry) => entry.value !== null && entry.value !== undefined)?.source ?? "legacy-heuristic", 90, "Resolved gross total"))
  }

  const resolvedTaxTotal = pickField(
    "tax_total",
    [
      { value: parseAmount(structured?.taxTotal ?? structured?.tax_total ?? structured?.gstTotal ?? structured?.gst_total), source: String(structured?.processor ?? structured?.source ?? "gemini-llm"), confidence: 82, evidence: "Structured tax" },
    ],
    0,
    observations,
  )

  // Final reconciliation so the candidate always satisfies subtotal + tax = gross,
  // which is what Xero validates when a bill is posted with LineAmountTypes Exclusive.
  const structuredSubtotal = parseAmount(structured?.subtotal ?? structured?.sub_total ?? null)
  const resolvedLineItems = normalizeLineItems(
    sourceLineItems,
    structuredSubtotal ?? resolvedGrossTotal,
    resolvedSupplierName,
  )
  const lineItemTotal = roundMoney(sumLineItems(resolvedLineItems))

  let subtotal = structuredSubtotal
  let taxTotal = parseAmount(resolvedTaxTotal)
  let grossTotal = resolvedGrossTotal

  if (grossTotal !== null && subtotal !== null && (taxTotal === null || taxTotal <= 0)) {
    const inferredTax = roundMoney(grossTotal - subtotal)
    if (inferredTax > 0 && inferredTax < grossTotal) taxTotal = inferredTax
  }
  if (grossTotal !== null && (taxTotal === null || taxTotal > 0) && subtotal === null) {
    const inferredSubtotal = roundMoney(grossTotal - (taxTotal ?? 0))
    if (inferredSubtotal > 0) subtotal = inferredSubtotal
  }
  if (subtotal === null) subtotal = resolvedLineItems.length > 0 ? lineItemTotal : grossTotal ?? 0
  if (taxTotal === null) taxTotal = 0
  if (grossTotal === null) grossTotal = roundMoney(subtotal + taxTotal)

  subtotal = roundMoney(subtotal)
  taxTotal = roundMoney(taxTotal)
  grossTotal = roundMoney(grossTotal)

  const lineItemsMatchSubtotal = resolvedLineItems.length === 0 || Math.abs(lineItemTotal - subtotal) <= 0.05
  const totalsBalanced = Math.abs((subtotal + taxTotal) - grossTotal) <= 0.05

  // Deterministic post-extraction guardrails. The model can hallucinate individual line
  // items or round the net/tax/gross trio inconsistently, so the arithmetic is checked here
  // before any confidence score or auto-approve decision is made. A failure downgrades the
  // candidate to review rather than letting a bad bill reach Xero.
  const NZ_GST_RATE = 0.15
  const mathDrift = Math.abs((subtotal + taxTotal) - grossTotal)
  const mathIntegrityOk = mathDrift <= 0.02
  // Allow freight and GST-free line items, so the expected tax is a ceiling, not an exact
  // figure: the printed tax must not exceed what a 15% GST on the subtotal would produce.
  const expectedTaxMax = roundMoney(subtotal * NZ_GST_RATE)
  const nzGstOk = taxTotal === 0 || (taxTotal > 0 && taxTotal <= expectedTaxMax + 0.02)
  const totalsValidated = mathIntegrityOk && nzGstOk

  const validationWarnings: string[] = []
  if (!mathIntegrityOk) validationWarnings.push(`subtotal + tax (${subtotal + taxTotal}) does not equal gross (${grossTotal}) by more than 0.02`)
  if (!nzGstOk) validationWarnings.push(`tax (${taxTotal}) exceeds 15% GST on subtotal (${subtotal})`)

  const processorConfidence = clampConfidence(
    confidenceSeed +
      (resolvedGrossTotal !== null ? 10 : 0) +
      (resolvedInvoiceNumber ? 8 : 0) +
      (totalsBalanced ? 12 : -18) +
      (resolvedLineItems.length > 0 ? 8 : -4) +
      (lineItemsMatchSubtotal ? 6 : -14) +
      (totalsValidated ? 8 : -12),
  )

  const duplicateRisk = String(item.duplicate_risk ?? "unknown")
  let decision = decideStatus(processorConfidence, duplicateRisk)
  if (!totalsValidated && decision.status !== "exception") {
    decision = { status: "review", severity: "warning", failureReason: validationWarnings.join("; ") || "Totals failed deterministic validation" }
  }
  const validationFlags = {
    hasAmount: grossTotal > 0,
    hasSender: Boolean(sender),
    hasInvoiceNumber: Boolean(resolvedInvoiceNumber),
    hasLineItems: resolvedLineItems.length > 0,
    totalsBalanced,
    lineItemsMatchSubtotal,
    lineItemTotal,
    mathIntegrityOk,
    nzGstOk,
    totalsValidated,
    validationWarnings,
    duplicateRisk,
    manualReview: decision.status !== "submitted",
    sourceLayers: processorChain,
  }

  const resolvedFields = {
    supplierName: resolvedSupplierName,
    supplierNameSource,
    reference: structured?.reference ?? null,
    invoiceNumber: resolvedInvoiceNumber,
    invoiceDate: resolvedInvoiceDate,
    dueDate: resolvedDueDate,
    grossTotal,
    taxTotal,
    subtotal,
    lineItems: resolvedLineItems,
    sender,
    subject,
    bodyPreview,
  }

  const candidatePayload = {
    intake_item_id: item.id,
    supplier_name: resolvedSupplierName,
    supplier_alias: sender,
    xero_contact_id: item.metadata?.xeroContactId ?? null,
    invoice_number: resolvedInvoiceNumber,
    invoice_date: resolvedInvoiceDate ?? (item.received_at ? new Date(item.received_at).toISOString().slice(0, 10) : null),
    due_date: resolvedDueDate ?? resolvedInvoiceDate ?? (item.received_at ? new Date(item.received_at).toISOString().slice(0, 10) : null),
    currency: "NZD",
    subtotal,
    tax_total: taxTotal,
    gross_total: grossTotal,
    line_items: resolvedLineItems,
    extraction_payload: {
      processorChain,
      sourceLayers: { structured },
      resolvedFields,
      validationFlags,
    },
    validation_flags: validationFlags,
    provenance: {
      processorChain,
      observations,
    },
    confidence: processorConfidence,
    duplicate_fingerprint: `${item.source_fingerprint}:${resolvedInvoiceNumber ?? ""}:${grossTotal}`.trim(),
    match_state: decision.status === "submitted" ? "high" : decision.status === "draft" ? "medium" : decision.status === "review" ? "manual_review" : "blocked",
    status: decision.status === "submitted" || decision.status === "draft" ? "validated" : "rejected",
  }

  const extractionRunPayload = {
    intake_item_id: item.id,
    document_artifact_id: item.document_artifact_id ?? null,
    processor_name: String(structured?.processor ?? structured?.source ?? "gemini-llm"),
    processor_chain: processorChain,
    status: decision.status === "exception" ? "failed" : "completed",
    confidence: processorConfidence,
    source_payload: {
      structured,
    },
    normalized_payload: resolvedFields,
    validation_payload: validationFlags,
    review_required: decision.status !== "submitted",
    review_reason: decision.failureReason,
  }

  return {
    candidatePayload,
    extractionRunPayload,
    fieldObservations: observations,
    decision,
    resolvedFields,
    validationFlags,
    processorChain,
  } satisfies HybridResolution
}
