import { useState, type FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { School, Loader2, LogIn, ShieldCheck, Mail } from "lucide-react"
import { useAuth } from "../context/useAuth"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/Input"
import { FormField } from "../components/ui/FormField"
import { ThemeToggle } from "../components/ui/ThemeToggle"
import { useToast } from "../components/ui/useToast"
import { supabase } from "../lib/supabaseClient"
import { getAppUrl } from "../lib/app-url"

const RESET_NOTICE =
  "If that address has a login, a password reset link is on its way. The link works once and expires in an hour."

export default function LoginPage() {
  const toast = useToast()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [showResetForm, setShowResetForm] = useState(false)
  const [resetEmail, setResetEmail] = useState("")
  const [resetLoading, setResetLoading] = useState(false)
  const [resetNotice, setResetNotice] = useState("")
  const { signInWithEmail, signInWithGoogle, setMockPersona } = useAuth()
  const navigate = useNavigate()

  async function handleEmailLogin(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError("")
    try {
      await signInWithEmail(email, password)
      toast.success("Signed in", "Redirecting to your dashboard.")
      window.setTimeout(() => navigate("/"), 900)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login failed"
      setError(message)
      toast.error("Login failed", message)
    } finally {
      setLoading(false)
    }
  }

  async function handlePasswordReset(e: FormEvent) {
    e.preventDefault()
    setResetLoading(true)

    // The confirmation is deliberately identical whether the address exists, does
    // not exist, or the mailer failed. Anything more specific would turn this form
    // into an account-enumeration oracle.
    try {
      await supabase?.auth.resetPasswordForEmail(resetEmail.trim(), {
        redirectTo: `${getAppUrl()}/set-password`,
      })
    } catch {
      // Swallowed on purpose - see above.
    } finally {
      setResetLoading(false)
      setShowResetForm(false)
      setResetNotice(RESET_NOTICE)
    }
  }

  async function handleGoogleLogin() {
    setLoading(true)
    setError("")
    try {
      await signInWithGoogle()
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google login failed"
      setError(message)
      toast.error("Google login failed", message)
      setLoading(false)
    }
  }

  function handleMockLogin() {
    setMockPersona("site_admin")
    toast.success("Mock auth enabled", "Opening the sandbox with the site admin persona.")
    window.setTimeout(() => navigate("/sandbox"), 0)
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
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">Welcome back</h1>
          <p className="mt-2 text-[var(--color-muted)]">Sign in to access your school dashboard</p>
        </div>

        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.45)] sm:p-8">
          {error && (
            <div className="mb-4 rounded-lg border border-[color-mix(in_srgb,var(--color-destructive)_20%,transparent)] bg-[color-mix(in_srgb,var(--color-destructive)_10%,transparent)] p-3 text-sm text-[var(--color-destructive)]">
              {error}
            </div>
          )}

          {resetNotice && (
            <div
              role="status"
              aria-live="polite"
              className="mb-4 flex items-start gap-2 rounded-lg border border-[color-mix(in_srgb,var(--color-success)_20%,transparent)] bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] p-3 text-sm text-[var(--color-success)]"
            >
              <Mail className="mt-0.5 size-4 shrink-0" />
              <span>{resetNotice}</span>
            </div>
          )}

          {showResetForm && (
            <form onSubmit={handlePasswordReset} className="mb-4 space-y-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-canvas)] p-4">
              <FormField label="Account email" htmlFor="reset-email">
                <Input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  placeholder="name@example.com"
                  value={resetEmail}
                  onChange={(event) => setResetEmail(event.target.value)}
                  required
                />
              </FormField>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setShowResetForm(false)} disabled={resetLoading}>
                  Cancel
                </Button>
                <Button type="submit" disabled={resetLoading}>
                  {resetLoading ? <Loader2 className="size-4 animate-spin mr-2" /> : <Mail className="size-4 mr-2" />}
                  Send reset link
                </Button>
              </div>
            </form>
          )}

          <form onSubmit={handleEmailLogin} className="space-y-4">
            <FormField label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </FormField>
            {!showResetForm && !resetNotice && (
              <button
                type="button"
                onClick={() => setShowResetForm(true)}
                className="-mt-1 text-sm text-[var(--color-accent)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
              >
                Forgot password?
              </button>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <LogIn className="size-4 mr-2" />}
              Sign In
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-[var(--color-border)]" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[var(--color-surface)] px-2 text-[var(--color-muted)]">Or continue with</span>
            </div>
          </div>

          <Button variant="outline" onClick={handleGoogleLogin} disabled={loading} className="w-full">
            {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <ShieldCheck className="size-4 mr-2" />}
            Google
          </Button>

          <Button variant="ghost" onClick={handleMockLogin} disabled={loading} className="mt-3 w-full">
            Use mock personas
          </Button>
        </div>
      </div>
    </div>
  )
}
