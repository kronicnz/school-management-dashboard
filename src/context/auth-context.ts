import { createContext } from "react"
import type { AuthContextType } from "../lib/api/database.types"
import type { MockAuthPersona } from "../lib/mock-auth"

export type AuthContextValue = AuthContextType & {
  mockPersonaId: string | null
  mockPersonas: MockAuthPersona[]
  activeMockPersona: MockAuthPersona | null
  setMockPersona: (personaId: string) => void
  clearMockPersona: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
