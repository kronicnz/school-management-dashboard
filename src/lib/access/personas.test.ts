/// <reference lib="deno.ns" />
import { ASSIGNABLE_ROLES, type AppRole } from "./registry"
import { can, canAny } from "./permissions"
import { ROUTE_CAPABILITIES, canAccessRoute } from "./routes"

/**
 * Per-persona walkthrough, executed rather than eyeballed.
 *
 * The manual `/sandbox` check asked for a pass over all ten assignable roles
 * confirming the nav, the dashboard sections, and the button set match the
 * matrix. Driving that through the browser is slow and, worse, silent: a role that
 * silently loses a nav entry still *looks* fine until someone reports a missing
 * link. So the same assertions are pinned here, where a matrix change fails the
 * build instead.
 *
 * `navigation.ts` cannot be imported here because it pulls in `lucide-react`,
 * which Deno cannot load. Its nav item paths are therefore parsed from the source
 * the same way `permissions.test.ts` parses the SQL seed, so the real module stays
 * the single source of truth and drift in either direction fails this file.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  assert(a === b, `${message}\n  actual:   ${a}\n  expected: ${b}`)
}

/** Reads the nav paths out of navigation.ts so the module itself is never duplicated. */
async function shellNavPaths(): Promise<string[]> {
  const source = await Deno.readTextFile(
    new URL("../../components/layout/navigation.ts", import.meta.url),
  )
  const block = source.match(/export const shellNavItems: ShellNavItem\[\] = \[([\s\S]*?)\n\]/)
  assert(block !== null, "could not find shellNavItems in navigation.ts")

  const paths = [...block[1].matchAll(/to:\s*"([^"]+)"/g)].map((match) => match[1])
  assert(paths.length > 0, "parsed no nav paths from navigation.ts")
  return paths
}

let cachedNavPaths: string[] | null = null
async function navPaths() {
  if (!cachedNavPaths) cachedNavPaths = await shellNavPaths()
  return cachedNavPaths
}

/** Mirrors the section gates in supabase/migrations/20260931300000_dashboard_stats_for_role.sql. */
function dashboardSections(role: AppRole): string[] {
  const roles = [role]
  const sections: string[] = []

  if (can(roles, "access.manage")) sections.push("schoolWide")
  if (!can(roles, "access.manage") && hasAssignedScope(roles)) sections.push("assigned")
  if (canAny(roles, ["ict.view_all", "rm.view_all"])) sections.push("itAdmin")

  return sections
}

function hasAssignedScope(roles: AppRole[]) {
  return canAny(roles, [
    "students.view_assigned",
    "classes.view_assigned",
    "attendance.view_assigned",
    "ict.view_assigned",
    "rm.view_assigned",
  ])
}

/**
 * The nav each role is expected to see, pinned from the agreed matrix.
 *
 * `/` is open to any signed-in user and `/sandbox` is not part of the shell nav, so
 * neither appears here even though both are reachable.
 *
 * `property_staff` intentionally keeps students, classes, and attendance: it is a
 * reduced role held *alongside* `staff` and the plan grants it those three
 * `view_assigned` capabilities. Only `property_manager` is cut off from them.
 */
const EXPECTED_NAV: Record<AppRole, string[]> = {
  site_admin: [
    "/",
    "/students",
    "/classes",
    "/staff",
    "/attendance",
    "/incidents",
    "/ict-tickets",
    "/rm-tickets",
    "/finance",
    "/assets",
    "/admin",
  ],
  // `it_admin` keeps ticket powers only. It holds no `assets.manage` and no
  // `incidents.*` capability, so `/assets` and `/incidents` are not offered even
  // though its preferred nav *ordering* lists them. Ordering is presentation and
  // must not be mistaken for visibility.
  it_admin: ["/", "/ict-tickets", "/rm-tickets"],
  it_staff: ["/", "/ict-tickets", "/rm-tickets"],
  // `/ict-tickets` is reachable because property_manager may raise its own ICT
  // ticket (`ict.create` + `ict.view_own`), not because it has any school scope.
  property_manager: ["/", "/ict-tickets", "/rm-tickets"],
  property_staff: ["/", "/students", "/classes", "/attendance"],
  counsellor: ["/", "/students", "/classes", "/attendance", "/incidents", "/ict-tickets", "/rm-tickets"],
  staff: ["/", "/students", "/classes", "/attendance", "/incidents", "/ict-tickets", "/rm-tickets"],
  finance_admin: ["/", "/finance"],
  finance_read_only: ["/", "/finance"],
  board_member: ["/", "/finance"],
  teacher: ["/"],
}

/**
 * Every nav path a role can open must be declared in ROUTE_CAPABILITIES, otherwise
 * `canAccessRoute` silently returns true and the entry cannot be reasoned about.
 */
