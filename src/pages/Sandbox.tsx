import { ShieldCheck, Users } from "lucide-react"
import { useAuth } from "../context/useAuth"
import { Card, CardContent } from "../components/ui/Card"
import { Button } from "../components/ui/button"
import { useToast } from "../components/ui/useToast"

export default function SandboxPage() {
  const { user, loading, activeMockPersona, clearMockPersona, mockPersonaId, mockPersonas, setMockPersona } = useAuth()
  const toast = useToast()

  return (
    <div className="min-h-screen bg-[var(--color-surface)] px-4 py-8 text-[var(--color-text)] sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--color-success)_20%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] px-3 py-1 text-xs font-medium text-[var(--color-success)]">
                <ShieldCheck className="size-3.5" />
                Auth sandbox
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-text)] sm:text-4xl">
                  Supabase Auth sandbox
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-[var(--color-text)] sm:text-base">
                  Use this page to verify email/password sign-in, Google OAuth, session persistence, and the active
                  auth persona used by role-gated screens.
                </p>
              </div>
            </div>
          </div>
        </header>

        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[var(--color-text)]">Auth Flow Testing</h2>
                <p className="mt-1 text-sm text-[var(--color-muted)]">
                  Switch between predefined personas to exercise role-gated UI without real Supabase accounts.
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  toast.success(
                    "Auth status",
                    loading
                      ? "Session is still loading."
                      : user
                        ? `Signed in as ${user.email ?? user.id}.`
                        : "No active session."
                  )
                }}
              >
                View Auth Status
              </Button>
            </div>

            <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-[var(--color-text)]">
              <div className="font-medium text-[var(--color-text)]">Current auth state</div>
              <div className="mt-1 text-[var(--color-muted)]">
                {loading
                  ? "Loading session..."
                  : user
                    ? mockPersonaId
                      ? `Mock persona: ${activeMockPersona?.full_name ?? user.email ?? user.id}`
                      : `Signed in as ${user.email ?? user.id}`
                    : "Not signed in"}
              </div>
              {user && (
                <div className="mt-2 text-xs text-[var(--color-muted)]">
                  Roles: {user.roles.length > 0 ? user.roles.join(", ") : "none"}
                </div>
              )}
            </div>

            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text)]">
                <Users className="size-4 text-[var(--color-success)]" />
                Mock personas
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {mockPersonas.map((persona) => {
                  const isActive = persona.id === mockPersonaId

                  return (
                    <button
                      key={persona.id}
                      type="button"
                      onClick={() => setMockPersona(persona.id)}
                      className={`rounded-xl border p-4 text-left transition ${isActive ? "border-[color-mix(in_srgb,var(--color-success)_50%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--color-success)_30%,transparent)]" : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-[var(--color-text)]">{persona.full_name}</div>
                          <div className="mt-1 text-xs text-[var(--color-muted)]">{persona.email}</div>
                        </div>
                        {isActive && <span className="rounded-full bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)] px-2 py-1 text-[11px] font-medium text-[var(--color-success)]">Active</span>}
                      </div>
                      <div className="mt-3 text-sm text-[var(--color-text)]">{persona.description}</div>
                      <div className="mt-3 text-xs text-[var(--color-muted)]">{persona.roles.join(", ")}</div>
                    </button>
                  )
                })}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={clearMockPersona} disabled={!mockPersonaId}>
                  Return to real auth
                </Button>
                <div className="text-xs text-[var(--color-muted)]">
                  Real auth remains the default; mock personas are local-only and do not write to Supabase auth.
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
