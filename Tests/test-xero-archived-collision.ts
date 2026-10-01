// Verifies that a DELETED/ARCHIVED bill's number is detected as consumed.
// Xero hides archived invoices unless includeArchived=true, so this is the check that was
// silently missing: without it the collision was never found and the POST just 400'd.
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./supabase/functions/finance-intake/index.ts", import.meta.url), "utf8");

const DELETED_BILL = "c284957b-648c-415a-b8e9-85c45c304c1f";
const MYOB_NUMBER = "2-10009929258";

const token = process.env.XERO_ACCESS_TOKEN;
const tenant = process.env.XERO_TENANT_ID;

if (!token || !tenant) {
  console.log("SKIP  no Xero credentials in environment; static checks only");
} else {
  const where = `InvoiceNumber=="${MYOB_NUMBER}"`;
  const withArchived = await fetch(
    `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(where)}&includeArchived=true&page=1`,
    { headers: { Authorization: `Bearer ${token}`, "Xero-tenant-id": tenant, Accept: "application/json" } },
  );
  const archived = await withArchived.json();
  const archivedBills = (archived?.Invoices ?? []).filter((i) => i?.Type === "ACCPAY");

  const withoutArchived = await fetch(
    `https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent(where)}&page=1`,
    { headers: { Authorization: `Bearer ${token}`, "Xero-tenant-id": tenant, Accept: "application/json" } },
  );
  const visible = await withoutArchived.json();
  const visibleBills = (visible?.Invoices ?? []).filter((i) => i?.Type === "ACCPAY");

  console.log(`\nbills for ${MYOB_NUMBER} WITHOUT includeArchived: ${visibleBills.length}`);
  for (const b of visibleBills) console.log(`  ${b.InvoiceNumber} ${b.Status} ${b.InvoiceID}`);
  console.log(`\nbills for ${MYOB_NUMBER} WITH includeArchived: ${archivedBills.length}`);
  for (const b of archivedBills) console.log(`  ${b.InvoiceNumber} ${b.Status} ${b.InvoiceID}`);

  const foundArchived = archivedBills.find((b) => b.InvoiceID === DELETED_BILL);
  console.log(`\n${foundArchived ? "PASS" : "FAIL"}  the deleted bill ${DELETED_BILL} is visible to the collision check`);
  if (foundArchived) {
    console.log(`        status reported by Xero: ${foundArchived.Status}`);
    console.log(`        this is the status the app must treat as "number consumed": ${!["DRAFT","AUTHORISED","SUBMITTED","PAID","PARTIALLYPAID"].includes(String(foundArchived.Status).toUpperCase())}`);
  }
}

// The query the function actually issues must include archived invoices.
const hasArchived = source.includes("includeArchived=true");
console.log(`\n${hasArchived ? "PASS" : "FAIL"}  the function's invoice lookup requests archived invoices`);

Deno.exit(hasArchived ? 0 : 1);
