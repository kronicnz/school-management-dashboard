// Verifies cleanLineItemDescriptions against the real column-bleed data pulled
// from the Computer Fusion MYOB invoice, plus cases that must NOT be altered.
// Imports the edge function module, so it uses the real implementation.
import { cleanLineItemDescriptions } from "./supabase/functions/finance-intake/index.ts";

let failures = 0;
function check(name: string, actual: string[], expected: string[]) {
  const pass = actual.length === expected.length && actual.every((v, i) => v === expected[i]);
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) {
    actual.forEach((v, i) => console.log(`      [${i}] got      ${JSON.stringify(v)}`));
    expected.forEach((v, i) => console.log(`      [${i}] expected ${JSON.stringify(v)}`));
  }
}

const mk = (descriptions: string[]) =>
  descriptions.map((Description, i) => ({
    Description,
    Quantity: i + 1,
    UnitAmount: 100,
    LineAmount: 100 * (i + 1),
    TaxType: "INPUT2",
    AccountCode: "400",
  }));

// Real data: the "Hrs" UoM cell was spliced into the middle of a wrapped description.
// The repeated "Labour" Item ID prefix is deliberately NOT stripped, see below.
check(
  "MYOB multi-line: removes mid-description UoM, keeps genuine wording",
  cleanLineItemDescriptions(
    mk([
      "Labour Onsite After Hours - Job# 100281 at Site: 9027 - Cotton Hrs On Whakatane - Close Off Code: C1144SR",
      "Labour Travel Time",
      "Labour Vehicle KM Charge",
    ]),
  ).map((i) => i.Description),
  [
    "Labour Onsite After Hours - Job# 100281 at Site: 9027 - Cotton On Whakatane - Close Off Code: C1144SR",
    "Labour Travel Time",
    "Labour Vehicle KM Charge",
  ],
);

// A shared first word is ambiguous, so it is left for the vision pass to handle
// rather than risking a silent corruption of correct descriptions.
check(
  "shared first word: left alone, not guessed at",
  cleanLineItemDescriptions(mk(["Subscription renewal", "Subscription setup", "Subscription support"])).map((i) => i.Description),
  ["Subscription renewal", "Subscription setup", "Subscription support"],
);

// "Km" is real wording inside "Vehicle KM Charge" and must survive.
check(
  "mid-sentence unit-like word that is real wording: kept",
  cleanLineItemDescriptions(
    mk(["Onsite support Cotton Hrs On Whakatane", "Travel Time", "Vehicle KM Charge"]),
  ).map((i) => i.Description),
  ["Onsite support Cotton On Whakatane", "Travel Time", "Vehicle KM Charge"],
);

// A unit next to a number is genuine wording, not a column bleed.
check(
  "unit next to a number: kept",
  cleanLineItemDescriptions(mk(["Consulting 3 Hrs onsite", "Travel Time", "Parts kit"])).map((i) => i.Description),
  ["Consulting 3 Hrs onsite", "Travel Time", "Parts kit"],
);

// Leading and trailing units are never removed.
check(
  "leading and trailing units: kept",
  cleanLineItemDescriptions(mk(["Hrs of labour", "Km travelled", "Each licence"])).map((i) => i.Description),
  ["Hrs of labour", "Km travelled", "Each licence"],
);

check(
  "single row: untouched",
  cleanLineItemDescriptions(mk(["Labour Travel Time"])).map((i) => i.Description),
  ["Labour Travel Time"],
);

console.log(failures === 0 ? "\nAll description cleanup checks passed" : `\n${failures} check(s) failed`);
Deno.exit(failures === 0 ? 0 : 1);
