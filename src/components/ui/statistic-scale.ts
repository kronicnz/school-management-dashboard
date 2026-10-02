/**
 * KPI value fitting.
 *
 * Kept out of `StatisticCard.tsx` so the module only exports components (React
 * Fast Refresh breaks otherwise) and so the sizing rules can be asserted
 * directly instead of being mirrored in a test, which is how they drift. The
 * numbers here are the single source of truth: the component renders the class
 * names, and statistic-fit.test.ts measures the same rem values.
 */

/** One value scale, three weights of emphasis. */
export const valueClasses = {
  primary: "text-[clamp(1.05rem,0.85rem+0.7vw,1.75rem)]",
  secondary: "text-lg",
  compact: "text-base",
} as const

export type StatisticCardVariant = keyof typeof valueClasses

/**
 * The lower bound of the `primary` clamp, which is also the largest size a value
 * ever renders at in the narrowest cell: 0.85rem + 0.7vw works out to under
 * 1.05rem at 360px, so the clamp floors there.
 */
export const NATURAL_MIN_REM = 1.05

/**
 * The number of characters a value can hold before it steps down a size.
 *
 * Measured against the narrowest grid cell: two columns inside a 360px viewport
 * with 1rem page padding and a 0.75rem gutter leaves 158px per column, less the
 * card border and the 0.875rem padding on each side, which leaves 128px of
 * content box. At the 0.6em advance of a tabular digit that is 11 characters at
 * the natural size, 12 at 1rem, and 17 at the 12px floor. Past the final step a
 * value has to be shortened at the call site; no size on this scale fits it.
 */
export const VALUE_WIDTH_STEPS = [11, 12, 17] as const

/**
 * The steps, in the order they are applied. The last is the 12px typography
 * floor, the same floor the suite asserts for labels and metadata: a KPI must
 * not become the smallest text on the page to avoid a layout break.
 */
export const VALUE_STEP_REM = [1, 0.875, 0.75] as const

/**
 * The steps apply at every width, not only from `sm` up. The clamp already
 * handles the wide end; the narrow end is a 360px viewport, where a two-column
 * grid leaves the least room. An `sm:` prefix here would have left the steps
 * dormant on exactly the devices that need them.
 */
const STEP_CLASSES = VALUE_STEP_REM.map((rem) => `text-[${rem}rem]`) as string[]

/**
 * Returns the size-step class for a value, or undefined when it fits at the
 * variant's natural size. Only `primary` steps down: `secondary` and `compact`
 * are already below the width that needs it.
 */
export function valueSizeFor(value: string | number, variant: StatisticCardVariant): string | undefined {
  if (variant !== "primary") return undefined

  const length = String(value).length
  const step = VALUE_WIDTH_STEPS.findIndex((limit) => length <= limit)

  // Past the final step is still a step, not "no step": a value too wide for the
  // cell renders at the floor and the test reports it as a call-site problem.
  const index = step < 0 ? VALUE_STEP_REM.length : step
  if (index === 0) return undefined

  return STEP_CLASSES[index - 1]
}
