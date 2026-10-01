import { can, canAny } from "./permissions"
import type { Capability } from "./registry"

/**
 * Route to capability requirements. An array means "any one of these", which
 * mirrors the `||` chains the old `canAccessRoute` switch used. An empty array
 * means the route is open to any signed-in user.
 *
 * The database is the real enforcement layer; this map only keeps the UI from
 * offering a page the user cannot open. A missing entry stays permissive, the
 * same way `canAccessRoute`'s `default: return true` was.
 */
export const ROUTE_CAPABILITIES: Record<string, readonly Capability[]> = {
  "/": [],
  "/students": ["students.view_all", "students.view_assigned"],
  "/classes": ["classes.view_all", "classes.view_assigned"],
  "/staff": ["staff.view", "staff.manage"],
  "/attendance": ["attendance.view_all", "attendance.view_assigned"],
  "/incidents": ["incidents.view_all", "incidents.view_own", "incidents.create_own"],
  "/tickets": ["ict.view_own", "ict.view_assigned", "rm.view_own", "rm.view_assigned"],
  "/ict-tickets": ["ict.view_all", "ict.view_assigned", "ict.view_own"],
  "/rm-tickets": ["rm.view_all", "rm.view_assigned", "rm.view_own"],
  "/finance": ["finance.view"],
  "/assets": ["assets.manage"],
  "/admin": ["access.manage"],
  "/sandbox": [],
}

export function normalizeRoutePath(pathname: string) {
  return pathname.split("?")[0].replace(/\/+$/, "") || "/"
}

export function routeCapabilities(pathname: string): readonly Capability[] {
  return ROUTE_CAPABILITIES[normalizeRoutePath(pathname)] ?? []
}

export function canAccessRoute(pathname: string, roles: string[] | null | undefined) {
  const required = routeCapabilities(pathname)

  if (required.length === 0) {
    return true
  }

  return canAny(roles, required)
}

export function canAccessAnyRoute(pathnames: readonly string[], roles: string[] | null | undefined) {
  return pathnames.some((pathname) => canAccessRoute(pathname, roles))
}

export { can, canAny }
