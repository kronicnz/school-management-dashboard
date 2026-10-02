// /// <reference lib="deno.ns" />
// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore
import { serve } from "https://deno.land/std/http/server.ts";
import { resolveHybridInvoiceCandidate } from "./hybrid-extraction.ts";
import {
  buildExtractionGenerationConfig,
  isStrictExtractionShape,
  mapStrictExtractionToInternal,
} from "./gemini-schema.ts";
import { validateExtraction, type DuplicateMatch, type ValidationError } from "./validation.ts";
import { appendAuditLog, computeFieldDiff } from "./audit.ts";
import {
  FinanceAuthError,
  requirePermission,
  resolveCaller,
  type FinanceCaller,
} from "./auth.ts";
import {
  buildReplacementInvoiceNumber,
  getCachedXeroResource,
  isInvoiceNumberCollision,
  pushInBatches,
  purgeExpiredXeroCache,
  xeroFetch,
  xeroRateLimiter,
} from "./xero-client.ts";

/** Attempts before an extraction is parked in failed_review for a human. */
const MAX_JOB_ATTEMPTS = 3;

/** Base delay for exponential backoff; attempt N waits BASE * 2^(N-1). */
const RETRY_BASE_DELAY_MS = 30_000;

const NZ_GST_RATE = 0.15;
const DEFAULT_XERO_ACCOUNT_CODE = "400";

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.\-]/g, "").trim();
    if (!cleaned || cleaned === "-" || cleaned === ".") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function parseInvoiceDate(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  // Already ISO
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // 2026/08/23
  const ymdSlash = raw.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})/);
  if (ymdSlash) return `${ymdSlash[1]}-${pad2(Number(ymdSlash[2]))}-${pad2(Number(ymdSlash[3]))}`;

  // 23/08/2026 or 08/23/2026 (NZ invoices are DD/MM/YYYY)
  const dmy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/);
  if (dmy) {
    let [, first, second, yearRaw] = dmy;
    let year = Number(yearRaw);
    if (yearRaw.length === 2) year += year >= 70 ? 1900 : 2000;
    const a = Number(first);
    const b = Number(second);
    const day = a > 12 ? a : b > 12 ? b : a;
    const month = a > 12 ? b : b > 12 ? a : b;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  // 23 Aug 2026 / 23rd August 2026 / Aug 23, 2026
  const monthName = raw.toLowerCase().match(/([a-z]{3,9})/);
  if (monthName && MONTHS[monthName[1]]) {
    const month = MONTHS[monthName[1]];
    const numbers = raw.match(/\d{1,2}/g)?.map(Number) ?? [];
    const yearMatch = raw.match(/\d{4}/);
    if (numbers.length >= 2 && yearMatch) {
      const year = Number(yearMatch[0]);
      const dayCandidates = numbers.filter((n) => n !== year);
      const day = dayCandidates.find((n) => n >= 1 && n <= 31);
      if (day) return `${year}-${pad2(month)}-${pad2(day)}`;
    }
  }

  const fallback = new Date(raw);
  if (!Number.isNaN(fallback.getTime())) return fallback.toISOString().slice(0, 10);
  return null;
}

const NON_LINE_DESCRIPTIONS = /^(sub\s*-?\s*)?(total|subtotal|gst|vat|tax|discount|balance|amount due|total due|total payable|credit|note|round|page)\b/i;

const UNIT_TOKENS = /^(hrs?|hr|ea|each|pairs?|pc|pcs|ea\.|ctn|ctns|carton|cartons|box|boxes|kit|kits|set|sets|pkt|pack|rolls?|sheet|sheets|bag|bags|unit|units)$/i;

/**
 * Flattened PDF text loses table columns, so the Item ID / category value ("Labour")
 * ends up prefixed on every description and the UoM value ("Hrs") gets spliced into the
 * middle of a wrapped description. Strip the prefix when every row shares it, and drop
 * UoM tokens that were clearly a separate column rather than part of the wording.
 */
/**
 * Flattened PDF text loses table columns, so the UoM cell value ("Hrs") ends up spliced
 * into the middle of a wrapped description ("...9027 - Cotton Hrs On Whakatane...").
 *
 * Only a unit abbreviation wedged between two real words is removed. Leading and
 * trailing units are left alone because those are genuine wording ("Vehicle KM Charge"),
 * as is a unit next to a number ("3 Hrs Consulting"). A repeated leading word is NOT
 * stripped here: a shared first word is just as likely to be real wording
 * ("Subscription renewal" / "Subscription setup") as an Item ID column, and guessing
 * would silently corrupt correct descriptions. Column separation is the vision pass's job.
 */
export function cleanLineItemDescriptions(lineItems: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (lineItems.length < 2) return lineItems;

  const isWord = (token: string) => /^[A-Za-z][A-Za-z'-]*$/.test(token) && token.length >= 2;

  return lineItems.map((item) => {
    const original = String(item.Description ?? "").trim();
    const words = original.split(/\s+/);
    if (words.length < 3) return item;

    const kept: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const isLeading = i === 0;
      const isTrailing = i === words.length - 1;
      const wedged =
        !isLeading &&
        !isTrailing &&
        UNIT_TOKENS.test(words[i]) &&
        isWord(words[i - 1]) &&
        isWord(words[i + 1]);

      if (wedged) continue;
      kept.push(words[i]);
    }

    const description = kept.join(" ").trim();
    return description && description !== original ? { ...item, Description: description } : item;
  });
}

function normalizeExtractedLineItems(
  lineItems: unknown,
  context: { subtotal: number | null; taxTotal: number | null; grossTotal: number | null },
): { lineItems: Array<Record<string, unknown>>; lineItemsAreExclusive: boolean | null } {
  const rawItems = Array.isArray(lineItems) ? lineItems : [];
  const VALID_TAX_TYPES = new Set(["INPUT", "INPUT2", "OUTPUT", "OUTPUT2", "NONE", "GSTONIMPORTS", "ZERO", "EXEMPTOUTPUT", "EXEMPTINPUT"]);

  const items = rawItems
    .map((entry) => {
      const record = (entry ?? {}) as Record<string, unknown>;
      const description = String(record.description ?? record.Description ?? "").replace(/\s+/g, " ").trim();
      let quantity = toFiniteNumber(record.quantity ?? record.Quantity) ?? 1;
      if (!(quantity > 0)) quantity = 1;
      const unitAmount = toFiniteNumber(record.unitAmount ?? record.UnitAmount);
      const lineAmount = toFiniteNumber(record.lineAmount ?? record.LineAmount);
      const rawTaxType = String(record.taxType ?? record.TaxType ?? "INPUT2").trim().toUpperCase().replace(/[\s-]/g, "");
      const rawAccount = String(record.accountCode ?? record.AccountCode ?? "").replace(/[\s-]/g, "").trim();

      return {
        description,
        quantity,
        unitAmount,
        lineAmount,
        taxType: VALID_TAX_TYPES.has(rawTaxType) ? rawTaxType : "INPUT2",
        accountCode: /^\d{3,6}$/.test(rawAccount) ? rawAccount : null,
      };
    })
    .filter((item) => {
      if (!item.description && item.unitAmount === null && item.lineAmount === null) return false;
      if (item.description && NON_LINE_DESCRIPTIONS.test(item.description) && !item.description.match(/\d/)) {
        return item.lineAmount !== null && item.lineAmount !== 0;
      }
      return true;
    });

  // Fill in the missing side of qty x unitAmount = lineAmount
  for (const item of items) {
    if (item.lineAmount === null && item.unitAmount !== null) {
      item.lineAmount = roundMoney(item.unitAmount * item.quantity);
    } else if (item.unitAmount === null && item.lineAmount !== null) {
      item.unitAmount = roundMoney(item.lineAmount / item.quantity);
    }
  }

  const liveItems = items.filter((item) => item.lineAmount !== null && item.lineAmount !== 0);
  if (liveItems.length === 0) {
    return { lineItems: [], lineItemsAreExclusive: null };
  }

  const sum = roundMoney(liveItems.reduce((total, item) => total + (item.lineAmount as number), 0));

  // Decide whether the extracted line amounts are GST-inclusive.
  // Xero bills are posted with LineAmountTypes: "Exclusive", so inclusive amounts must be converted.
  // The totals block is the authority: try each candidate scale against the printed anchors and
  // use whichever one reconciles. This also corrects a model that divided an already-exclusive
  // amount by 1.15 (or failed to divide an inclusive one).
  const exclusiveAnchors = [context.subtotal, context.subtotal !== null && context.taxTotal !== null ? roundMoney(context.subtotal + context.taxTotal) : null].filter((v): v is number => v !== null && v > 0);
  const inclusiveAnchors = [
    context.grossTotal,
    context.grossTotal !== null && context.taxTotal !== null ? roundMoney(context.grossTotal - context.taxTotal) : null,
  ].filter((v): v is number => v !== null && v > 0);

  const reconciles = (candidateSum: number) => {
    const tolerance = Math.max(0.05, Math.max(candidateSum, 0) * 0.005);
    return (anchors: number[]) => anchors.some((anchor) => Math.abs(anchor - candidateSum) <= Math.max(tolerance, anchor * 0.005));
  };
  const isExclusiveScale = reconciles(sum);
  const isInclusiveScale = reconciles(roundMoney(sum * (1 + NZ_GST_RATE)));

  let scale = 1;
  let lineItemsAreExclusive: boolean | null = null;
  if (isExclusiveScale(exclusiveAnchors)) {
    scale = 1;
    lineItemsAreExclusive = true;
  } else if (isInclusiveScale(exclusiveAnchors)) {
    scale = 1 / (1 + NZ_GST_RATE);
    lineItemsAreExclusive = false;
  } else if (isExclusiveScale(inclusiveAnchors)) {
    scale = 1;
    lineItemsAreExclusive = true;
  } else if (isInclusiveScale(inclusiveAnchors)) {
    scale = 1 / (1 + NZ_GST_RATE);
    lineItemsAreExclusive = false;
  }

  if (scale !== 1) {
    console.log(`[line-items] Rescaling extracted line amounts by ${scale.toFixed(4)} to match the printed totals`);
    for (const item of liveItems) {
      item.lineAmount = roundMoney((item.lineAmount as number) * scale);
      if (item.unitAmount !== null) item.unitAmount = roundMoney((item.unitAmount as number) * scale);
    }
  }

  const normalized = cleanLineItemDescriptions(liveItems.map((item) => ({
    Description: item.description || "Invoice item",
    Quantity: item.quantity,
    UnitAmount: roundMoney(item.unitAmount ?? 0),
    LineAmount: roundMoney(item.lineAmount ?? 0),
    TaxType: item.taxType,
    AccountCode: item.accountCode ?? DEFAULT_XERO_ACCOUNT_CODE,
  })));

  return { lineItems: normalized, lineItemsAreExclusive };
}

function reconcileTotals(input: {
  subtotal: number | null;
  taxTotal: number | null;
  grossTotal: number | null;
  lineItemsAreExclusive: boolean | null;
  lineItemSum: number | null;
}) {
  let subtotal = input.subtotal !== null && input.subtotal > 0 ? input.subtotal : null;
  let taxTotal = input.taxTotal !== null && input.taxTotal > 0 ? input.taxTotal : null;
  let grossTotal = input.grossTotal !== null && input.grossTotal > 0 ? input.grossTotal : null;
  let taxRate: number | null = null;
  const inferred: string[] = [];

  // A GST-exclusive subtotal plus GST must reconcile to the gross total.
  if (grossTotal !== null && subtotal !== null && taxTotal === null) {
    const candidate = roundMoney(grossTotal - subtotal);
    if (candidate > 0 && candidate < grossTotal) {
      taxTotal = candidate;
      inferred.push("taxTotal");
    }
  }

  if (grossTotal !== null && taxTotal !== null && subtotal === null) {
    const candidate = roundMoney(grossTotal - taxTotal);
    if (candidate > 0) {
      subtotal = candidate;
      inferred.push("subtotal");
    }
  }

  if (grossTotal === null && subtotal !== null && taxTotal !== null) {
    grossTotal = roundMoney(subtotal + taxTotal);
    inferred.push("grossTotal");
  } else if (grossTotal === null && subtotal !== null) {
    grossTotal = subtotal;
    inferred.push("grossTotal");
  }

  // Detect the effective tax rate when only two of the three totals were printed.
  if (grossTotal !== null && taxTotal !== null && grossTotal > 0) {
    const base = subtotal !== null ? subtotal : roundMoney(grossTotal - taxTotal);
    if (base > 0) {
      const rate = taxTotal / base;
      if (rate > 0.02 && rate < 0.30) {
        taxRate = roundMoney(rate * 1000) / 10;
        if (taxRate > 0 && Math.abs(rate - NZ_GST_RATE) > 0.01) inferred.push("nonStandardTaxRate");
      }
    }
  }

  if (subtotal === null && grossTotal !== null && input.lineItemSum !== null && input.lineItemSum > 0) {
    subtotal = input.lineItemSum;
    inferred.push("subtotalFromLineItems");
  }

  return {
    subtotal: subtotal === null ? 0 : roundMoney(subtotal),
    taxTotal: taxTotal === null ? 0 : roundMoney(taxTotal),
    grossTotal: grossTotal === null ? 0 : roundMoney(grossTotal),
    taxRate,
    inferred,
  };
}

const PLACEHOLDER_VALUES = /^(unknown|n\/a|na|none|null|nil|not\s*(specified|provided|available|stated)|not applicable|tbd|pending|-{1,2})$/i;

/** Characters that legitimately appear inside a supplier invoice number. */
const INVOICE_NUMBER_ALLOWED = /^[A-Za-z0-9][A-Za-z0-9\-/_.:#'()\s&]*$/;

/** Common invoice date layouts. A date is never a valid invoice number. */
const DATE_SHAPES = [
  /^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/,       // 2026-05-27
  /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/,       // 27/05/2026
  /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2}$/,        // 27-05-26
  /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}$/,       // 27 May 2026
];

/**
 * Invoice numbers are identifiers, not amounts. A model will occasionally echo a figure
 * from the totals block, so bare money values are rejected.
 *
 * Only money-shaped and date-shaped values are rejected. A number made of digits and
 * separators is a perfectly valid identifier and must be kept: MYOB invoices are numbered
 * "2-10009929258", and an earlier version of this function threw those away because they
 * contain a hyphen.
 */
