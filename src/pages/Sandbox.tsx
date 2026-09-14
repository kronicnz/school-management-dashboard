import { ShieldCheck, Users } from "lucide-react"
import { useAuth } from "../context/useAuth"
import { Card, CardContent } from "../components/ui/Card"
import { Button } from "../components/ui/button"
import { useToast } from "../components/ui/useToast"

export default function SandboxPage() {
  const { user, loading, activeMockPersona, clearMockPersona, mockPersonaId, mockPersonas, setMockPersona } = useAuth()
  const toast = useToast()

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-6xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                <ShieldCheck className="size-3.5" />
                Auth sandbox
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
                  Supabase Auth sandbox
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
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
                <h2 className="text-lg font-semibold text-white">Auth Flow Testing</h2>
                <p className="mt-1 text-sm text-slate-400">
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

            <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
              <div className="font-medium text-white">Current auth state</div>
              <div className="mt-1 text-slate-400">
                {loading
                  ? "Loading session..."
                  : user
                    ? mockPersonaId
                      ? `Mock persona: ${activeMockPersona?.full_name ?? user.email ?? user.id}`
                      : `Signed in as ${user.email ?? user.id}`
                    : "Not signed in"}
              </div>
              {user && (
                <div className="mt-2 text-xs text-slate-500">
                  Roles: {user.roles.length > 0 ? user.roles.join(", ") : "none"}
                </div>
              )}
            </div>

            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <Users className="size-4 text-emerald-300" />
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
                      className={`rounded-xl border p-4 text-left transition ${isActive ? "border-emerald-400/50 bg-emerald-400/10 ring-1 ring-emerald-400/30" : "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10"}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-white">{persona.full_name}</div>
                          <div className="mt-1 text-xs text-slate-400">{persona.email}</div>
                        </div>
                        {isActive && <span className="rounded-full bg-emerald-400/15 px-2 py-1 text-[11px] font-medium text-emerald-200">Active</span>}
                      </div>
                      <div className="mt-3 text-sm text-slate-300">{persona.description}</div>
                      <div className="mt-3 text-xs text-slate-400">{persona.roles.join(", ")}</div>
                    </button>
                  )
                })}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={clearMockPersona} disabled={!mockPersonaId}>
                  Return to real auth
                </Button>
                <div className="text-xs text-slate-500">
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