Deno.test("every shell nav path has a capability rule", async () => {
  for (const path of await navPaths()) {
    assert(
      Object.prototype.hasOwnProperty.call(ROUTE_CAPABILITIES, path),
      `nav path ${path} is missing from ROUTE_CAPABILITIES`,
    )
  }
})

Deno.test("nav matches the matrix for every assignable role", async () => {
  const paths = await navPaths()

  for (const role of ASSIGNABLE_ROLES) {
    const visible = paths.filter((path) => canAccessRoute(path, [role]))
    assertEquals(visible, EXPECTED_NAV[role], `nav drift for role ${role}`)
  }
})

/**
 * `property_manager` owns R&M end to end and has no school-module scope at all.
 * `property_staff` is deliberately different: it keeps assigned student, class, and
 * attendance access, so only `property_manager` is asserted here.
 */
Deno.test("the property manager does not inherit school modules", async () => {
  const paths = await navPaths()
  const visible = paths.filter((path) => canAccessRoute(path, ["property_manager"]))

  for (const forbidden of ["/students", "/classes", "/attendance", "/finance", "/admin", "/assets"]) {
    assert(!visible.includes(forbidden), `property_manager should not see ${forbidden}`)
  }
})

Deno.test("property_staff keeps its assigned school scope but no ticket powers", async () => {
  const paths = await navPaths()
  const visible = paths.filter((path) => canAccessRoute(path, ["property_staff"]))

  for (const allowed of ["/students", "/classes", "/attendance"]) {
    assert(visible.includes(allowed), `property_staff should keep ${allowed}`)
  }
  for (const forbidden of ["/ict-tickets", "/rm-tickets", "/incidents", "/finance", "/admin", "/assets"]) {
    assert(!visible.includes(forbidden), `property_staff should not see ${forbidden}`)
  }
})

Deno.test("IT roles have no finance or admin access", async () => {
  for (const role of ["it_admin", "it_staff"] as AppRole[]) {
    assert(!canAccessRoute("/finance", [role]), `${role} must not open /finance`)
    assert(!canAccessRoute("/admin", [role]), `${role} must not open /admin`)
    assert(!canAccessRoute("/staff", [role]), `${role} must not open /staff`)
  }
})

Deno.test("site_admin reaches every guarded route", async () => {
  for (const path of Object.keys(ROUTE_CAPABILITIES)) {
    assert(canAccessRoute(path, ["site_admin"]), `site_admin should reach ${path}`)
  }
})

Deno.test("the dashboard section set matches the matrix for every assignable role", () => {
  for (const role of ASSIGNABLE_ROLES) {
    const sections = dashboardSections(role)

    if (can([role], "access.manage")) {
      assert(sections.includes("schoolWide"), `${role} should get school-wide totals`)
    }
    if (!can([role], "access.manage") && hasAssignedScope([role])) {
      assert(sections.includes("assigned"), `${role} should get assigned-scope totals`)
    }
    if (canAny([role], ["ict.view_all", "rm.view_all"])) {
      assert(sections.includes("itAdmin"), `${role} should get queue triage`)
    }

    // A role with no operational scope gets no section at all rather than an
    // empty panel, which is what the finance-only roles rely on.
    if (!hasAssignedScope([role]) && !can([role], "access.manage") && !canAny([role], ["ict.view_all", "rm.view_all"])) {
      assertEquals(sections, [], `${role} should get no dashboard section`)
    }
  }
})

Deno.test("a role-less user reaches only the open routes", () => {
  const guarded = Object.entries(ROUTE_CAPABILITIES)
    .filter(([, caps]) => caps.length > 0)
    .map(([path]) => path)

  for (const path of guarded) {
    assert(!canAccessRoute(path, []), `${path} should not be open to a role-less user`)
  }
  assert(canAccessRoute("/", []), "/ stays open to a signed-in user with no roles")
  assert(canAccessRoute("/sandbox", []), "/sandbox stays open for local UI work")
})

Deno.test("capabilities are additive so a multi-role persona is a union", async () => {
  const paths = await navPaths()

  // The persona in mock-auth that exists to prove the union, not an override.
  const union = paths.filter((path) => canAccessRoute(path, ["staff", "finance_admin"]))
  const staffOnly = paths.filter((path) => canAccessRoute(path, ["staff"]))
  const financeOnly = paths.filter((path) => canAccessRoute(path, ["finance_admin"]))

  for (const path of union) {
    assert(
      staffOnly.includes(path) || financeOnly.includes(path),
      `union nav contains ${path}, which neither single role can reach`,
    )
  }
  assert(union.includes("/finance"), "staff + finance_admin should reach /finance")
  assert(union.includes("/students"), "staff + finance_admin should keep the staff modules")

  // Comparing the sets rather than the arrays, because nav order is a per-role
  // presentation concern and the two single-role arrays order the same paths
  // differently from the combined view.
  const unionSet = new Set(union)
  for (const path of Array.from(new Set([...staffOnly, ...financeOnly]))) {
    assert(unionSet.has(path), `${path} is reachable by one role but missing from the union`)
  }
})

