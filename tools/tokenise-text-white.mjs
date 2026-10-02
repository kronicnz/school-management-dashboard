// Converts text-white to the semantic text token, which is what the light-theme
// override already resolved it to. Dark mode shifts from #fff to slate-200:
// both sit far above AA on the dark surfaces, and it makes the two themes agree.
// Run with: deno run --allow-read --allow-write tools/tokenise-text-white.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const SKIP = new Set(["node_modules", "dist", ".git", "tools"])

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

let files = 0
for (const file of walk("src")) {
  const before = readFileSync(file, "utf8")
  // The token test names text-white in a banned list, so it must keep its own copy.
  if (file.endsWith("palette-ratchet.test.ts")) continue
  const after = before.replaceAll("text-white", "text-[var(--color-text)]")
  if (after !== before) {
    writeFileSync(file, after)
    files++
    console.log(file)
  }
}
console.log(`${files} files changed`)
