// Verifies Xero contact name matching. Built from the real contact names in the tenant, and
// from the actual failure: the extracted name "Computerfusion" must resolve to the existing
// "Computer Fusion" contact instead of stalling on contact_not_found.
//
// The contract is the tier, not the score: only "exact" and "normalized" may be posted
// against automatically, "suggested" must be confirmed by a user, and "none" must not link.
import { normalizeContactName, scoreContactNameMatch, matchContactName } from "./supabase/functions/finance-intake/index.ts";

let failures = 0;

function expectTier(name: string, extracted: string, existing: string, want: string) {
  const actual = matchContactName(extracted, existing).tier;
  const pass = actual === want;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(40)} ${JSON.stringify(extracted)} vs ${JSON.stringify(existing)} -> ${actual}${pass ? "" : ` (want ${want})`}`);
}

function expectScore(name: string, a: string, b: string, wantMax: number) {
  const actual = scoreContactNameMatch(a, b);
  const pass = actual <= wantMax;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name.padEnd(40)} score ${actual.toFixed(2)} (want <= ${wantMax})`);
}

console.log("--- the reported failure: a spacing difference must still match automatically ---");
expectTier("Computerfusion -> Computer Fusion", "Computerfusion", "Computer Fusion", "normalized");
expectTier("Computer Fusion -> Computerfusion", "Computer Fusion", "Computerfusion", "normalized");
// Case and surrounding whitespace are folded away before comparison, so these are exact.
expectTier("lowercase variant", "computer fusion", "Computer Fusion", "exact");
expectTier("trailing space", "  Repco  ", "Repco", "exact");

console.log("\n--- case, punctuation and legal suffix differences ---");
expectTier("legal suffix added", "Computer Fusion", "Computer Fusion Ltd", "normalized");
expectTier("legal suffix on Xero side", "Cyclone Finance", "Cyclone Finance Ltd", "normalized");
expectTier("hyphen vs space", "Oak Lane Hire", "oak-lane-hire", "normalized");
expectTier("ampersand", "Abby Wells", "Abby & Wells", "normalized");
expectTier("ampersand spelled out", "Fisher Paykel", "Fisher & Paykel", "normalized");
expectTier("identical", "Repco", "Repco", "exact");

console.log("\n--- a partial name is a guess, so it is only ever a suggestion ---");
expectTier("Fusion vs Computer Fusion", "Fusion", "Computer Fusion", "suggested");
expectTier("Computer Fusion vs Fusion", "Computer Fusion", "Fusion", "suggested");
expectTier("Office vs Office Supplies", "Office", "Office Supplies Company", "suggested");
expectScore("partial name must not auto-link", "Fusion", "Computer Fusion", 0.89);

console.log("\n--- real distinct suppliers must never match at all ---");
expectTier("Repco vs Computer Fusion", "Repco", "Computer Fusion", "none");
expectTier("Cyclone vs Computer Fusion", "Cyclone Finance Ltd", "Computer Fusion", "none");
expectTier("Woolworths vs Wilson", "Woolworths Market", "Wilson Periodicals", "none");
expectTier("Bank West vs Ridgeway Bank", "Bank West", "Ridgeway Bank", "none");
expectTier("MYOB vs Maddox", "MYOB NZ Limited", "Maddox Publishing Group", "none");
expectTier("Wilson vs Woolworths", "Wilson Periodicals", "Woolworths Market", "none");
expectTier("7-Eleven vs 24 Locks", "7-Eleven", "24 Locks", "none");

console.log("\n--- markers and junk must never match ---");
expectTier("marker vs real", "Unmatched supplier", "Computer Fusion", "none");
expectTier("marker vs itself", "Unmatched supplier", "Unmatched supplier", "none");
expectTier("real vs marker", "Computer Fusion", "Unmatched supplier", "none");
expectTier("empty", "", "Computer Fusion", "none");
expectTier("digits", "88213", "Computer Fusion", "none");
expectScore("marker scores zero", "Unmatched supplier", "Unmatched supplier", 0);

console.log("\n--- normalisation ---");
const norm = (v: string, want: string) => {
  const actual = normalizeContactName(v);
  const pass = actual === want;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  normalize ${JSON.stringify(v).padEnd(28)} -> ${JSON.stringify(actual)}${pass ? "" : ` (want ${JSON.stringify(want)})`}`);
};
norm("Computer Fusion", "computer fusion");
norm("Computer Fusion Ltd", "computer fusion");
norm("oak-lane-hire", "oak lane hire");
norm("Abby & Wells", "abby wells");
norm("Fisher & Paykel", "fisher paykel");
norm("Unmatched supplier", "unmatched supplier");
norm("MYOB NZ Limited", "myob");
norm("  Spaced   Out  ", "spaced out");
norm("  ", "");

console.log(failures === 0 ? "\nAll contact matching checks passed" : `\n${failures} check(s) failed`);
Deno.exit(failures === 0 ? 0 : 1);
