/// <reference lib="deno.ns" />

/**
 * Raw palette gate.
 *
 * The design system defines the colour scale in src/index.css and every status
 * colour is verified against both themes in contrast.test.ts. This file guards
 * the other half of that contract: that components reach for those tokens
 * instead of hardcoded Tailwind palette classes.
 *
 * The classes are not merely untidy. The light-theme override block in
 * index.css used to remap `text-slate-*` while knowing nothing about the accent
 * families, so `text-cyan-400` rendered at 1.80:1 on a white surface and
 * `text-amber-400` at 1.66:1. That is unreadable, and it is invisible in dark
 * mode where the same class measures 10:1.
 *
 * This was a ratchet with a per-file budget for 352 occurrences across 17
 * files. All of them are now converted, so it is a plain gate: any raw palette
 * class in src/ is a failure. If a token is genuinely missing, add the token
 * and a contrast assertion for it rather than reaching for a palette class.
 */

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
 * Classes matching `<property>-<family>-<step>` for any colour-capable utility
 * property, plus their opacity-suffixed forms, e.g. `bg-cyan-400/10`.
 *
 * The property list is deliberately wider than the original seven. It has to
 * cover the modifier forms too, so `hover:bg-rose-500/20` and
 * `focus:ring-cyan-500` are both caught.
 */
const PROPERTIES = [
  "text",
  "bg",
  "border",
  "ring",
  "from",
  "via",
  "to",
  "fill",
  "stroke",
  "shadow",
  "outline",
  "divide",
  "accent",
  "decoration",
  "caret",
] as const

const RAW_PALETTE = new RegExp(
  // Optional variant prefixes, e.g. the `hover:` in `hover:bg-rose-500/20`.
  `(?:[a-z-]+:)*(?:${PROPERTIES.join("|")})-(${PALETTE.join("|")})-\\d{2,3}(?:/\\d{1,3})?\\b`,
  "g",
)

const SRC_ROOT = new URL("../../", import.meta.url)

/** This file names the classes it bans, so it excludes itself from the walk. */
const SELF = "components/ui/palette-ratchet.test.ts"

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

/** Reports each raw palette class found, with its line number. */
export function findRawPaletteUsage(): string[] {
  const found: string[] = []

  for (const file of collectSourceFiles(SRC_ROOT)) {
    // Both tests name the classes they ban, so they exclude themselves.
    if (file === SELF || file === "components/ui/contrast.test.ts") continue

    const source = stripComments(Deno.readTextFileSync(new URL(file, SRC_ROOT)))
    for (const [index, line] of source.split("\n").entries()) {
      for (const match of line.matchAll(RAW_PALETTE)) {
        found.push(`${file}:${index + 1}  ${match[0]}`)
      }
    }
  }

  return found
}

Deno.test("no component reaches for a raw palette class", () => {
  const found = findRawPaletteUsage()

  // Grouped by file so the message reads as a worklist rather than a wall.
  const byFile = new Map<string, string[]>()
  for (const entry of found) {
    const [location] = entry.split("  ")
    const file = location.split(":")[0]
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file)!.push(entry)
  }

  const report = [...byFile.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([file, entries]) => `${file} (${entries.length})\n    ${entries.join("\n    ")}`)
    .join("\n  ")

  assert(
    found.length === 0,
    `Raw palette classes found. Use a semantic token from index.css:\n  ${report}`,
  )
})

Deno.test("the gate matches the classes it bans and ignores token usage", () => {
  // A guard on the guard: if this regex stopped matching the palette the test
  // above would pass vacuously while the classes were all still there.
  const probe = `className="text-violet-400 bg-teal-500/10 border-fuchsia-300 hover:bg-lime-800/50"`
  const matches = probe.match(RAW_PALETTE)
  assert(matches !== null && matches.length === 4, `the palette regex should match 4 classes in the probe, matched ${matches ? matches.length : 0}`)

  // And confirm the pattern does not fire on legitimate token usage.
  const tokens = `className="text-[var(--color-success)] bg-[var(--color-surface-soft)] focus:ring-[var(--color-information)]"`
  assert(tokens.match(RAW_PALETTE) === null, "the palette regex should not match semantic token classes")

  // shadow- and accent- utilities take a colour too, and are easy to forget.
  for (const utility of ["shadow-emerald-500/20", "accent-indigo-500", "from-sky-400", "to-violet-600"]) {
    assert(utility.match(RAW_PALETTE) !== null, `the palette regex should match ${utility}`)
  }
})
