export type RoleTier = "it_admin" | "leadership" | "operational_staff" | "minimal_access"

export type OperationalSubtype = "teacher" | "counsellor" | "it_staff" | "unknown"

export const leadershipRoles = ["principal", "deputy_principal", "counsellor_delegate", "leadership_delegate"] as const
export const operationalStaffRoles = ["teacher", "counsellor", "it_staff"] as const

export const tierLabels: Record<RoleTier, string> = {
  it_admin: "IT admin",
  leadership: "Leadership",
  operational_staff: "Operational staff",
  minimal_access: "Minimal access",
}

export const tierBadgeTones: Record<RoleTier, "violet" | "amber" | "cyan" | "slate"> = {
  it_admin: "violet",
  leadership: "amber",
  operational_staff: "cyan",
  minimal_access: "slate",
}

export const pageVisibilityMatrix: Record<string, RoleTier[]> = {
  "/": ["it_admin", "leadership", "operational_staff", "minimal_access"],
  "/students": ["it_admin", "leadership", "operational_staff"],
  "/classes": ["it_admin", "leadership", "operational_staff"],
  "/staff": ["it_admin", "leadership"],
  "/attendance": ["it_admin", "leadership", "operational_staff"],
  "/incidents": ["it_admin", "leadership", "operational_staff"],
  "/tickets": ["it_admin", "leadership", "operational_staff"],
  "/assets": ["it_admin"],
  "/admin": ["it_admin"],
}

export function getResolvedRoleTier(roles: string[] | null | undefined): RoleTier {
  const normalizedRoles = new Set((roles ?? []).map((role) => role.trim().toLowerCase()).filter(Boolean))

  if (normalizedRoles.has("it_admin")) {
    return "it_admin"
  }

  if (leadershipRoles.some((role) => normalizedRoles.has(role))) {
    return "leadership"
  }

  if (operationalStaffRoles.some((role) => normalizedRoles.has(role))) {
    return "operational_staff"
  }

  return "minimal_access"
}

export function getOperationalSubtype(roles: string[] | null | undefined): OperationalSubtype {
  const normalizedRoles = new Set((roles ?? []).map((role) => role.trim().toLowerCase()).filter(Boolean))

  if (normalizedRoles.has("teacher")) return "teacher"
  if (normalizedRoles.has("counsellor")) return "counsellor"
  if (normalizedRoles.has("it_staff")) return "it_staff"

  return "unknown"
}

export function isLeadershipTier(tier: RoleTier) {
  return tier === "leadership"
}

export function isOperationalStaffTier(tier: RoleTier) {
  return tier === "operational_staff"
}

export function isItAdminTier(tier: RoleTier) {
  return tier === "it_admin"
}

export function isRouteAllowedForTier(pathname: string, tier: RoleTier) {
  const allowedTiers = pageVisibilityMatrix[pathname]

  if (!allowedTiers) {
    return true
  }

  return allowedTiers.includes(tier)
}
