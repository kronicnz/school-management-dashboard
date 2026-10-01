import { useEffect, useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { KeyRound, Loader2, School } from "lucide-react"
import { supabase } from "../lib/supabaseClient"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/Input"
import { FormField } from "../components/ui/FormField"
import { ThemeToggle } from "../components/ui/ThemeToggle"
import { useToast } from "../components/ui/useToast"

/**
 * Set or reset a password from a one-time link.
 *
 * This route is deliberately mounted outside `PublicRoute`. `PublicRoute` redirects
 * any signed-in user to the dashboard, and a user who has just followed an
 * invitation or reset link IS signed in by the time this renders, so nesting it
 * there would bounce them away from the only form they need.
 *
 * It relies on `detectSessionInUrl` (see src/lib/supabaseClient.ts) to exchange
 * the one-time code in the URL for a session. If that exchange did not happen -
 * the link expired, or it was already used - there is nothing to protect, so the
 * page says so instead of showing a form that would fail on submit.
 */

const MIN_PASSWORD_LENGTH = 8

/** Grace period for the URL code exchange to finish before giving up on the link. */
const SESSION_SETTLE_MS = 1500

export default function SetPasswordPage() {
  const toast = useToast()
  const navigate = useNavigate()
  const [linkState, setLinkState] = useState<"checking" | "ready" | "invalid">("checking")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!supabase) {
      setLinkState("invalid")
      return
    }

    let cancelled = false
    let settled = false

    const settle = (hasSession: boolean) => {
      if (cancelled || settled) return
      settled = true
      setLinkState(hasSession ? "ready" : "invalid")
    }

    // The exchange happens asynchronously, so the auth event is the reliable
    // signal that a valid link arrived.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) settle(true)
    })

    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        settle(true)
        return
      }
      window.setTimeout(() => settle(false), SESSION_SETTLE_MS)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)
      return
    }

    if (password !== confirmPassword) {
      setError("The two passwords do not match.")
      return
    }

    if (!supabase) {
      setError("Supabase is not configured. Please check the environment variables.")
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      toast.success("Password updated", "You are signed in. Taking you to your dashboard.")
      window.setTimeout(() => navigate("/"), 900)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update the password."
      setError(message)
      toast.error("Could not update the password", message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen bg-[var(--color-canvas)] flex items-center justify-center p-4 text-[var(--color-text)]">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <School className="size-10 text-[var(--color-accent)]" />
            <span className="text-2xl font-bold text-[var(--color-text)]">SchoolMgmt</span>
          </div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">Choose a password</h1>
          <p className="mt-2 text-[var(--color-muted)]">
            This link works once. Set a password to finish setting up your account.
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.45)] sm:p-8">
          {linkState === "checking" && (
            <div className="flex items-center justify-center gap-3 py-8 text-sm text-[var(--color-muted)]">
              <Loader2 className="size-4 animate-spin" />
              Checking your link...
            </div>
          )}

          {linkState === "invalid" && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex size-12 items-center justify-center rounded-full border border-[var(--color-border)]">
                <KeyRound className="size-5 text-[var(--color-muted)]" />
              </div>
              <p className="text-sm text-[var(--color-text)]">
                This link has expired or has already been used.
              </p>
              <p className="text-sm text-[var(--color-muted)]">
                Request a new one from the sign-in screen and open it on this device.
              </p>
              <Button asChild variant="outline" className="w-full">
                <a href="/login">Back to sign in</a>
              </Button>
            </div>
          )}

          {linkState === "ready" && (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {error && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="rounded-lg border border-[color-mix(in_srgb,var(--color-destructive)_20%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_10%,transparent)] p-3 text-sm text-[var(--color-destructive)]"
                >
                  {error}
                </div>
              )}

              <FormField label="New password" htmlFor="new-password">
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
              </FormField>

              <FormField label="Confirm new password" htmlFor="confirm-password">
                <Input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Type it again"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </FormField>

              <p className="text-xs text-[var(--color-muted)]">
                Use at least {MIN_PASSWORD_LENGTH} characters. This is the only password you will set here -
                you can change it later through your account.
              </p>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <KeyRound className="size-4 mr-2" />}
                Save password
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
