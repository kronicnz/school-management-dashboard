// One-off conversion of the remaining raw palette classes to semantic tokens.
// Run with: deno run --allow-read --allow-write tools/tokenise.mjs
import { readFileSync, writeFileSync } from "node:fs"

const mix = (token, pct) => `[color-mix(in_srgb,var(--color-${token})_${pct}%,transparent)]`

/**
 * Text and foreground colours map straight to a token of the same meaning.
 * Indigo has no status meaning of its own, so it becomes the accent, which is
 * what it was standing in for wherever it appeared.
 */
const TEXT = {
  "text-slate-100": "text-[var(--color-text)]",
  "text-slate-200": "text-[var(--color-text)]",
  "text-slate-300": "text-[var(--color-text)]",
  "text-slate-400": "text-[var(--color-muted)]",
  "text-slate-500": "text-[var(--color-muted)]",
  "text-slate-600": "text-[var(--color-muted)]",
  "text-cyan-200": "text-[var(--color-information)]",
  "text-cyan-300": "text-[var(--color-information)]",
  "text-cyan-400": "text-[var(--color-information)]",
  "text-cyan-500": "text-[var(--color-information)]",
  "text-emerald-200": "text-[var(--color-success)]",
  "text-emerald-300": "text-[var(--color-success)]",
  "text-emerald-400": "text-[var(--color-success)]",
  "text-amber-300": "text-[var(--color-warning)]",
  "text-amber-400": "text-[var(--color-warning)]",
  "text-rose-200": "text-[var(--color-destructive)]",
  "text-rose-300": "text-[var(--color-destructive)]",
  "text-rose-400": "text-[var(--color-destructive)]",
  "text-indigo-300": "text-[var(--color-accent)]",
  "text-indigo-400": "text-[var(--color-accent)]",
  "text-indigo-500": "text-[var(--color-accent)]",
}

const SLATE_BG = {
  "bg-slate-900": "bg-[var(--color-surface-muted)]",
  "bg-slate-950": "bg-[var(--color-surface)]",
}

const FILES = [
  "src/pages/Assets.tsx",
  "src/pages/Sandbox.tsx",
  "src/pages/Staff.tsx",
  "src/pages/Classes.tsx",
  "src/pages/Students.tsx",
  "src/pages/Login.tsx",
  "src/pages/Tickets.tsx",
  "src/pages/Attendance.tsx",
  "src/pages/SetPassword.tsx",
]

let total = 0
for (const file of FILES) {
  const before = readFileSync(file, "utf8")
  let after = before

  for (const [from, to] of Object.entries(TEXT)) {
    after = after.replaceAll(
      from,
      // A hover: or focus: variant keeps its own prefix, so only the colour is swapped.
      to.replace(/^[a-z-]+:/, (p) => p),
    )
  }

  for (const [from, to] of Object.entries(SLATE_BG)) after = after.replaceAll(from, to)

  // Alpha variants, longest first so a /20 is not consumed by a /200 pattern.
  const alphas = ["/10", "/15", "/20", "/25", "/30", "/40", "/50", "/60", "/80"]
  const tone = { cyan: "information", emerald: "success", amber: "warning", rose: "destructive", indigo: "accent" }
  for (const [family, token] of Object.entries(tone)) {
    for (const alpha of alphas) {
      for (const prop of ["bg", "border", "ring", "shadow", "text", "from", "via", "to"]) {
        after = after.replaceAll(`${prop}-${family}-500${alpha}`, `${prop}-${mix(token, alpha.slice(1))}`)
        after = after.replaceAll(`${prop}-${family}-400${alpha}`, `${prop}-${mix(token, alpha.slice(1))}`)
        after = after.replaceAll(`${prop}-${family}-300${alpha}`, `${prop}-${mix(token, alpha.slice(1))}`)
      }
    }
    // Solid
    for (const prop of ["bg", "border", "ring", "text", "accent", "shadow"]) {
      after = after.replaceAll(`${prop}-${family}-400`, `${prop}-[var(--color-${token})]`)
      after = after.replaceAll(`${prop}-${family}-500`, `${prop}-[var(--color-${token})]`)
    }
  }

  if (after !== before) {
    writeFileSync(file, after)
    total++
    console.log(`converted ${file}`)
  }
}
console.log(`${total} files changed`)
