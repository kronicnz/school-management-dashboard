/// <reference lib="deno.ns" />
import {
  ALL_ROLES,
  ASSIGNABLE_ROLES,
  CAPABILITIES,
  ROLE_PERMISSIONS,
  ROLE_PRECEDENCE,
  isAppRole,
  isCapability,
  type AppRole,
  type Capability,
} from "./registry"
import {
  can,
  canAll,
  canAny,
  capabilitiesForRoles,
  defaultActiveRole,
  normalizeRoles,
} from "./permissions"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  assert(a === b, `${message}\n  actual:   ${a}\n  expected: ${b}`)
}

// Every capability in the union is reachable. The module-wide `view_all` and
// admin capabilities are reachable only through the site_admin bypass, so the
// bypass counts as the granting role for those.
Deno.test("every capability is granted by at least one role", () => {
  const union = new Set<Capability>()
  for (const role of ASSIGNABLE_ROLES) {
    for (const capability of ROLE_PERMISSIONS[role]) union.add(capability)
  }
  for (const capability of capabilitiesForRoles(["site_admin"])) union.add(capability)
  const unreachable = CAPABILITIES.filter((capability) => !union.has(capability))
  assertEquals(unreachable, [], "capabilities that no role grants")
})

// The site_admin-only rows must not leak into any other role's capability set.
Deno.test("module-wide and admin capabilities are site_admin only", () => {
  const siteAdminOnly: Capability[] = [
    "students.view_all",
    "classes.view_all",
    "attendance.view_all",
    "assets.manage",
    "staff.view",
    "staff.manage",
    "access.manage",
    "settings.manage",
  ]
  for (const role of ASSIGNABLE_ROLES.filter((candidate) => candidate !== "site_admin")) {
    for (const capability of siteAdminOnly) {
      assert(!can([role], capability), `${role} must not hold ${capability}`)
    }
  }
  for (const capability of siteAdminOnly) {
    assert(can(["site_admin"], capability), `site_admin must hold ${capability}`)
  }
})

// No role maps to a capability outside the declared union.
Deno.test("no role maps to an unknown capability", () => {
  const known = new Set<string>(CAPABILITIES)
  for (const role of ALL_ROLES) {
    for (const capability of ROLE_PERMISSIONS[role]) {
      assert(known.has(capability), `role ${role} grants unknown capability ${capability}`)
      assert(isCapability(capability), `role ${role} grants non-capability ${capability}`)
    }
  }
})

// site_admin is a bypass, not an enumerated list.
Deno.test("site_admin short-circuits the matrix", () => {
  assertEquals([...ROLE_PERMISSIONS.site_admin], [], "site_admin should enumerate no capabilities")
  assert(capabilitiesForRoles(["site_admin"]).size === CAPABILITIES.length, "site_admin bypasses the matrix")
  assert(can(["site_admin"], "settings.manage"), "site_admin can manage settings")
})

// Multi-role resolution is a union, never an override.
Deno.test("capabilities are additive across held roles", () => {
  assert(can(["it_staff", "finance_read_only"], "ict.update_assigned"), "it_staff capability retained")
  assert(can(["it_staff", "finance_read_only"], "finance.view"), "finance_read_only capability added")
  assert(!can(["it_staff", "finance_read_only"], "finance.manage"), "finance.manage not granted")
  assert(!can(["it_staff", "finance_read_only"], "ict.assign"), "it_admin-only capability not leaked")
})

Deno.test("the retired teacher role grants nothing", () => {
  assertEquals([...capabilitiesForRoles(["teacher"])], [], "teacher resolves to no capabilities")
})

Deno.test("role normalisation is case and whitespace insensitive", () => {
  assertEquals(normalizeRoles([" IT_Staff ", "it_staff", ""]), ["it_staff"], "normalised roles")
  assert(can([" IT_Admin "], "ict.claim"), "normalised role resolves capability")
})

Deno.test("canAny and canAll handle their edge cases", () => {
  assert(!canAny(["site_admin"], []), "empty canAny is false")
  assert(canAll(["site_admin"], []), "empty canAll is true")
  assert(canAny(["counsellor"], ["finance.view", "incidents.export"]), "canAny matches one")
  assert(!canAll(["counsellor"], ["incidents.export", "finance.manage"]), "canAll requires all")
})

