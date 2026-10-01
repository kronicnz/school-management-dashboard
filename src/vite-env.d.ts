// Vite injects `import.meta.env` at build time. Deno has no such property on
// ImportMeta, so the app modules that read it fail to typecheck when the suites
// pull them in. Declaring the shape here keeps both toolchains on one source of
// truth for which VITE_ variables exist.
//
// Written as a module with `declare global` so the suites can pull it in with a
// plain import. A script-style .d.ts would work too, but only via a triple
// slash reference, which the linter rejects.
export {}

declare global {
  interface ImportMetaEnv {
    readonly VITE_SUPABASE_URL?: string
    readonly VITE_SUPABASE_ANON_KEY?: string
    readonly VITE_APP_URL?: string
    /**
     * Opt-in for /sandbox and the mock personas. See src/lib/auth-sandbox.ts:
     * impersonation bypasses every client-side capability check, so a build a
     * real user can reach should leave this unset.
     */
    readonly VITE_ENABLE_AUTH_SANDBOX?: string
    readonly DEV?: boolean
    readonly PROD?: boolean
    readonly MODE?: string
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv
  }
}
