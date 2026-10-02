import type { Session } from "@supabase/supabase-js"
import type { AuthUser } from "./api/database.types"
import { isAuthSandboxEnabled } from "./auth-sandbox"

export type MockAuthPersona = {
  id: string
  email: string
  full_name: string
  roles: string[]
  description: string
}

const MOCK_AUTH_PERSONA_STORAGE_KEY = "school-management-system-mock-auth-persona"
const ACTIVE_ROLE_STORAGE_KEY = "school-management-system-active-role"

/**
 * The active role only picks the dashboard view and badge. It never gates
 * access, so a stale or unknown stored value is simply ignored.
 */
export function getStoredActiveRole() {
  if (typeof window === "undefined") return null

  const stored = window.localStorage.getItem(ACTIVE_ROLE_STORAGE_KEY)
  return stored?.trim() || null
}

export function setStoredActiveRole(role: string) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(ACTIVE_ROLE_STORAGE_KEY, role)
}

export function clearStoredActiveRole() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(ACTIVE_ROLE_STORAGE_KEY)
}

// One persona per role, plus the multi-role combinations that matter: a role
// switcher, additive capability resolution, and the base role held alongside a
// reduced one. `teacher` is retired and replaced by `staff`.
export const mockAuthPersonas: MockAuthPersona[] = [
  {
    id: "site_admin",
    email: "site.admin.mock@school.local",
    full_name: "Mock Site Admin",
    roles: ["site_admin"],
    description: "Full application access for platform-wide administration.",
  },
  {
    id: "finance_admin",
    email: "finance.admin.mock@school.local",
    full_name: "Mock Finance Admin",
    roles: ["finance_admin"],
    description: "Finance write access for payment and review workflows.",
  },
  {
    id: "finance_read_only",
    email: "finance.readonly.mock@school.local",
    full_name: "Mock Finance Reader",
    roles: ["finance_read_only"],
    description: "Read-only finance access for reporting and review.",
  },
  {
    id: "board_member",
    email: "board.member.mock@school.local",
    full_name: "Mock Board Member",
    roles: ["board_member"],
    description: "Read-only board oversight for finance reports and statistics.",
  },
  {
    id: "staff",
    email: "staff.mock@school.local",
    full_name: "Mock Staff",
    roles: ["staff"],
    description: "Base role: assigned students, own incidents, and self-service tickets.",
  },
  {
    id: "counsellor",
    email: "counsellor.mock@school.local",
    full_name: "Mock Counsellor",
    roles: ["counsellor"],
    description: "Pastoral support with full incident permissions including sensitive cases.",
  },
  {
    id: "property_manager",
    email: "property.manager.mock@school.local",
    full_name: "Mock Property Manager",
    roles: ["property_manager"],
    description: "Owns R&M tickets end to end and can assign them.",
  },
  {
    id: "property_staff",
    email: "property.staff.mock@school.local",
    full_name: "Mock Property Staff",
    roles: ["property_staff"],
    description: "Reduced role for facilities staff who only need assigned-scope records.",
  },
  {
    id: "it_staff",
    email: "it.staff.mock@school.local",
    full_name: "Mock IT Staff",
    roles: ["it_staff"],
    description: "Works ICT tickets assigned to them and raises their own.",
  },
  {
    id: "it_admin",
    email: "it.admin.mock@school.local",
    full_name: "Mock IT Admin",
    roles: ["it_admin"],
    description: "Full ICT and R&M ticket administration, without staff or admin screens.",
  },
  {
    id: "staff_finance_admin",
    email: "staff.finance.mock@school.local",
    full_name: "Mock Staff Finance",
    roles: ["staff", "finance_admin"],
    description: "Base role plus finance, to verify the role switcher and additive capabilities.",
  },
  {
    id: "staff_property_staff",
    email: "staff.property.mock@school.local",
    full_name: "Mock Staff Property",
    roles: ["staff", "property_staff"],
    description: "Base role plus a reduced role, to verify capabilities union rather than override.",
  },
  {
    id: "it_staff_staff",
    email: "technical.staff.mock@school.local",
    full_name: "Mock Technical Staff",
    roles: ["it_staff", "staff"],
    description: "Technical desk plus the base role, to verify the role switcher default ordering.",
  },
]

/**
 * The personas this build is allowed to impersonate.
 *
 * Empty unless the auth sandbox is enabled, so a production bundle has no way to
 * fabricate an identity even if something calls setMockPersona.
 */
export function getAvailableMockPersonas(): MockAuthPersona[] {
  return isAuthSandboxEnabled() ? mockAuthPersonas : []
}

export function getStoredMockPersonaId() {
  if (typeof window === "undefined") return null

  // A persona id left in localStorage by an earlier dev session must not carry
  // into a build that has the sandbox switched off, so it is dropped on read
  // rather than merely ignored.
  if (!isAuthSandboxEnabled()) {
    clearStoredMockPersonaId()
    return null
  }

  const stored = window.localStorage.getItem(MOCK_AUTH_PERSONA_STORAGE_KEY)
  return stored && mockAuthPersonas.some((persona) => persona.id === stored) ? stored : null
}

export function setStoredMockPersonaId(personaId: string) {
  if (typeof window === "undefined") return
  if (!isAuthSandboxEnabled()) return
  window.localStorage.setItem(MOCK_AUTH_PERSONA_STORAGE_KEY, personaId)
}

export function clearStoredMockPersonaId() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(MOCK_AUTH_PERSONA_STORAGE_KEY)
}

export function getMockPersona(personaId: string | null | undefined) {
  const available = getAvailableMockPersonas()
  if (available.length === 0) return null
  if (!personaId) return null
  return available.find((persona) => persona.id === personaId) ?? available[0]
}

export function createMockUser(persona: MockAuthPersona): AuthUser {
  return {
    id: persona.id,
    email: persona.email,
    full_name: persona.full_name,
    org_unit_path: null,
    roles: [...persona.roles],
    user_metadata: { full_name: persona.full_name, name: persona.full_name, mock_persona_id: persona.id },
  }
}

export function createMockSession(user: AuthUser): Session {
  return {
    access_token: `mock-access-token-${user.id}`,
    refresh_token: `mock-refresh-token-${user.id}`,
    expires_in: 60 * 60,
    expires_at: undefined,
    token_type: "bearer",
    user,
  } as unknown as Session
}