export function sanitizeInvoiceNumber(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).replace(/\s+/g, " ").trim();
  if (!raw) return null;

  // Strip the decorations suppliers wrap around numbers: "#88213", ": 88213", "INV 88213".
  const trimmed = raw.replace(/^[#:\s]+/, "").replace(/[\s#:]+$/, "").trim();
  if (!trimmed || trimmed.length > 60 || PLACEHOLDER_VALUES.test(trimmed)) return null;
  if (!INVOICE_NUMBER_ALLOWED.test(trimmed)) return null;

  const hasLetter = /[a-z]/i.test(trimmed);

  // "249.00", "1,002.91", "$249" - a bare amount, not an identifier.
  if (!hasLetter && /^\$?\s*[\d,]+(\.\d{1,2})?\s*$/.test(trimmed) && /[.,]/.test(trimmed)) return null;

  if (DATE_SHAPES.some((shape) => shape.test(trimmed))) return null;

  // Must contain a digit, and must not be only separators or punctuation.
  if (!/\d/.test(trimmed)) return null;
  if (!/[A-Za-z0-9]/.test(trimmed.replace(/[\s\-/_.:#'()&]/g, ""))) return null;

  return trimmed;
}

export function sanitizeReference(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 60 || PLACEHOLDER_VALUES.test(raw)) return null;
  if (!INVOICE_NUMBER_ALLOWED.test(raw)) return null;
  // PO and reference numbers carry the same risk of being echoed from a totals block,
  // but unlike invoice numbers they may legitimately be non-numeric ("MAYO", "CLIENT-PO-A").
  if (!/[a-z]/i.test(raw) && /^\$?\s*[\d,]+(\.\d{1,2})?\s*$/.test(raw) && /[.,]/.test(raw)) return null;
  if (DATE_SHAPES.some((shape) => shape.test(raw))) return null;
  if (!/[A-Za-z0-9]/.test(raw.replace(/[\s\-/_.:#'()&]/g, ""))) return null;
  return raw;
}

function normalizeExtraction(raw: Record<string, unknown>): Record<string, unknown> {
  const subtotalRaw = toFiniteNumber(raw.subtotal ?? raw.subTotal ?? raw.sub_total);
  const taxRaw = toFiniteNumber(raw.taxTotal ?? raw.tax_total ?? raw.gstTotal ?? raw.gst_total);
  const grossRaw = toFiniteNumber(raw.grossTotal ?? raw.gross_total ?? raw.totalAmount ?? raw.total);

  const { lineItems, lineItemsAreExclusive } = normalizeExtractedLineItems(raw.lineItems ?? raw.line_items, {
    subtotal: subtotalRaw,
    taxTotal: taxRaw,
    grossTotal: grossRaw,
  });

  const lineItemSum = lineItems.length > 0
    ? roundMoney(lineItems.reduce((total, item) => total + Number(item.LineAmount ?? 0), 0))
    : null;

  const totals = reconcileTotals({ subtotal: subtotalRaw, taxTotal: taxRaw, grossTotal: grossRaw, lineItemsAreExclusive, lineItemSum });

  return {
    ...raw,
    invoiceNumber: sanitizeInvoiceNumber(raw.invoiceNumber ?? raw.invoice_number),
    reference: sanitizeReference(raw.reference),
    supplierName: raw.supplierName ? String(raw.supplierName).trim() : null,
    supplierTaxNumber: raw.supplierTaxNumber ? String(raw.supplierTaxNumber).trim() : null,
    invoiceDate: parseInvoiceDate(raw.invoiceDate ?? raw.invoice_date),
    dueDate: parseInvoiceDate(raw.dueDate ?? raw.due_date),
    subtotal: totals.subtotal,
    taxTotal: totals.taxTotal,
    grossTotal: totals.grossTotal,
    taxRate: totals.taxRate,
    lineItems,
    normalization: {
      lineItemsAreExclusive,
      lineItemSum,
      inferredTotals: totals.inferred,
      totalsBalanced: Math.abs((totals.subtotal + totals.taxTotal) - totals.grossTotal) <= 0.05,
    },
  };
}

/**
 * Last-resort recovery of an invoice number that is printed on the document but was
 * lost by the model or by sanitizing. Suppliers label this field in many ways and the
 * value itself may contain separators, so match the label first and let the sanitized
 * value be anything credible. Without this, a document reading
 * "INVOICE NUMBER 2-10009929258" could end up with no number at all.
 */
const LABELLED_NUMBER_PATTERNS: RegExp[] = [
  /\b(?:tax\s+)?invoice\s*(?:no|number|#|num)\.?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\-/_.#]{1,40})/gi,
  /\binv(?:oice)?\.?\s*(?:no|number|#)\.?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\-/_.#]{1,40})/gi,
  /\bbill\s*(?:no|number|#)\.?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9\-/_.#]{1,40})/gi,
  /^[ \t]*(?:document\s*)?(?:no|number|#)\.?[ \t]*[:#-]?[ \t]*([A-Za-z0-9][A-Za-z0-9\-/_.#]{1,40})[ \t]*$/gim,
];

export function recoverInvoiceNumberFromText(rawText: string): string | null {
  if (!rawText) return null;
  const found: string[] = [];
  for (const pattern of LABELLED_NUMBER_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(rawText);
    while (match !== null) {
      const candidate = sanitizeInvoiceNumber(match[1]);
      if (candidate) found.push(candidate);
      match = pattern.exec(rawText);
    }
  }
  if (found.length === 0) return null;
  // Prefer the value the document asserts most often, then the first one seen.
  const counts = new Map<string, number>();
  for (const value of found) counts.set(value, (counts.get(value) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked[0][0];
}

/**
 * Parses a JSON object out of a model response that may be wrapped in a code fence
 * or preceded by commentary.
 */
export function parseGeminiJson(raw: string): Record<string, unknown> | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  candidates.push(text);

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const MAX_EXTRACTION_TEXT = 20000;

const NUMERIC_FIELDS = new Set(["subtotal", "taxTotal", "grossTotal", "quantity", "unitAmount", "lineAmount"]);

/** A field counts as missing when it is null, blank, an empty list, or a zero on a money field. */
function isEmptyFieldValue(key: string, value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (NUMERIC_FIELDS.has(key) && Number(value) === 0) return true;
  return false;
}

/**
 * Fills gaps in `primary` from `secondary`. Used to combine the PDF vision pass with the
 * text pass. The caller decides which one is primary, because a poor read from either side
 * must not overwrite a good read from the other.
 */
export function mergeExtractions(
  primary: Record<string, unknown> | null,
  secondary: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!primary) return secondary;
  if (!secondary) return primary;

  const merged: Record<string, unknown> = { ...secondary, ...primary };
  const filled: string[] = [];
  for (const key of Object.keys(primary)) {
    if (isEmptyFieldValue(key, primary[key]) && !isEmptyFieldValue(key, secondary[key])) {
      merged[key] = secondary[key];
      filled.push(key);
    }
  }
  if (filled.length > 0) console.log("[llm-extract] Filled from secondary:", filled.join(", "));

  const primaryItems = Array.isArray(primary.lineItems) ? (primary.lineItems as unknown[]) : [];
  if (primaryItems.length === 0 && Array.isArray(secondary.lineItems) && (secondary.lineItems as unknown[]).length > 0) {
    merged.lineItems = secondary.lineItems;
  }
  return merged;
}

function getGeminiModel(envVar: string, defaultModel: string): string {
  return Deno.env.get(envVar)?.trim() || defaultModel;
}

interface GeminiCallOptions {
  apiKey: string;
  model: string;
  contents: any[];
  generationConfig?: Record<string, unknown>;
}

async function callGemini({ apiKey, model, contents, generationConfig }: GeminiCallOptions): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents,
          ...(generationConfig ? { generationConfig } : {}),
        }),
        signal: controller.signal,
      },
    );

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errText}`);
    }

    interface GeminiResponse {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }

    const data = (await response.json()) as GeminiResponse;
    const rawResult = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text ?? "").join("") ?? "";
    return rawResult;
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Gemini extraction timed out after 60s");
    }
    throw error;
  }
}

function isRetryableGeminiError(message: string): boolean {
  const status = Number(message.match(/Gemini API error \((\d{3})\)/)?.[1] ?? 0);
  if (status === 429 || status === 408 || status >= 500) return true;
  if (status === 404) return true;
  return !status;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls Gemini through a chain of models, retrying transient failures.
 *
 * The 3.x Gemini endpoints return sporadic 503 "high demand" errors, and a single
 * failure loses the whole invoice, so each model gets two attempts with a short
 * backoff before the chain moves on. 4xx payload/credential errors are not retried
 * because the next model would fail identically.
 */
/** Models that returned 429/quota errors are skipped for the rest of this instance's life. */
const unavailableModels = new Set<string>();
const quotaBlockedModels = new Set<string>();

async function callGeminiWithFallback(
  apiKey: string,
  primaryModel: string,
  fallbackModel: string,
  contents: any[],
  generationConfig?: Record<string, unknown>,
): Promise<string> {
  const chain: string[] = [];
  for (const model of [
    primaryModel,
    fallbackModel,
    getGeminiModel("FINANCE_GEMINI_RESERVE_MODEL", "gemini-3.8-flash"),
    getGeminiModel("FINANCE_GEMINI_OCR_MODEL", "gemini-3.5-flash-lite"),
  ]) {
    if (model && !chain.includes(model)) chain.push(model);
  }

  const usable = chain.filter((model) => !quotaBlockedModels.has(model));
  if (usable.length === 0) {
    throw new Error(`All configured Gemini models are rate limited or out of quota: ${chain.join(", ")}`);
  }

  let lastError: unknown = null;
  for (const model of usable) {
    if (unavailableModels.has(model)) continue;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGemini({ apiKey, model, contents, generationConfig });
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (/quota/i.test(message) && message.includes("429")) {
          quotaBlockedModels.add(model);
          console.warn(`[gemini] Model "${model}" is out of quota. Skipping it for this instance.`);
          break;
        }
        if (!isRetryableGeminiError(message)) throw error;
        if (attempt === 0) {
          console.warn(`[gemini] Model "${model}" failed (${message}). Retrying once in 1500ms.`);
          await sleep(1500);
        }
      }
    }
    unavailableModels.add(model);
    console.warn(`[gemini] Model "${model}" exhausted retries. Trying next model in the chain.`);
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const MATERIAL_GAPS = new Set(["grossTotal", "subtotal", "lineItems", "totalsDoNotBalance", "supplierName", "invoiceNumber", "isInvoice", "currency", "totalAmount", "gstAmount"]);

function findExtractionGaps(parsed: Record<string, unknown>): string[] {
  const gaps: string[] = [];
  const lineItems = Array.isArray(parsed.lineItems) ? (parsed.lineItems as unknown[]) : [];
  const normalization = (parsed.normalization ?? {}) as Record<string, unknown>;

  if (parsed.isInvoice === false) gaps.push("isInvoice");
  if (!parsed.supplierName) gaps.push("supplierName");
  if (!parsed.invoiceNumber) gaps.push("invoiceNumber");
  if (!parsed.invoiceDate) gaps.push("invoiceDate");
  if (!parsed.dueDate) gaps.push("dueDate");
  if (Number(parsed.grossTotal) <= 0) gaps.push("grossTotal");
  if (Number(parsed.subtotal) <= 0) gaps.push("subtotal");
  if (Number(parsed.totalAmount) <= 0) gaps.push("totalAmount");
  if (Number(parsed.gstAmount) <= 0) gaps.push("gstAmount");
  if (!parsed.currency) gaps.push("currency");
  if (lineItems.length === 0) gaps.push("lineItems");
  if (normalization.totalsBalanced === false) gaps.push("totalsDoNotBalance");
  return gaps;
}

async function repairExtraction(
  rawText: string,
  partial: Record<string, unknown>,
  gaps: string[],
): Promise<Record<string, unknown> | null> {
  const apiKey = Deno.env.get("FINANCE_GEMINI_API_KEY") ?? Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return null;

  const primaryModel = getGeminiModel("FINANCE_GEMINI_REVIEW_MODEL", "gemini-3.5-flash");
  const fallbackModel = getGeminiModel("FINANCE_GEMINI_FALLBACK_MODEL", "gemini-3.6-flash");

  const truncated = rawText.length > MAX_EXTRACTION_TEXT
    ? rawText.slice(0, MAX_EXTRACTION_TEXT) + "\n...[TEXT TRUNCATED]..."
    : rawText;
  const escapedText = truncated.replace(/"/g, '\\"');

  const prompt = `A previous extraction attempt on this invoice returned incomplete or inconsistent data.
It is MISSING or WRONG: ${gaps.join(", ")}.

Re-read the invoice text from scratch and return the corrected, complete extraction.

Rules:
- Look again specifically for: ${gaps.map((gap) => GAP_HINTS[gap] ?? gap).join("; ")}.
- is_invoice: true if the document is a tax invoice, false otherwise.
- multi_document_detected: true if the uploaded file contains multiple distinct tax invoices.
- If the invoice has an itemised table, you MUST return every billable row as its own line item, in order.
- A description wrapping onto a second line with no quantity or amount of its own belongs to the previous row.
- subtotal + gst_amount must equal total_amount exactly. If you only have two of the three, compute the third.
- unit_price and amount are GST-EXCLUSIVE. If the printed row amount is GST-inclusive, divide it by 1.15.
- Dates are YYYY-MM-DD. Amounts are plain numbers.
- currency: invoice currency (NZD, AUD, USD, EUR, GBP).
- Never invent a value. If a field genuinely is not in the document, return null for it.

Return only the JSON object.

Previous (unreliable) attempt: ${JSON.stringify(partial)}

Invoice text:
"${escapedText}"`;

  try {
    const rawResult = await callGeminiWithFallback(
      apiKey,
      primaryModel,
      fallbackModel,
      [{ role: "user", parts: [{ text: prompt }] }],
      buildExtractionGenerationConfig(),
    );
    const repairedJson = parseGeminiJson(rawResult);
    if (!repairedJson) {
      console.warn("[llm-repair] Repair attempt did not return a JSON object");
      return null;
    }
    const repaired = normalizeExtraction(
      isStrictExtractionShape(repairedJson)
        ? mapStrictExtractionToInternal(repairedJson)
        : repairedJson,
    );
    const remaining = findExtractionGaps(repaired);
    console.log("[llm-repair] Attempted repair of:", gaps.join(", "), "| still missing:", remaining.join(", ") || "none");
    return repaired;
  } catch (error) {
    console.warn("[llm-repair] Repair attempt failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

const GAP_HINTS: Record<string, string> = {
  isInvoice: "whether the document is actually a tax invoice",
  multiDocumentDetected: "whether the file contains multiple distinct invoices",
  supplierName: "the company issuing the invoice (letterhead, not the Bill To customer)",
  invoiceNumber: "the document number labelled Invoice No / Tax Invoice / #",
  invoiceDate: "the document or issue date",
  grossTotal: "the final GST-inclusive total (Total / Total Due / Grand Total)",
  lineItems: "every row of the itemised table",
  totalsDoNotBalance: "the totals block, so subtotal + tax equals gross",
  dueDate: "the payment due date",
  subtotal: "the GST-exclusive subtotal",
  taxTotal: "the GST/VAT amount",
  currency: "the invoice currency (NZD, AUD, USD, EUR, GBP)",
  totalAmount: "the final GST-inclusive total",
  gstAmount: "the GST/VAT amount",
};

async function runLlmExtraction(rawText: string): Promise<{ structuredData: any; confidence: number; errors: string[] }> {
  const apiKey = Deno.env.get("FINANCE_GEMINI_API_KEY") ?? Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return { structuredData: {}, confidence: 0, errors: ["Missing FINANCE_GEMINI_API_KEY"] };
  }

  const primaryModel = getGeminiModel("FINANCE_GEMINI_REVIEW_MODEL", "gemini-3.5-flash");
  const fallbackModel = getGeminiModel("FINANCE_GEMINI_FALLBACK_MODEL", "gemini-3.6-flash");
  console.log(`[llm-extract] Models: primary=${primaryModel}, fallback=${fallbackModel}`);

  const MAX_TEXT = MAX_EXTRACTION_TEXT;
  const truncated = rawText.length > MAX_TEXT ? rawText.slice(0, MAX_TEXT) + "\n...[TEXT TRUNCATED]..." : rawText;
  const escapedText = truncated.replace(/"/g, '\\"');

  const prompt = `You extract structured invoice data. The text below is an email plus the invoice document text. Extract from the INVOICE only; ignore email greetings, signatures, disclaimers, links, and marketing.

FIELD RULES
1. is_invoice: true if the document is a tax invoice, false otherwise.
2. multi_document_detected: true if the uploaded file contains multiple distinct tax invoices in a single file payload.
3. supplierName: the company ISSUING the invoice. Never the "Bill To" / "Ship To" / "Customer" company. If the issuer has a trading name use it. If nothing in the invoice states it, return null.
4. supplierTaxNumber: the issuer's GST/ABN/VAT/tax registration number, null if absent.
5. invoiceNumber: the issuer's own document number (Invoice No, Tax Invoice #, INV-xxxx, Account/Ref). Do NOT use a quote number, order number, customer number, or PO number.
6. reference: the customer-side reference such as PO number, "Your Order", "Customer Ref". null if absent.
7. invoiceDate: document/issue date. dueDate: payment due date. Both YYYY-MM-DD.
8. Amounts are plain numbers with no currency symbol or thousands separators.
9. currency: invoice currency (NZD, AUD, USD, EUR, GBP).

TOTAL RULES (NZ GST)
- "Total Including GST" / "Total Due" / "Grand Total" is the GST-INCLUSIVE figure -> total_amount (grossTotal).
- "Total Exclusive" / "Subtotal" / "Net" is the GST-EXCLUSIVE figure -> subtotal.
- "GST" / "Tax" / "VAT" -> gst_amount (taxTotal).
- If the invoice prints only an inclusive total and a tax amount, subtotal = grossTotal - taxTotal.
- If it prints only a total with no tax breakdown, set subtotal = that total, taxTotal = null.
- Never put the same figure in both subtotal and grossTotal unless the invoice genuinely shows them equal.

MULTI-DOCUMENT HANDLING
- If multiple distinct tax invoices are found in a single file, set multi_document_detected: true and return each invoice's extraction in the document_extractions array with the same field structure.

LINE ITEM RULES (most important)
- Read the line item table row by row and return ONE entry per genuine billable row.
- A description that wraps onto the next line without its own quantity or amount is a CONTINUATION of the previous row: append the wrapped words to that row's description instead of creating a new item.
- Ignore summary rows that are not charges: "Subtotal", "GST/Tax", "Total", "Discount", "Round", "Balance Due", page numbers, and empty filler rows.
- Keep genuine discount and credit rows as negative amounts.
- quantity: numeric. If not printed, use 1.
- unit_price: the price for one unit, EXCLUDING GST, in the invoice's own currency.
- amount: quantity x unit_price, EXCLUDING GST. If the invoice only prints one amount for the row, use it for amount and derive unit_price = amount / quantity.
- If the only printed amounts are GST-inclusive (e.g. "Total $115.00" for a 15% GST line), still report them EXCLUDING GST by dividing by 1.15 so subtotal + tax equals grossTotal.
- account_code: ONLY if the invoice prints an explicit account, expense, category, or GL code for that row. Otherwise empty string. Never guess one.
- Do not merge separate rows. If there are two consulting rows, return two entries.

OUTPUT RULES
- Return every line item you can see, even when the totals are unclear.
- Use null for a field you cannot find. Never invent values.
- Return only the JSON object, no commentary.

EXAMPLE - single item
Text: "TAX INVOICE | BrightSpark Ltd | GST 123-456-789 | Invoice No: BS-2041 | Date: 03/09/2026 | Due: 17/09/2026 | Description | Qty | Unit | Amount | Laptop docking station | 2 | 600.00 | 1200.00 | Subtotal 1200.00 | GST 15% 180.00 | Total Including GST 1380.00"
Result: is_invoice true, multi_document_detected false, supplierName "BrightSpark Ltd", supplierTaxNumber "123-456-789", invoiceNumber "BS-2041", invoiceDate "2026-09-03", dueDate "2026-09-17", currency "NZD", subtotal 1200, gst_amount 180, total_amount 1380, lineItems [{description "Laptop docking station", quantity 2, unit_price 600, amount 1200, account_code ""}]

EXAMPLE - multi-document
Text: "TAX INVOICE | Company A | ... | TAX INVOICE | Company B | ..."
Result: is_invoice true, multi_document_detected true, document_extractions: [{supplier_name "Company A", ...}, {supplier_name "Company B", ...}]

EXAMPLE - multi-line with wrapped description
Text: "| Item | Qty | Unit Price | Line Total | | Managed network support - | 1 | 850.00 | 850.00 | |   per month, 12 month term | | | | | | Onsite hardware installation | 4 | 125.00 | 500.00 | | Annual cloud licence renewal | 1 | 2400.00 | 2400.00 | | Subtotal 3750.00 | GST 562.50 | Total 4312.50 |"
Result: THREE line items - the wrapped "per month, 12 month term" text is appended to the first description, not a fourth row.
lineItems: [{description "Managed network support - per month, 12 month term", quantity 1, unit_price 850, amount 850, account_code ""}, {description "Onsite hardware installation", quantity 4, unit_price 125, amount 500, account_code ""}, {description "Annual cloud licence renewal", quantity 1, unit_price 2400, amount 2400, account_code ""}]

EXAMPLE - GST-inclusive line pricing
Text: "Invoice 9911 from Paper Co. Item: A4 paper cartons | 10 | 55.00 | 550.00 | GST 82.50 | Total 632.50"
Result: subtotal 550, gst_amount 82.50, total_amount 632.50, amount 500, unit_price 50 (the 550 printed amount is GST-inclusive).

Text: "${escapedText}"`;

  try {
    const rawResult = await callGeminiWithFallback(
      apiKey,
      primaryModel,
      fallbackModel,
      [{ role: "user", parts: [{ text: prompt }] }],
      buildExtractionGenerationConfig(),
    );

    const parsedJson = parseGeminiJson(rawResult);
    if (!parsedJson) {
      return { structuredData: {}, confidence: 0, errors: ["Gemini response was not a JSON object"] };
    }

    let parsed = normalizeExtraction(
      isStrictExtractionShape(parsedJson) ? mapStrictExtractionToInternal(parsedJson) : parsedJson,
    );

    // The model can miss a number that is printed plainly on the page, and sanitizing can
    // discard a perfectly good one. Read the label out of the document text directly
    // before deciding the number is genuinely absent.
    if (!parsed.invoiceNumber) {
      const recovered = recoverInvoiceNumberFromText(rawText);
      if (recovered) {
        console.log("[llm-extract] Recovered invoice number from document text:", recovered);
        parsed = { ...parsed, invoiceNumber: recovered, invoiceNumberRecoveredFromText: true } as Record<string, unknown>;
      }
    }

    // A first pass often returns a partial read. Retry with a focused repair prompt
    // rather than accepting a half-filled invoice, then keep whichever pass filled more.
    const gaps = findExtractionGaps(parsed);
    if (gaps.some((gap) => MATERIAL_GAPS.has(gap))) {
      console.log("[llm-extract] Gaps detected:", gaps.join(", "), "- running repair pass");
      const repaired = await repairExtraction(rawText, parsed, gaps);
      if (repaired) {
        const merged = mergeExtractions(repaired, parsed) as Record<string, unknown>;
        const before = findExtractionGaps(parsed).length;
        const after = findExtractionGaps(merged).length;
        parsed = after <= before ? normalizeExtraction(merged) : parsed;
      }
    }

    const confidence = scoreExtractionConfidence(parsed);
    console.log(
      "[llm-extract] Confidence:", confidence,
      "fields:", Object.keys(parsed).filter((k) => parsed[k] != null),
      "lineItems:", (parsed.lineItems as unknown[])?.length,
      "norm:", JSON.stringify(parsed.normalization),
    );

    return { structuredData: parsed, confidence, errors: [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { structuredData: {}, confidence: 0, errors: [`Gemini extraction error: ${message}`] };
  }
}

function scoreExtractionConfidence(parsed: Record<string, unknown>): number {
  const lineItems = Array.isArray(parsed.lineItems) ? (parsed.lineItems as Array<Record<string, unknown>>) : [];
  const normalization = (parsed.normalization ?? {}) as Record<string, unknown>;

  let confidence = 0;
  if (parsed.supplierName) confidence += 15;
  if (parsed.invoiceNumber) confidence += 10;
  if (parsed.invoiceDate) confidence += 10;
  if (parsed.dueDate) confidence += 5;
  if (Number(parsed.grossTotal) > 0) confidence += 20;
  if (Number(parsed.taxTotal) > 0) confidence += 10;
  if (Number(parsed.subtotal) > 0) confidence += 10;
  if (lineItems.length > 0) confidence += 20;
  if (lineItems.length >= 2) confidence += 5;

  if (normalization.totalsBalanced === true) confidence += 5;
  if (normalization.totalsBalanced === false) confidence -= 15;

  const lineItemSum = typeof normalization.lineItemSum === "number" ? normalization.lineItemSum : null;
  const subtotal = Number(parsed.subtotal) || 0;
  if (lineItemSum !== null && subtotal > 0) {
    const drift = Math.abs(lineItemSum - subtotal);
    if (drift <= 0.05) confidence += 5;
    else if (drift <= Math.max(1, subtotal * 0.02)) confidence -= 3;
    else confidence -= 12;
  } else if (lineItemSum === null && subtotal > 0) {
    confidence -= 10;
  }

  if (lineItems.some((item) => !(item.Description && String(item.Description).trim()))) confidence -= 10;
  if (lineItems.some((item) => !Number(item.UnitAmount))) confidence -= 8;

  return Math.max(10, Math.min(100, confidence));
}

function formatErrorValue(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message || error.name || "Unknown error";
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof record.message === "string" && record.message.trim()) parts.push(record.message.trim());
    if (typeof record.code === "string" && record.code.trim()) parts.push(`code=${record.code.trim()}`);
    if (typeof record.status === "string" && record.status.trim()) parts.push(`status=${record.status.trim()}`);
    if (typeof record.details === "string" && record.details.trim()) parts.push(record.details.trim());
    if (parts.length > 0) return parts.join(" | ");
    try {
      const json = JSON.stringify(error);
      if (json && json !== "{}") return json;
    } catch {
      // fall through
    }

    const keys = Object.keys(record).slice(0, 6);
    if (keys.length > 0) {
      return keys.map((key) => `${key}=${formatErrorValue(record[key])}`).join("; ");
    }

    const ctor = (error as { constructor?: { name?: string } }).constructor?.name;
    return ctor ? `${ctor} object` : "Unknown error object";
  }
  return String(error);
}

// Polyfill for Deno.env in non-Deno environments (Node.js) for local TypeScript compatibility
declare const Deno: {
  env: {
    get(key: string): string | undefined
    set(key: string, value: string): void
    delete(key: string): void
    has(key: string): boolean
    toObject(): Record<string, string>
  }
};

if (typeof Deno === 'undefined') {
  // @ts-ignore
  globalThis.Deno = {
    env: {
      get: (key: string) => (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key],
      set: (_key: string, _value: string) => {},
      delete: (_key: string) => {},
      has: (key: string) => key in ((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}),
      toObject: () => {
        const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
        const result: Record<string, string> = {}
        for (const [key, value] of Object.entries(env)) {
          if (typeof value === "string") result[key] = value
        }
        return result
      },
    },
  };
}


function safeEnv(...keys: string[]) {
  for (const key of keys) {
    try {
      const value = Deno.env.get(key)
      if (value) return value
    } catch {
      return ""
    }
  }
  return ""
}

const SUPABASE_URL = safeEnv("SUPABASE_URL", "SUPABASE_INTERNAL_URL");
const SUPABASE_SERVICE_ROLE_KEY = safeEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_INTERNAL_SECRET_KEY");

let supabaseClient: any = null;

function getSupabaseClient() {
  if (!supabaseClient) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase runtime environment is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    }
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseClient;
}

function createId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeSourceType(sourceType: string | undefined, source: string) {
  const candidate = (sourceType ?? "").trim();
  if (candidate === "gmail" || candidate === "manual_upload") return candidate;
  return source === "manual_upload" ? "manual_upload" : "gmail";
}

function decodeBase64Url(value?: string | null) {
  if (!value) return "";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    return atob(padded);
  } catch {
    return "";
  }
}

function getHeaderValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string) {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function asDateString(value: unknown): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const dmy = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = Number(dmy[2]);
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 2000) {
      const parsed = new Date(Date.UTC(year, month - 1, day));
      return parsed.toISOString().slice(0, 10);
    }
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function toMoney(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

const VALID_XERO_NZ_TAX_TYPES = new Set([
  "INPUT", "INPUT2", "OUTPUT", "OUTPUT2", "NONE", "GSTONIMPORTS", "ZERO", "EXEMPTOUTPUT", "EXEMPTINPUT"
]);

function sanitizeTaxType(taxType: string): string {
  const normalized = taxType.trim().toUpperCase();
  return VALID_XERO_NZ_TAX_TYPES.has(normalized) ? normalized : "INPUT2";
}

/**
 * Maps a GST amount to the appropriate Xero tax type for NZ.
 * - If GST amount > 0: standard rated -> INPUT2 (15% GST on expenses)
 * - If GST amount == 0: GST-free/exempt -> EXEMPTOUTPUT (for expenses) or BASEXCLUDED
 *   We default to EXEMPTOUTPUT for GST-free expenses, which is the most common case.
 *   ZERO is for zero-rated exports, NONE is for non-taxable.
 */
function mapGstAmountToTaxType(gstAmount: number | null, lineAmount: number | null): string {
  const gst = typeof gstAmount === "number" ? gstAmount : 0;
  const amount = typeof lineAmount === "number" ? lineAmount : 0;
  
  if (gst > 0 && amount > 0) {
    // Has GST - standard rated purchase
    return "INPUT2";
  }
  
  // GST-free or 0% GST - use EXEMPTOUTPUT for expenses (most common)
  // Could also use BASEXCLUDED or NONE depending on the specific case
  return "EXEMPTOUTPUT";
}

function parseContactName(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "Unknown supplier";
  const emailMatch = raw.match(/<([^>]+)>/);
  if (emailMatch?.[1]) return emailMatch[1].trim();
  return raw.replace(/\s*<.*$/, "").trim();
}

function normalizeLineItems(value: unknown, defaultAccountCode?: string): Array<Record<string, unknown>> {
  const items = Array.isArray(value) ? value : [];
  const fallbackAccountCode = defaultAccountCode?.trim() || "400";
  return items.map((item) => {
    const record = item as Record<string, unknown>;
    const description = String(record.Description ?? record.description ?? record.name ?? "Invoice item").trim() || "Invoice item";
    const quantity = toMoney(record.Quantity ?? record.quantity ?? 1) || 1;
    const unitAmount = toMoney(record.UnitAmount ?? record.unitAmount ?? record.amount ?? record.price ?? 0);
    const lineAmount = toMoney(record.LineAmount ?? record.lineAmount ?? quantity * unitAmount);
    const accountCode = String(record.AccountCode ?? record.accountCode ?? record.account_code ?? fallbackAccountCode).trim();
    const taxType = sanitizeTaxType(String(record.TaxType ?? record.taxType ?? record.tax_type ?? "INPUT2"));
    return {
      Description: description,
      Quantity: quantity,
      UnitAmount: unitAmount,
      LineAmount: lineAmount,
      TaxType: taxType,
      AccountCode: accountCode,
    };
  });
}

function extractInvoiceReference(candidate: Record<string, any>): string | null {
  const payload = candidate?.extraction_payload?.resolvedFields?.reference ??
    candidate?.extraction_payload?.sourceLayers?.structured?.reference;
  if (payload) return String(payload).trim().slice(0, 50) || null;

  const existing = candidate?.reference ?? candidate?.po_number;
  return existing ? String(existing).trim().slice(0, 50) || null : null;
}

/**
 * Lightweight pre-extraction hints pulled straight out of an email body before the
 * Gemini pass runs. Used by the intake tests and as a cheap fallback when the LLM
 * cannot see the document. Returns invoice date, due date, line items and the printed
 * total when the plain-text body carries them in the common "Description N x $unit $line"
 * layout.
 */
export function extractFinanceHints(
  rawEmail: string,
  _subject: string | null,
  _sender: string | null,
  _fileName?: string | null,
): {
  invoiceDate: string | null
  dueDate: string | null
  lineItems: Array<{ Description: string; Quantity: number; UnitAmount: number; LineAmount: number }>
  amount: number | null
} {
  // extractEmailText collapses the body to a single whitespace-normalised line, so the
  // hints are read out of the flattened text with global regexes rather than line by line.
  const text = extractEmailText(rawEmail)

  const findDate = (label: RegExp): string | null => {
    const match = text.match(label)
    if (!match?.[1]) return null
    return parseInvoiceDate(match[1])
  }

  const invoiceDate = findDate(/invoice\s*date\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i)
  const dueDate = findDate(/(?:due\s*date|due)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i)

  const lineItems: Array<{ Description: string; Quantity: number; UnitAmount: number; LineAmount: number }> = []
  // "Stationery Pack 2 x $10.00 $20.00" and "Consulting 2 $50.00 $100.00" (no x in HTML tables).
  // The description is anchored to title-case words so a date or a totals label never gets
  // swallowed: "Invoice Date: 12/09/2026" fails because the colon breaks the \s+ before the
  // quantity, and "Total $35.00" fails because $ is not a digit.
  const LINE_ITEM_RE = /([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)\s+(\d+)\s*(?:x|@)?\s*\$?([\d,]+(?:\.\d+)?)\s+\$?([\d,]+(?:\.\d+)?)/g
  let match: RegExpExecArray | null
  while ((match = LINE_ITEM_RE.exec(text)) !== null) {
    const description = match[1].replace(/\s+/g, " ").trim()
    const quantity = Number(match[2].replace(/,/g, ""))
    const unitAmount = Number(match[3].replace(/,/g, ""))
    const lineAmount = Number(match[4].replace(/,/g, ""))
    if (!description || !Number.isFinite(quantity) || !Number.isFinite(unitAmount) || !Number.isFinite(lineAmount)) continue
    if (/^(subtotal|total|gst|tax|balance|due|amount)/i.test(description)) continue
    lineItems.push({ Description: description, Quantity: quantity, UnitAmount: unitAmount, LineAmount: lineAmount })
  }

  let amount: number | null = null
  const amountMatch = text.match(/(?:grand\s+)?total\s*\$?([\d,]+(?:\.\d+)?)/i)
  if (amountMatch?.[1]) {
    const parsed = Number(amountMatch[1].replace(/,/g, ""))
    if (Number.isFinite(parsed)) amount = parsed
  }

  return { invoiceDate, dueDate, lineItems, amount }
}

function stripQuotedPrintable(value: string) {
  return value
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_match, hex) => String.fromCharCode(parseInt(hex, 16)))
}

export function extractEmailText(rawEmail: string) {
  const normalized = rawEmail.replace(/\r\n/g, "\n").replace(/\u2028|\u2029/g, " ")
  const htmlMatch = normalized.match(/<html[\s\S]*?<\/html>/i)
  const plainText = normalized
    .split(/\n\n/)
    .slice(1)
    .join("\n")
    .replace(/\u0000/g, "")
    .replace(/\\u2028|\\u2029/g, " ")
    .replace(/\\/g, " ")

  const htmlText = htmlMatch
    ? stripQuotedPrintable(htmlMatch[0])
      .replace(/<\s*br\s*\/?\s*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
    : ""

  return `${plainText} ${htmlText}`.replace(/\s+/g, " ").trim()
}

async function getXeroAccessToken(): Promise<string> {
  const direct = Deno.env.get("XERO_ACCESS_TOKEN") ?? Deno.env.get("FINANCE_XERO_ACCESS_TOKEN");
  const refreshToken = Deno.env.get("XERO_REFRESH_TOKEN") ?? Deno.env.get("FINANCE_XERO_REFRESH_TOKEN");
  const clientId = Deno.env.get("XERO_CLIENT_ID") ?? Deno.env.get("FINANCE_XERO_CLIENT_ID");
  const clientSecret = Deno.env.get("XERO_CLIENT_SECRET") ?? Deno.env.get("FINANCE_XERO_CLIENT_SECRET");

  if (!refreshToken || !clientId || !clientSecret) {
    if (direct?.trim()) return direct.trim();
    throw new Error("Missing Xero credentials. Set XERO_CLIENT_ID, XERO_CLIENT_SECRET, and XERO_REFRESH_TOKEN (preferred), or XERO_ACCESS_TOKEN as a fallback.");
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

    const response = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Failed to refresh Xero token: ${await response.text()}`);
    }

    const data = await response.json();
    if (!data?.access_token) {
      throw new Error("No access token returned from Xero");
    }

    return String(data.access_token);
  } catch (error) {
    if (direct?.trim()) {
      console.warn("Xero refresh token failed; falling back to direct access token.", error);
      return direct.trim();
    }
    throw error;
  }
}

async function fetchXeroTenants(accessToken: string) {
  const response = await fetch("https://api.xero.com/connections", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch Xero connections: ${await response.text()}`);
  }
  return await response.json();
}

/**
 * Xero returns a single "A validation exception occurred" wrapper and puts the
 * usable detail in Elements[].ValidationErrors (invoice level) and
 * Elements[].LineItems[].ValidationErrors (per line). Surfacing those keeps the
 * failure diagnosable instead of dumping the whole echoed invoice back at the UI.
 */
function summarizeXeroError(text: string): string {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text.slice(0, 2000);
  }

  const elements: any[] = Array.isArray(parsed?.Elements) ? parsed.Elements : [];
  const messages: string[] = [];
  const add = (message: string) => {
    const clean = String(message ?? "").trim();
    if (clean && !messages.includes(clean)) messages.push(clean);
  };

  add(parsed?.Message);
  if (parsed?.ErrorNumber !== undefined) add(`ErrorNumber ${parsed.ErrorNumber}`);

  for (const element of elements) {
    for (const validation of element?.ValidationErrors ?? []) add(validation?.Message);
    for (const [index, line] of (element?.LineItems ?? []).entries()) {
      for (const validation of line?.ValidationErrors ?? []) {
        add(`Line ${index + 1} (${line?.Description || "no description"}): ${validation?.Message}`);
      }
    }
  }

  if (messages.length === 0) return text.slice(0, 2000);

  const hasDetail = messages.length > 2 || !messages.includes(parsed?.Message);
  return hasDetail ? messages.join(" | ") : messages.join(" | ");
}

async function postXeroBill(accessToken: string, tenantId: string, invoice: Record<string, unknown>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

  try {
    // Routed through the shared limiter so a fifty-invoice batch cannot burst
    // past Xero's 5-concurrent / 60-per-minute ceiling.
    const response = await xeroFetch("https://api.xero.com/api.xro/2.0/Invoices", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ Invoices: [invoice] }),
      signal: controller.signal
    });

    clearTimeout(timeout);

    const text = await response.text();
    if (!response.ok) {
      const summary = summarizeXeroError(text);
      // Callers branch on the collision code to generate a replacement number,
      // so it must survive the message flattening summarizeXeroError performs.
      const error = new Error(`Xero invoice create failed (${response.status}): ${summary}`);
      (error as Error & { xeroBody?: string; xeroStatus?: number }).xeroBody = text;
      (error as Error & { xeroBody?: string; xeroStatus?: number }).xeroStatus = response.status;
      throw error;
    }

    const data = text ? JSON.parse(text) : {};
    const created = Array.isArray(data?.Invoices) ? data.Invoices[0] : null;
    if (!created?.InvoiceID) {
      throw new Error(`Xero invoice create returned no invoice id: ${summarizeXeroError(text)}`);
    }
    return created;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}


async function fetchXeroInvoicesWhere(accessToken: string, tenantId: string, where: string) {
  // includeArchived is required, not optional: Xero hides ARCHIVED/DELETED invoices by
  // default, and a hidden bill still owns its number. Without this the collision is never
  // detected and the POST just fails with an opaque 400.
  const response = await xeroFetch(
    `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(where)}&includeArchived=true&page=1`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
      },
    },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`Xero invoice lookup failed (${response.status}): ${summarizeXeroError(text)}`);
  return JSON.parse(text || "{}");
}

/**
 * Xero treats a POST for an invoice number that already exists as a modification of that
 * invoice. If the existing bill is already AUTHORISED the API answers with
 * "Invoice not of valid status for modification", which is why the create appeared to fail
 * even though the payload was correct. Look the number up first and link instead of re-posting.
 */
async function findExistingXeroBill(accessToken: string, tenantId: string, invoiceNumber: string) {
  const safeNumber = String(invoiceNumber).replace(/"/g, "");
  if (!safeNumber) return null;
  const data = await fetchXeroInvoicesWhere(accessToken, tenantId, `InvoiceNumber=="${safeNumber}"`);
  const invoices: any[] = Array.isArray(data?.Invoices) ? data.Invoices : [];
  return invoices.find((invoice) => invoice?.Type === "ACCPAY") ?? invoices[0] ?? null;
}

/** Strips everything that varies between two spellings of the same company name. */
export function normalizeContactName(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    // "Abby & Wells" and "Abby Wells" are the same company, so the conjunction is dropped
    // rather than left to decide whether the two names are the same.
    .replace(/\band\b/g, " ")
    // Legal and geographic suffixes carry no identity, so they must not prevent a match.
    .replace(/\b(ltd|limited|co|company|group|holdings|partners|llc|llp|inc|incorporated|nz|new zealand)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Unmatched supplier" is a marker, never a real contact. */
function isUnresolvedSupplier(name: string): boolean {
  const normalized = normalizeContactName(name);
  return normalized === "" || normalized === "unmatched supplier";
}

const AUTO_CREATE_CONTACT_CONFIDENCE_THRESHOLD = 80;

async function createXeroContact(
  accessToken: string,
  tenantId: string,
  contactName: string,
): Promise<{ contactId: string; name: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await xeroFetch(
      "https://api.xero.com/api.xro/2.0/Contacts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Xero-tenant-id": tenantId,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          Contacts: [
            {
              Name: contactName,
              IsSupplier: true,
            },
          ],
        }),
        signal: controller.signal,
      },
    );

    clearTimeout(timeout);

    const text = await response.text();
    if (!response.ok) {
      const summary = summarizeXeroError(text);
      throw new Error(`Xero contact create failed (${response.status}): ${summary}`);
    }

    const data = text ? JSON.parse(text) : {};
    const created = Array.isArray(data?.Contacts) ? data.Contacts[0] : null;
    if (!created?.ContactID) {
      throw new Error(`Xero contact create returned no contact id: ${summarizeXeroError(text)}`);
    }
    return { contactId: String(created.ContactID), name: String(created.Name) };
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

export type ContactMatchTier = "exact" | "normalized" | "suggested" | "none";

/**
 * Ranks how likely two names are to be the same supplier, for use as a suggestion only.
 * Returns 0 unless the shorter name's words are all contained in the longer one, so
 * "Fusion" and "Repco" both score 0 against "Computer Fusion".
 */
export function scoreContactNameMatch(extracted: string, existing: string): number {
  if (isUnresolvedSupplier(extracted) || isUnresolvedSupplier(existing)) return 0;

  const aWords = normalizeContactName(extracted).split(" ").filter(Boolean);
  const bWords = normalizeContactName(existing).split(" ").filter(Boolean);
  if (aWords.length === 0 || bWords.length === 0) return 0;

  const aSet = new Set(aWords);
  const bSet = new Set(bWords);
  const shorter = aSet.size <= bSet.size ? aSet : bSet;
  const longer = aSet.size <= bSet.size ? bSet : aSet;
  if (![...shorter].every((word) => longer.has(word))) return 0;

  const overlap = shorter.size / longer.size;
  const lengthRatio = Math.min(aWords.length, bWords.length) / Math.max(aWords.length, bWords.length);
  return Math.min(1, 0.75 * overlap + 0.25 * lengthRatio);
}

/**
 * Decides whether an extracted supplier name is the same contact as one already in Xero.
 *
 * Only an exact or normalised match is trusted enough to post against. A shorter name whose
 * words are contained in a longer one ("Fusion" vs "Computer Fusion") is a plausible but
 * unproven guess, so it is returned as a suggestion for the user to confirm rather than
 * linked silently.
 */
export function matchContactName(extracted: string, existing: string): { tier: ContactMatchTier; score: number } {
  if (isUnresolvedSupplier(extracted) || isUnresolvedSupplier(existing)) return { tier: "none", score: 0 };

  const rawA = String(extracted ?? "").trim().toLowerCase();
  const rawB = String(existing ?? "").trim().toLowerCase();
  if (!rawA || !rawB) return { tier: "none", score: 0 };
  if (rawA === rawB) return { tier: "exact", score: 1 };

  const normA = normalizeContactName(extracted);
  const normB = normalizeContactName(existing);
  if (!normA || !normB) return { tier: "none", score: 0 };
  if (normA === normB) return { tier: "normalized", score: 1 };

  // A domain-derived name loses its word breaks: "Computerfusion" vs "Computer Fusion".
  if (normA.replace(/\s+/g, "") === normB.replace(/\s+/g, "")) {
    return { tier: "normalized", score: 0.98 };
  }

  const score = scoreContactNameMatch(extracted, existing);
  return score >= 0.5 ? { tier: "suggested", score } : { tier: "none", score: 0 };
}

/**
 * In-request memo for the contact list.
 *
 * A twenty-candidate batch previously issued twenty identical Contacts GETs,
 * which consumed the whole per-minute quota before the first bill was posted
 * and made the batch itself a cause of the 429s it then had to survive. Keyed by
 * tenant so a multi-tenant switch cannot serve one org's contacts to another.
 *
 * Deliberately a short in-request memo rather than the 24-hour static cache:
 * a supplier added to Xero this morning must be resolvable this afternoon, and
 * contacts are not the slowly-changing reference data the cache is for.
 */
const contactListMemo = new Map<string, { expiresAt: number; contacts: Array<Record<string, any>> }>();

const CONTACT_MEMO_TTL_MS = 5 * 60_000;

async function fetchXeroContacts(accessToken: string, tenantId: string): Promise<Array<Record<string, any>>> {
  const memo = contactListMemo.get(tenantId);
  if (memo && memo.expiresAt > Date.now()) return memo.contacts;

  const response = await xeroFetch(
    "https://api.xero.com/api.xro/2.0/Contacts?page=1&pageSize=200",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
      },
    },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`Xero contact lookup failed (${response.status}): ${summarizeXeroError(text)}`);
  const parsed = JSON.parse(text || "{}");
  const contacts = Array.isArray(parsed?.Contacts) ? parsed.Contacts : [];

  contactListMemo.set(tenantId, { expiresAt: Date.now() + CONTACT_MEMO_TTL_MS, contacts });
  return contacts;
}

/**
 * The Xero Chart of Accounts, cached for 24 hours.
 *
 * Used to confirm that an account code extracted or configured for a line item
 * actually exists in the ledger. Without the check a wrong code is accepted by
 * the payload builder and rejected by Xero as an opaque 400, which is exactly
 * the failure mode the deterministic validation layer exists to remove.
 */
async function fetchXeroChartOfAccounts(
  accessToken: string,
  tenantId: string,
  supabase: any,
): Promise<Array<Record<string, any>>> {
  const { data, fromCache } = await getCachedXeroResource<Record<string, any>>(supabase, {
    tenantId,
    resource: "accounts",
    fetcher: async () => {
      const response = await xeroFetch(
        "https://api.xero.com/api.xro/2.0/Accounts?page=1&pageSize=200",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Xero-tenant-id": tenantId,
            Accept: "application/json",
          },
        },
      );
      const text = await response.text();
      if (!response.ok) throw new Error(`Xero account lookup failed (${response.status}): ${summarizeXeroError(text)}`);
      const parsed = JSON.parse(text || "{}");
      return Array.isArray(parsed?.Accounts) ? parsed.Accounts : [];
    },
  });

  if (!fromCache) console.log(`[xero-cache] Chart of Accounts refreshed for tenant ${tenantId}`);
  return data;
}

/**
 * Resolves an extracted supplier name to a real Xero contact.
 *
 * An exact `Name==` lookup is not enough: the extracted name is often a normalised or inferred
 * variant, so "Computerfusion" misses the "Computer Fusion" contact that already exists and
 * the bill stalls on contact_not_found. Confident matches are used directly; near misses are
 * returned as suggestions so the user can confirm rather than create a duplicate contact.
 */
export async function resolveXeroContact(
  accessToken: string,
  tenantId: string,
  contactName: string,
): Promise<{
  contact: Record<string, any> | null;
  matchType: ContactMatchTier;
  score: number;
  candidates: Array<{ name: string; contactId: string; score: number }>;
}> {
  const safeName = String(contactName ?? "").replace(/"/g, "").trim();
  const none = { contact: null, matchType: "none" as const, score: 0, candidates: [] };
  if (!safeName || isUnresolvedSupplier(safeName)) return none;

  const contacts = await fetchXeroContacts(accessToken, tenantId);

  // Best confident match wins. Scanning the whole list avoids the pagination gaps that a
  // name-filtered query can miss.
  let best: { contact: Record<string, any>; tier: ContactMatchTier; score: number } | null = null;
  for (const contact of contacts) {
    const name = String(contact?.Name ?? "");
    const result = matchContactName(safeName, name);
    if (result.tier === "none") continue;
    if (!best || result.score > best.score) best = { contact, tier: result.tier, score: result.score };
    if (best.tier === "exact") break;
  }

  if (best) {
    return { contact: best.contact, matchType: best.tier, score: best.score, candidates: [] };
  }

  // Nothing matched. Offer the closest names so the user can confirm the right contact
  // instead of creating a duplicate.
  const candidates = contacts
    .filter((contact) => !isUnresolvedSupplier(String(contact?.Name ?? "")))
    .map((contact) => ({
      name: String(contact?.Name ?? ""),
      contactId: String(contact?.ContactID ?? ""),
      score: scoreContactNameMatch(safeName, String(contact?.Name ?? "")),
    }))
    .filter((candidate) => candidate.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return { contact: null, matchType: "suggested", score: candidates[0]?.score ?? 0, candidates };
}

/** Xero statuses that mean the invoice still "owns" its number. */
const ACTIVE_XERO_STATUSES = new Set(["DRAFT", "AUTHORISED", "SUBMITTED", "PAID", "PARTIALLYPAID"]);

/**
 * Compares a candidate against the invoice already in Xero so a linked bill that
 * disagrees with the extracted data is never reported as a silent success.
 */
function diffXeroBill(candidate: Record<string, any>, bill: Record<string, any>): string[] {
  const mismatches: string[] = [];
  const billContact = String(bill?.Contact?.Name ?? "").trim();
  const billDate = asDateString(bill?.Date) ?? asDateString(bill?.DateString);
  const billDue = asDateString(bill?.DueDate) ?? asDateString(bill?.DueDateString);
  const billTotal = toMoney(bill?.Total);
  const billLines = Array.isArray(bill?.LineItems) ? (bill.LineItems as Array<Record<string, any>>) : [];
  const candidateLines = normalizeLineItems(candidate.line_items, "400");
  const candidateTotal = toMoney(candidate.gross_total ?? candidate.subtotal);

  if (billContact && billContact.toLowerCase() !== String(candidate.supplier_name ?? "").trim().toLowerCase()) {
    mismatches.push(`contact "${billContact}" vs "${candidate.supplier_name}"`);
  }
  if (billDate && billDate !== asDateString(candidate.invoice_date)) {
    mismatches.push(`date ${billDate} vs ${asDateString(candidate.invoice_date)}`);
  }
  if (billDue && billDue !== asDateString(candidate.due_date)) {
    mismatches.push(`due date ${billDue} vs ${asDateString(candidate.due_date)}`);
  }
  if (Math.abs(billTotal - candidateTotal) > 0.05) {
    mismatches.push(`total ${billTotal} vs ${candidateTotal}`);
  }
  if (billLines.length !== candidateLines.length) {
    mismatches.push(`${billLines.length} line item(s) in Xero vs ${candidateLines.length} extracted`);
  }
  return mismatches;
}

async function loadValidatedCandidates(supabase: any, candidateIds?: string[]) {
  let query = supabase
    .from("finance_invoice_candidates")
    .select("*, intake_item:finance_intake_items!finance_invoice_candidates_intake_item_id_fkey(*)")
    .in("status", ["validated", "ready", "posted", "review"]);

  if (candidateIds && candidateIds.length > 0) {
    query = query.in("id", candidateIds);
  }

  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/**
 * Records a processing event. Logging must never be able to abort a batch: if this insert
 * throws from inside a per-candidate catch block it would escape the loop and silently drop
 * every remaining invoice, so failures here are logged and swallowed.
 */
async function recordFinanceEvent(supabase: any, event: Record<string, unknown>) {
  try {
    const { error } = await supabase.from("finance_processing_events").insert(event);
    if (error) console.warn("[post_xero] Failed to log event:", error.message);
  } catch (error) {
    console.warn("[post_xero] Event insert threw:", error instanceof Error ? error.message : String(error));
  }
}

/**
 * Moves a message out of the "Invoices to process" label once its bill is safely in Xero,
 * so the next Gmail pull does not re-ingest work that is already done.
 *
 * Best effort by design: the bill is already written by the time this runs, so a Gmail
 * failure must not be reported as a posting failure. The message simply stays in the
 * pending label and is re-picked up later.
 */
async function markGmailMessageProcessed(
  supabase: any,
  intakeItemId: string | null | undefined,
): Promise<{ swapped: boolean; reason?: string }> {
  if (!intakeItemId) return { swapped: false, reason: "no_intake_item" };

  const { data: item } = await supabase
    .from("finance_intake_items")
    .select("gmail_message_id, metadata")
    .eq("id", intakeItemId)
    .maybeSingle();

  const messageId = item?.gmail_message_id ?? null;
  if (!messageId) return { swapped: false, reason: "not_a_gmail_item" };

  const pendingLabelName = String(item?.metadata?.gmailLabel ?? Deno.env.get("FINANCE_GMAIL_LABEL") ?? "Invoices to process");
  const processedLabelName = Deno.env.get("FINANCE_GMAIL_PROCESSED_LABEL") ?? "Invoices processed";

  try {
    const accessToken = await fetchGoogleAccessToken();
    const pendingLabelId = await resolveLabelId(accessToken, pendingLabelName);
    const processedLabelId = await resolveLabelId(accessToken, processedLabelName);

    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          addLabelIds: [processedLabelId],
          removeLabelIds: [pendingLabelId],
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      console.warn(`[post_xero] Gmail relabel failed (${response.status}): ${detail.slice(0, 500)}`);
      return { swapped: false, reason: `gmail_modify_failed:${response.status}` };
    }

    console.log(`[post_xero] Relabelled Gmail message ${messageId} as processed`);
    return { swapped: true };
  } catch (error) {
    console.warn("[post_xero] Gmail relabel skipped:", error instanceof Error ? error.message : String(error));
    return { swapped: false, reason: "gmail_unavailable" };
  }
}

/**
 * Enforces the line-item schema that Xero requires before any bill is posted. A candidate
 * whose line items cannot satisfy the contract is rejected with a descriptive message
 * instead of failing inside Xero as an opaque 400.
 *
 * Required per row: description, quantity, unit_amount, line_amount, tax_type.
 * account_code is optional but, when present, must be a 3-6 digit code.
 */
function validateLineItemsForXero(lineItems: Array<Record<string, unknown>>): string | null {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return "Invoice has no line items; Xero requires at least one LineItem.";
  }

  const VALID_TAX_TYPES = new Set([
    "INPUT", "INPUT2", "OUTPUT", "OUTPUT2", "NONE", "GSTONIMPORTS", "ZERO", "EXEMPTOUTPUT", "EXEMPTINPUT",
  ]);

  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i] ?? {};
    const description = String(item.Description ?? item.description ?? "").trim();
    if (!description) return `Line item ${i + 1} is missing a description.`;

    const quantity = Number(item.Quantity ?? item.quantity);
    if (!(quantity > 0)) return `Line item ${i + 1} ("${description}") has an invalid quantity.`;

    const unitAmount = Number(item.UnitAmount ?? item.unitAmount);
    const lineAmount = Number(item.LineAmount ?? item.lineAmount);
    if (!(unitAmount >= 0) || !(lineAmount >= 0)) {
      return `Line item ${i + 1} ("${description}") has invalid amounts.`;
    }

    const expected = roundMoney(unitAmount * quantity);
    if (Math.abs(expected - lineAmount) > 0.05) {
      return `Line item ${i + 1} ("${description}") amounts do not reconcile: ${unitAmount} x ${quantity} = ${expected}, but line amount is ${lineAmount}.`;
    }

    const rawTaxType = String(item.TaxType ?? item.taxType ?? "").toUpperCase().replace(/[\s-]/g, "");
    if (!VALID_TAX_TYPES.has(rawTaxType)) {
      return `Line item ${i + 1} ("${description}") has an invalid tax type "${item.TaxType ?? item.taxType}".`;
    }

    const rawAccount = String(item.AccountCode ?? item.accountCode ?? "").replace(/[\s-]/g, "").trim();
    if (rawAccount && !/^\d{3,6}$/.test(rawAccount)) {
      return `Line item ${i + 1} ("${description}") has an invalid account code "${item.AccountCode ?? item.accountCode}".`;
    }
  }

  return null;
}

/**
 * Looks up a known supplier alias for an extracted supplier name. The mapping is seeded
 * with the recurring school vendors and grows as bills are reviewed. A match lets the
 * pipeline default the Xero account code for line items that the invoice itself does not
 * print, and it surfaces the canonical contact name alongside the raw AI read.
 */
async function lookupSupplierAlias(
  supabase: any,
  supplierName: string,
): Promise<{ alias: Record<string, any> | null; accountCode: string | null; canonicalName: string | null }> {
  const normalized = normalizeContactName(supplierName)
  if (!normalized) return { alias: null, accountCode: null, canonicalName: null }

  const { data, error } = await supabase
    .from("finance_supplier_aliases")
    .select("id, supplier_name, normalized_name, xero_contact_id, xero_contact_name, default_account_code, category, active")
    .eq("active", true)
    .order("usage_count", { ascending: false })

  if (error || !Array.isArray(data) || data.length === 0) {
    return { alias: null, accountCode: null, canonicalName: null }
  }

  // Exact normalised match first, then a word-overlap fallback so "Computer Fusion" still
  // hits a row seeded as "Computerfusion".
  const exact = data.find((row: Record<string, any>) => row.normalized_name === normalized)
  if (exact) {
    await supabase.from("finance_supplier_aliases").update({ usage_count: (exact.usage_count ?? 0) + 1 }).eq("id", exact.id)
    return { alias: exact, accountCode: exact.default_account_code ?? null, canonicalName: exact.supplier_name ?? null }
  }

  const targetWords = new Set(normalized.split(" ").filter(Boolean))
  let best: { row: Record<string, any>; score: number } | null = null
  for (const row of data) {
    const words = new Set(String(row.normalized_name ?? "").split(" ").filter(Boolean))
    if (words.size === 0) continue
    const overlap = [...targetWords].filter((word) => words.has(word)).length
    const score = overlap / Math.max(targetWords.size, words.size)
    if (score > 0 && (!best || score > best.score)) best = { row, score }
  }

  if (best && best.score >= 0.5) {
    await supabase.from("finance_supplier_aliases").update({ usage_count: (best.row.usage_count ?? 0) + 1 }).eq("id", best.row.id)
    return { alias: best.row, accountCode: best.row.default_account_code ?? null, canonicalName: best.row.supplier_name ?? null }
  }

  return { alias: null, accountCode: null, canonicalName: null }
}

async function postCandidatesToXero(
  supabase: any,
  candidateIds?: string[],
  invoiceNumberOverrides?: Record<string, string>,
) {
  // Anything pushed before a batch-level failure (auth, tenant) is preserved so the
  // caller can still see which invoices made it.
  const partialResults: Array<Record<string, unknown>> = [];
  try {
    const accessToken = await getXeroAccessToken();
    const tenantId = Deno.env.get("XERO_TENANT_ID") ?? Deno.env.get("FINANCE_XERO_TENANT_ID");
    let resolvedTenantId: string;
    if (tenantId?.trim()) {
      resolvedTenantId = tenantId.trim();
    } else {
      const tenants = await fetchXeroTenants(accessToken);
      // Prefer "Demo Company (NZ)" tenant, fallback to first available
      const demoNzTenant = Array.isArray(tenants)
        ? tenants.find((t) => String(t?.tenantName ?? "").includes("Demo Company") && String(t?.tenantName ?? "").includes("NZ"))
        : null;
      const firstTenant = Array.isArray(tenants) ? tenants[0] : null;
      resolvedTenantId = (demoNzTenant ?? firstTenant)?.tenantId as string;
      if (!resolvedTenantId) {
        return { ok: false, action: "post_xero", message: "No Xero tenant available. Connect the integration and ensure a NZ tenant exists.", results: [] };
      }
    }

    const candidates = await loadValidatedCandidates(supabase, candidateIds);
    const accountCode = Deno.env.get("XERO_ACCOUNT_CODE") ?? Deno.env.get("FINANCE_XERO_ACCOUNT_CODE") ?? "400";

    // Auto-renumbering is on by default: a consumed invoice number blocks a valid bill
    // from ever reaching the ledger, and generating a replacement preserves the
    // supplier's original in the Reference. Set FINANCE_XERO_AUTO_RENUMBER=false to
    // fall back to prompting the user for a replacement number in the dashboard.
    const autoRenumberEnabled = safeEnv("FINANCE_XERO_AUTO_RENUMBER") !== "false";

    // Housekeeping: expired Chart of Accounts rows are dropped once per batch rather
    // than per candidate.
    void purgeExpiredXeroCache(supabase);

    console.log(
      `[post_xero] Pushing ${candidates.length} candidate(s) | limiter ${JSON.stringify(xeroRateLimiter.snapshot())} | autoRenumber=${autoRenumberEnabled}`,
    );

    // Loaded once for the whole batch. A failure here is not fatal: the account-code
    // check is skipped rather than blocking every bill on an unreachable endpoint.
    let validAccountCodes: Set<string> | null = null;
    try {
      const accounts = await fetchXeroChartOfAccounts(accessToken, resolvedTenantId, supabase);
      if (accounts.length > 0) {
        validAccountCodes = new Set(
          accounts
            .map((account) => String(account?.Code ?? "").trim())
            .filter(Boolean),
        );
      }
    } catch (error) {
      console.warn("[post_xero] Chart of Accounts unavailable; skipping account code check:", formatErrorValue(error));
    }

    // Each candidate is an independent unit of work so the batch can be driven by the Xero
    // rate limiter rather than a bare sequential loop. A pool of five workers plus the
    // limiter's 60-per-minute window keeps a large push inside Xero's published limits;
    // the limiter is what was previously missing, and without it a fifty-invoice batch
    // reliably earned a 429 part way through and reported it as a posting failure.
    const postOneCandidate = async (candidate: any): Promise<Record<string, unknown>> => {
      try {
        const existingLink = await supabase
          .from("finance_xero_links")
          .select("id,xero_invoice_id,xero_invoice_number,xero_status")
          .eq("candidate_id", candidate.id)
          .maybeSingle();

        if (existingLink.data?.id) {
          return {
            candidateId: candidate.id,
            status: "skipped",
            xeroInvoiceId: existingLink.data.xero_invoice_id,
            xeroInvoiceNumber: existingLink.data.xero_invoice_number,
          };
        }

        const lineItems = normalizeLineItems(candidate.line_items, accountCode);
        const total = toMoney(candidate.gross_total ?? candidate.subtotal ?? 0);
        const subtotal = toMoney(candidate.subtotal);
        const invoiceDate = asDateString(candidate.invoice_date) ?? asDateString(candidate.created_at) ?? new Date().toISOString().slice(0, 10);
        const dueDate = asDateString(candidate.due_date) ?? invoiceDate;
        const contactName = parseContactName(candidate.supplier_name ?? candidate.supplier_alias ?? null);
        // Provenance decides whether a missing contact may be created automatically. Only a
        // name read off the document itself is trustworthy enough for that.
        const supplierSource = String(
          candidate.extraction_payload?.resolvedFields?.supplierNameSource ??
          candidate.extraction_payload?.sourceLayers?.structured?.processor ??
          "unknown",
        );
        // Look the supplier up in the alias mapping before hitting Xero. A known vendor can
        // supply the canonical contact id directly (skipping the fuzzy contact scan) and a
        // default account code for line items the invoice itself does not print.
        const aliasLookup = await lookupSupplierAlias(supabase, contactName);
        const aliasAccountCode = aliasLookup.accountCode ?? accountCode;
        const aliasContactId = aliasLookup.alias?.xero_contact_id ?? null;
        const canonicalSupplierName = aliasLookup.canonicalName ?? contactName;
        // Xero burns an invoice number permanently, so a corrected bill sometimes has to
        // go out under a different number. An explicit override from the UI always wins;
        // otherwise the original is used until a collision forces a replacement below.
        const originalInvoiceNumber = sanitizeInvoiceNumber(candidate.invoice_number);
        const overrideInvoiceNumber = sanitizeInvoiceNumber(invoiceNumberOverrides?.[candidate.id]);
        let invoiceNumber = overrideInvoiceNumber ?? originalInvoiceNumber;

        // If the number had to change, the supplier's own number must not disappear. Xero has
        // no field for "the number this actually was", so it is carried in the Reference so the
        // bill can still be traced back to the source document during reconciliation.
        const extractedReference = extractInvoiceReference(candidate);
        let reference = invoiceNumber && originalInvoiceNumber && invoiceNumber !== originalInvoiceNumber
          ? [extractedReference, `Source invoice no: ${originalInvoiceNumber}`].filter(Boolean).join(" | ").slice(0, 100)
          : extractedReference;
        const referenceWasRenumbered = Boolean(
          originalInvoiceNumber && invoiceNumber && originalInvoiceNumber !== invoiceNumber,
        );

        // A POST for a number Xero already holds is treated as an update, and an
        // already-authorised bill cannot be updated. Link to it instead of re-posting.
        if (invoiceNumber && invoiceNumber === sanitizeInvoiceNumber(candidate.invoice_number)) {
          const existingBill = await findExistingXeroBill(accessToken, resolvedTenantId, invoiceNumber);
          if (existingBill?.InvoiceID) {
            const existingStatus = String(existingBill.Status ?? "UNKNOWN").toUpperCase();

            // Xero burns an invoice number permanently, even once the bill is VOIDED, DELETED
            // or ARCHIVED: a POST with that number fails with "Invoice not of valid status
            // for modification". Linking to a voided bill would look like success while
            // leaving the wrong document in place.
            //
            // In auto mode the bill is renumbered and posted anyway, because the invoice is
            // valid and only the identifier is spent. In manual mode the candidate is
            // returned as number_consumed and the dashboard prompts for a replacement.
            // Either way the supplier's own number is preserved in the Reference.
            if (!ACTIVE_XERO_STATUSES.has(existingStatus)) {
              const replacement = autoRenumberEnabled
                ? buildReplacementInvoiceNumber(invoiceNumber)
                : null;

              if (replacement) {
                console.log(`[post_xero] Invoice number ${invoiceNumber} is consumed by a ${existingStatus} bill; reposting as ${replacement}`);
                invoiceNumber = replacement;
                reference = [extractedReference, `Source invoice no: ${originalInvoiceNumber ?? invoiceNumber}`]
                  .filter(Boolean)
                  .join(" | ")
                  .slice(0, 100);

                await recordFinanceEvent(supabase, {
                  candidate_id: candidate.id,
                  intake_item_id: candidate.intake_item_id,
                  event_type: "manual_review",
                  severity: "warning",
                  details: {
                    message: `Invoice number ${originalInvoiceNumber} is permanently consumed by a ${existingStatus} bill (${existingBill.InvoiceID}). Reposting as ${replacement}; the original number is preserved in the bill's Reference.`,
                    xeroInvoiceId: existingBill.InvoiceID,
                    xeroStatus: existingStatus,
                    originalInvoiceNumber,
                    replacementInvoiceNumber: replacement,
                  },
                });

                await appendAuditLog(supabase, {
                  intakeItemId: candidate.intake_item_id,
                  candidateId: candidate.id,
                  eventType: "xero_pushed",
                  source: "worker",
                  metadata: { autoRenumbered: true, originalInvoiceNumber, replacementInvoiceNumber: replacement },
                });
              } else {
                const message = `Invoice number ${invoiceNumber} is already used in Xero by a ${existingStatus} bill (${existingBill.InvoiceID}). Xero permanently consumes an invoice number the first time it is used, so this number can never be reused. Re-post this bill under a different number to send it to Xero; the original number is kept in the bill's Reference so the source document stays traceable.`;
                await recordFinanceEvent(supabase, {
                  candidate_id: candidate.id,
                  intake_item_id: candidate.intake_item_id,
                  event_type: "manual_review",
                  severity: "warning",
                  details: { message, xeroInvoiceId: existingBill.InvoiceID, xeroStatus: existingStatus },
                });
                await appendAuditLog(supabase, {
                  intakeItemId: candidate.intake_item_id,
                  candidateId: candidate.id,
                  eventType: "xero_failed",
                  source: "worker",
                  metadata: { reason: "number_consumed", xeroInvoiceId: existingBill.InvoiceID, xeroStatus: existingStatus },
                });
                return {
                  candidateId: candidate.id,
                  status: "number_consumed",
                  supplier: candidate.supplier_name,
                  invoiceNumber,
                  xeroInvoiceId: existingBill.InvoiceID,
                  xeroStatus: existingStatus,
                  xeroUrl: existingBill.Url ?? null,
                  error: message,
                };
              }
            } else {

            const mismatches = diffXeroBill(candidate, existingBill);
            const { data: link, error: linkError } = await supabase
              .from("finance_xero_links")
              .insert({
                candidate_id: candidate.id,
                xero_tenant_id: resolvedTenantId,
                xero_invoice_id: String(existingBill.InvoiceID),
                xero_invoice_number: existingBill.InvoiceNumber ?? null,
                xero_status: String(existingBill.Status ?? "UNKNOWN"),
                xero_type: String(existingBill.Type ?? "ACCPAY"),
                xero_url: existingBill.Url ?? null,
                idempotency_key: `link:${candidate.id.slice(0, 8)}:${String(existingBill.InvoiceID).slice(0, 12)}`,
                create_status: "synced",
                last_synced_at: new Date().toISOString(),
              })
              .select("id")
              .single();
            if (linkError) throw linkError;

            await supabase.from("finance_invoice_candidates").update({ status: "written" }).eq("id", candidate.id);
            if (link?.id) {
              await supabase.from("finance_intake_items").update({
                status: "synced",
                processed_at: new Date().toISOString(),
              }).eq("id", candidate.intake_item_id);
            }

            await recordFinanceEvent(supabase, {
              candidate_id: candidate.id,
              intake_item_id: candidate.intake_item_id,
              event_type: "duplicate_blocked",
              severity: mismatches.length > 0 ? "warning" : "info",
              details: {
                xeroInvoiceId: existingBill.InvoiceID,
                xeroStatus: existingBill.Status,
                xeroDate: existingBill.DateString ?? null,
                xeroTotal: existingBill.Total ?? null,
                xeroContact: existingBill.Contact?.Name ?? null,
                mismatches,
                note: "Linked to the invoice that already exists in Xero; no new bill was created.",
              },
            });

            const gmail = await markGmailMessageProcessed(supabase, candidate.intake_item_id);

            return {
              candidateId: candidate.id,
              status: "already_exists",
              xeroInvoiceId: existingBill.InvoiceID,
              xeroInvoiceNumber: existingBill.InvoiceNumber ?? null,
              xeroStatus: existingBill.Status ?? null,
              xeroContact: existingBill.Contact?.Name ?? null,
              xeroDate: existingBill.DateString ?? null,
              xeroUrl: existingBill.Url ?? null,
              gmailRelabelled: gmail.swapped,
              mismatches,
              message: mismatches.length > 0
                ? `Invoice ${candidate.invoice_number} already exists in Xero (${existingBill.Status}) but it does not match the extracted data: ${mismatches.join("; ")}. Linked without creating a duplicate - correct or void the Xero bill.`
                : `Invoice ${candidate.invoice_number} already exists in Xero (${existingBill.Status}) and matches. Linked without creating a duplicate.`,
            };
          }
        }
        }

        // Resolve the supplier to a real Xero contact. Posting with a loose name lets Xero
        // attach the bill to the wrong contact, or silently create a new one: Xero auto-creates
        // a contact for any name a bill is posted under, which is how the contact list ended up
        // holding entries like "Shaneb 26" and "Fw: Invoice IV00004431; From Computer Fusion".
        //
        // A known alias can short-circuit this scan entirely: if the mapping already carries the
        // canonical Xero contact id, use it directly instead of re-resolving the fuzzy name.
        let resolution = await resolveXeroContact(accessToken, resolvedTenantId, canonicalSupplierName)
        if (aliasContactId && (!resolution.contact || resolution.matchType === "none")) {
          resolution = {
            contact: { ContactID: aliasContactId, Name: canonicalSupplierName },
            matchType: "exact",
            score: 1,
            candidates: [],
          }
        }
        if (!resolution.contact?.ContactID) {
          const suggestions = resolution.candidates
            .map((candidate) => `${candidate.name} (${Math.round(candidate.score * 100)}% match)`)
            .join(", ");

          // A near miss is a confirmation prompt, not a dead end: the extracted name is often
          // just a different spelling of a contact Xero already has.
          const message = suggestions
            ? `No Xero contact is named exactly "${contactName}", but these look similar: ${suggestions}. Confirm the right contact before posting.`
            : `No Xero contact named "${contactName}" exists. Create the supplier in Xero, then retry.`;

          // Auto-create contact when:
          // 1. Supplier name came from the document (not email/subject)
          // 2. Extraction confidence is high enough
          // 3. No close matches exist in Xero (suggestions would be a near-match)
          const candidateConfidence = Number(candidate.confidence ?? 0);
          const canAutoCreate = supplierSource === "document" && candidateConfidence >= AUTO_CREATE_CONTACT_CONFIDENCE_THRESHOLD && !suggestions;

          if (canAutoCreate) {
            console.log(`[post_xero] Auto-creating Xero contact "${canonicalSupplierName}" (confidence: ${candidateConfidence})`);
            try {
              const createdContact = await createXeroContact(accessToken, resolvedTenantId, canonicalSupplierName);
              if (createdContact) {
                await recordFinanceEvent(supabase, {
                  candidate_id: candidate.id,
                  intake_item_id: candidate.intake_item_id,
                  event_type: "contact_created",
                  severity: "info",
                  details: {
                    contactName: canonicalSupplierName,
                    contactId: createdContact.contactId,
                    confidence: candidateConfidence,
                    message: `Auto-created Xero contact for supplier "${canonicalSupplierName}"`,
                  },
                });

                resolution = {
                  contact: { ContactID: createdContact.contactId, Name: createdContact.name },
                  matchType: "exact",
                  score: 1,
                  candidates: [],
                };
              }
            } catch (contactError) {
              const contactErrorMessage = contactError instanceof Error ? contactError.message : String(contactError);
              console.warn(`[post_xero] Failed to auto-create contact: ${contactErrorMessage}`);
              // Fall through to manual review
            }
          }

          // If we still don't have a contact after potential auto-creation, return for manual review
          if (!resolution.contact?.ContactID) {
            await recordFinanceEvent(supabase, {
              candidate_id: candidate.id,
              intake_item_id: candidate.intake_item_id,
              event_type: suggestions ? "manual_review" : "failed",
              severity: "warning",
              details: {
                message,
                supplier: candidate.supplier_name,
                supplierSource,
                invoiceNumber: candidate.invoice_number,
                suggestedContacts: resolution.candidates,
                autoCreateAttempted: canAutoCreate,
              },
            });

            return {
              candidateId: candidate.id,
              status: suggestions ? "contact_needs_confirmation" : "contact_not_found",
              supplier: contactName,
              error: message,
              suggestions: resolution.candidates,
              // Only a document-derived name may be turned into a new Xero contact without
              // a human checking it first.
              canAutoCreate: supplierSource === "document",
              autoCreateThreshold: AUTO_CREATE_CONTACT_CONFIDENCE_THRESHOLD,
              candidateConfidence,
            };
          }
        }
        const contact = resolution.contact;

        // A name that only matched after normalisation is worth recording: it means the
        // extracted spelling differed from the one in Xero.
        if (resolution.matchType === "normalized") {
          await recordFinanceEvent(supabase, {
            candidate_id: candidate.id,
            intake_item_id: candidate.intake_item_id,
            event_type: "contact_matched",
            severity: "info",
            details: {
              extractedName: contactName,
              matchedName: String(contact.Name ?? ""),
              contactId: String(contact.ContactID),
              note: "Matched ignoring case, spacing, punctuation and legal suffixes.",
            },
          });
        }
        const contactId = String(contact.ContactID);

        // Xero bills are posted GST-exclusive. If the candidate only carries a single
        // GST-inclusive figure, use it as the exclusive amount rather than inflating the bill.
        const exclusiveLines = lineItems.length > 0
          ? lineItems
          : [
            {
              Description: candidate.supplier_name ?? "Finance invoice",
              Quantity: 1,
              UnitAmount: subtotal > 0 ? subtotal : total,
              LineAmount: subtotal > 0 ? subtotal : total,
              AccountCode: aliasAccountCode,
              TaxType: mapGstAmountToTaxType(candidate.tax_total, subtotal > 0 ? subtotal : total),
            },
          ];

        // Default the account code for any line item the invoice itself did not print one
        // for, using the supplier's mapped purchase category. This is what stops a bill from
        // landing on a wrong GL code just because the model left accountCode null.
        // Also map tax types: if line has 0 GST, use EXEMPTOUTPUT instead of INPUT2
        const defaultedLines = exclusiveLines.map((item) => {
          const record = item as Record<string, unknown>;
          const lineGstAmount = toFiniteNumber(record.gstAmount ?? record.taxAmount ?? record.TaxAmount);
          const lineAmount = toFiniteNumber(record.LineAmount ?? record.lineAmount ?? record.Amount);
          const currentTaxType = String(record.TaxType ?? record.taxType ?? "").toUpperCase().replace(/[\s-]/g, "");
          
          // If tax type is not set or is the default INPUT2 but line has 0 GST, map to EXEMPTOUTPUT
          let taxType = currentTaxType;
          if (!taxType || (taxType === "INPUT2" && lineGstAmount !== null && lineGstAmount <= 0)) {
            taxType = mapGstAmountToTaxType(lineGstAmount, lineAmount);
          }
          
          return {
            ...item,
            AccountCode: record.AccountCode ?? record.accountCode ?? aliasAccountCode,
            TaxType: taxType,
          };
        });

        // Confirm the GL code actually exists in the ledger. The Chart of Accounts is read
        // through a 24-hour cache, so this check costs at most one outbound call per day
        // per tenant rather than one per invoice. A code the model invented is the single
        // most common cause of a silent posting failure, and catching it here converts
        // an opaque Xero 400 into a specific, fixable review item.
        if (validAccountCodes && defaultedLines.length > 0) {
          const unknownCodes = [...new Set(
            defaultedLines
              .map((item) => String((item as Record<string, unknown>).AccountCode ?? "").trim())
              .filter((code) => code && !validAccountCodes.has(code)),
          )];
          if (unknownCodes.length > 0) {
            const message = `Account code${unknownCodes.length === 1 ? "" : "s"} ${unknownCodes.join(", ")} ${unknownCodes.length === 1 ? "does" : "do"} not exist in the Xero Chart of Accounts. Set a valid expense code on the line items or on the supplier alias before posting.`;
            await recordFinanceEvent(supabase, {
              candidate_id: candidate.id,
              intake_item_id: candidate.intake_item_id,
              event_type: "manual_review",
              severity: "warning",
              details: { message, unknownAccountCodes: unknownCodes, supplier: candidate.supplier_name },
            });
            await appendAuditLog(supabase, {
              intakeItemId: candidate.intake_item_id,
              candidateId: candidate.id,
              eventType: "xero_failed",
              source: "worker",
              metadata: { reason: "unknown_account_code", unknownAccountCodes: unknownCodes },
            });
            return {
              candidateId: candidate.id,
              status: "failed",
              supplier: candidate.supplier_name ?? null,
              invoiceNumber: candidate.invoice_number ?? null,
              error: message,
            };
          }
        }

        // Enforce the line-item schema Xero requires before sending the payload. A candidate
        // that cannot satisfy it is reported here rather than failing inside Xero as an
        // opaque 400, and the audit event makes the rejection diagnosable.
        const lineItemValidationError = validateLineItemsForXero(defaultedLines);
        if (lineItemValidationError) {
          const message = `Refusing to post invoice ${candidate.invoice_number ?? candidate.id}: ${lineItemValidationError}`;
          await recordFinanceEvent(supabase, {
            candidate_id: candidate.id,
            intake_item_id: candidate.intake_item_id,
            event_type: "failed",
            severity: "error",
            details: { message, supplier: candidate.supplier_name, invoiceNumber: candidate.invoice_number },
          });
          return {
            candidateId: candidate.id,
            status: "failed",
            supplier: candidate.supplier_name ?? null,
            invoiceNumber: candidate.invoice_number ?? null,
            error: message,
          };
        }

        const invoicePayload = {
          Type: "ACCPAY",
          Contact: { ContactID: contactId, Name: contactName },
          Date: invoiceDate,
          DueDate: dueDate,
          LineAmountTypes: "Exclusive",
          Status: "DRAFT",
          ...(reference ? { Reference: reference } : {}),
          ...(invoiceNumber ? { InvoiceNumber: invoiceNumber } : {}),
          LineItems: defaultedLines,
        };

        // The pre-emptive lookup above catches a number that Xero already owns, but it
        // queries only the first page and can race with another posting, so the create
        // call is still treated as authoritative. A collision reported here is retried
        // once under a fresh number rather than surfaced as a failure, because the
        // invoice itself is fine and only the identifier is spent.
        let created: Record<string, any>;
        try {
          created = await postXeroBill(accessToken, resolvedTenantId, invoicePayload);
        } catch (postError) {
          const postBody = (postError as { xeroBody?: string })?.xeroBody ?? "";
          const postMessage = postError instanceof Error ? postError.message : String(postError);
          const body = postBody || postMessage;
          const retryNumber = invoiceNumber && autoRenumberEnabled
            ? buildReplacementInvoiceNumber(invoiceNumber)
            : null;

          if (!isInvoiceNumberCollision(body) || !retryNumber) throw postError;

          console.warn(`[post_xero] ${invoiceNumber} collided on create; retrying as ${retryNumber}`);
          reference = [extractedReference, `Source invoice no: ${originalInvoiceNumber ?? invoiceNumber}`]
            .filter(Boolean)
            .join(" | ")
            .slice(0, 100);
          invoiceNumber = retryNumber;
          created = await postXeroBill(accessToken, resolvedTenantId, {
            ...invoicePayload,
            InvoiceNumber: retryNumber,
            ...(reference ? { Reference: reference } : {}),
          });

          await recordFinanceEvent(supabase, {
            candidate_id: candidate.id,
            intake_item_id: candidate.intake_item_id,
            event_type: "manual_review",
            severity: "warning",
            details: {
              message: `Xero rejected invoice number ${originalInvoiceNumber} as already in use. Reposting as ${retryNumber}; the original number is preserved in the bill's Reference.`,
              originalInvoiceNumber,
              replacementInvoiceNumber: retryNumber,
            },
          });
        }

        // Shorten idempotency key to stay within Xero's length limit (max ~50-100 chars)
        const idempotencyKey = `fi:${candidate.id.slice(0, 8)}:${created.InvoiceID.slice(0, 12)}`;

        const { error: linkError } = await supabase
          .from("finance_xero_links")
          .insert({
            candidate_id: candidate.id,
            xero_tenant_id: resolvedTenantId,
            xero_invoice_id: String(created.InvoiceID),
            xero_invoice_number: created.InvoiceNumber ?? null,
            xero_status: String(created.Status ?? "DRAFT"),
            xero_type: String(created.Type ?? "ACCPAY"),
            xero_url: created.Url ?? null,
            idempotency_key: idempotencyKey,
            create_status: "submitted",
            last_synced_at: new Date().toISOString(),
          })
          .select("id")
          .single();

        if (linkError) throw linkError;

        await supabase.from("finance_invoice_candidates").update({
          status: "written",
          xero_contact_id: contactId,
        }).eq("id", candidate.id);

        await supabase.from("finance_intake_items").update({
          status: "synced",
          processed_at: new Date().toISOString(),
        }).eq("id", candidate.intake_item_id);

        await recordFinanceEvent(supabase, {
          candidate_id: candidate.id,
          intake_item_id: candidate.intake_item_id,
          event_type: "written",
          severity: "info",
          details: {
            xeroInvoiceId: created.InvoiceID,
            xeroInvoiceNumber: created.InvoiceNumber ?? null,
            ...(referenceWasRenumbered ? { originalInvoiceNumber, postedInvoiceNumber: invoiceNumber } : {}),
          },
        });

        const gmail = await markGmailMessageProcessed(supabase, candidate.intake_item_id);

        await appendAuditLog(supabase, {
          intakeItemId: candidate.intake_item_id,
          candidateId: candidate.id,
          eventType: "xero_pushed",
          source: "worker",
          metadata: {
            xeroInvoiceId: created.InvoiceID,
            xeroInvoiceNumber: created.InvoiceNumber ?? null,
            xeroStatus: created.Status ?? null,
            originalInvoiceNumber: originalInvoiceNumber ?? null,
            postedInvoiceNumber: invoiceNumber ?? null,
            autoRenumbered: Boolean(originalInvoiceNumber && invoiceNumber && originalInvoiceNumber !== invoiceNumber),
          },
        });

        return {
          candidateId: candidate.id,
          status: "posted",
          xeroInvoiceId: created.InvoiceID,
          xeroInvoiceNumber: created.InvoiceNumber ?? null,
          xeroStatus: created.Status ?? null,
          gmailRelabelled: gmail.swapped,
          ...(originalInvoiceNumber && invoiceNumber && originalInvoiceNumber !== invoiceNumber
            ? { originalInvoiceNumber, renumbered: true }
            : {}),
        };
      } catch (candidateError) {
        const message = candidateError instanceof Error
          ? candidateError.message
          : (typeof candidateError === "string" ? candidateError : JSON.stringify(candidateError, null, 2));

        await recordFinanceEvent(supabase, {
          candidate_id: candidate.id,
          intake_item_id: candidate.intake_item_id,
          event_type: "failed",
          severity: "error",
          details: { message: String(message).slice(0, 2000), supplier: candidate.supplier_name, invoiceNumber: candidate.invoice_number },
        });

        await appendAuditLog(supabase, {
          intakeItemId: candidate.intake_item_id,
          candidateId: candidate.id,
          eventType: "xero_failed",
          source: "worker",
          metadata: { message: String(message).slice(0, 2000), supplier: candidate.supplier_name ?? null, invoiceNumber: candidate.invoice_number ?? null },
        });

        return {
          candidateId: candidate.id,
          status: "failed",
          supplier: candidate.supplier_name ?? null,
          invoiceNumber: candidate.invoice_number ?? null,
          error: String(message).slice(0, 2000),
        };
      }
    };

    // Batches of 50, five in flight, with the shared limiter holding the whole thing
    // to 60 requests a minute. Results come back in candidate order regardless of the
    // order they actually completed in, so the UI summary is stable between runs.
    const results = await pushInBatches(candidates, postOneCandidate);
    return {
      ok: true,
      action: "post_xero",
      results,
      // The pool always runs to completion: each candidate is isolated so one bad
      // invoice cannot stop the rest. The summary lets the caller report partial
      // success honestly instead of treating the batch as all-or-nothing.
      summary: summarizePostResults(results),
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : (typeof error === 'string' ? error : JSON.stringify(error, null, 2));
    // Results collected before the failure are still returned. Reporting ok:false alone
    // would make the caller discard invoices that were in fact written successfully.
    return {
      ok: false,
      action: "post_xero",
      message,
      // The batch could not finish (auth, tenant, or a failed candidate lookup), so
      // anything not in results was never attempted.
      aborted: true,
      results: partialResults,
      summary: summarizePostResults(partialResults),
    };
  }
}

