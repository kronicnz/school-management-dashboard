import { strict as assert } from "node:assert"
import { dedupeById, matchesOrgUnitPath, normalizeOrgUnitPath } from "./shared.ts"

Deno.test("normalizeOrgUnitPath canonicalizes input", () => {
  assert.equal(normalizeOrgUnitPath("Accounts/Automated/Staff/"), "/accounts/automated/staff")
})

Deno.test("matchesOrgUnitPath accepts exact and descendant paths only", () => {
  assert.equal(matchesOrgUnitPath("/Accounts/Automated/Staff", "/Accounts/Automated/Staff"), true)
  assert.equal(matchesOrgUnitPath("/Accounts/Automated/Staff/Year 7", "/Accounts/Automated/Staff"), true)
  assert.equal(matchesOrgUnitPath("/Accounts/Automated/Staffing", "/Accounts/Automated/Staff"), false)
})

Deno.test("dedupeById keeps the last record for a given id", () => {
  const records = dedupeById([
    { id: "a", value: 1 },
    { id: "b", value: 2 },
    { id: "a", value: 3 },
  ])

  assert.deepEqual(records, [
    { id: "a", value: 3 },
    { id: "b", value: 2 },
  ])
})
