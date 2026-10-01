/// <reference lib="deno.ns" />
import { ROUTE_CAPABILITIES, normalizeRoutePath } from "./routes"

/**
 * Deep links and guards, pinned structurally because they cannot be rendered here.
 *
 * The app routes through `useRoutes` with plain path-plus-element objects, and
 * every page sits behind a guard that looks its path up in a static capability
 * map. That design lets the two halves of a link drift apart silently: a nav
 * entry can point at a route that was renamed, or a route can declare a guard
 * path that is not the path it is mounted at. Neither throws. The link still
 * resolves, or it quietly does not, and the only symptom is a user landing on
 * the dashboard instead of the page they asked for.
 *
 * Rendering would cover this, but the suites run under Deno with no DOM, so the
 * route table and the nav list are parsed from source instead. That is also why
 * this file exists at all: the react-router v7 upgrade was verified by typecheck
 * and build, neither of which executes a redirect or a guard, so the route
 * handling was exactly the part left unproven.
 *
 * As in `personas.test.ts`, `navigation.ts` is parsed rather than imported
 * because it pulls in `lucide-react`, which Deno cannot load.
 *
 * What this does not cover: whether a guard redirects the *right* way, and
 * whether the nav renders. Both need a browser.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function assertSameSet(actual: readonly string[], expected: readonly string[]) {
  const a = [...actual].sort()
  const b = [...expected].sort()
  assert(
    a.join("|") === b.join("|"),
    `${JSON.stringify(a)} does not match ${JSON.stringify(b)}`,
  )
}

const APP_SOURCE = await Deno.readTextFile(new URL("../../App.tsx", import.meta.url))

/**
 * Resolves a route-table path to the absolute path it actually serves.
 *
 * Children are declared relative to the AppLayout route at "/", so the table
 * says `students` while the capability map says `/students`. Comparing the two
 * literally would call every real route stale, which is how this file failed on
 * its first run.
 */
function resolveRoutePath(path: string): string {
  return normalizeRoutePath(path.startsWith("/") ? path : `/${path}`)
}

/** Every `path: "..."` literal in the route table, as absolute paths. */
function routePaths(): string[] {
  return [...APP_SOURCE.matchAll(/path:\s*"([^"]+)"/g)].map((match) => resolveRoutePath(match[1]))
}

/** Every `path` handed to a RouteGuard, which is the key it looks up in the map. */
function guardPaths(): string[] {
  return [...APP_SOURCE.matchAll(/<RouteGuard path="([^"]+)"/g)].map((match) => resolveRoutePath(match[1]))
}

/** The `path` a route is mounted at, paired with the path its guard authorizes. */
function mountedGuards(): Array<[string, string]> {
  return [...APP_SOURCE.matchAll(/path:\s*"([^"]+)"[^}]*?<RouteGuard path="([^"]+)"/g)]
    .map((match) => [resolveRoutePath(match[1]), resolveRoutePath(match[2])] as [string, string])
}

/** Nav paths, read out of navigation.ts so the real module stays the source of truth. */
async function navPaths(): Promise<string[]> {
  const source = await Deno.readTextFile(
    new URL("../../components/layout/navigation.ts", import.meta.url),
  )
  const block = source.match(/export const shellNavItems: ShellNavItem\[\] = \[([\s\S]*?)\n\]/)
  assert(block !== null, "could not find shellNavItems in navigation.ts")

  const paths = [...block[1].matchAll(/to:\s*"([^"]+)"/g)].map((match) => match[1])
  assert(paths.length > 0, "parsed no nav paths from navigation.ts")
  return paths
}

Deno.test("the route table parsed, rather than silently matching nothing", () => {
  // Every assertion below is a comparison between two lists. If a rewrite of the
  // route definitions stops them parsing, both lists go empty and the
  // comparisons pass vacuously, so the parse itself has to be asserted.
  assert(routePaths().length >= 10, `Parsed only ${routePaths().length} route paths from App.tsx`)
  assert(guardPaths().length >= 10, `Parsed only ${guardPaths().length} guarded paths from App.tsx`)
  assert(
    mountedGuards().length >= 10,
    `Paired only ${mountedGuards().length} routes with their guards from App.tsx`,
  )
})

