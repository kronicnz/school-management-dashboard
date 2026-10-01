// Verifies supplier resolution. Built from the real subject lines and sender addresses in
// the local finance_intake_items table, including the two that produced garbage supplier
// names ("for your order from Repco" and "Your May bill for Account 000631263").
import { resolveHybridInvoiceCandidate } from "./supabase/functions/finance-intake/hybrid-extraction.ts";

let failures = 0;

function resolves(name: string, subject: string, sender: string, structured: Record<string, unknown>, expected: string) {
  const item: Record<string, unknown> = {
    subject,
    sender_email: sender,
    metadata: { structuredExtraction: { processor: "gemini-pdf-vision", confidence: 90, ...structured } },
  };
  const actual = (resolveHybridInvoiceCandidate(item) as { resolvedFields: { supplierName: string } }).resolvedFields.supplierName;
  const pass = actual === expected;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(34)} -> ${JSON.stringify(actual)}${pass ? "" : ` (expected ${JSON.stringify(expected)})`}`);
}

const noDoc = { grossTotal: 100 };

console.log("--- the two subjects that produced garbage supplier names ---");
// "from Repco" names the real supplier, so it is recovered rather than discarded.
resolves("Repco order subject", "Fw: Invoice for your order  from Repco", "shane b <shaneb_26@hotmail.com>", noDoc, "Repco");
// This subject names no company at all, so the sender domain is the only usable signal.
resolves("monthly bill subject", "Fw: Your May bill for Account 000631263", "Shane Byrne <admin@computerfusion.co.nz>", noDoc, "Computerfusion");

console.log("\n--- real subjects from the intake table ---");
resolves("computer fusion", "Fw: Invoice IV00004431; From Computer Fusion", "Shane Byrne <admin@computerfusion.co.nz>", noDoc, "Computer Fusion");
resolves("myob", "Fw: MYOB Tax Invoice 2-10009929258", "Shane Byrne <admin@computerfusion.co.nz>", noDoc, "Computerfusion");

console.log("\n--- the document always wins over every fallback ---");
const withDoc = { grossTotal: 100, supplierName: "Cyclone Finance Ltd" };
resolves("document beats subject", "Fwd: Dear Accounts Team Invoice attached for Tela+ charges. Regards Accounts@cyclonefinance.co.nz", "\"RIS | Office\" <office@ris.school.nz>", withDoc, "Cyclone Finance Ltd");
resolves("document beats bad sender", "Fw: Your May bill for Account 000631263", "shaneb_26@hotmail.com", withDoc, "Cyclone Finance Ltd");

console.log("\n--- sentences and notifications must never become a supplier ---");
for (const subject of [
  "Fwd: Dear Accounts Team Invoice attached for Tela+ charges. Regards Accounts@cyclonefinance.co.nz <mailto:Accounts@cyclonefinance.co.nz>",
  "Invoice attached for your records",
  "Your invoice is available",
  "Payment due - please remit",
  "AutoPay confirmation",
  "Statement of account available",
  "Re: Invoice",
  "Thank you for your business",
  "Copy of your order",
  "Overdue payment reminder",
  "This is your receipt",
]) {
  resolves(`rejects: ${subject.slice(0, 24)}`, subject, "someone@gmail.com", noDoc, "Unmatched supplier");
}

console.log("\n--- personal addresses carry no supplier signal ---");
for (const sender of [
  "shane b <shaneb_26@hotmail.com>",
  "someone@gmail.com",
  "user@outlook.com",
  "person@yahoo.co.nz",
  "someone@icloud.com",
]) {
  resolves(`freemail: ${sender.slice(0, 22)}`, "Fw: Your statement is ready", sender, noDoc, "Unmatched supplier");
}

console.log("\n--- genuine company senders still resolve ---");
for (const [sender, expected] of [
  // The derived name is the domain label, not the mailbox name.
  ["accounts@cyclonefinance.co.nz", "Cyclonefinance"],
  ["admin@computerfusion.co.nz", "Computerfusion"],
  ["billing@oak-lane-hire.co.nz", "Oak Lane Hire"],
  ["hello@repco.co.nz", "Repco"],
  ["team@northcrown.co.nz", "Northcrown"],
] as const) {
  resolves(`domain: ${expected}`, "Fw: Your statement is ready", sender, noDoc, expected);
}

console.log("\n--- a document reference must never be read as a supplier ---");
resolves("invoice number after label", "Fw: Invoice IV00004431", "x@gmail.com", noDoc, "Unmatched supplier");
resolves("invoice no with hash", "Fw: Invoice # 88213", "x@gmail.com", noDoc, "Unmatched supplier");
resolves("long numeric ref", "Fw: Invoice 2-10009929258", "x@gmail.com", noDoc, "Unmatched supplier");

console.log("\n--- a name named inside a sentence is still found ---");
resolves("from Repco", "Fw: Invoice for your order  from Repco", "x@gmail.com", noDoc, "Repco");
resolves("from Acme", "Fw: Invoice from Acme Holdings Ltd", "x@gmail.com", noDoc, "Acme Holdings Ltd");
resolves("after semicolon from", "Fw: Invoice IV00004431; From Computer Fusion", "x@gmail.com", noDoc, "Computer Fusion");
resolves("from Oak Lane Hire", "Fw: Your monthly statement from Oak Lane Hire", "x@gmail.com", noDoc, "Oak Lane Hire");
resolves("email address is not a name", "Fwd: Dear Accounts Team Invoice attached for Tela+ charges. Regards Accounts@cyclonefinance.co.nz", "x@gmail.com", noDoc, "Unmatched supplier");

console.log(failures === 0 ? "\nAll supplier resolution checks passed" : `\n${failures} check(s) failed`);
Deno.exit(failures === 0 ? 0 : 1);