function summarizePostResults(results: Array<Record<string, unknown>>) {
  const summary: Record<string, number> = { total: results.length, posted: 0, linked: 0, failed: 0, needsAttention: 0, skipped: 0 };
  const attention: Array<Record<string, unknown>> = [];

  for (const result of results) {
    const status = String(result.status ?? "unknown");
    if (status === "posted") summary.posted += 1;
    else if (status === "already_exists") summary.linked += 1;
    else if (status === "skipped") summary.skipped += 1;
    else {
      summary.failed += 1;
      attention.push({
        candidateId: result.candidateId,
        supplier: result.supplier ?? null,
        invoiceNumber: result.invoiceNumber ?? null,
        status,
        error: result.error ?? result.message ?? null,
        xeroStatus: result.xeroStatus ?? null,
        xeroInvoiceId: result.xeroInvoiceId ?? null,
        xeroUrl: result.xeroUrl ?? null,
      });
    }
  }

  return { ...summary, attention };
}

function extractMessageText(part: any): string {
  if (!part) return "";
  const mimeType = String(part.mimeType ?? "").toLowerCase();
  if (mimeType.startsWith("text/plain") && part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  if (part.parts && Array.isArray(part.parts)) {
    for (const child of part.parts) {
      const text = extractMessageText(child);
      if (text.trim()) return text;
    }
  }
  if (part.body?.data) {
    return decodeBase64Url(part.body.data);
  }
  return "";
}

/**
 * A single vision pass regularly returns the header totals but no itemised table.
 * Re-ask with a prompt that only asks for the table before falling back to flattened
 * OCR text, which is where column bleed (UoM and Item ID values spliced into
 * descriptions) comes from.
 */
async function extractLineItemsFromPdfMultimodal(
  pdfBase64: string,
  filename: string,
  context: { subtotal: number | null; grossTotal: number | null },
): Promise<Record<string, unknown>[] | null> {
  const apiKey = Deno.env.get("FINANCE_GEMINI_API_KEY") ?? Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return null;

  const primaryModel = getGeminiModel("FINANCE_GEMINI_VISION_MODEL", getGeminiModel("FINANCE_GEMINI_REVIEW_MODEL", "gemini-3.5-flash"));
  const fallbackModel = getGeminiModel("FINANCE_GEMINI_FALLBACK_MODEL", "gemini-3.6-flash");

  const anchor = context.subtotal
    ? `The printed GST-exclusive subtotal is ${context.subtotal}. Your line amounts must add up to it.`
    : context.grossTotal
      ? `The printed total is ${context.grossTotal}. Your GST-exclusive line amounts plus 15% GST must add up to it.`
      : "";

  const prompt = `Look ONLY at the itemised line table on this invoice and transcribe it.

How to read the table correctly:
- Each visual row is one line item. Do not merge rows and do not split one row.
- Take the description ONLY from the Description/Item/Details column, including the full text of that cell if it wraps onto a second line.
- Ignore every other column: Item ID, Category, Type, UoM (Hrs, Km, Ea, Each, Pc), tax codes (S15, GST15), and the account code. None of those belong in a description.
- Read quantity, unit price and amount from their own columns.
- Skip summary rows (Subtotal, GST, Tax, Total, Balance Due) and page footers.
- If the table genuinely has no line items, return an empty lineItems array.

${anchor}

Respond with ONLY a JSON object of this exact shape, with no other text and no code fence:
{"lineItems":[{"description":"","quantity":0,"unitAmount":0,"lineAmount":0,"taxType":"INPUT2"}]}`;

  try {
    // No responseSchema: constraining the response shape causes the model to skip the
    // table entirely and return only a couple of header fields.
    const rawResult = await callGeminiWithFallback(
      apiKey,
      primaryModel,
      fallbackModel,
      [
        {
          role: "user",
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "application/pdf", data: pdfBase64 } },
          ],
        },
      ],
      { responseMimeType: "application/json", temperature: 0.1, topP: 0.9 },
    );

    const parsedJson = parseGeminiJson(rawResult);
    if (!parsedJson) {
      console.log("[pdf-vision] Table-only retry did not return a JSON object");
      return null;
    }

    const parsed = normalizeExtraction(parsedJson);
    const items = Array.isArray(parsed.lineItems) ? (parsed.lineItems as Array<Record<string, unknown>>) : [];
    console.log(
      "[pdf-vision] Table-only retry produced",
      items.length,
      "line items, sum:",
      JSON.stringify((parsed.normalization as Record<string, unknown>)?.lineItemSum),
    );
    return items.length > 0 ? items : null;
  } catch (error) {
    console.warn("[pdf-vision] Table-only retry failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

/**
 * Rates how complete and self-consistent a structured extraction is, so the better of
 * the PDF vision pass and the text pass becomes the base for the merge instead of a
 * fixed preference.
 */
function scorePdfStructured(result: Record<string, unknown> | null): number {
  if (!result) return -1;
  return scoreExtractionConfidence(result);
}

/**
 * Encodes an ArrayBuffer as base64 without relying on Node's `Buffer`, which is
 * neither typed nor present in the Deno runtime this function runs in. Large
 * uploads are chunked so the spread never exceeds the call-argument limit.
 */
function arrayBufferToBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode(...view.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Downloads a manually-uploaded invoice from Supabase Storage and runs it through
 * the same PDF/text extraction the Gmail path uses. Returns the same shape so the
 * process handler can treat manual uploads and Gmail messages identically.
 *
 * A manual upload enqueues a job whose payload is the client-supplied metadata, so
 * without this the worker finds no raw text and no structured PDF pass and produces
 * nothing - the intake lane just sits at "pending" forever.
 */
async function extractFromStorageAttachment(
  supabase: any,
  storagePath: string,
  fileName: string,
): Promise<{ rawText: string; pdfStructured: Record<string, unknown> | null } | null> {
  try {
    const { data, error } = await supabase.storage.from("finance-intake-attachments").download(storagePath);
    if (error || !data) {
      console.warn("[process] Failed to download manual upload from storage:", storagePath, error?.message ?? "no data");
      return null;
    }

    const bytes = await data.arrayBuffer();
    const base64 = arrayBufferToBase64(bytes);

    const lowerName = (fileName ?? "").toLowerCase();
    const isPdf = lowerName.endsWith(".pdf") || data.type === "application/pdf";

    if (isPdf) {
      const { text, structured } = await extractPdfFromBase64(base64, fileName);
      return { rawText: text, pdfStructured: structured };
    }

    // Non-PDF uploads (images, txt, etc.): read the text directly when possible.
    const text = await extractTextFromBytes(bytes, fileName, data.type);
    return { rawText: text ?? `[Uploaded file: ${fileName}]`, pdfStructured: null };
  } catch (error) {
    console.warn("[process] Manual upload extraction failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function extractPdfFromBase64(
  pdfBase64: string,
  filename: string,
): Promise<{ text: string; structured: Record<string, unknown> | null }> {
  const pdfTexts: string[] = [];
  let bestStructured: Record<string, unknown> | null = null;

  const multimodalResult = await extractFromPdfMultimodal(pdfBase64, filename);
  if (multimodalResult) {
    if (!Array.isArray(multimodalResult.lineItems) || (multimodalResult.lineItems as unknown[]).length === 0) {
      console.log("[pdf] Vision pass returned no line items; retrying with a table-only prompt");
      const retried = await extractLineItemsFromPdfMultimodal(pdfBase64, filename, {
        subtotal: toFiniteNumber(multimodalResult.subtotal),
        grossTotal: toFiniteNumber(multimodalResult.grossTotal),
      });
      if (retried) {
        multimodalResult.lineItems = retried;
        multimodalResult.normalization = normalizeExtraction(multimodalResult).normalization;
      }
    }
    if (scorePdfStructured(multimodalResult) > scorePdfStructured(bestStructured)) {
      bestStructured = multimodalResult;
    }
    pdfTexts.push(`[PDF: ${filename}]\n${JSON.stringify(multimodalResult)}`);
  } else {
    const extractedText = await extractTextFromPdfBase64(pdfBase64, filename);
    if (extractedText) {
      pdfTexts.push(`[PDF: ${filename}]\n${extractedText}`);
    }
  }

  const text = pdfTexts.join("\n\n");
  console.log("[pdf] Total PDF text length:", text.length, "structured:", bestStructured ? "yes" : "no");
  return { text, structured: bestStructured };
}

async function extractTextFromBytes(
  bytes: ArrayBuffer,
  fileName: string,
  mimeType?: string,
): Promise<string | null> {
  const lowerName = (fileName ?? "").toLowerCase();
  const type = (mimeType ?? "").toLowerCase();

  if (lowerName.endsWith(".txt") || type.startsWith("text/")) {
    try {
      return new TextDecoder().decode(bytes).trim() || null;
    } catch {
      return null;
    }
  }

  // Images and other binary uploads: hand the bytes to Gemini for transcription.
  const base64 = arrayBufferToBase64(bytes);

  const mimeForGemini = type || (lowerName.endsWith(".png") ? "image/png" : lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg") ? "image/jpeg" : "image/png");

  const apiKey = Deno.env.get("FINANCE_GEMINI_API_KEY") ?? Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return null;

  try {
    const primaryModel = getGeminiModel("FINANCE_GEMINI_OCR_MODEL", "gemini-3.5-flash-lite");
    const fallbackModel = getGeminiModel("FINANCE_GEMINI_FALLBACK_MODEL", "gemini-3.6-flash");
    const extracted = await callGeminiWithFallback(
      apiKey,
      primaryModel,
      fallbackModel,
      [
        {
          role: "user",
          parts: [
            { text: "Extract all text content from this invoice image, preserving table structure, line breaks, and column layout. Return only the extracted text." },
            { inline_data: { mime_type: mimeForGemini, data: base64 } },
          ],
        },
      ],
      { responseMimeType: "text/plain", temperature: 0.1, topP: 0.9 },
    );
    return extracted.trim() || null;
  } catch (error) {
    console.log("[pdf-extract] Exception:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function extractPdfAttachments(
  accessToken: string,
  messageId: string,
  payload: any,
): Promise<{ text: string; structured: Record<string, unknown> | null }> {
  const pdfTexts: string[] = [];
  let bestStructured: Record<string, unknown> | null = null;

  async function findAttachments(part: any) {
    if (!part) return;
    const filename = part.filename ?? "";
    const mimeType = String(part.mimeType ?? "").toLowerCase();
    const attachmentId = part.body?.attachmentId;

    if (attachmentId && (filename.toLowerCase().endsWith(".pdf") || mimeType === "application/pdf")) {
      try {
        console.log("[pdf] Found PDF attachment:", filename, "attachmentId:", attachmentId);
        const attachment = await gmailFetch(accessToken, `/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
        const pdfBase64 = attachment?.data ?? "";
        if (pdfBase64) {
          // Send the PDF straight to Gemini with the structured schema; the visual table
          // layout is far more reliable than re-parsing flattened text.
          const multimodalResult = await extractFromPdfMultimodal(pdfBase64, filename);

          if (multimodalResult) {
            // The first vision pass often reads the totals but skips the table.
            if (!Array.isArray(multimodalResult.lineItems) || (multimodalResult.lineItems as unknown[]).length === 0) {
              console.log("[pdf] Vision pass returned no line items; retrying with a table-only prompt");
              const retried = await extractLineItemsFromPdfMultimodal(pdfBase64, filename, {
                subtotal: toFiniteNumber(multimodalResult.subtotal),
                grossTotal: toFiniteNumber(multimodalResult.grossTotal),
              });
              if (retried) {
                multimodalResult.lineItems = retried;
                multimodalResult.normalization = normalizeExtraction(multimodalResult).normalization;
              }
            }

            if (scorePdfStructured(multimodalResult) > scorePdfStructured(bestStructured)) {
              bestStructured = multimodalResult;
            }
            pdfTexts.push(`[PDF: ${filename}]\n${JSON.stringify(multimodalResult)}`);
          } else {
            const extractedText = await extractTextFromPdfBase64(pdfBase64, filename);
            if (extractedText) {
              pdfTexts.push(`[PDF: ${filename}]\n${extractedText}`);
            }
          }
        }
      } catch (e) {
        console.warn("Failed to fetch/extract PDF attachment:", filename, e);
      }
    }

    if (part.parts && Array.isArray(part.parts)) {
      for (const child of part.parts) {
        await findAttachments(child);
      }
    }
  }

  await findAttachments(payload);
  const text = pdfTexts.join("\n\n");
  console.log("[pdf] Total PDF text length:", text.length, "structured:", bestStructured ? "yes" : "no");
  return { text, structured: bestStructured };
}

async function extractTextFromPdfBase64(pdfBase64: string, filename = "invoice.pdf"): Promise<string> {
  const apiKey = Deno.env.get("FINANCE_GEMINI_API_KEY") ?? Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.log("[pdf-extract] No API key");
    return "";
  }

  const primaryModel = getGeminiModel("FINANCE_GEMINI_OCR_MODEL", "gemini-3.5-flash-lite");
  const fallbackModel = getGeminiModel("FINANCE_GEMINI_FALLBACK_MODEL", "gemini-3.6-flash");

  console.log("[pdf-extract] Model:", primaryModel, "fallback:", fallbackModel, "file:", filename);

  try {
    const extracted = await callGeminiWithFallback(
      apiKey,
      primaryModel,
      fallbackModel,
      [
        {
          role: "user",
          parts: [
            { text: "Extract all text content from this invoice PDF, preserving table structure, line breaks, and column layout. Maintain the visual arrangement of line items, subtotals, and totals. Return only the extracted text." },
            {
              inline_data: {
                mime_type: "application/pdf",
                data: pdfBase64,
              },
            },
          ],
        },
      ],
      {
        responseMimeType: "text/plain",
        temperature: 0.1,
        topP: 0.9,
      },
    );

    console.log("[pdf-extract] Extracted length:", extracted.length);
    return extracted;
  } catch (error) {
    console.log("[pdf-extract] Exception:", error instanceof Error ? error.message : String(error));
    return "";
  }
}

async function extractFromPdfMultimodal(pdfBase64: string, filename: string): Promise<Record<string, unknown> | null> {
  const apiKey = Deno.env.get("FINANCE_GEMINI_API_KEY") ?? Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    console.log("[pdf-vision] No API key");
    return null;
  }

  // Structured table reading needs a stronger model than plain OCR. The flash-lite
  // model is kept for the text-plainth pass because it is the cheapest reliable one.
  const primaryModel = getGeminiModel("FINANCE_GEMINI_VISION_MODEL", getGeminiModel("FINANCE_GEMINI_REVIEW_MODEL", "gemini-3.5-flash"));
  const fallbackModel = getGeminiModel("FINANCE_GEMINI_FALLBACK_MODEL", "gemini-3.6-flash");

  console.log("[pdf-vision] Multimodal extraction with models:", primaryModel, fallbackModel);

  const prompt = `You are reading the actual page image and table layout of an invoice PDF. Use the VISUAL column structure, not a guess from running text.

Read the invoice top to bottom and return the structured data.

- supplierName: the company ISSUING the invoice (letterhead, or the name above the "Tax Invoice" heading). Never the "Bill To" customer. Ignore logos with no readable company name.
- supplierTaxNumber: GST/ABN/VAT/IRD number printed on the invoice.
- invoiceNumber: the document number next to "Invoice No", "Tax Invoice", or "#". Not a quote, order, or PO number.
- reference: PO number / "Your reference" / customer reference. null if absent.
- invoiceDate and dueDate as YYYY-MM-DD.
- Amounts as plain numbers, no currency symbols, no thousands separators.

LINE ITEMS: locate the itemised table by its header row (Item/Description, Qty, Unit Price/Rate, Amount/Line Total, Tax). Read one entry per billable row in reading order.
- Only the column literally headed "Description" (or "Item", "Details") belongs in the description. Copy the rest of that cell exactly, including any wrapped second line of text.
- Other columns in the same row are NOT part of the description and must never appear in it: Item ID / Category / Type / Job code, UoM (Hrs, Km, Ea, Each, Pc, Ctn, Mth), and any tax-code column (S15, GST15, E1). Do not prefix the description with the Item ID and do not splice a UoM into the middle of a wrapped description.
- A description that wraps onto a second visual line is one description. Join the wrapped lines with a space. Never treat the UoM cell as part of a wrapped line.
- Skip non-charge rows: Subtotal, GST/Tax, Total, Discount, Round, Balance Due, page footers, empty filler rows.
- Keep real discount and credit rows as negative amounts.
- quantity: printed quantity, else 1.
- unitAmount: price per unit EXCLUDING GST. lineAmount: quantity x unitAmount EXCLUDING GST. If the row prints only one amount, put it in lineAmount and derive unitAmount = lineAmount / quantity.
- If the only amounts printed are GST-inclusive, divide by 1.15 so subtotal + tax equals the printed total.
- taxType: "INPUT2" is the NZ default for a standard-rated purchase, "EXEMPTINPUT" for GST-free/exempt, "ZERO" for zero-rated/export.
- accountCode: only if an explicit account, expense, category or GL code is printed for that row, otherwise null. Never guess one.

TOTALS
- grossTotal: "Total Including GST" / "Total Due" / "Grand Total" (GST-inclusive).
- subtotal: "Subtotal" / "Total Exclusive" / "Net" (GST-exclusive).
- taxTotal: "GST" / "Tax" / "VAT".
- If only an inclusive total is shown, set subtotal to that total and taxTotal to null.
- If only a subtotal and tax are shown, grossTotal = subtotal + taxTotal.
- Do not copy the same figure into both subtotal and grossTotal unless the invoice shows them equal.

Return every line item you can read. Use null for anything not present. Never invent values.

Respond with ONLY a JSON object of this exact shape, with no other text and no code fence:
{"supplierName":"","supplierTaxNumber":"","invoiceNumber":"","reference":"","invoiceDate":"","dueDate":"","subtotal":0,"taxTotal":0,"grossTotal":0,"lineItems":[{"description":"","quantity":0,"unitAmount":0,"lineAmount":0,"taxType":"INPUT2","accountCode":null}]}`;

  try {
    // Deliberately no responseSchema. Constraining the response shape makes the model
    // skip the line item table and answer with only the header totals; asking for the
    // shape in the prompt and reading the visual columns instead works reliably.
    const rawResult = await callGeminiWithFallback(
      apiKey,
      primaryModel,
      fallbackModel,
      [
        {
          role: "user",
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: "application/pdf",
                data: pdfBase64,
              },
            },
          ],
        },
      ],
      {
        responseMimeType: "application/json",
        temperature: 0.1,
        topP: 0.9,
      },
    );

    const parsedJson = parseGeminiJson(rawResult);
    if (!parsedJson) {
      console.log("[pdf-vision] Could not parse a JSON object from the model response");
      return null;
    }

    const parsed = normalizeExtraction(parsedJson);
    console.log(
      "[pdf-vision] Extracted fields:",
      Object.keys(parsed).filter((k) => parsed[k] != null),
      "lineItems:",
      (parsed.lineItems as unknown[])?.length,
      "norm:",
      JSON.stringify(parsed.normalization),
    );
    return parsed;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log("[pdf-vision] Exception:", msg);
    return null;
  }
}

async function fetchGoogleAccessToken(): Promise<string> {
  const refreshToken = Deno.env.get("FINANCE_GOOGLE_REFRESH_TOKEN") ?? Deno.env.get("GOOGLE_REFRESH_TOKEN");
  const clientId = Deno.env.get("FINANCE_GOOGLE_CLIENT_ID") ?? Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("FINANCE_GOOGLE_CLIENT_SECRET") ?? Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!refreshToken || !clientId || !clientSecret) {
    const directAccessToken = Deno.env.get("FINANCE_GOOGLE_ACCESS_TOKEN") ?? Deno.env.get("GOOGLE_ACCESS_TOKEN");
    if (directAccessToken?.trim()) return directAccessToken.trim();
    throw new Error("Missing Gmail auth env vars. Set FINANCE_GOOGLE_CLIENT_ID, FINANCE_GOOGLE_CLIENT_SECRET, and FINANCE_GOOGLE_REFRESH_TOKEN (preferred), or FINANCE_GOOGLE_ACCESS_TOKEN as a fallback.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh Gmail access token: ${await response.text()}`);
  }

  const data = await response.json();
  if (!data?.access_token) {
    throw new Error("No access token returned from Google");
  }

  return String(data.access_token);
}

async function gmailFetch(accessToken: string, path: string) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Gmail API request failed (${response.status}): ${await response.text()}`);
  }

  return await response.json();
}

async function resolveLabelId(accessToken: string, labelName: string) {
  const data = await gmailFetch(accessToken, "/users/me/labels");
  const labels: Array<{ id?: string; name?: string }> = Array.isArray(data?.labels) ? data.labels : [];
  const normalized = labelName.trim().toLowerCase();
  const match = labels.find((label) => String(label.name ?? "").trim().toLowerCase() === normalized);
  if (!match?.id) {
    throw new Error(`Gmail label not found: ${labelName}`);
  }
  return match.id;
}

async function listMessagesForLabel(accessToken: string, labelId: string, maxResults = 4) {
  const data = await gmailFetch(accessToken, `/users/me/messages?labelIds=${encodeURIComponent(labelId)}&maxResults=${maxResults}`);
  return Array.isArray(data?.messages) ? data.messages : [];
}

async function getMessage(accessToken: string, id: string) {
  return await gmailFetch(accessToken, `/users/me/messages/${encodeURIComponent(id)}?format=full`);
}

async function syncGmailInvoices(supabase: any, labelName: string, maxMessages = 4) {
  const accessToken = await fetchGoogleAccessToken();
  const labelId = await resolveLabelId(accessToken, labelName);
  const messages = await listMessagesForLabel(accessToken, labelId, maxMessages);

  const { data: batch, error: batchError } = await supabase
    .from("finance_intake_batches")
    .insert({
      source: "gmail",
      status: "queued",
      source_label: labelName,
      message_count: messages.length,
      item_count: messages.length,
      notes: `Pulled from Gmail label ${labelName}`,
    })
    .select("id")
    .single();

  if (batchError) throw new Error(formatErrorValue(batchError));

  const results: Array<{ messageId: string; itemId?: string; jobId?: string; skipped?: boolean; candidateId?: string; candidateStatus?: string }> = [];

  for (const message of messages) {
    const gmailMessage = await getMessage(accessToken, message.id);
    const headers = Array.isArray(gmailMessage?.payload?.headers) ? gmailMessage.payload.headers : [];
    const subject = getHeaderValue(headers, "Subject");
    const sender = getHeaderValue(headers, "From");
    const receivedAt = getHeaderValue(headers, "Date");
    const emailText = extractMessageText(gmailMessage?.payload) || gmailMessage?.snippet || "";
    
    // Extract structured data + text from PDF attachments
    const pdf = await extractPdfAttachments(accessToken, message.id, gmailMessage?.payload);
    console.log("[sync] PDF text length:", pdf.text.length, "email text length:", emailText.length);
    // Put PDF content first, then email text — PDF is the authoritative invoice source
    const combinedText = [pdf.text, emailText].filter(Boolean).join("\n\n");
    console.log("[sync] Combined text length:", combinedText.length);

    const sourceFingerprint = `gmail:${message.id}`;
    const { data: existingItem } = await supabase
      .from("finance_intake_items")
      .select("id,active_job_id")
      .eq("source_fingerprint", sourceFingerprint)
      .maybeSingle();

    if (existingItem?.id) {
      results.push({ messageId: message.id, itemId: existingItem.id, skipped: true });
      continue;
    }

    const { data: item, error: itemError } = await supabase
      .from("finance_intake_items")
      .insert({
        batch_id: batch.id,
        source_type: "gmail",
        source_fingerprint: sourceFingerprint,
        source_key: message.id,
        gmail_message_id: message.id,
        gmail_thread_id: gmailMessage?.threadId ?? null,
        label_name: labelName,
        subject,
        sender_email: sender,
        received_at: receivedAt,
        status: "pending",
        confidence: 0,
        duplicate_risk: "unknown",
        metadata: {
          gmailLabel: labelName,
          gmailSnippet: gmailMessage?.snippet ?? "",
          rawText: combinedText.slice(0, 20000),
          pdfStructured: pdf.structured,
        },
      })
      .select("id")
      .single();

    if (itemError) {
      throw new Error(formatErrorValue(itemError));
    }

    const { data: job, error: jobError } = await supabase
      .from("finance_intake_jobs")
      .insert({
        intake_item_id: item.id,
        queue_name: "finance-intake",
        job_type: "extract",
        status: "queued",
        payload: {
          source: "gmail",
          gmailMessageId: message.id,
          gmailThreadId: gmailMessage?.threadId ?? null,
          labelName,
          subject,
          senderEmail: sender,
          receivedAt,
          rawText: combinedText.slice(0, 20000),
          pdfStructured: pdf.structured,
        },
      })
      .select("id")
      .single();

    if (jobError) {
      throw new Error(formatErrorValue(jobError));
    }

    await supabase.from("finance_intake_items").update({ active_job_id: job.id, status: "queued" }).eq("id", item.id);
    console.log("[sync_gmail] Created job:", job.id, "for item:", item.id);
    results.push({ messageId: message.id, itemId: item.id, jobId: job.id, skipped: false });
  }

  return {
    ok: true,
    action: "sync_gmail",
    labelName,
    messageCount: messages.length,
    batchId: batch.id,
    results,
  };
}

async function enqueueItem(supabase: any, body: EnqueuePayload, caller: FinanceCaller) {
  const source = body.source ?? "gmail";
  const sourceType = normalizeSourceType(body.sourceType, source);
  const sourceFingerprint = body.sourceFingerprint ?? createId();
  const sourceLabel = body.sourceLabel ?? (source === "gmail" ? "Gmail invoices" : "Finance intake");
  const batchStatus = body.batchStatus ?? "queued";
  const itemCount = body.itemCount ?? 1;
  const messageCount = body.messageCount ?? 0;

  const { data: batch, error: batchError } = await supabase
    .from("finance_intake_batches")
    .insert({
      source,
      status: batchStatus,
      source_label: sourceLabel,
      message_count: messageCount,
      item_count: itemCount,
      notes: body.notes ?? null,
    })
    .select("id")
    .single();

  if (batchError) throw batchError;

  const { data: item, error: itemError } = await supabase
    .from("finance_intake_items")
    .insert({
      batch_id: batch.id,
      source_type: sourceType,
      source_fingerprint: sourceFingerprint,
      source_key: body.sourceKey ?? null,
      gmail_message_id: body.gmailMessageId ?? null,
      gmail_thread_id: body.gmailThreadId ?? null,
      label_name: body.labelName ?? null,
      subject: body.subject ?? null,
      sender_email: body.senderEmail ?? null,
      received_at: body.receivedAt ?? null,
      file_name: body.fileName ?? null,
      mime_type: body.mimeType ?? null,
      storage_path: body.storagePath ?? null,
      status: body.status ?? "pending",
      confidence: body.confidence ?? 0,
      duplicate_risk: body.duplicateRisk ?? "unknown",
      metadata: body.metadata ?? {},
    })
    .select("id")
    .single();

  if (itemError) throw itemError;

  const { data: job, error: jobError } = await supabase
    .from("finance_intake_jobs")
    .insert({
      intake_item_id: item.id,
      queue_name: "finance-intake",
      job_type: "extract",
      status: "queued",
      payload: body.metadata ?? {},
    })
    .select("id")
    .single();

  if (jobError) throw jobError;

  await supabase.from("finance_intake_items").update({ active_job_id: job.id }).eq("id", item.id);

  await appendAuditLog(supabase, {
    intakeItemId: item.id,
    candidateId: null,
    jobId: job.id,
    batchId: batch.id,
    eventType: "created",
    source: "system",
    metadata: {
      source,
      sourceType,
      fileName: body.fileName ?? null,
      sourceFingerprint,
      actorId: caller.userId,
      actorLabel: caller.label,
    },
  });

  return {
    ok: true,
    action: "enqueue",
    batchId: batch.id,
    itemId: item.id,
    jobId: job.id,
  };
}

/**
 * Applies a manual correction to an extracted candidate and records the diff.
 *
 * The candidate row is the record of what the model produced, so it is not
 * overwritten in place: the corrected values are written to the row *and* every
 * changed field is appended to the immutable log as an explicit before/after
 * pair. That pairing is the only way to answer "which fields does the extractor
 * get wrong" - a snapshot of the final row would have lost the original value the
 * moment someone saved twice.
 */
async function applyCandidateEdit(
  supabase: any,
  body: { candidateId?: string; edits?: Record<string, unknown> },
  caller: FinanceCaller,
) {
  const candidateId = String(body.candidateId ?? "");
  if (!candidateId) {
    return { ok: false, action: "record_edit", message: "candidateId is required" };
  }

  const { data: candidate, error: readError } = await supabase
    .from("finance_invoice_candidates")
    .select("id, intake_item_id, supplier_name, invoice_number, invoice_date, due_date, subtotal, tax_total, gross_total, currency, line_items")
    .eq("id", candidateId)
    .maybeSingle();

  if (readError) throw readError;
  if (!candidate) {
    return { ok: false, action: "record_edit", message: `Candidate ${candidateId} was not found` };
  }

  // Map the public field names onto their column names so the client never has to
  // know the schema.
  const COLUMN_BY_FIELD: Record<string, string> = {
    supplierName: "supplier_name",
    invoiceNumber: "invoice_number",
    invoiceDate: "invoice_date",
    dueDate: "due_date",
    subtotal: "subtotal",
    taxTotal: "tax_total",
    grossTotal: "gross_total",
    currency: "currency",
    lineItems: "line_items",
  };

  const patch: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(body.edits ?? {})) {
    const column = COLUMN_BY_FIELD[field];
    if (!column) continue;
    patch[column] = value;
    before[field] = candidate[column] ?? null;
    after[field] = value ?? null;
  }

  const diffs = computeFieldDiff(before, after);
  if (diffs.length === 0) {
    return { ok: true, action: "record_edit", candidateId, diffs: [], message: "No changes to record" };
  }

  const { error: updateError } = await supabase
    .from("finance_invoice_candidates")
    .update(patch)
    .eq("id", candidateId);
  if (updateError) throw updateError;

  await appendAuditLog(
    supabase,
    {
      intakeItemId: candidate.intake_item_id,
      candidateId,
      eventType: "user_edited",
      // Taken from the verified session, never from the request body. A client that
      // sends actorId is ignored entirely: the whole point of the audit trail is
      // that the recorded actor cannot be chosen by whoever made the edit.
      actorId: caller.userId,
      actorLabel: caller.label,
      source: caller.kind === "scheduler" ? "scheduler" : "user",
      metadata: {
        changedFieldCount: diffs.length,
        actorEmail: caller.email,
        actorRoles: caller.roles,
      },
    },
    diffs,
  );

  return { ok: true, action: "record_edit", candidateId, diffs };
}

/**
 * Re-runs extraction for a single intake item from the review panel. The previous
 * candidate and extraction run are soft-reset (not deleted) so the audit trail keeps
 * the old read, while a fresh job is queued for the next process pass. Clearing the
 * stored rawText/pdfStructured means the manual-upload storage download re-runs
 * instead of replaying the cached read.
 *
 * This is the path a finance user takes when the first read came back wrong and they
 * want the model to look at the document again, rather than hand-correcting every
 * field.
 */
async function reprocessItem(
  supabase: any,
  body: Record<string, unknown>,
  caller: FinanceCaller,
) {
  const itemId = String(body.itemId ?? "");
  if (!itemId) {
    return { ok: false, action: "reprocess", message: "itemId is required" };
  }

  const { data: item, error: itemError } = await supabase
    .from("finance_intake_items")
    .select("id, storage_path, file_name, metadata, status, active_job_id")
    .eq("id", itemId)
    .maybeSingle();

  if (itemError) throw itemError;
  if (!item) {
    return { ok: false, action: "reprocess", message: `Intake item ${itemId} was not found` };
  }

  // Re-reading only works for storage-backed uploads. A Gmail item's invoice is
  // fetched from the Gmail API during sync, and there is no payload to replay,
  // so reprocessing it would just re-queue a job with nothing to extract.
  if (!item.storage_path) {
    return {
      ok: false,
      action: "reprocess",
      message: "This item was pulled from Gmail, not uploaded. Re-read it from the Gmail sync instead.",
    };
  }

  // finance_intake_jobs.intake_item_id is both unique and NOT NULL, so the old
  // row can neither be deleted nor be repointed:
  //  - DELETE cascades SET NULL onto finance_intake_logs.job_id, and the
  //    append-only trigger rejects that UPDATE.
  //  - UPDATE ... SET intake_item_id = NULL violates NOT NULL.
  //
  // The way through is to not touch the row's identity at all: re-queue the
  // existing job in place. The process handler re-downloads from storage
  // whenever the job payload and item metadata carry no text, so clearing
  // the payload is what forces a fresh read.
  const { data: existingJobs } = await supabase
    .from("finance_intake_jobs")
    .select("id, payload")
    .eq("intake_item_id", itemId);

  const existingJob = Array.isArray(existingJobs) && existingJobs.length > 0 ? existingJobs[0] : null;

  if (existingJob) {
    await supabase
      .from("finance_intake_jobs")
      .update({
        status: "queued",
        payload: {},
        scheduled_for: null,
        locked_at: null,
        locked_by: null,
        last_error: null,
        attempt_count: 0,
      })
      .eq("id", existingJob.id);
  }

  // Reset the cached extraction so the worker re-reads the document rather than
  // replaying the previous pass. The prior candidate is still reachable through
  // finance_invoice_candidates.intake_item_id and finance_extraction_runs, so
  // nothing is lost by clearing the item's own pointers.
  await supabase
    .from("finance_intake_items")
    .update({
      status: "pending",
      confidence: 0,
      duplicate_risk: "unknown",
      validation_errors: [],
      validation_warnings: [],
      extraction_run_id: null,
      extraction_summary: {},
      metadata: { ...(item.metadata ?? {}), rawText: null, pdfStructured: null },
      failure_reason: null,
      active_job_id: existingJob?.id ?? null,
    })
    .eq("id", itemId);

  // If no job row existed for this item (e.g. it was never enqueued), create one.
  let job: { id: string };
  if (existingJob) {
    job = { id: existingJob.id };
  } else {
    const { data: inserted, error: jobError } = await supabase
      .from("finance_intake_jobs")
      .insert({
        intake_item_id: itemId,
        queue_name: "finance-intake",
        job_type: "extract",
        status: "queued",
        payload: {},
      })
      .select("id")
      .single();
    if (jobError) throw jobError;
    job = inserted;
    await supabase.from("finance_intake_items").update({ active_job_id: job.id }).eq("id", itemId);
  }

  // The candidate that was previously extracted for this item. finance_intake_items
  // no longer carries the back-reference (migration 20260928000000 dropped it to break a
  // FK cycle), so it is read from the candidate table, which still points at the item.
  const { data: previousCandidate } = await supabase
    .from("finance_invoice_candidates")
    .select("id")
    .eq("intake_item_id", itemId)
    .maybeSingle();

  await appendAuditLog(supabase, {
    intakeItemId: itemId,
    candidateId: null,
    jobId: job.id,
    batchId: null,
    eventType: "reprocess_requested",
    source: caller.kind === "scheduler" ? "scheduler" : "user",
    metadata: {
      actorId: caller.userId,
      actorLabel: caller.label,
      previousCandidateId: previousCandidate?.id ?? null,
      fileName: item.file_name ?? null,
    },
  });

  return { ok: true, action: "reprocess", itemId, jobId: job.id };
}

type EnqueuePayload = {
  sourceFingerprint?: string;
  source?: string;
  sourceType?: string;
  candidateIds?: string[];
  batchId?: string;
  batchStatus?: string;
  sourceLabel?: string;
  messageCount?: number;
  itemCount?: number;
  notes?: string | null;
  sourceKey?: string | null;
  gmailMessageId?: string | null;
  gmailThreadId?: string | null;
  labelName?: string | null;
  subject?: string | null;
  senderEmail?: string | null;
  receivedAt?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  storagePath?: string | null;
  status?: string;
  confidence?: number;
  duplicateRisk?: string;
  metadata?: Record<string, unknown>;
};

if ((import.meta as { main?: boolean }).main) {
  serve(async (req: Request) => {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let body: { action?: string } & EnqueuePayload = {} as { action?: string } & EnqueuePayload;

    try {
      body = (await req.json()) as { action?: string } & EnqueuePayload;
      const action = body.action ?? "enqueue";

      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        return Response.json(
          { ok: false, action, message: "Supabase runtime environment is missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." },
          { status: 200 },
        );
      }

      const supabase = getSupabaseClient();

      // Resolve the caller before anything else. Every action on this function
      // writes finance state, and the audit trail records who did it, so a request
      // without a verified identity is refused here rather than being processed as
      // an anonymous write that nothing can be attributed to.
      const caller = await resolveCaller(req, supabase);
      requirePermission(caller, action);
      console.log(`[auth] ${action} by ${caller.kind} "${caller.label}" (${caller.roles.join(", ") || "n/a"})`);

      if (action === "sync_gmail") {
        const labelName = body.labelName ?? Deno.env.get("FINANCE_GMAIL_LABEL") ?? "Invoices to process";
        const result = await syncGmailInvoices(supabase, labelName, 4);
        return Response.json(result);
      }

      // "process" is the interactive path a finance user triggers from the dashboard.
      // "drain_queue" is the same code reached by pg_cron after it promotes a due
      // retry, which is what lets a retry finish with no browser tab open. Sharing
      // one implementation means the scheduled path cannot drift from the tested one.
      if (action === "process" || action === "drain_queue") {
        const limit = action === "drain_queue"
          ? Math.min(Number((body as Record<string, unknown>).limit ?? 5), 20)
          : Math.min(Number((body as Record<string, unknown>).limit ?? 1), 10);

        // Identifies this invocation in finance_intake_jobs.locked_by so a stalled job
        // can be attributed to a worker rather than looking orphaned.
        const workerId = createId();

        // Set to the row this job is about to rewrite, so the duplicate probe can
        // exclude it. Without this, re-processing a job always matches the candidate
        // it just wrote and flags every retry as a duplicate of itself.
        let currentCandidateId: string | null = null;

        /**
         * Rule C probe. Matches on the triple the finance team reconciles by -
         * supplier, invoice number and total - because any one of them alone produces
         * false positives: suppliers reissue numbers, and two suppliers can legitimately
         * bill the same amount.
         */
        const duplicateLookup = async (criteria: {
          supplierName: string;
          invoiceNumber: string;
          totalAmount: number;
        }): Promise<DuplicateMatch[]> => {
          if (!currentCandidateId) return [];
          const { data, error } = await supabase
            .from("finance_invoice_candidates")
            .select("id, intake_item_id, supplier_name, invoice_number, gross_total, created_at")
            .ilike("supplier_name", criteria.supplierName)
            .ilike("invoice_number", criteria.invoiceNumber)
            .eq("gross_total", criteria.totalAmount)
            .neq("id", currentCandidateId)
            .limit(5);

          if (error) throw error;
          return (Array.isArray(data) ? data : []).map((row: any) => ({
            intakeItemId: row.intake_item_id,
            candidateId: row.id,
            supplierName: row.supplier_name,
            invoiceNumber: row.invoice_number,
            totalAmount: row.gross_total === null ? null : Number(row.gross_total),
            createdAt: row.created_at,
          }));
        };
        let jobQuery = supabase
          .from("finance_intake_jobs")
          .select("*, intake_item:finance_intake_items!finance_intake_jobs_intake_item_id_fkey(*)")
          .eq("status", "queued")
          .eq("job_type", "extract")
          .order("created_at", { ascending: true })
          .limit(limit);

        const targetJobId = (body as Record<string, unknown>).jobId;
        if (targetJobId) {
          jobQuery = jobQuery.eq("id", String(targetJobId));
        }

        const { data: jobs, error: jobsError } = await jobQuery;

        if (jobsError) throw jobsError;
        console.log("[process] Found queued jobs:", jobs?.length ?? 0, jobs?.map((j: any) => ({ id: j.id, status: j.status, job_type: j.job_type })));
        if (!jobs || jobs.length === 0) {
          return Response.json({ ok: true, action, processed: 0, results: [] });
        }

        const results = [];
        for (const job of jobs) {
          try {
            console.log("[process] Starting job:", job.id);

            // Claim the job before doing any work. The update is conditioned on the
            // row still being 'queued', so two workers racing for the same job see
            // different row counts and exactly one proceeds. A plain read-then-write
            // claim let a Gmail pull and a scheduled drain extract the same invoice
            // twice and race on the candidate upsert.
            const { data: claimed, error: claimError } = await supabase
              .from("finance_intake_jobs")
              .update({
                status: "processing",
                locked_at: new Date().toISOString(),
                locked_by: workerId,
                attempt_count: (job.attempt_count ?? 0) + 1,
              })
              .eq("id", job.id)
              .eq("status", "queued")
              .select("id");

            if (claimError) throw claimError;
            if (!Array.isArray(claimed) || claimed.length === 0) {
              console.log("[process] Job already claimed by another worker, skipping:", job.id);
              continue;
            }

            const item = job.intake_item;
            if (!item) {
              throw new Error("No intake item found for job");
            }

            // The client is no longer responsible for reflecting progress, but the item
            // status still drives the dashboard badge, so it moves to 'extracting' now.
            await supabase.from("finance_intake_items").update({ status: "extracting" }).eq("id", item.id);

            // Manual uploads carry the invoice as a storage path rather than a Gmail
            // attachment. Pull the file out of storage and run it through the same
            // PDF/text extraction the Gmail path uses, so the job payload below is
            // populated identically regardless of source. Without this a manual upload
            // enqueues a job with no rawText and no pdfStructured, and the worker
            // silently produces nothing.
            const storagePath = item.storage_path ?? null;
            if (storagePath && !job.payload?.rawText && !job.payload?.pdfStructured && !item.metadata?.rawText && !item.metadata?.pdfStructured) {
              console.log("[process] Manual upload detected; extracting from storage:", storagePath);
              const manual = await extractFromStorageAttachment(supabase, storagePath, item.file_name ?? "invoice");
              if (manual) {
                const updatedPayload = { ...(job.payload ?? {}), ...manual };
                await supabase
                  .from("finance_intake_jobs")
                  .update({ payload: updatedPayload })
                  .eq("id", job.id);
                job.payload = updatedPayload;
                await supabase
                  .from("finance_intake_items")
                  .update({ metadata: { ...(item.metadata ?? {}), rawText: manual.rawText ?? null, pdfStructured: manual.pdfStructured ?? null } })
                  .eq("id", item.id);
                item.metadata = { ...(item.metadata ?? {}), rawText: manual.rawText ?? null, pdfStructured: manual.pdfStructured ?? null };
              }
            }

            // The PDF multimodal pass is authoritative when it produced line items.
            const pdfStructured = (job.payload?.pdfStructured ?? item.metadata?.pdfStructured ?? null) as Record<string, unknown> | null;
            const rawText = job.payload?.rawText ?? item.metadata?.rawText ?? "";
            let structuredExtraction: any = null;
            let extractionError: string | null = null;
            let processorName = "gemini-llm";
            if (rawText.trim()) {
              console.log("[process] Running LLM extraction for job:", job.id);
              const extraction = await runLlmExtraction(rawText);
              if (extraction.errors && extraction.errors.length > 0) {
                extractionError = extraction.errors.join("; ");
                console.log("[process] Extraction error:", extractionError);
              }
              if (extraction.structuredData && Object.keys(extraction.structuredData).length > 0) {
                structuredExtraction = extraction.structuredData;
              }
            } else {
              console.log("[process] No raw text for job:", job.id);
            }

            if (pdfStructured) {
              // Whichever pass read the invoice better becomes the base. A PDF pass that
              // only found the header totals must not overwrite a text pass that found
              // the line items, and vice versa.
              const pdfScore = scorePdfStructured(pdfStructured);
              const textScore = structuredExtraction ? scoreExtractionConfidence(structuredExtraction) : -1;
              const pdfWins = pdfScore >= textScore;
              console.log(
                "[process] Merging extractions for job:", job.id,
                "| pdf score:", pdfScore, "text score:", textScore,
                "| base:", pdfWins ? "pdf-vision" : "text",
              );
              if (pdfWins) processorName = "gemini-pdf-vision";
              structuredExtraction = mergeExtractions(
                pdfWins ? pdfStructured : structuredExtraction,
                pdfWins ? structuredExtraction : pdfStructured,
              ) as Record<string, unknown> | null;
            }

            if (structuredExtraction) {
              structuredExtraction = {
                ...structuredExtraction,
                confidence: scoreExtractionConfidence(structuredExtraction),
                processor: processorName,
              };
              console.log(
                "[process] Extraction ready for job:", job.id,
                "processor:", structuredExtraction.processor,
                "confidence:", structuredExtraction.confidence,
              );
            }

            // Attach structured extraction to item metadata for hybrid resolution
            const itemWithExtraction = {
              ...item,
              metadata: {
                ...item.metadata,
                structuredExtraction,
                geminiExtraction: structuredExtraction,
              },
            };

            // Run hybrid extraction
            console.log("[process] Running hybrid extraction for job:", job.id);
            const resolution = resolveHybridInvoiceCandidate(itemWithExtraction);

            // If LLM extraction failed or returned nothing, ensure candidate gets "validated" status
            // so it can be manually processed in the dashboard (maps to valid DB status)
            let candidateStatus = resolution.candidatePayload.status;
            let candidateConfidence = resolution.candidatePayload.confidence;
            if (extractionError && (!structuredExtraction || resolution.candidatePayload.status === "rejected")) {
              candidateStatus = "validated"; // Use valid DB status
              candidateConfidence = Math.max(candidateConfidence, 30);
              console.log("[process] Forcing validated status due to extraction error");
            }

            // Look up any existing candidate first so the duplicate probe can exclude it.
            const { data: existingCandidate } = await supabase
              .from("finance_invoice_candidates")
              .select("id")
              .eq("intake_item_id", item.id)
              .maybeSingle();
            currentCandidateId = existingCandidate?.id ?? null;

            // Deterministic validation runs on every extraction, before the candidate
            // is allowed to leave the queue. The model is good at reading a document and
            // bad at arithmetic, and the two failures are indistinguishable from the
            // outside, so the totals are checked here rather than discovered inside Xero.
            const validation = await validateExtraction(
              {
                supplierName: resolution.candidatePayload.supplier_name ?? null,
                invoiceNumber: resolution.candidatePayload.invoice_number ?? null,
                invoiceDate: resolution.candidatePayload.invoice_date ?? null,
                subtotal: toFiniteNumber(resolution.candidatePayload.subtotal),
                gstAmount: toFiniteNumber(resolution.candidatePayload.tax_total),
                totalAmount: toFiniteNumber(resolution.candidatePayload.gross_total),
                currency: resolution.candidatePayload.currency ?? null,
                lineItemCount: Array.isArray(resolution.candidatePayload.line_items)
                  ? resolution.candidatePayload.line_items.length
                  : 0,
              },
              { duplicateLookup },
            );

            const validationErrors: ValidationError[] = [...validation.errors, ...validation.warnings];
            const validationWarnings = validation.warnings.map(w => w.rule);
            console.log(
              "[process] Validation for job:", job.id,
              "| ok:", validation.ok,
              "| errors:", validation.errors.length,
              "| warnings:", validation.warnings.length,
              "| summary:", JSON.stringify(validation.summary),
            );

            // Upsert candidate with structured data
            console.log("[process] Upserting candidate for job:", job.id);

            const candidatePatch = {
              ...resolution.candidatePayload,
              status: candidateStatus,
              confidence: candidateConfidence,
              validation_errors: validationErrors,
              validation_warnings: validationWarnings,
              validation_summary: { ...validation.summary, errors: validationErrors },
            };

            let candidateId: string;
            if (existingCandidate?.id) {
              const { error: updateError } = await supabase
                .from("finance_invoice_candidates")
                .update(candidatePatch)
                .eq("id", existingCandidate.id);
              if (updateError) throw updateError;
              candidateId = existingCandidate.id;
            } else {
              const { data: newCandidate, error: insertError } = await supabase
                .from("finance_invoice_candidates")
                .insert(candidatePatch)
                .select("id")
                .single();
              if (insertError) throw insertError;
              candidateId = newCandidate.id;
            }
            console.log("[process] Candidate created:", candidateId);

            // Insert extraction run record
            const { data: extractionRun } = await supabase
              .from("finance_extraction_runs")
              .insert({
                ...resolution.extractionRunPayload,
                candidate_id: candidateId,
                validation_payload: { ...resolution.extractionRunPayload.validation_payload, ...validation.summary },
              })
              .select("id")
              .single();

            // A failed validation route routes the item to needs_review so it surfaces in
            // the dashboard's review lane with its error tags attached, rather than
            // looking identical to a clean extraction.
            const itemStatus = validation.requiresReview
              ? "needs_review"
              : resolution.decision.status === "submitted" || resolution.decision.status === "draft"
                ? "extracted"
                : "review";

            // Update intake item
            await supabase.from("finance_intake_items").update({
              status: itemStatus,
              confidence: resolution.candidatePayload.confidence,
              duplicate_risk: resolution.candidatePayload.duplicate_fingerprint
                ? (validation.summary.duplicate ? "possible" : "clear")
                : "unknown",
              candidate_id: candidateId,
              validation_errors: validationErrors,
              validation_warnings: validationWarnings,
              extraction_run_id: extractionRun?.id ?? null,
              extraction_summary: validation.summary,
            }).eq("id", item.id);

            // Update job status
            console.log("[process] Updating job status to completed:", job.id);
            const { error: jobUpdateError } = await supabase.from("finance_intake_jobs").update({
              status: "completed",
              locked_at: null,
              locked_by: null,
              scheduled_for: null,
              last_error: null,
            }).eq("id", job.id);
            if (jobUpdateError) {
              console.error("[process] Failed to update job status:", jobUpdateError);
              throw new Error("Job status update failed: " + JSON.stringify(jobUpdateError));
            }
            console.log("[process] Job completed:", job.id);

            await appendAuditLog(supabase, {
              intakeItemId: item.id,
              candidateId,
              extractionRunId: extractionRun?.id ?? null,
              jobId: job.id,
              eventType: validation.requiresReview ? "review_opened" : "ocr_processed",
              source: "worker",
              metadata: {
                processor: processorName,
                confidence: resolution.candidatePayload.confidence,
                validation: validation.summary,
                validationErrors,
              },
            });

            results.push({
              jobId: job.id,
              candidateId,
              status: itemStatus,
              confidence: resolution.candidatePayload.confidence,
              validationErrors,
            });
          } catch (jobError) {
            const message = formatErrorValue(jobError);
            const attempt = Number(job.attempt_count ?? 0) + 1;

            // Exponential backoff: 30s, 60s, 120s. The job is re-queued as 'retrying'
            // with a scheduled_for, and the pg_cron drain promotes it once the window
            // has elapsed - so a retry survives a closed browser tab, which a
            // client-side polling loop never could. After MAX_JOB_ATTEMPTS the item
            // is parked in failed_review for a human instead of looping forever.
            if (attempt < MAX_JOB_ATTEMPTS) {
              const delayMs = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
              const scheduledFor = new Date(Date.now() + delayMs).toISOString();

              await supabase.from("finance_intake_jobs").update({
                status: "retrying",
                scheduled_for: scheduledFor,
                locked_at: null,
                locked_by: null,
                last_error: message,
              }).eq("id", job.id);

              await supabase.from("finance_intake_items").update({
                status: "pending",
                failure_reason: message,
              }).eq("id", job.intake_item_id);

              await appendAuditLog(supabase, {
                intakeItemId: job.intake_item_id,
                jobId: job.id,
                eventType: "retry_scheduled",
                source: "worker",
                metadata: { attempt, maxAttempts: MAX_JOB_ATTEMPTS, scheduledFor, error: message },
              });

              console.warn(`[process] Job ${job.id} failed (attempt ${attempt}/${MAX_JOB_ATTEMPTS}); retrying at ${scheduledFor}: ${message}`);
              results.push({ jobId: job.id, status: "retrying", attempt, scheduledFor, error: message });
              continue;
            }

            await supabase.from("finance_intake_jobs").update({
              status: "failed",
              locked_at: null,
              locked_by: null,
              last_error: message,
            }).eq("id", job.id);

            await supabase.from("finance_intake_items").update({
              status: "failed_review",
              failed_at: new Date().toISOString(),
              failure_reason: message,
            }).eq("id", job.intake_item_id);

            await appendAuditLog(supabase, {
              intakeItemId: job.intake_item_id,
              jobId: job.id,
              eventType: "validation_failed",
              source: "worker",
              metadata: { attempt, error: message, terminal: true },
            });

            console.error(`[process] Job ${job.id} failed permanently after ${attempt} attempts: ${message}`);
            results.push({ jobId: job.id, status: "failed_review", attempt, error: message });
          }
        }

        return Response.json({ ok: true, action, processed: results.length, results });
      }

      if (action === "record_edit") {
        return Response.json(await applyCandidateEdit(supabase, body as Record<string, unknown>, caller));
      }

      if (action === "reprocess") {
        return Response.json(await reprocessItem(supabase, body as Record<string, unknown>, caller));
      }

      if (action === "post_xero") {
        const candidateIds = Array.isArray(body.candidateIds) ? body.candidateIds : [];
        const overrides = (body as Record<string, unknown>).invoiceNumberOverrides;
        const result = await postCandidatesToXero(
          supabase,
          candidateIds.length > 0 ? candidateIds : undefined,
          overrides && typeof overrides === "object" ? overrides as Record<string, string> : undefined,
        );
        return Response.json(result);
      }

      if (action !== "enqueue") {
        return Response.json({ ok: false, action, message: `Unsupported action: ${action}` }, { status: 200 });
      }

      const result = await enqueueItem(supabase, body, caller);
      return Response.json(result);
    } catch (error) {
      const message = formatErrorValue(error);

      // Authentication and authorization failures are reported with a real status
      // code. Everything else keeps the historical 200-with-ok:false contract,
      // because the dashboard reads that shape and a bare 500 would show it as an
      // unexplained network failure rather than a finance problem.
      if (error instanceof FinanceAuthError) {
        console.warn(`[auth] Refused ${body?.action ?? "unknown"}: ${message}`);
        return Response.json(
          { ok: false, action: body?.action ?? "unknown", message, code: "not_authorized" },
          { status: error.status },
        );
      }

      console.error("finance-intake failed", error);
      return Response.json(
        {
          ok: false,
          action: body?.action ?? "unknown",
          message,
          details: error instanceof Error ? { name: error.name, stack: error.stack ?? null } : { raw: String(error) },
        },
        { status: 200 },
      );
    }
  });
}
