/// <reference lib="deno.ns" />

/**
 * The auth sandbox gate.
 *
 * These assert the resolver rather than the UI, because the UI cannot be run
 * here. The point being pinned is narrow and specific: a build that has not
 * asked for mock personas must not be able to fabricate one, no matter what a
 * caller passes in.
 */

import { isAuthSandboxEnabled, type AuthSandboxEnv } from "./auth-sandbox"
import { getAvailableMockPersonas, getMockPersona, mockAuthPersonas } from "./mock-auth"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

Deno.test("the dev server always has the sandbox", () => {
  assert(isAuthSandboxEnabled({ DEV: true }), "a dev build should be enabled")
})

Deno.test("a non-dev build has to ask for the sandbox", () => {
  assert(isAuthSandboxEnabled({ VITE_ENABLE_AUTH_SANDBOX: "true" }), "the opt-in should enable it")
  assert(!isAuthSandboxEnabled({ DEV: false }), "a prod build with no flag should be disabled")
  assert(!isAuthSandboxEnabled({}), "an empty env should be disabled")
})

Deno.test("only the exact string true turns the flag on", () => {
  // A truthy-looking value that is not "true" would mean the gate depends on how
  // the flag is spelled. Env vars are strings, so this is the whole surface.
  for (const value of ["false", "1", "TRUE", "True", "yes", "", " true", "true "]) {
    assert(
      !isAuthSandboxEnabled({ VITE_ENABLE_AUTH_SANDBOX: value }),
      `"${value}" should not enable the sandbox`,
    )
  }
})

Deno.test("a missing environment is disabled rather than throwing", () => {
  // Vite always defines import.meta.env, but this module is also imported by the
  // Deno suites, where it is absent. Undefined has to mean off, not a crash at
  // import time.
  assert(!isAuthSandboxEnabled(undefined), "an undefined env should be disabled")
})

Deno.test("personas are unavailable in a build that has not opted in", () => {
  // This is the assertion that matters. It runs against the module's own
  // environment rather than an injected one, so it verifies the gate is actually
  // wired into the persona lookup rather than sitting beside it unused.
  const enabledHere = isAuthSandboxEnabled()

  if (enabledHere) {
    assert(
      getAvailableMockPersonas().length === mockAuthPersonas.length,
      "an enabled build should offer every persona",
    )
    return
  }

  assert(
    getAvailableMockPersonas().length === 0,
    "a build without the opt-in offered personas",
  )
})

Deno.test("no persona id resolves when the sandbox is off", () => {
  // The backstop. Even handed a real, well-formed persona id, the lookup has to
  // come back empty, otherwise a caller could still swap the user for site_admin.
  if (isAuthSandboxEnabled()) return

  for (const persona of mockAuthPersonas) {
    assert(
      getMockPersona(persona.id) === null,
      `${persona.id} resolved while the sandbox is off`,
    )
  }

  assert(getMockPersona(null) === null, "a null id should stay null")
  assert(getMockPersona("not-a-persona") === null, "an unknown id should stay null")
})

Deno.test("the persona catalog itself is left intact", () => {
  // The gate filters at lookup time rather than emptying the export, so the ten
  // personas stay available to the tests that walk them and to a build that
  // opts in later without a rebuild of the data.
  assert(mockAuthPersonas.length > 0, "the catalog should not have been emptied")
  assert(
    new Set(mockAuthPersonas.map((persona) => persona.id)).size === mockAuthPersonas.length,
    "persona ids should be unique, since they are stored in localStorage by id",
  )
})

Deno.test("the env shape matches what Vite injects", () => {
  // Guards the cast in auth-sandbox.ts. If Vite's env shape changes, the cast
  // would silently read undefined and report disabled everywhere.
  const env: AuthSandboxEnv = { DEV: true, VITE_ENABLE_AUTH_SANDBOX: "true" }
  assert(isAuthSandboxEnabled(env), "a full Vite-shaped env should be enabled")
})
