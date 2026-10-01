// Checks tiered contact matching against the real Xero contact list, so the fix is proven
// against the actual data rather than samples.
import { matchContactName, resolveXeroContact } from "./supabase/functions/finance-intake/index.ts";

const token = Deno.env.get("XERO_ACCESS_TOKEN");
const tenant = Deno.env.get("XERO_TENANT_ID");
if (!token || !tenant) {
  console.log("SKIP  no Xero credentials");
  Deno.exit(0);
}

const contactsRes = await fetch("https://api.xero.com/api.xro/2.0/Contacts?page=1&pageSize=200", {
  headers: { Authorization: `Bearer ${token}`, "Xero-tenant-id": tenant, Accept: "application/json" },
});
const names: string[] = ((await contactsRes.json())?.Contacts ?? []).map((c: any) => String(c.Name));

console.log(`checking against ${names.length} real Xero contacts\n`);

let failures = 0;
function check(name: string, pass: boolean, detail = "") {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(46)} ${detail}`);
}

console.log("--- the reported case resolves to the real contact ---");
const computerfusion = await resolveXeroContact(token, tenant, "Computerfusion");
console.log(`   "Computerfusion" -> ${computerfusion.contact?.Name ?? "none"} (${computerfusion.matchType}, score ${computerfusion.score})`);
check("Computerfusion resolves to a contact", Boolean(computerfusion.contact?.ContactID));
check("the match is Computer Fusion", computerfusion.contact?.Name === "Computer Fusion", `got ${computerfusion.contact?.Name}`);
check("matched as normalized, not guessed", computerfusion.matchType === "normalized");

console.log("\n--- names that must not silently attach to the wrong contact ---");
for (const name of ["Repco", "Cyclone Finance Ltd", "Some Brand New Supplier"]) {
  const result = await resolveXeroContact(token, tenant, name);
  const auto = result.contact && result.matchType !== "none" && result.matchType !== "suggested";
  check(`"${name}" does not auto-attach`, !auto, auto ? `attached to ${result.contact?.Name}` : `suggestions: ${result.candidates.map((c) => c.name).join(", ") || "none"}`);
}

console.log("\n--- no real contact is ever matched to a different real contact ---");
const autoMatches: string[] = [];
for (const name of names) {
  const result = await resolveXeroContact(token, tenant, name);
  if (result.contact && result.matchType !== "none" && result.matchType !== "suggested") {
    const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (norm(result.contact.Name) !== norm(name)) {
      autoMatches.push(`${name} -> ${result.contact.Name}`);
    }
  }
}
check("no contact auto-matches the wrong contact", autoMatches.length === 0, autoMatches.join("; "));

console.log("\n--- the junk contacts are recognised as junk, not as suppliers ---");
for (const junk of ["Fw: Invoice IV00004431; From Computer Fusion", "Shaneb 26", "Admin"]) {
  const tier = matchContactName("Unmatched supplier", junk).tier;
  check(`"${junk.slice(0, 34)}" is not a supplier match`, tier === "none", `tier ${tier}`);
}

console.log(failures === 0 ? "\nAll live Xero contact checks passed" : `\n${failures} check(s) failed`);
Deno.exit(failures === 0 ? 0 : 1);
