/**
 * Declarative role and capability registry.
 *
 * This is the client-side mirror of the seeded `public.role_permissions` table.
 * Adding a role or adjusting a capability is a data change: update the seed in
 * `supabase/migrations/20261001000000_permission_matrix.sql` and this file
 * together, then let the parity check catch drift.
 */

export const SITE_ADMIN_ROLE = "site_admin"

/** Every role the application knows about, including the retired `teacher`. */
export const ALL_ROLES = [
  SITE_ADMIN_ROLE,
  "it_admin",
  "it_staff",
  "property_manager",
  "property_staff",
  "counsellor",
  "finance_admin",
  "finance_read_only",
  "board_member",
  "staff",
  "teacher",
] as const

export type AppRole = (typeof ALL_ROLES)[number]

/** Roles a user may be granted going forward. `teacher` is retired. */
export const ASSIGNABLE_ROLES = ALL_ROLES.filter((role) => role !== "teacher")

/** Retired roles kept only so historical grants stay readable. */
export const RETIRED_ROLES = ["teacher"] as const

export const ROLE_LABELS: Record<AppRole, string> = {
  site_admin: "Site admin",
  it_admin: "IT admin",
  it_staff: "IT staff",
  property_manager: "Property manager",
  property_staff: "Property staff",
  counsellor: "Counsellor",
  finance_admin: "Finance admin",
  finance_read_only: "Finance read only",
  board_member: "Board member",
  staff: "Staff",
  teacher: "Teacher",
}

/**
 * Used only to pick a default active role for the dashboard view and badge.
 * It never gates access: capabilities from every held role are additive.
 */
export const ROLE_PRECEDENCE: readonly AppRole[] = [
  SITE_ADMIN_ROLE,
  "it_admin",
  "finance_admin",
  "counsellor",
  "property_manager",
  "it_staff",
  "finance_read_only",
  "board_member",
  "property_staff",
  "staff",
  "teacher",
]

export const CAPABILITIES = [
  "students.view_all",
  "students.view_assigned",
  "classes.view_all",
  "classes.view_assigned",
  "attendance.view_all",
  "attendance.view_assigned",
  "incidents.create_own",
  "incidents.view_own",
  "incidents.view_all",
  "incidents.update_own",
  "incidents.update_all",
  "incidents.assign",
  "incidents.take",
  "incidents.view_sensitive",
  "incidents.export",
  "ict.create",
  "ict.view_own",
  "ict.view_assigned",
  "ict.view_all",
  "ict.update_assigned",
  "ict.assign",
  "ict.claim",
  "rm.create",
  "rm.view_own",
  "rm.view_assigned",
  "rm.view_all",
  "rm.update_assigned",
  "rm.assign",
  "rm.claim",
  "finance.view",
  "finance.manage",
  "assets.manage",
  "staff.view",
  "staff.manage",
  "access.manage",
  "settings.manage",
] as const

export type Capability = (typeof CAPABILITIES)[number]

/** Every role except the superuser shortcut, which bypasses the matrix. */
export const MATRIX_ROLES = ASSIGNABLE_ROLES

function expand(...capabilities: Capability[]): readonly Capability[] {
  return capabilities
}

/**
 * The agreed role → capability matrix. `site_admin` is intentionally absent:
 * it short-circuits every check rather than enumerating capabilities.
 */
export const ROLE_PERMISSIONS: Record<AppRole, readonly Capability[]> = {
  site_admin: expand(),

  staff: expand(
    "students.view_assigned",
    "classes.view_assigned",
    "attendance.view_assigned",
    "incidents.create_own",
    "incidents.view_own",
    "incidents.update_own",
    "ict.create",
    "ict.view_own",
    "rm.create",
    "rm.view_own",
  ),

  property_staff: expand(
    "students.view_assigned",
    "classes.view_assigned",
    "attendance.view_assigned",
  ),

  it_staff: expand(
    "ict.create",
    "ict.view_own",
    "ict.view_assigned",
    "ict.update_assigned",
    "ict.claim",
    "rm.create",
    "rm.view_own",
    "rm.view_assigned",
    "rm.update_assigned",
    "rm.claim",
  ),

  it_admin: expand(
    "ict.create",
    "ict.view_own",
    "ict.view_assigned",
    "ict.view_all",
    "ict.update_assigned",
    "ict.assign",
    "ict.claim",
    "rm.create",
    "rm.view_own",
    "rm.view_assigned",
    "rm.view_all",
    "rm.update_assigned",
    "rm.assign",
    "rm.claim",
  ),

  property_manager: expand(
    "ict.create",
    "ict.view_own",
    "rm.create",
    "rm.view_own",
    "rm.view_assigned",
    "rm.update_assigned",
    "rm.view_all",
    "rm.assign",
    "rm.claim",
  ),

  counsellor: expand(
    "students.view_assigned",
    "classes.view_assigned",
    "attendance.view_assigned",
    "incidents.create_own",
    "incidents.view_own",
    "incidents.view_all",
    "incidents.update_own",
    "incidents.update_all",
    "incidents.assign",
    "incidents.take",
    "incidents.view_sensitive",
    "incidents.export",
    "ict.create",
    "ict.view_own",
    "rm.create",
    "rm.view_own",
  ),

  finance_admin: expand("finance.view", "finance.manage"),
  finance_read_only: expand("finance.view"),
  board_member: expand("finance.view"),

  // Retired: no capabilities. Historical grants resolve to nothing.
  teacher: expand(),
}

export function isAppRole(value: string): value is AppRole {
  return (ALL_ROLES as readonly string[]).includes(value)
}

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value)
}
