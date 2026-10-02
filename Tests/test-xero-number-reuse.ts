// Does deleting a bill free its invoice number in Xero?
//
// This matters because the user wants to "flush" the deleted invoices to stop the
// number_consumed errors. The answer decides whether that is worth doing at all, so it is
// tested rather than assumed.
//
// Method: attempt to create a bill under a number already held by a DELETED bill. If Xero
// accepts it, the number was free. The test uses numbers created by earlier diagnostics in
// the demo company, not real supplier data.
import { readFileSync } from "node:fs";

const token = Deno.env.get("XERO_ACCESS_TOKEN");
const tenant = Deno.env.get("XERO_TENANT_ID");
if (!token || !tenant) {
  console.log("SKIP  no Xero credentials");
  Deno.exit(0);
}

const headers = {
  Authorization: `Bearer ${token}`,
  "Xero-tenant-id": tenant,
  Accept: "application/json",
  "Content-Type": "application/json",
};

const list = await (await fetch(
  "https://api.xero.com/api.xro/2.0/Invoices?includeArchived=true&page=1&pageSize=200",
  { headers },
)).json();

const dead = (list?.Invoices ?? []).filter(
  (i: any) => i?.Type === "ACCPAY" && ["DELETED", "VOIDED", "ARCHIVED"].includes(i.Status),
);

// Group the dead bills by invoice number so we can see which numbers are held by which states.
const byNumber = new Map<string, Set<string>>();
for (const bill of dead) {
  const number = String(bill.InvoiceNumber ?? "").trim();
  if (!number) continue;
  if (!byNumber.has(number)) byNumber.set(number, new Set());
  byNumber.get(number)!.add(bill.Status);
}

console.log("dead bills holding an invoice number:");
for (const [number, statuses] of [...byNumber].sort()) {
  console.log(`  ${number.padEnd(26)} ${[...statuses].join(", ")}`);
}

// Probe one number per distinct dead state to see whether the number is actually free.
// A voided bill was authorised at some point, so its number is locked permanently. A bill
// that was deleted while still a draft may free its number.
async function probe(number: string, contactId: string, date: string) {
  const response = await fetch("https://api.xero.com/api.xro/2.0/Invoices", {
    method: "POST",
    headers,
    body: JSON.stringify({
      Type: "ACCPAY",
      Contact: { ContactID: contactId },
      Date: date,
      LineAmountTypes: "Exclusive",
      Status: "DRAFT",
      InvoiceNumber: number,
      LineItems: [{ Description: "Number reuse probe", Quantity: 1, UnitAmount: 1, AccountCode: "400" }],
    }),
  });
  const text = await response.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text || "{}"); } catch { /* non-JSON body */ }
  if (response.ok) {
    return { ok: true, invoiceId: parsed.Invoices?.[0]?.InvoiceID, status: parsed.Invoices?.[0]?.Status };
  }
  const message = parsed?.Message ?? parsed?.Detail ?? parsed?.Elements?.[0]?.ValidationErrors?.[0]?.Message ?? text.slice(0, 200);
  return { ok: false, message: String(message) };
}

const contact = (list?.Contacts ?? [])[0];
const contactsRes = await (await fetch("https://api.xero.com/api.xro/2.0/Contacts?page=1", { headers })).json();
const contactId = String(contactsRes?.Contacts?.[0]?.ContactID ?? "");
if (!contactId) {
  console.log("SKIP  no Xero contact available to probe against");
  Deno.exit(0);
}

const probes = ["DIAG-001", "VERIFY-CORRECTED-PAYLOAD", "IV00004431-CORRECTED", "IV00004431", "660700225", "2-10009929258"];
const created: string[] = [];
console.log("\nprobing whether each number can be used for a new bill:");
for (const number of probes) {
  const result = await probe(number, contactId, "2026-09-28");
  const statuses = byNumber.get(number) ? [...byNumber.get(number)!].join(",") : "not held by any dead bill";
  console.log(`  ${number.padEnd(26)} held-by=${statuses.padEnd(18)} ${result.ok ? `REUSED (new bill ${result.invoiceId})` : `BLOCKED: ${result.message}`}`);
  if (result.ok && result.invoiceId) created.push(result.invoiceId);
}

console.log(`\n${created.length} probe bill(s) were created and will now be deleted.`);
for (const id of created) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${id}`, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ Status: "DELETED" }),
  });
  console.log(`  cleanup ${id}: ${res.ok ? "deleted" : `failed (${res.status})`}`);
}