Deno.test("defaultActiveRole follows precedence and is presentation only", () => {
  assertEquals(defaultActiveRole(["it_staff", "site_admin", "counsellor"]), "site_admin", "site_admin wins")
  assertEquals(defaultActiveRole(["it_staff", "counsellor"]), "counsellor", "counsellor outranks it_staff")
  assertEquals(defaultActiveRole(["finance_read_only"]), "finance_read_only", "single role is its own default")
  assertEquals(defaultActiveRole([]), null, "no roles has no default")
  for (const role of ALL_ROLES) {
    assert(ROLE_PRECEDENCE.includes(role), `${role} is missing from ROLE_PRECEDENCE`)
  }
})

// The parity check the refactor exists to enable: the seeded SQL matrix in the
// migration must equal the TS registry, capability for capability. Parsed from
// the migration file so an edit to either side fails here rather than drifting.
Deno.test("the SQL seed and the TS registry agree", async () => {
  const migration = await Deno.readTextFile(
    new URL("../../../supabase/migrations/20260930150000_permission_matrix.sql", import.meta.url),
  )

  const seedBlock = migration.match(
    /insert into public\.role_permissions[\s\S]*?from \(values([\s\S]*?)\n\) as r\(role, capability\)/,
  )
  assert(seedBlock !== null, "could not find the role_permissions seed block in the migration")

  const seeded = new Map<string, string[]>()
  for (const match of seedBlock[1].matchAll(/\('([a-z_]+)',\s*'([a-z_.]+)'\)/g)) {
    const [, role, capability] = match
    const list = seeded.get(role) ?? []
    list.push(capability)
    seeded.set(role, list)
  }

  assert(seeded.size > 0, "parsed no grants from the migration seed")

  for (const [role, capabilities] of seeded) {
    assert(isAppRole(role), `seeded role ${role} is not in the TS registry`)
    const expected = [...ROLE_PERMISSIONS[role as AppRole]].sort()
    assertEquals([...capabilities].sort(), expected, `matrix drift for role ${role}`)
  }

  // Every grantable role must appear in the seed, or the SQL grants nothing.
  for (const role of ASSIGNABLE_ROLES) {
    if (role === "site_admin") continue
    assert(seeded.has(role), `role ${role} is missing from the migration seed`)
  }

  // The seeded capability catalogue must be the same union the client knows.
  const catalogue = migration.match(
    /insert into public\.app_capabilities[\s\S]*?values([\s\S]*?)\non conflict \(capability\)/,
  )
  assert(catalogue !== null, "could not find the app_capabilities seed in the migration")

  // Descriptions may contain SQL-escaped quotes, so the trailing literal
  // allows doubled quotes rather than stopping at the first one.
  const seededCapabilities = [
    ...catalogue[1].matchAll(/\('([a-z_.]+)',\s*'[a-z]+',\s*'(?:[^']|'')*'\)/g),
  ].map((match) => match[1])
  assertEquals(
    seededCapabilities.sort(),
    [...CAPABILITIES].sort(),
    "capability catalogue drift between SQL and TS",
  )
})

// Guards the specific matrix rows the migration seed must reproduce.
Deno.test("matrix rows that the SQL seed must match exactly", () => {
  assert(can(["counsellor"], "incidents.view_sensitive"), "counsellor keeps sensitive incidents")
  assert(can(["counsellor"], "incidents.export"), "counsellor keeps incident export")
  assert(can(["counsellor"], "students.view_assigned"), "counsellor keeps school records access")
  assert(can(["property_manager"], "rm.assign"), "property_manager is an R&M operator")
  assert(!can(["property_manager"], "students.view_assigned"), "property_manager has no school records access")
  assert(!can(["property_manager"], "ict.assign"), "property_manager cannot assign ICT tickets")
  assert(can(["it_staff"], "rm.view_assigned"), "it_staff can see an R&M ticket assigned to them")
  assert(!can(["it_staff"], "rm.assign"), "it_staff is not an R&M operator")
  assert(can(["it_staff"], "ict.claim"), "it_staff can take an unassigned ICT ticket")
  assert(can(["it_staff"], "rm.claim"), "it_staff can take an unassigned R&M ticket")
  assert(!can(["it_staff"], "ict.assign"), "it_staff cannot assign ICT to someone else")
  assert(!can(["finance_read_only"], "finance.manage"), "finance_read_only cannot manage finance")
  assert(can(["board_member"], "finance.view"), "board_member retains finance view")
  assert(!can(["property_staff"], "ict.create"), "property_staff has no ticket powers")
  assert(!can(["it_staff"], "ict.assign"), "it_staff cannot assign")
  assert(!can(["staff"], "staff.view"), "staff has no staff-directory access")
})
