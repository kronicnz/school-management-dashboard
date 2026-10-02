import { createContext } from "react"
import type { AuthContextType } from "../lib/api/database.types"
import type { MockAuthPersona } from "../lib/mock-auth"
import type { AppRole } from "../lib/access/registry"

export type AuthContextValue = AuthContextType & {
  mockPersonaId: string | null
  mockPersonas: MockAuthPersona[]
  activeMockPersona: MockAuthPersona | null
  setMockPersona: (personaId: string) => void
  clearMockPersona: () => void
  /**
   * Presentation only: selects the dashboard view and badge for a multi-role
   * user. Access is always the union of every held role.
   */
  activeRole: AppRole | null
  setActiveRole: (role: AppRole) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
