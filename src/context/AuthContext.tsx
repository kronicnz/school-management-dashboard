import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { supabase } from "../lib/supabaseClient"
import { getAppUrl } from "../lib/app-url"
import type { AuthUser, AuthContextType } from "../lib/api/database.types"
import { fetchCurrentUserRoles } from "../lib/api/supabaseApi"
import { AuthContext, type AuthContextValue } from "./auth-context"
import {
  clearStoredMockPersonaId,
  createMockSession,
  createMockUser,
  getMockPersona,
  getStoredMockPersonaId,
  mockAuthPersonas,
  setStoredMockPersonaId,
} from "../lib/mock-auth"
import {
  clearStoredActiveRole,
  getStoredActiveRole,
  setStoredActiveRole,
} from "../lib/mock-auth"
import { defaultActiveRole, normalizeRoles } from "../lib/access/permissions"
import { isAppRole, type AppRole } from "../lib/access/registry"

function normalizeAuthUser(
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> } | null
): AuthUser | null {
  if (!user) return null

  return {
    id: user.id,
    email: user.email ?? null,
    full_name:
      (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null) ??
      (typeof user.user_metadata?.name === "string" ? user.user_metadata.name : null),
    org_unit_path: null,
    roles: [],
    user_metadata: user.user_metadata,
  } as AuthUser
}

function getSupabaseClient() {
  const client = supabase

  if (!client) {
    throw new Error("Supabase not configured")
  }

  return client
}

async function getRealAuthState(client: ReturnType<typeof getSupabaseClient>) {
  const { data } = await client.auth.getSession()
  const roles = data.session?.user ? await fetchCurrentUserRoles().catch(() => []) : []
  const authUser = normalizeAuthUser(data.session?.user ?? null)

  return {
    session: data.session,
    user: authUser ? { ...authUser, roles } : null,
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialMockPersonaId = getStoredMockPersonaId()
  const initialMockPersona = getMockPersona(initialMockPersonaId)

  const [user, setUser] = useState<AuthUser | null>(() => (initialMockPersona ? createMockUser(initialMockPersona) : null))
  const [session, setSession] = useState<AuthContextType["session"]>(() =>
    initialMockPersona ? createMockSession(createMockUser(initialMockPersona)) : null
  )
  const [loading, setLoading] = useState(!initialMockPersona)
  const [mockPersonaId, setMockPersonaId] = useState<string | null>(initialMockPersonaId)
  const [activeRoleOverride, setActiveRoleOverride] = useState<AppRole | null>(() => {
    const stored = getStoredActiveRole()
    return stored && isAppRole(stored) ? stored : null
  })

  // The override is only honoured while the user still holds the role, so
  // dropping a grant never leaves a stale badge on screen.
  const activeRole = useMemo(() => {
    const roles = normalizeRoles(user?.roles)
    if (activeRoleOverride && roles.includes(activeRoleOverride)) {
      return activeRoleOverride
    }
    return defaultActiveRole(roles)
  }, [activeRoleOverride, user?.roles])

  const setActiveRole = useCallback((role: AppRole) => {
    setActiveRoleOverride(role)
    setStoredActiveRole(role)
  }, [])

  const syncMockPersona = useCallback((personaId: string | null) => {
    setMockPersonaId(personaId)

    if (!personaId) {
      clearStoredMockPersonaId()
      clearStoredActiveRole()
      setActiveRoleOverride(null)
      setUser(null)
      setSession(null)
      setLoading(true)
      return
    }

    const persona = getMockPersona(personaId) ?? mockAuthPersonas[0]
    const mockUser = createMockUser(persona)
    setStoredMockPersonaId(persona.id)
    setUser(mockUser)
    setSession(createMockSession(mockUser))
    setLoading(false)
  }, [])

  useEffect(() => {
    if (mockPersonaId) {
      const persona = getMockPersona(mockPersonaId) ?? mockAuthPersonas[0]
      const mockUser = createMockUser(persona)
      setUser(mockUser)
      setSession(createMockSession(mockUser))
      setLoading(false)
      return
    }

    const client = getSupabaseClient()
    let cancelled = false

    async function initializeSession() {
      setLoading(true)
      const { session: nextSession, user: nextUser } = await getRealAuthState(client)

      if (cancelled) return

      setSession(nextSession)
      setUser(nextUser)
      setLoading(false)
    }

    void initializeSession()

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (mockPersonaId) return

      setSession(nextSession)
      const authUser = normalizeAuthUser(nextSession?.user ?? null)
      if (!authUser) {
        setUser(null)
        setLoading(false)
        return
      }

      void fetchCurrentUserRoles()
        .then((roles) => {
          setUser({ ...authUser, roles })
        })
        .catch(() => {
          setUser({ ...authUser, roles: [] })
        })
        .finally(() => {
          setLoading(false)
        })
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [mockPersonaId])

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (mockPersonaId) {
      syncMockPersona(null)
    }

    const client = getSupabaseClient()
    const { error } = await client.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [mockPersonaId, syncMockPersona])

  const signInWithGoogle = useCallback(async () => {
    if (mockPersonaId) {
      syncMockPersona(null)
    }

    const client = getSupabaseClient()
    const redirectTo = getAppUrl()
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    })
    if (error) throw error
  }, [mockPersonaId, syncMockPersona])

  const signOut = useCallback(async () => {
    if (mockPersonaId) {
      syncMockPersona(null)
      return
    }

    const client = supabase
    if (!client) return
    const { error } = await client.auth.signOut()
    if (error) throw error
    clearStoredActiveRole()
    setActiveRoleOverride(null)
    setUser(null)
    setSession(null)
  }, [mockPersonaId, syncMockPersona])

  const refreshSession = useCallback(async () => {
    if (mockPersonaId) {
      const persona = getMockPersona(mockPersonaId) ?? mockAuthPersonas[0]
      const mockUser = createMockUser(persona)
      setSession(createMockSession(mockUser))
      setUser(mockUser)
      setLoading(false)
      return
    }

    const client = getSupabaseClient()
    const { session: nextSession, user: nextUser } = await getRealAuthState(client)
    setSession(nextSession)
    setUser(nextUser)
  }, [mockPersonaId])

  const setMockPersona = useCallback((personaId: string) => {
    syncMockPersona(personaId)
  }, [syncMockPersona])

  const clearMockPersona = useCallback(() => {
    syncMockPersona(null)
  }, [syncMockPersona])

  const activeMockPersona = mockPersonaId ? getMockPersona(mockPersonaId) ?? mockAuthPersonas[0] : null

  const contextValue: AuthContextValue = {
    user,
    session,
    loading,
    signInWithEmail,
    signInWithGoogle,
    signOut,
    refreshSession,
    mockPersonaId,
    mockPersonas: mockAuthPersonas,
    activeMockPersona,
    setMockPersona,
    clearMockPersona,
    activeRole,
    setActiveRole,
  }

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  )
}
