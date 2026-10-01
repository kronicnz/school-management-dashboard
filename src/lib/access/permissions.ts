import {
  CAPABILITIES,
  ROLE_PERMISSIONS,
  ROLE_PRECEDENCE,
  SITE_ADMIN_ROLE,
  isAppRole,
  type AppRole,
  type Capability,
} from "./registry"

export function normalizeRoles(roles: string[] | null | undefined): string[] {
  const seen = new Set<string>()
  for (const role of roles ?? []) {
    const normalized = role.trim().toLowerCase()
    if (normalized) seen.add(normalized)
  }
  return [...seen]
}

export function hasRole(roles: string[] | null | undefined, role: string) {
  return normalizeRoles(roles).includes(role.trim().toLowerCase())
}

export function hasAnyRole(roles: string[] | null | undefined, candidates: readonly string[]) {
  const normalized = normalizeRoles(roles)
  return candidates.some((candidate) => normalized.includes(candidate))
}

export function isSiteAdmin(roles: string[] | null | undefined) {
  return hasRole(roles, SITE_ADMIN_ROLE)
}

/**
 * Additive resolution: `site_admin` resolves every capability, otherwise the
 * result is the union of every held role's capabilities. Roles are never
 * exclusive, so a person holding two roles gets both capability sets.
 */
export function capabilitiesForRoles(roles: string[] | null | undefined): Set<Capability> {
  const granted = new Set<Capability>()

  for (const role of normalizeRoles(roles)) {
    if (role === SITE_ADMIN_ROLE) {
      return new Set(CAPABILITIES)
    }
    if (!isAppRole(role)) continue
    for (const capability of ROLE_PERMISSIONS[role]) {
      granted.add(capability)
    }
  }

  return granted
}

export function can(roles: string[] | null | undefined, capability: Capability) {
  return capabilitiesForRoles(roles).has(capability)
}

export function canAny(roles: string[] | null | undefined, capabilities: readonly Capability[]) {
  if (capabilities.length === 0) return false
  const granted = capabilitiesForRoles(roles)
  return capabilities.some((capability) => granted.has(capability))
}

export function canAll(roles: string[] | null | undefined, capabilities: readonly Capability[]) {
  if (capabilities.length === 0) return true
  const granted = capabilitiesForRoles(roles)
  return capabilities.every((capability) => granted.has(capability))
}

/**
 * Narrows raw role strings to the registry, dropping anything unknown. Useful
 * where a role list feeds a typed signature, such as the dashboard snapshot.
 */
export function toAppRoles(roles: string[] | null | undefined): AppRole[] {
  return normalizeRoles(roles).filter(isAppRole)
}

/**
 * Picks the role that drives the dashboard view and badge for a multi-role
 * user. It is presentation only and must never be used to gate access.
 */
export function defaultActiveRole(roles: string[] | null | undefined): AppRole | null {
  const normalized = normalizeRoles(roles)
  for (const candidate of ROLE_PRECEDENCE) {
    if (normalized.includes(candidate)) return candidate
  }
  return null
}
