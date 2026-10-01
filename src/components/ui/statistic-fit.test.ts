/// <reference lib="deno.ns" />

/**
 * The KPI value must never break mid-number.
 *
 * `StatisticGrid` holds two columns down to the narrowest supported viewport,
 * which leaves a content box of roughly 128px for the value. A NZD amount such
 * as "$1,234,567.89" does not fit at the primary type size in that box, so the
 * component steps the size down instead of letting the string wrap.
 *
 * The step boundaries are asserted here against real formatted output rather
 * than eyeballed, because a number split across two lines reads as two numbers.
 * The sizes are imported from statistic-scale rather than restated here: the
 * previous version of this file computed a 268px cell while its own comment
 * described a 128px one, having never halved for the two-column grid, so the
 * guard passed at more than twice the width it claimed to enforce.
 */

import { formatCount, formatNZD } from "../../lib/format"
import { NATURAL_MIN_REM, VALUE_STEP_REM, VALUE_WIDTH_STEPS } from "./statistic-scale"

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/**
 * The narrowest supported layout, in the order the browser subtracts it:
 * a 360px viewport, 1rem page padding each side, a 0.75rem gutter between two
 * columns, the card border, and the 0.875rem card padding on each side.
 */
const NARROWEST_VIEWPORT_PX = 360
const PAGE_PADDING_PX = 32
const GUTTER_PX = 12
const CARD_BORDER_PX = 2
const CARD_PADDING_PX = 28

const NARROWEST_CONTENT_BOX_PX =
  (NARROWEST_VIEWPORT_PX - PAGE_PADDING_PX - GUTTER_PX) / 2 - CARD_BORDER_PX - CARD_PADDING_PX

/** Root font size. Every rem value in the scale is converted with it. */
const ROOT_PX = 16

/** Character advance of a tabular digit at 1rem, as a fraction of the font size. */
const TABULAR_ADVANCE = 0.6

/**
 * The size the value renders at for a given character count, mirroring the
 * lookup in `valueSizeFor`.
 */
function renderedRem(length: number): number {
  const step = VALUE_WIDTH_STEPS.findIndex((limit) => length <= limit)
  const index = step < 0 ? VALUE_STEP_REM.length : step
  return index === 0 ? NATURAL_MIN_REM : VALUE_STEP_REM[index - 1]
}

Deno.test("the narrowest cell is the width the scale was measured against", () => {
  // Guards the arithmetic above rather than the design. A cell this size is the
  // reason the scale exists; if the padding or the grid changes, this fails and
  // the boundaries below have to be re-derived rather than quietly trusted.
  assert(
    NARROWEST_CONTENT_BOX_PX === 128,
    `The narrowest KPI cell computes to ${NARROWEST_CONTENT_BOX_PX}px, not the 128px the scale assumes. Re-derive VALUE_WIDTH_STEPS.`,
  )
})

Deno.test("no value the app can produce wraps inside the narrowest KPI cell", () => {
  // Values drawn from the real formatters, so this covers what actually renders
  // rather than a hand-picked string.
  //
  // Only `StatisticCard` values belong here. The dashboard's statusLabel is
  // longer than a step boundary but is not in this constraint: it renders as a
  // TableBadge in a full-width wrapping row of badges, which wraps as a whole
  // rather than mid-phrase. Adding it made the suite fail on a case it was never
  // about, so keep anything rendered outside a KPI card out of this list.
  const values: Array<[string, string]> = [
    ["count", formatCount(1234567)],
    ["count small", formatCount(42)],
    ["nzd small", formatNZD(1234.56)],
    ["nzd large", formatNZD(1234567.89)],
    ["nzd negative variance", formatNZD(-12345.67)],
    ["percent", `${94}%`],
  ]

  for (const [name, value] of values) {
    const length = value.length
    const required = length * TABULAR_ADVANCE * renderedRem(length) * ROOT_PX

    assert(
      required <= NARROWEST_CONTENT_BOX_PX,
      `"${name}" renders as "${value}" (${length} chars) at ${renderedRem(length)}rem, needing ${Math.round(required)}px, ` +
        `over the ${NARROWEST_CONTENT_BOX_PX}px available in the narrowest KPI cell. ` +
        `Either add a step to VALUE_STEP_REM or shorten the value at the call site.`,
    )
  }
})

