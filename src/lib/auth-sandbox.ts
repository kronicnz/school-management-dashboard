/**
 * Whether the auth sandbox and its mock personas may be used in this build.
 *
 * The sandbox lets a signed-in user replace their own identity with any of the
 * mock personas, including site_admin, and it is mounted without a RouteGuard
 * because no role is meant to own it. That is fine for local UI validation and
 * wrong for anything a real user can reach: the client-side capability layer in
 * ROUTE_CAPABILITIES stops governing anything once the persona can be chosen,
 * leaving Supabase RLS as the only thing between a real account and every page.
 *
 * RLS is the real enforcement layer, so this is not a way to read real data.
 * It is a way to see every screen as an administrator. Gating the personas
 * closes that off without touching the routes, so the sandbox path still exists
 * and still explains itself when it is inert.
 *
 * The switch is opt-in rather than tied to `import.meta.env.DEV`, because the
 * ten-role persona walkthrough is a release check and tends to happen against a
 * built preview as well as the dev server. Set VITE_ENABLE_AUTH_SANDBOX=true on
 * any environment that should have it; omit it and personas stay off.
 */

export type AuthSandboxEnv = {
  DEV?: boolean
  VITE_ENABLE_AUTH_SANDBOX?: string
} | undefined

/**
 * Vite only defines `import.meta.env` for the bundle it builds. Reading it
 * through a cast keeps this module importable from the Deno suites, where the
 * property is absent, and lets the suites pass a fake environment instead.
 */
function buildEnv(): AuthSandboxEnv {
  return (import.meta as { env?: { DEV?: boolean; VITE_ENABLE_AUTH_SANDBOX?: string } }).env
}

/**
 * Resolves the flag from a Vite-style environment. The dev server always has
 * the sandbox; any other build has to ask for it explicitly.
 */
export function isAuthSandboxEnabled(env: AuthSandboxEnv = buildEnv()): boolean {
  if (!env) return false
  if (env.DEV === true) return true
  return env.VITE_ENABLE_AUTH_SANDBOX === "true"
}