/**
 * The button set, which is the third part of the walkthrough.
 *
 * These mirror the capability reads in `Tickets.tsx:272-275`, `Finance.tsx:17`,
 * and `Incidents.tsx:139`. A role that can open a page must not be handed controls
 * the database would refuse, so each flag is pinned per role rather than left to
 * the UI.
 */
type ButtonFlags = {
  ictViewAll: boolean
  ictViewAssigned: boolean
  ictAssign: boolean
  ictCreate: boolean
  rmViewAll: boolean
  rmViewAssigned: boolean
  rmAssign: boolean
  rmCreate: boolean
  financeManage: boolean
  incidentsSensitive: boolean
  incidentsUpdateAll: boolean
}

function buttonFlags(role: AppRole): ButtonFlags {
  const roles = [role]
  return {
    ictViewAll: can(roles, "ict.view_all"),
    ictViewAssigned: can(roles, "ict.view_assigned"),
    ictAssign: can(roles, "ict.assign"),
    ictCreate: can(roles, "ict.create"),
    rmViewAll: can(roles, "rm.view_all"),
    rmViewAssigned: can(roles, "rm.view_assigned"),
    rmAssign: can(roles, "rm.assign"),
    rmCreate: can(roles, "rm.create"),
    financeManage: can(roles, "finance.manage"),
    incidentsSensitive: can(roles, "incidents.view_sensitive"),
    incidentsUpdateAll: can(roles, "incidents.update_all"),
  }
}

const EXPECTED_BUTTONS: Record<AppRole, Partial<ButtonFlags>> = {
  site_admin: {
    ictViewAll: true,
    ictAssign: true,
    rmViewAll: true,
    rmAssign: true,
    financeManage: true,
    incidentsSensitive: true,
    incidentsUpdateAll: true,
  },
  it_admin: { ictViewAll: true, ictAssign: true, rmViewAll: true, rmAssign: true },
  it_staff: { ictViewAssigned: true, ictCreate: true, rmViewAssigned: true, rmCreate: true },
  property_manager: { rmViewAll: true, rmAssign: true, rmCreate: true, ictCreate: true },
  property_staff: {},
  counsellor: { incidentsSensitive: true, incidentsUpdateAll: true, ictCreate: true },
  staff: { ictCreate: true, rmCreate: true },
  finance_admin: { financeManage: true },
  finance_read_only: {},
  board_member: {},
  teacher: {},
}

Deno.test("the button set matches the matrix for every assignable role", () => {
  for (const role of ASSIGNABLE_ROLES) {
    const flags = buttonFlags(role)

    for (const [flag, value] of Object.entries(EXPECTED_BUTTONS[role])) {
      assertEquals(
        flags[flag as keyof ButtonFlags],
        value,
        `button ${flag} drift for role ${role}`,
      )
    }
  }
})

Deno.test("assignment is limited to the roles that own it", () => {
  // `ict.assign` is it_admin plus the site_admin bypass; `rm.assign` adds the
  // property manager. A role that can work assigned tickets must not gain the
  // ability to hand them to someone else.
  assert(!buttonFlags("it_staff").ictAssign, "it_staff must not assign ICT tickets")
  assert(!buttonFlags("it_staff").rmAssign, "it_staff must not assign R&M tickets")
  assert(!buttonFlags("property_manager").ictAssign, "property_manager must not assign ICT tickets")
  assert(buttonFlags("property_manager").rmAssign, "property_manager assigns R&M tickets")
  assert(buttonFlags("staff").ictAssign === false, "staff must not assign any ticket")
  assert(buttonFlags("staff").rmAssign === false, "staff must not assign any R&M ticket")
})

Deno.test("a read-only finance role gets no finance write control", () => {
  for (const role of ["finance_read_only", "board_member"] as AppRole[]) {
    assert(can([role], "finance.view"), `${role} should still see finance`)
    assert(!buttonFlags(role).financeManage, `${role} must not get finance write controls`)
  }
})

Deno.test("counsellor is the only non-admin role with sensitive incidents", () => {
  for (const role of ASSIGNABLE_ROLES) {
    const expected = role === "counsellor" || role === "site_admin"
    assertEquals(
      buttonFlags(role).incidentsSensitive,
      expected,
      `incidents.view_sensitive drift for role ${role}`,
    )
  }
})