Deno.test("every shell nav entry resolves to a declared route", async () => {
  const declared = routePaths().map(normalizeRoutePath)
  const missing = (await navPaths())
    .map(normalizeRoutePath)
    .filter((path) => !declared.includes(path))

  assert(
    missing.length === 0,
    `The shell links to ${missing.join(", ")} but App.tsx declares no such route. ` +
      `A deep link from the sidebar would fall through to the dashboard.`,
  )
})

Deno.test("every guarded route guards the path it is mounted at", () => {
  // A guard mounted at /students but authorizing against "/staff" is worse than
  // no guard at all: it renders a page the capability map never meant that path
  // to expose.
  const mismatched = mountedGuards().filter(([mounted, guarding]) => normalizeRoutePath(mounted) !== guarding)

  assert(
    mismatched.length === 0,
    mismatched
      .map(([mounted, guarding]) => `${mounted} is guarded as ${guarding}`)
      .join("; ") + ". The guard would check the wrong capability for that path.",
  )
})

Deno.test("every guarded route is declared in the capability map", () => {
  // The map is permissive by default: an undeclared path is allowed. That is
  // deliberate for open routes, so a page that should be guarded but is not
  // declared is invisible from the map alone and surfaces here.
  const undeclared = guardPaths().filter((path) => !(path in ROUTE_CAPABILITIES))

  assert(
    undeclared.length === 0,
    `${undeclared.join(", ")} is guarded in App.tsx but absent from ROUTE_CAPABILITIES. ` +
      `canAccessRoute returns true for an undeclared path, so that guard never fires.`,
  )
})

Deno.test("the capability map holds no route the app does not declare", () => {
  // The reverse drift. A stale entry keeps a capability alive for a page that no
  // longer exists, so it reads as covered in review while covering nothing.
  const declared = routePaths().map(normalizeRoutePath)
  const stale = Object.keys(ROUTE_CAPABILITIES).filter((path) => !declared.includes(path))

  assert(
    stale.length === 0,
    `ROUTE_CAPABILITIES declares ${stale.join(", ")} but App.tsx mounts no route for it.`,
  )
})

Deno.test("no route path is declared twice", () => {
  // React Router resolves a duplicate to the first match, so a shadowed route is
  // unreachable code that still reads as present.
  const counts = new Map<string, number>()
  for (const path of routePaths()) {
    const key = normalizeRoutePath(path)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([path]) => path)

  assert(
    duplicates.length === 0,
    `Declared more than once: ${duplicates.join(", ")}. The first match wins and the rest are unreachable.`,
  )
})

Deno.test("the unguarded routes are exactly the three that are meant to be open", () => {
  // Each of these is unguarded for its own stated reason, and personas.test.ts
  // already pins the capability side of the same decision.
  //
  //   /login         PublicRoute bounces a signed-in user to the dashboard, so
  //                  guarding it would be circular.
  //   /set-password  Outside PublicRoute and RouteGuard both, because someone
  //                  following an invitation is signed in with no roles yet and
  //                  must reach the form before a guard can redirect them.
  //   /sandbox       Open for local UI work, per the assertion in
  //                  personas.test.ts that it stays reachable with no roles.
  const expected = ["/login", "/set-password", "/sandbox"]

  const guarded = new Set(guardPaths())
  const open = [...new Set(routePaths())].filter((path) => !guarded.has(path))

  try {
    assertSameSet(open, expected)
  } catch {
    assert(
      false,
      `Unguarded routes are ${open.join(", ") || "none"}, expected ${expected.join(", ")}. ` +
        `A new unguarded route is reachable by any signed-in user without a capability check.`,
    )
  }
})

Deno.test("only the dashboard and sandbox carry an empty capability list", () => {
  // A guarded route whose capability list is empty is guarded in name only:
  // canAccessRoute allows it for every signed-in user. "/" is the dashboard,
  // which is correct, and "/sandbox" is asserted open elsewhere. Any third one
  // would be a capability-gated page that checks nothing.
  const ungated = Object.entries(ROUTE_CAPABILITIES)
    .filter(([, capabilities]) => capabilities.length === 0)
    .map(([path]) => path)

  try {
    assertSameSet(ungated, ["/", "/sandbox"])
  } catch {
    assert(
      false,
      `These routes require no capability: ${ungated.join(", ") || "none"}. ` +
        `Expected only the dashboard and the sandbox, which are open by design.`,
    )
  }
})
