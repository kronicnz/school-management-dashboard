/**
 * Optimized JSON Schema enforcement for Gemini Structured Outputs.
 *
 * Performance Improvements:
 * - Removed tight regex patterns (`ISO_DATE_PATTERN`) to eliminate Gemini decoding 
 *   backtracking overhead and prevent extraction failures on non-standard date formats.
 * - Set `temperature: 0` for greedy token selection (faster generation & deterministic output).
 * - Explicitly allows `nullable: true` on fields so Gemini returns explicit `null` rather 
 *   than inventing filler values to satisfy type constraints.
 * 
 * Accuracy Improvements:
 * - Sanitized schema descriptions to prevent common extraction mistakes.
 * - Refined numeric & array parsing routines in mapping functions to gracefully convert 
 *   formatted numeric strings (e.g., "$1,234.50") to numbers.
 */

export const SUPPORTED_CURRENCIES = ["NZD", "AUD", "USD"] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const INVOICE_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    is_invoice: {
      type: "boolean",
      description: "True if the document is a tax invoice or bill, False if quote, statement, or order confirmation.",
    },
    multi_document_detected: {
      type: "boolean",
      description: "True ONLY if the file contains 2+ separate invoice documents merged together.",
    },
    supplier_name: {
      type: ["string", "null"],
      description: "The vendor/seller issuing the invoice. Do NOT extract the customer or recipient.",
    },
    gst_number: {
      type: ["string", "null"],
      description: "Vendor GST, ABN, VAT or Tax ID number. Null if absent.",
    },
    invoice_number: {
      type: ["string", "null"],
      description: "Official invoice number. Ignore Purchase Order (PO) or Reference numbers here.",
    },
    invoice_date: {
      type: ["string", "null"],
      description: "Document issue date in YYYY-MM-DD format. Convert printed dates like '12 Jan 2024' to YYYY-MM-DD.",
    },
    due_date: {
      type: ["string", "null"],
      description: "Payment due date in YYYY-MM-DD format. Null if absent.",
    },
    currency: {
      type: ["string", "null"],
      enum: [...SUPPORTED_CURRENCIES],
      description: "3-letter currency code (NZD, AUD, or USD).",
    },
    subtotal: {
      type: ["number", "string", "null"],
      description: "Net subtotal before tax/GST.",
    },
    gst_amount: {
      type: ["number", "string", "null"],
      description: "Total GST/VAT amount charged.",
    },
    total_amount: {
      type: ["number", "string", "null"],
      description: "Final gross total amount payable inclusive of tax.",
    },
    line_items: {
      type: "array",
      description: "List of itemized invoice lines in exact printed order.",
      items: {
        type: "object",
        properties: {
          description: { type: ["string", "null"] },
          quantity: { type: ["number", "string", "null"] },
          unit_price: { type: ["number", "string", "null"] },
          amount: { type: ["number", "string", "null"] },
          account_code: {
            type: ["string", "null"],
            description: "General ledger account code if explicitly printed on the line item.",
          },
        },
        required: ["description", "quantity", "unit_price", "amount"],
      },
    },
    document_extractions: {
      type: "array",
      description: "Extractions for each individual document if multi_document_detected is true.",
      items: {
        type: "object",
        properties: {
          supplier_name: { type: ["string", "null"] },
          gst_number: { type: ["string", "null"] },
          invoice_number: { type: ["string", "null"] },
          invoice_date: { type: ["string", "null"] },
          due_date: { type: ["string", "null"] },
          currency: { type: ["string", "null"], enum: [...SUPPORTED_CURRENCIES] },
          subtotal: { type: ["number", "string", "null"] },
          gst_amount: { type: ["number", "string", "null"] },
          total_amount: { type: ["number", "string", "null"] },
          line_items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: ["string", "null"] },
                quantity: { type: ["number", "string", "null"] },
                unit_price: { type: ["number", "string", "null"] },
                amount: { type: ["number", "string", "null"] },
                account_code: { type: ["string", "null"] },
              },
              required: ["description", "quantity", "unit_price", "amount"],
            },
          },
        },
        required: [
          "supplier_name",
          "invoice_number",
          "subtotal",
          "total_amount",
          "currency",
          "line_items",
        ],
      },
    },
  },
  required: [
    "is_invoice",
    "multi_document_detected",
    "supplier_name",
    "invoice_number",
    "subtotal",
    "gst_amount",
    "total_amount",
    "currency",
    "line_items",
  ],
} as const;

