/// <reference lib="deno.ns" />

/**
 * Contrast checks for the semantic token scale.
 *
 * The status colours are used as text on cards, not just as fills, so they have
 * to clear WCAG 2.1 AA (4.5:1 for body text) against every surface they can
 * land on in both themes. These are computed here rather than eyeballed because
 * the failures are not obvious: the original light-theme values read as
 * perfectly reasonable amber and cyan on a white page at 1.24:1 and 1.39:1.
 *
 * Backgrounds are composited the way the browser composites them. A token like
 * `--color-surface: rgb(15 23 42 / 0.82)` is a translucent layer over
 * `--color-canvas`, so the real background is a blend, not the raw token value.
 */

const AA_BODY_TEXT = 4.5

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

type Rgb = [number, number, number]

function parseRgb(value: string): Rgb {
  const match = value.match(/rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (!match) throw new Error(`Cannot parse an rgb() token: ${value}`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function parseAlpha(value: string): number {
  const match = value.match(/\/\s*([\d.]+)\s*\)/)
  return match ? Number(match[1]) : 1
}

function composite(foreground: Rgb, alpha: number, backdrop: Rgb): Rgb {
  return [
    foreground[0] * alpha + backdrop[0] * (1 - alpha),
    foreground[1] * alpha + backdrop[1] * (1 - alpha),
    foreground[2] * alpha + backdrop[2] * (1 - alpha),
  ]
}

function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(foreground: Rgb, background: Rgb): number {
  const a = relativeLuminance(foreground)
  const b = relativeLuminance(background)
  const [lighter, darker] = a > b ? [a, b] : [b, a]
  return (lighter + 0.05) / (darker + 0.05)
}

/** Reads `--name: value;` declarations out of one theme block of index.css. */
function readTheme(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(selector)
  assert(start >= 0, `No ${selector} block found in src/index.css`)

  const open = css.indexOf("{", start)
  const close = css.indexOf("}", open)
  const block = css.slice(open + 1, close)

  const tokens = new Map<string, string>()
  for (const line of block.split("\n")) {
    const match = line.match(/^\s*(--[a-z0-9-]+):\s*(.+?);\s*$/)
    if (match) tokens.set(match[1], match[2])
  }
  return tokens
}

/**
 * Flattens a translucent surface onto the canvas beneath it.
 *
 * `--color-canvas` is itself fully opaque, so the recursion terminates there.
 * An opaque token short-circuits to its own value.
 */
function resolveSurface(tokens: Map<string, string>, name: string): Rgb {
  const key = name.startsWith("--") ? name : `--color-${name}`
  const raw = tokens.get(key)
  assert(raw, `Missing token ${key} in index.css`)

  const alpha = parseAlpha(raw)
  const opaque = parseRgb(raw)
  if (alpha >= 1) return opaque

  const backdrop = key === "--color-canvas" ? opaque : resolveSurface(tokens, "canvas")
  return composite(opaque, alpha, backdrop)
}

/** Text-bearing status colours. These must clear AA as text, not just as a fill. */
const STATUS_TOKENS = [
  "--color-destructive",
  "--color-success",
  "--color-warning",
  "--color-information",
  "--color-pending",
  "--color-overdue",
  "--color-completed",
  "--color-inactive",
  "--color-primary",
  "--color-text",
  "--color-muted",
  "--color-subtle",
]

const SURFACE_TOKENS = ["--color-surface", "--color-surface-soft", "--color-surface-elevated"]

Deno.test("every status colour clears AA body text against every surface, in both themes", () => {
  const css = Deno.readTextFileSync(new URL("../../index.css", import.meta.url))

  for (const [theme, selector] of [["dark", ":root"], ["light", 'html[data-theme="light"]']] as const) {
    const tokens = readTheme(css, selector)
    const surfaces = SURFACE_TOKENS.map((name) => [name, resolveSurface(tokens, name)] as const)

    for (const token of STATUS_TOKENS) {
      const raw = tokens.get(token)
      assert(raw, `${theme}: missing token ${token}`)
      // Solid tokens only. A token carrying its own alpha is a wash or a
      // border, where the 3:1 non-text threshold applies instead.
      const foreground = parseRgb(raw!)

      for (const [surfaceName, surface] of surfaces) {
        const ratio = contrastRatio(foreground, surface)
        assert(
          ratio >= AA_BODY_TEXT,
          `${theme}: ${token} on ${surfaceName} is ${ratio.toFixed(2)}:1, below the ${AA_BODY_TEXT}:1 AA body-text minimum.\n` +
            `  token value: ${raw}\n` +
            `  background:  rgb(${surface.map((channel) => Math.round(channel)).join(", ")})\n` +
            `  Fix: move ${token} a step further from ${surfaceName} in index.css, or give this text a different token.`,
        )
      }
    }
  }
})

Deno.test("the surfaces used for nesting are distinguishable from each other", () => {
  const css = Deno.readTextFileSync(new URL("../../index.css", import.meta.url))

  for (const [theme, selector] of [["dark", ":root"], ["light", 'html[data-theme="light"]']] as const) {
    const tokens = readTheme(css, selector)
    const surface = resolveSurface(tokens, "--color-surface")
    const soft = resolveSurface(tokens, "--color-surface-soft")
    const elevated = resolveSurface(tokens, "--color-surface-elevated")

    // A nested card that matches its parent reads as a flat block, which is the
    // card-in-card-in-card problem the layout pass was meant to remove.
    const nested = Math.abs(relativeLuminance(soft) - relativeLuminance(surface))
    const raised = Math.abs(relativeLuminance(elevated) - relativeLuminance(surface))

    assert(nested > 0.002, `${theme}: surface-soft is indistinguishable from surface (Δ ${nested.toFixed(5)}).`)
    assert(raised > 0.002, `${theme}: surface-elevated is indistinguishable from surface (Δ ${raised.toFixed(5)}).`)
  }
})

Deno.test("every button label clears AA against its own fill", () => {
  // Button renders `--color-button-text` on a solid fill, so each is judged as a
  // text-on-fill pair rather than a text-on-surface one: a fill is opaque and the
  // surface underneath never shows through.
  //
  // The danger pair is here because `--color-destructive` is tuned to be legible
  // as text on a light surface, which is much too pale to carry a white label.
  // Without a separate fill token the danger button would pass the text checks
  // and still be unreadable.
  const css = Deno.readTextFileSync(new URL("../../index.css", import.meta.url))

  const FILLS = ["--color-accent-strong", "--color-danger-fill", "--color-danger-fill-hover"]

  for (const [theme, selector] of [["dark", ":root"], ["light", 'html[data-theme="light"]']] as const) {
    const tokens = readTheme(css, selector)
    const label = tokens.get("--color-button-text")
    assert(label, `${theme}: missing --color-button-text`)

    for (const fill of FILLS) {
      const value = tokens.get(fill)
      assert(value, `${theme}: missing ${fill}`)

      const ratio = contrastRatio(parseRgb(label!), parseRgb(value!))
      assert(
        ratio >= AA_BODY_TEXT,
        `${theme}: the button label is ${ratio.toFixed(2)}:1 on ${fill}, below ${AA_BODY_TEXT}:1.`,
      )
    }
  }
})

Deno.test("no token is declared twice inside a theme block with different values", () => {
  // A silent second declaration wins and hides the first, which is how the light
  // theme ended up with a cyan accent nobody chose. Fail rather than depend on
  // which one happens to come last.
  const css = Deno.readTextFileSync(new URL("../../index.css", import.meta.url))

  for (const [theme, selector] of [["dark", ":root"], ["light", 'html[data-theme="light"]']] as const) {
    const start = css.indexOf(selector)
    assert(start >= 0, `No ${selector} block found in src/index.css`)
    const block = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start))

    const seen = new Map<string, string>()
    const conflicts: string[] = []

    for (const line of block.split("\n")) {
      const match = line.match(/^\s*(--[a-z0-9-]+):\s*(.+?);\s*$/)
      if (!match) continue

      const [, name, value] = match
      const previous = seen.get(name)
      if (previous && previous !== value) conflicts.push(`${name}: ${previous} then ${value}`)
      seen.set(name, value)
    }

    assert(conflicts.length === 0, `${theme}: conflicting duplicate token declarations in index.css:\n  ${conflicts.join("\n  ")}`)
  }
})

Deno.test("no raw palette colour reaches the badge or KPI primitives", () => {
  // TableBadge and StatisticCard are how status colour enters every dashboard
  // surface, so a regression here is the whole audit undone.
  for (const file of ["TableBadge.tsx", "StatisticCard.tsx"]) {
    const source = Deno.readTextFileSync(new URL(`./${file}`, import.meta.url))
    // Comments legitimately name the classes being banned, so strip them first.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")

    const raw = code.match(/(?:text|bg|border|from|to)-(?:slate|cyan|emerald|amber|rose|violet|indigo|purple|sky|blue|red|green|orange)-\d+/g)
    assert(raw === null, `${file} reintroduced raw palette classes: ${raw ? raw.join(", ") : ""}`)

    const hex = code.match(/#[0-9a-fA-F]{3,8}\b/)
    assert(hex === null, `${file} reintroduced a raw hex colour: ${hex ? hex[0] : ""}`)

    const rgbLiteral = code.match(/rgb\(\s*\d/)
    assert(rgbLiteral === null, `${file} reintroduced a raw rgb() literal instead of a token.`)
  }
})
