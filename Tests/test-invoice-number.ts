// Verifies sanitizeInvoiceNumber against real invoice numbers from the Xero demo org
// and against the money values it must never mistake for a number.
// Imports the edge function module, so it uses the real implementation.
import { sanitizeInvoiceNumber, recoverInvoiceNumberFromText } from "./supabase/functions/finance-intake/index.ts";

let failures = 0;

function accepts(name: string, input: unknown, expected: string) {
  const actual = sanitizeInvoiceNumber(input);
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  keeps    ${name.padEnd(34)} ${JSON.stringify(input)} -> ${JSON.stringify(actual)}`);
}

function rejects(name: string, input: unknown) {
  const actual = sanitizeInvoiceNumber(input);
  const pass = actual === null;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  rejects  ${name.padEnd(34)} ${JSON.stringify(input)} -> ${JSON.stringify(actual)}`);
}

console.log("--- numbers with separators and no letters: these were being dropped ---");
accepts("MYOB invoice number", "2-10009929258", "2-10009929258");
accepts("MYOB with a slash", "2/10009929258", "2/10009929258");
accepts("RPT prefixed series", "RPT445-1", "RPT445-1");
accepts("date-like short ref", "08-4123", "08-4123");
accepts("space separated", "660 700 225", "660 700 225");
accepts("underscore separated", "INV_2024_0088", "INV_2024_0088");
accepts("parenthesised", "INV(1)", "INV(1)");
accepts("leading hash stripped", "#88213", "88213");
accepts("colon prefix stripped", ": 88213", "88213");
accepts("long hyphenated", "2024-ABC-XYZ-0001", "2024-ABC-XYZ-0001");

console.log("\n--- alphanumeric numbers seen in the org ---");
for (const number of [
  "IV00004431", "M000471", "M000463", "M000456", "M000442", "M000435",
  "RPT489-1", "RPT453-1", "RPT469-1", "RPT412-1", "08-4123", "945-Ocon",
  "SM0210", "CS815", "GB1-White", "720-2", "720-1", "660700225", "471", "408", "449", "710",
  "INV-007", "B-2024-118", "NZ-ABC-1234",
]) {
  accepts("org number", number, number);
}

console.log("\n--- amounts echoed from the totals block must still be rejected ---");
for (const amount of ["249.00", "1002.91", "1,002.91", "59.80", "0.15", "$249", "1,002"]) {
  rejects("money value", amount);
}

console.log("\n--- a bare integer is a valid invoice number and must be kept ---");
for (const number of ["1002", "88213", "12345", "7"]) {
  accepts("bare integer", number, number);
}

console.log("\n--- dates, placeholders and junk ---");
for (const junk of [
  "2026-05-27", "2026/05/27", "27/05/2026", "27-05-26", "27 May 2026",
  "unknown", "N/A", "NA", "none", "null", "TBD", "not specified", "-", "", "   ",
  "---", "...", "###",
]) {
  rejects("junk value", junk);
}

console.log("\n--- edge cases ---");
rejects("null", null);
rejects("undefined", undefined);
accepts("number input", 88213, "88213");
accepts("collapses whitespace", "IV 00004431", "IV 00004431");
rejects("over 60 chars", "A1".repeat(31));
accepts("exactly 60 chars", "A1".repeat(30), "A1".repeat(30));
rejects("expression-ish", "1+1");
rejects("only separators", "-/-/-");
accepts("trailing colon stripped", "88213:", "88213");
accepts("decorated number", "  # 88213  ", "88213");

console.log("\n--- recovering a printed number straight from document text ---");

function recovers(name: string, text: string, expected: string | null) {
  const actual = recoverInvoiceNumberFromText(text);
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  recovers  ${name.padEnd(30)} -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
}

recovers("MYOB style header", `MYOB NZ Limited\nGST 123-456-789\nINVOICE NUMBER 2-10009929258\nInvoice date 2026-08-28\nDue date 2026-09-27`, "2-10009929258");
recovers("Invoice No: with colon", "TAX INVOICE\nInvoice No: IV00004431\nTotal 1002.92", "IV00004431");
recovers("Invoice # with hash", "BrightSpark Ltd\nInvoice #: BS-2041\nAmount Due 1380.00", "BS-2041");
recovers("Invoice Number: mixed case", "Acme\nInvoice Number: M000471\nSubtotal 500.00", "M000471");
recovers("Tax invoice no", "Warehouse Ltd\nTax Invoice No 720-2\nTotal 99.00", "720-2");
recovers("Bill number", "Cloud Co\nBill No. INV-2024-77\nTotal 20.00", "INV-2024-77");
recovers("repeats are ranked", "Invoice No: 2-10009929258\nshown again: Invoice No: 2-10009929258", "2-10009929258");
recovers("ignores a total after the label", "Invoice No: M000442\nTotal Due 249.00\nTotal 249.00", "M000442");
recovers("no number in text", "MYOB NZ Limited\nInvoice date 2026-08-28\nTotal 249.00", null);
recovers("empty text", "", null);

console.log("\n--- the exact text that was missed ---");
recovers("reported case", "INVOICE NUMBER 2-10009929258", "2-10009929258");

console.log("\n--- reference keeps non-numeric values but still drops amounts ---");
import { sanitizeReference } from "./supabase/functions/finance-intake/index.ts";
for (const value of ["100281 -C1144SR", "MAYO", "CLIENT-PO-A", "PO-99218", "945-Ocon"]) {
  const actual = sanitizeReference(value);
  const pass = actual === value;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  reference  ${value.padEnd(18)} -> ${JSON.stringify(actual)}`);
}
for (const value of ["249.00", "1,002.91"]) {
  const actual = sanitizeReference(value);
  const pass = actual === null;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  reference  ${value.padEnd(18)} -> ${JSON.stringify(actual)} (expected null)`);
}

console.log("\n--- recovering a number from an email subject ---");
import { resolveHybridInvoiceCandidate } from "./supabase/functions/finance-intake/hybrid-extraction.ts";

function fromSubject(name: string, subject: string, structured: Record<string, unknown>, expected: string | null) {
  const item: Record<string, unknown> = { subject, metadata: { structuredExtraction: { processor: "gemini-pdf-vision", confidence: 100, ...structured } } };
  const actual = (resolveHybridInvoiceCandidate(item) as { resolvedFields: { invoiceNumber: string | null } }).resolvedFields.invoiceNumber;
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  subject   ${name.padEnd(28)} -> ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
}

const empty = { supplierName: "MYOB NZ Limited", invoiceNumber: null, grossTotal: 59.8 };

fromSubject("reported case", "Fw: MYOB Tax Invoice 2-10009929258", empty, "2-10009929258");
fromSubject("labelled no", "Invoice No: IV00004431", empty, "IV00004431");
fromSubject("label with hash", "Invoice # BS-2041", empty, "BS-2041");
fromSubject("Myob style", "MYOB Tax Invoice 2-10009929258", empty, "2-10009929258");
fromSubject("no prefix", "Tax Invoice M000471", empty, "M000471");
fromSubject("document beats subject", "Fw: MYOB Tax Invoice 2-10009929258", { ...empty, invoiceNumber: "M000999" }, "M000999");
fromSubject("subject has no number", "Fw: Your September statement", empty, null);
fromSubject("subject amount only", "Invoice 249.00", empty, null);
fromSubject("bare word only", "Invoice", empty, null);

console.log(failures === 0 ? "\nAll invoice number checks passed" : `\n${failures} check(s) failed`);
Deno.exit(failures === 0 ? 0 : 1);
