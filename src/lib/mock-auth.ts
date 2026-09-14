import type { Session } from "@supabase/supabase-js"
import type { AuthUser } from "./api/database.types"

export type MockAuthPersona = {
  id: string
  email: string
  full_name: string
  roles: string[]
  description: string
}

const MOCK_AUTH_PERSONA_STORAGE_KEY = "school-management-system-mock-auth-persona"

export const mockAuthPersonas: MockAuthPersona[] = [
  {
    id: "principal",
    email: "principal.mock@school.local",
    full_name: "Mock Principal",
    roles: ["principal"],
    description: "Leadership access for school-wide review and oversight.",
  },
  {
    id: "deputy_principal",
    email: "deputy.principal.mock@school.local",
    full_name: "Mock Deputy Principal",
    roles: ["deputy_principal"],
    description: "Leadership access without IT admin privileges.",
  },
  {
    id: "teacher",
    email: "teacher.mock@school.local",
    full_name: "Mock Teacher",
    roles: ["teacher"],
    description: "Teacher-scoped access for classroom and incident testing.",
  },
  {
    id: "counsellor",
    email: "counsellor.mock@school.local",
    full_name: "Mock Counsellor",
    roles: ["counsellor"],
    description: "Student-support access with broader incident permissions.",
  },
  {
    id: "staff",
    email: "staff.mock@school.local",
    full_name: "Mock Staff",
    roles: ["it_staff"],
    description: "Staff-level access for non-leadership UI checks.",
  },
  {
    id: "it_admin",
    email: "it.admin.mock@school.local",
    full_name: "Mock IT Admin",
    roles: ["it_admin"],
    description: "IT admin access for tickets, assets, and access management.",
  },
]

export function getStoredMockPersonaId() {
  if (typeof window === "undefined") return null

  const stored = window.localStorage.getItem(MOCK_AUTH_PERSONA_STORAGE_KEY)
  return stored && mockAuthPersonas.some((persona) => persona.id === stored) ? stored : null
}

export function setStoredMockPersonaId(personaId: string) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(MOCK_AUTH_PERSONA_STORAGE_KEY, personaId)
}

export function clearStoredMockPersonaId() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(MOCK_AUTH_PERSONA_STORAGE_KEY)
}

export function getMockPersona(personaId: string | null | undefined) {
  const fallbackPersona = mockAuthPersonas[0]
  if (!personaId) return null
  return mockAuthPersonas.find((persona) => persona.id === personaId) ?? fallbackPersona
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
