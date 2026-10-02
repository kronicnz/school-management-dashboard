import { strict as assert } from "node:assert"
import { extractFinanceHints, extractEmailText } from "./index.ts"
import { resolveHybridInvoiceCandidate } from "./hybrid-extraction.ts"

Deno.test("extractFinanceHints parses plain text multi-item invoices", () => {
  const rawEmail = [
    "From: invoices@example.com",
    "Subject: Invoice 1234",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Invoice Date: 12/09/2026",
    "Due Date: 26/09/2026",
    "Stationery Pack 2 x $10.00 $20.00",
    "Printer Ink 1 x $15.00 $15.00",
    "Total $35.00",
  ].join("\n")

  const hints = extractFinanceHints(rawEmail, null, null, "invoice.eml")

  assert.equal(hints.invoiceDate, "2026-09-12")
  assert.equal(hints.dueDate, "2026-09-26")
  assert.equal(hints.lineItems.length, 2)
  assert.equal(hints.lineItems[0].Description, "Stationery Pack")
  assert.equal(hints.lineItems[0].Quantity, 2)
  assert.equal(hints.lineItems[0].UnitAmount, 10)
  assert.equal(hints.lineItems[1].Description, "Printer Ink")
  assert.equal(hints.lineItems[1].Quantity, 1)
  assert.equal(hints.lineItems[1].UnitAmount, 15)
  assert.equal(hints.amount, 35)
})

Deno.test("extractFinanceHints parses html table invoices", () => {
  const rawEmail = [
    'From: billing@example.com',
    'Subject: HTML Invoice',
    'Content-Type: multipart/alternative; boundary="boundary123"',
    "",
    "--boundary123",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Please see the HTML version.",
    "",
    "--boundary123",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "<html><body>",
    "<p>Invoice Date: 01/09/2026</p>",
    "<table>",
    "<tr><td>Consulting</td><td>2</td><td>$50.00</td><td>$100.00</td></tr>",
    "<tr><td>Hosting</td><td>1</td><td>$20.00</td><td>$20.00</td></tr>",
    "</table>",
    "<p>Due Date: 15/09/2026</p>",
    "<p>Grand Total $120.00</p>",
    "</body></html>",
    "",
    "--boundary123--",
  ].join("\n")

  const text = extractEmailText(rawEmail)
  const hints = extractFinanceHints(rawEmail, null, null, "invoice.eml")

  assert.ok(text.includes("Consulting"))
  assert.equal(hints.invoiceDate, "2026-09-01")
  assert.equal(hints.dueDate, "2026-09-15")
  assert.equal(hints.lineItems.length, 2)
  assert.equal(hints.lineItems[0].Description, "Consulting")
  assert.equal(hints.lineItems[0].Quantity, 2)
  assert.equal(hints.lineItems[0].UnitAmount, 50)
  assert.equal(hints.lineItems[1].Description, "Hosting")
  assert.equal(hints.lineItems[1].Quantity, 1)
  assert.equal(hints.lineItems[1].UnitAmount, 20)
  assert.equal(hints.amount, 120)
})

Deno.test("extractFinanceHints sanitizes unicode escape text", () => {
  const rawEmail = [
    "From: weird@example.com",
    "Subject: Backslash Test",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Item \u2028 Name 1 x $12.00 $12.00",
    "Total $12.00",
  ].join("\n")

  const hints = extractFinanceHints(rawEmail, null, null, "invoice.eml")

  assert.equal(hints.lineItems.length, 1)
  assert.equal(String(hints.lineItems[0].Description).includes("\\"), false)
  assert.equal(hints.lineItems[0].Description, "Item Name")
})

Deno.test("resolveHybridInvoiceCandidate prefers structured overrides and records provenance", () => {
  const result = resolveHybridInvoiceCandidate({
    id: "item_1",
    source_fingerprint: "fingerprint-1",
    metadata: {
      parsedSubject: "Legacy Subject",
      parsedSender: "billing@example.com",
      parsedBodyPreview: "Legacy body preview",
      extractedGrossTotal: 100,
      parsedLineItems: [{ Description: "Legacy line", Quantity: 1, UnitAmount: 100 }],
      parsedConfidence: 42,
      llmExtraction: {
        supplierName: "LLM Supplier",
        invoiceNumber: "INV-900",
        invoiceDate: "2026-09-01",
        dueDate: "2026-09-15",
        grossTotal: 100,
        lineItems: [{ Description: "LLM line", Quantity: 2, UnitAmount: 50 }],
      },
    },
  })

  assert.equal(result.candidatePayload.supplier_name, "LLM Supplier")
  assert.equal(result.candidatePayload.invoice_number, "INV-900")
  assert.equal(result.candidatePayload.line_items[0].Description, "LLM line")
  assert.equal(result.validationFlags.totalsBalanced, true)
  assert.equal(result.processorChain.includes("gemini-llm"), true)
  assert.equal(result.fieldObservations.some((observation) => observation.field_name === "supplier_name"), true)
  assert.equal(result.fieldObservations.some((observation) => observation.source_processor === "gemini-llm"), true)
})
