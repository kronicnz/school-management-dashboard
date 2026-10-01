// Removes test residue from the Xero demo company.
//
// Safety rules, applied literally rather than by judgement:
//   - Only bills whose contact or number is recognisably test junk are removed.
//   - Any bill attached to a real supplier, or to a real invoice number, is left alone.
//   - The blocked numbers IV00004431 and 2-10009929258 are deliberately kept: deleting
//     their voided bills cannot free the numbers and would destroy the evidence of why.
import { createClient } from "npm:@supabase/supabase-js";

const token = Deno.env.get("XERO_ACCESS_TOKEN")!;
const tenant = Deno.env.get("XERO_TENANT_ID")!;
const APPLY = Deno.args.includes("--apply");

const headers = {
  Authorization: `Bearer ${token}`,
  "Xero-tenant-id": tenant,
  Accept: "application/json",
  "Content-Type": "application/json",
};

async function xero(path: string, init?: RequestInit) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0${path}`, { headers, ...init });
  const text = await res.text();
  let json: any = {};
  try { json = JSON.parse(text || "{}"); } catch { /* non-JSON body */ }
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return json;
}

// DELETE /Invoices/{id} returns 404 in this tenant; posting Status DELETED works.
async function deleteBill(id: string) {
  await xero(`/Invoices/${id}`, { method: "POST", body: JSON.stringify({ Status: "DELETED" }) });
}

const supabase = createClient("http://127.0.0.1:54321", "sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz");
// The linked-bill guard decides which bills are safe to delete, so a failure here must
// stop the run. Swallowing it once allowed a cleanup to run with no protection at all.
const { data: links, error: linkError } = await supabase
  .from("finance_xero_links")
  .select("xero_invoice_id,xero_invoice_number,candidate_id");
if (linkError) {
  console.error("Cannot verify which bills are linked to candidates. Refusing to clean up.", linkError.message);
  Deno.exit(1);
}
const linkedInvoiceIds = new Set((links ?? []).map((r: any) => String(r.xero_invoice_id)));
console.log(`guard active: ${linkedInvoiceIds.size} bill(s) are linked to candidates and will not be deleted\n`);

/** Contacts that only exist because a subject line or a personal address was posted. */
const JUNK_CONTACT_PATTERNS = [/^fw:/i, /for your order/i, /your may bill/i, /^shaneb\s*26$/i, /^shane b$/i, /^admin$/i];

const JUNK_BILL_NUMBERS = new Set(["DIAG-001", "VERIFY-CORRECTED-PAYLOAD", "IV00004431-CORRECTED", "2-10009929258-R1", "CS999", "SM999"]);

// Numbers that can never be freed. Their dead bills are kept so the collision stays visible.
const KEEP_NUMBERS = new Set(["IV00004431", "2-10009929258", "660700225", "Elec.", "for"]);

const invoices = (await xero("/Invoices?includeArchived=true&page=1&pageSize=200")).Invoices ?? [];
const contacts = (await xero("/Contacts?page=1&pageSize=200")).Contacts ?? [];

console.log(`${APPLY ? "APPLYING" : "DRY RUN"} cleanup\n`);

const billsToDelete = invoices.filter((b: any) => {
  if (b.Type !== "ACCPAY") return false;
  if (!["DRAFT", "DELETED", "VOIDED", "ARCHIVED"].includes(b.Status)) return false;
  if (linkedInvoiceIds.has(String(b.InvoiceID))) return false;
  const number = String(b.InvoiceNumber ?? "").trim();
  const contactName = String(b.Contact?.Name ?? "");
  if (KEEP_NUMBERS.has(number)) return false;
  const junkNumber = JUNK_BILL_NUMBERS.has(number);
  const junkContact = JUNK_CONTACT_PATTERNS.some((re) => re.test(contactName));
  const probe = (b.LineItems ?? []).some((li: any) => /Number reuse probe/i.test(String(li.Description ?? "")));
  const noValue = Number(b.Total ?? 0) === 0;
  return junkNumber || probe || (junkContact && noValue);
});

const contactsToDelete = contacts.filter((c: any) =>
  JUNK_CONTACT_PATTERNS.some((re) => re.test(String(c.Name ?? ""))) &&
  // Never remove a contact that real bills point at.
  !invoices.some((b: any) => String(b.Contact?.ContactID ?? "") === String(c.ContactID) && !billsToDelete.some((d: any) => d.InvoiceID === b.InvoiceID))
);

console.log(`bills to delete (${billsToDelete.length}):`);
for (const b of billsToDelete) {
  console.log(`  ${String(b.InvoiceNumber || "(no number)").padEnd(28)} ${b.Status.padEnd(8)} ${String(b.Contact?.Name ?? "").slice(0, 40)}  total=${b.Total}`);
}
console.log(`\ncontacts to delete (${contactsToDelete.length}):`);
for (const c of contactsToDelete) {
  console.log(`  ${String(c.Name).slice(0, 50)}  (${c.ContactID})`);
}

if (!APPLY) {
  console.log("\nDry run only. Re-run with --apply to make these changes.");
  Deno.exit(0);
}

for (const b of billsToDelete) {
  try { await deleteBill(String(b.InvoiceID)); console.log(`  deleted bill ${b.InvoiceNumber || b.InvoiceID}`); }
  catch (e) { console.log(`  FAILED bill ${b.InvoiceNumber || b.InvoiceID}: ${(e as Error).message}`); }
}
for (const c of contactsToDelete) {
  try { await xero(`/Contacts/${c.ContactID}`, { method: "DELETE" }); console.log(`  deleted contact ${c.Name}`); }
  catch (e) { console.log(`  FAILED contact ${c.Name}: ${(e as Error).message}`); }
}

console.log("\nCleanup complete.");
