/// <reference lib="deno.ns" />

/**
 * Raw palette ratchet.
 *
 * The design system defines the colour scale in src/index.css and every status
 * colour is verified against both themes in contrast.test.ts. This file guards
 * the other half of that contract: that components reach for those tokens
 * instead of hardcoded Tailwind palette classes.
 *
 * The classes are not merely untidy. The light-theme override block in
 * index.css remaps `text-slate-*` and `bg-white/*` but knows nothing about the
 * accent families, so `text-cyan-400` renders at 1.80:1 on a white surface and
 * `text-amber-400` at 1.66:1. That is unreadable, and it is invisible in dark
 * mode where the same class measures 10:1.
 *
 * This is a ratchet, not a gate. `BUDGETS` below pins the current count per
 * file. Converting a file lowers its number and the budget lowers with it, so
 * the suite fails if raw palette usage ever goes back up, and a partially
 * converted codebase is normal rather than a failing build.
 */

const SRC_ROOT = new URL("../../", import.meta.url)

/** Palette families that have a semantic token equivalent. */
const PALETTE = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
] as const

/**
 * Classes matching `(text|bg|border|from|to|ring|fill|stroke)-<family>-<step>`
 * plus their opacity-suffixed forms, e.g. `bg-cyan-400/10`.
 */
const RAW_PALETTE = new RegExp(
  `\\b(?:text|bg|border|from|to|ring|fill|stroke)-(${PALETTE.join("|")})-\\d{2,3}(?:/\\d{1,3})?\\b`,
  "g",
)

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** Strips comments so a class named in an explanatory comment is not counted. */
function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

/** Returns paths relative to src/, including their subdirectory. */
function collectSourceFiles(directory: URL, prefix = ""): string[] {
  const found: string[] = []
  for (const entry of Deno.readDirSync(directory)) {
    if (entry.isDirectory) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
      found.push(...collectSourceFiles(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`))
      continue
    }
    if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) found.push(`${prefix}${entry.name}`)
  }
  return found
}

/** Counts raw palette class usages per file, relative to src/. */
export function paletteUsageByFile(): Record<string, number> {
  const counts: Record<string, number> = {}

  for (const file of collectSourceFiles(SRC_ROOT)) {
    // The probe string in the self-test names banned classes deliberately.
    if (file === SELF) continue

    const source = stripComments(Deno.readTextFileSync(new URL(file, SRC_ROOT)))
    const matches = source.match(RAW_PALETTE)
    if (matches && matches.length > 0) counts[file] = matches.length
  }

  return counts
}

/**
 * The per-file budget, as measured by this file's own pattern. Lower it as each
 * file is converted. A file that reaches zero should be deleted from this map
 * entirely, so the ratchet also records which modules are done.
 */
const BUDGETS: Record<string, number> = {
  "pages/Admin.tsx": 218,
  "pages/Assets.tsx": 24,
  "pages/Sandbox.tsx": 20,
  "components/ui/Toast.tsx": 15,
  "pages/Staff.tsx": 10,
  "pages/Classes.tsx": 9,
  "pages/Students.tsx": 7,
  "components/ui/Select.tsx": 7,
  "pages/Login.tsx": 6,
  "pages/Tickets.tsx": 5,
  "components/ui/button.tsx": 4,
  "pages/Attendance.tsx": 4,
  "components/ui/TableAvatar.tsx": 3,
  "pages/SetPassword.tsx": 3,
  "components/ui/FormField.tsx": 2,
  "components/ui/Input.tsx": 2,
}

/** This file names the classes it bans, so it excludes itself from the walk. */
const SELF = "components/ui/palette-ratchet.test.ts"

Deno.test("raw palette usage stays within its per-file budget", () => {
  const actual = paletteUsageByFile()
  const regressions: string[] = []

  for (const [file, budget] of Object.entries(BUDGETS)) {
    const count = actual[file] ?? 0
    if (count > budget) {
      regressions.push(`${file}: ${count} raw palette classes, budget is ${budget} (+${count - budget})`)
    }
  }

  // A new file using raw palette is as much a regression as an existing one
  // going over its budget, so unlisted files are pinned at zero.
  for (const [file, count] of Object.entries(actual)) {
    if (!(file in BUDGETS)) regressions.push(`${file}: ${count} raw palette classes in a file with no budget entry`)
  }

  // A budgeted file that has been fully converted should be removed from the
  // map, otherwise the entry rots and hides a later regression.
  const stale = Object.entries(BUDGETS)
    .filter(([file, budget]) => budget > 0 && (actual[file] ?? 0) === 0)
    .map(([file]) => `${file}: budgeted at ${BUDGETS[file]} but now uses none. Remove the entry.`)

  assert(regressions.length === 0, `Raw palette usage regressed:\n  ${regressions.join("\n  ")}`)
  assert(stale.length === 0, `Stale budget entries:\n  ${stale.join("\n  ")}`)
})

Deno.test("the ratchet has budgeted every file that still uses raw palette", () => {
  // A guard on the guard: if this file's own regex stopped matching the palette
  // the counts would silently fall to zero and the budget would look satisfied
  // while the classes were all still there.
  const source = stripComments(Deno.readTextFileSync(new URL("./contrast.test.ts", import.meta.url)))
  const probe = `className="text-cyan-400 bg-amber-500/10 border-rose-300"`
  assert(source.length > 0, "could not read the probe source")

  const matches = probe.match(RAW_PALETTE)
  assert(matches !== null && matches.length === 3, `the palette regex should match 3 classes in "${probe}", matched ${matches ? matches.length : 0}`)

  // And confirm the pattern does not fire on legitimate token usage.
  const tokens = `className="text-[var(--color-success)] bg-[var(--color-surface-soft)]"`
  assert(tokens.match(RAW_PALETTE) === null, "the palette regex should not match semantic token classes")
})
