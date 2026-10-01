/// <reference lib="deno.ns" />
import type { AppRole } from "../access/registry"
import { can, canAny } from "../access/permissions"
import { DASHBOARD_COPY, DASHBOARD_PROFILES, getDashboardCopy, getDashboardProfile } from "./profiles"

/**
 * These tests pin the dashboard section rules. The expected values were read out
 * of `dashboard_stats_for_role` running against the local stack for all ten
 * assignable roles, so a matrix change that alters which sections a role sees
 * fails here instead of silently producing a different dashboard on the local
 * stack than in production.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertEquals(actual: unknown, expected: unknown, message: string) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  assert(a === b, `${message}\n  actual:   ${a}\n  expected: ${b}`)
}

/** Mirrors the section gates in supabase/migrations/20260931300000_dashboard_stats_for_role.sql. */
function sectionsForRole(role: AppRole): string[] {
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

const EXPECTED_SECTIONS: Record<AppRole, string[]> = {
  site_admin: ["schoolWide", "itAdmin"],
  it_admin: ["assigned", "itAdmin"],
  property_manager: ["assigned", "itAdmin"],
  it_staff: ["assigned"],
  staff: ["assigned"],
  counsellor: ["assigned"],
  property_staff: ["assigned"],
  finance_admin: [],
  finance_read_only: [],
  board_member: [],
  teacher: [],
}

Deno.test("dashboard sections match what the SQL function returns", () => {
  for (const [role, expected] of Object.entries(EXPECTED_SECTIONS) as Array<[AppRole, string[]]>) {
    assertEquals(sectionsForRole(role), expected, `section drift for role ${role}`)
  }
})

Deno.test("finance-only roles get no operational section", () => {
  for (const role of ["finance_admin", "finance_read_only", "board_member"] as AppRole[]) {
    assertEquals(sectionsForRole(role), [], `${role} should resolve no dashboard section`)
  }
})

Deno.test("a school-wide viewer still sees the queue triage section", () => {
  // site_admin bypasses the matrix, so both gates fire. Suppressing itAdmin for a
  // site admin would zero the pending-role-update and unassigned-ticket cards.
  const sections = sectionsForRole("site_admin")
  assert(sections.includes("schoolWide"), "site_admin loses the school-wide totals")
  assert(sections.includes("itAdmin"), "site_admin loses the queue triage section")
  assert(!sections.includes("assigned"), "school-wide totals already cover the assigned scope")
})

Deno.test("every assignable role has a profile and copy block", () => {
  for (const role of Object.keys(EXPECTED_SECTIONS) as AppRole[]) {
    const profile = getDashboardProfile(role)
    assert(profile.metricOrder.length > 0, `role ${role} has an empty metric order`)
    assertEquals(getDashboardProfile(role), DASHBOARD_PROFILES[role], `profile lookup drift for ${role}`)

    const copy = getDashboardCopy(role)
    assertEquals(copy, DASHBOARD_COPY[role], `copy lookup drift for ${role}`)
    assert(copy.metricsTitle.length > 0, `role ${role} has no metrics title`)
  }
})

Deno.test("profile metric order stays within the known metric keys", () => {
  const known = new Set([
    "students",
    "classes",
    "staff",
    "attendance",
    "tickets",
    "incidents",
    "followUps",
    "assets",
    "propertyRm",
    "pendingInvoices",
    "outstandingValue",
    "unassignedTickets",
    "roleUpdates",
  ])

  for (const [role, profile] of Object.entries(DASHBOARD_PROFILES)) {
    for (const key of profile.metricOrder) {
      assert(known.has(key), `role ${role} orders unknown metric ${key}`)
    }
  }
})

Deno.test("finance roles lead with the finance cards", () => {
  for (const role of ["finance_admin", "finance_read_only", "board_member"] as AppRole[]) {
    const order = DASHBOARD_PROFILES[role].metricOrder
    assertEquals(order.slice(0, 2), ["pendingInvoices", "outstandingValue"], `${role} should lead with finance`)
    assert(order.includes("students"), `${role} dropped the student card entirely`)
  }
})

Deno.test("an unknown role falls back instead of throwing", () => {
  assertEquals(getDashboardProfile(null), DASHBOARD_PROFILES.teacher, "null role should use the retired/default profile")
  assert(getDashboardCopy(null).metricsTitle.length > 0, "null role should still render copy")
  assertEquals(getDashboardProfile("not_a_role" as AppRole), DASHBOARD_PROFILES.teacher, "unknown role should fall back")
})

Deno.test("copy is per role, not a shared default", () => {
  const titles = new Set(Object.values(DASHBOARD_COPY).map((copy) => copy.metricsTitle))
  assert(titles.size > 1, "every role renders identical copy")
})