/**
 * Enhanced generation config. 
 * Pinned to temperature 0 for max deterministic speed and topP omitted for unconstrained decoding performance.
 */
export function buildExtractionGenerationConfig(): Record<string, unknown> {
  return {
    responseMimeType: "application/json",
    responseSchema: INVOICE_EXTRACTION_SCHEMA,
    temperature: 0,
  };
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed && trimmed.toLowerCase() !== "null" && trimmed.toLowerCase() !== "undefined") {
      return trimmed;
    }
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    // Strip commas, currency symbols, whitespace
    const cleaned = value.replace(/[^0-9.-]/g, "").trim();
    if (!cleaned || cleaned === "-" || cleaned === ".") return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeCurrency(value: unknown): SupportedCurrency {
  const candidate = String(value ?? "").trim().toUpperCase();
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(candidate)
    ? (candidate as SupportedCurrency)
    : "NZD";
}

/**
 * Converts strict-schema structured output to camelCase payload.
 */
export function mapStrictExtractionToInternal(raw: Record<string, unknown>): Record<string, unknown> {
  const rawLineItems = Array.isArray(raw.line_items) ? raw.line_items : [];

  const result: Record<string, unknown> = {
    isInvoice: typeof raw.is_invoice === "boolean" ? raw.is_invoice : true,
    multiDocumentDetected: typeof raw.multi_document_detected === "boolean" ? raw.multi_document_detected : false,
    supplierName: firstString(raw.supplier_name),
    supplierTaxNumber: firstString(raw.gst_number),
    invoiceNumber: firstString(raw.invoice_number),
    invoiceDate: firstString(raw.invoice_date),
    dueDate: firstString(raw.due_date),
    subtotal: toNumber(raw.subtotal),
    taxTotal: toNumber(raw.gst_amount),
    grossTotal: toNumber(raw.total_amount),
    currency: normalizeCurrency(raw.currency),
    lineItems: rawLineItems.map((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      const accountCode = firstString(item.account_code);
      return {
        description: firstString(item.description) ?? "",
        quantity: toNumber(item.quantity) ?? 1,
        unitAmount: toNumber(item.unit_price),
        lineAmount: toNumber(item.amount),
        taxType: "INPUT2",
        accountCode: accountCode ?? null,
      };
    }),
  };

  if (result.multiDocumentDetected && Array.isArray(raw.document_extractions)) {
    result.documentExtractions = raw.document_extractions.map((extraction: unknown) => {
      const ext = (extraction ?? {}) as Record<string, unknown>;
      return {
        supplierName: firstString(ext.supplier_name),
        supplierTaxNumber: firstString(ext.gst_number),
        invoiceNumber: firstString(ext.invoice_number),
        invoiceDate: firstString(ext.invoice_date),
        dueDate: firstString(ext.due_date),
        subtotal: toNumber(ext.subtotal),
        taxTotal: toNumber(ext.gst_amount),
        grossTotal: toNumber(ext.total_amount),
        currency: normalizeCurrency(ext.currency),
        lineItems: (Array.isArray(ext.line_items) ? ext.line_items : []).map((entry: unknown) => {
          const item = (entry ?? {}) as Record<string, unknown>;
          const accountCode = firstString(item.account_code);
          return {
            description: firstString(item.description) ?? "",
            quantity: toNumber(item.quantity) ?? 1,
            unitAmount: toNumber(item.unit_price),
            lineAmount: toNumber(item.amount),
            taxType: "INPUT2",
            accountCode: accountCode ?? null,
          };
        }),
      };
    });
  }

  return result;
}

export function isStrictExtractionShape(raw: Record<string, unknown>): boolean {
  const keys = Object.keys(raw ?? {});
  return keys.some((key) =>
    [
      "is_invoice",
      "multi_document_detected",
      "supplier_name",
      "gst_number",
      "invoice_number",
      "subtotal",
      "gst_amount",
      "total_amount",
      "line_items",
    ].includes(key)
  );
}