Deno.test("no KPI passes two figures joined by a separator", () => {
  // The defect this suite was written for: a value like "$132,950.00 /
  // $141,200.00" cannot fit the narrowest cell at a legible size, so the fix is
  // to split it into separate cards rather than shrink the type. Scan for the
  // pattern so it cannot come back unnoticed.
  const callSites = [
    new URL("../dashboard/DashboardOverview.tsx", import.meta.url),
    new URL("../finance/FinanceOverview.tsx", import.meta.url),
    new URL("../../pages/Students.tsx", import.meta.url),
    new URL("../../pages/Staff.tsx", import.meta.url),
    new URL("../../pages/Classes.tsx", import.meta.url),
    new URL("../../pages/Attendance.tsx", import.meta.url),
    new URL("../../pages/Assets.tsx", import.meta.url),
    new URL("../../pages/Incidents.tsx", import.meta.url),
    new URL("../../pages/Tickets.tsx", import.meta.url),
    new URL("../../pages/Admin.tsx", import.meta.url),
  ]

  const offenders: string[] = []
  for (const url of callSites) {
    const source = Deno.readTextFileSync(url)
    const name = url.pathname.split("/").pop() ?? url.pathname

    // A template literal spanning two interpolated values is the shape that
    // produces the unwieldy joined string.
    const paired = source.match(/value=\{`[^`]*\$\{[^}]*\}[^`]*\/[^`]*\$\{/g)
    if (paired) offenders.push(`${name}: ${paired.join(" | ")}`)
  }

  assert(
    offenders.length === 0,
    `A KPI is still rendering two figures in one value:\n  ${offenders.join("\n  ")}\n` +
      `Split it into separate StatisticCard entries.`,
  )
})

Deno.test("the step boundaries are contiguous and cover a realistic worst case", () => {
  for (let index = 1; index < VALUE_WIDTH_STEPS.length; index += 1) {
    assert(
      VALUE_WIDTH_STEPS[index] > VALUE_WIDTH_STEPS[index - 1],
      `VALUE_WIDTH_STEPS must increase: ${VALUE_WIDTH_STEPS.join(", ")}`,
    )
  }

  // Every boundary needs a step behind it, and a value one character past the
  // last boundary still has to land on the floor rather than on no step at all.
  assert(
    VALUE_WIDTH_STEPS.length === VALUE_STEP_REM.length,
    `${VALUE_WIDTH_STEPS.length} boundaries but ${VALUE_STEP_REM.length} steps. ` +
      `A value that outgrows its cell must always land on a defined size.`,
  )

  // The longest single figure any call site renders. If a future value grows past
  // the final step, the last tier has to grow with it.
  const longestKnown = formatNZD(1234567.89)
  assert(
    longestKnown.length <= VALUE_WIDTH_STEPS[VALUE_WIDTH_STEPS.length - 1],
    `The widest single value is ${longestKnown.length} chars, past the last step of ${VALUE_WIDTH_STEPS[VALUE_WIDTH_STEPS.length - 1]}.`,
  )
})

Deno.test("the value scale never drops below the 12px legibility floor", () => {
  // 0.75rem is 12px, the typography floor for label and value text. A KPI that
  // renders smaller than its own label to avoid a wrap has traded legibility for
  // layout, which is the wrong way round.
  const floorRem = 0.75
  const tiers: Array<[string, number]> = [
    ...VALUE_STEP_REM.map((rem, index) => [`value step ${index + 1}`, rem] as [string, number]),
    ["compact variant", 1],
    ["secondary variant", 1.125],
  ]

  for (const [label, limit] of tiers) {
    assert(limit >= floorRem, `${label} would render below the 12px floor: ${limit}rem`)
  }
})
