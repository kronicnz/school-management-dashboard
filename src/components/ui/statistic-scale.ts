/**
 * KPI value fitting.
 *
 * Kept out of `StatisticCard.tsx` so the module only exports components (React
 * Fast Refresh breaks otherwise) and so the sizing rules can be asserted
 * directly instead of being mirrored in a test, which is how they drift.
 */

/** One value scale, three weights of emphasis. */
export const valueClasses = {
  primary: "text-[clamp(1.05rem,0.85rem+0.7vw,1.75rem)]",
  secondary: "text-lg",
  compact: "text-base",
} as const

export type StatisticCardVariant = keyof typeof valueClasses

/**
 * The number of characters a value can hold before it steps down a size.
 *
 * Measured against the narrowest grid cell: two columns inside a 360px viewport
 * with 1rem page padding and a 0.75rem gutter leaves roughly 128px of content
 * box. Tabular figures at the `primary` clamp top out around 11 characters in
 * that width, so each step covers roughly another 60% of characters at the same
 * box. The final step is the 12px floor; nothing may go smaller.
 */
export const VALUE_WIDTH_STEPS = [11, 16, 22] as const

const STEP_CLASSES = ["", "sm:text-[1.4rem]", "sm:text-[1.2rem]", "sm:text-[1.05rem]"] as const

/**
 * Returns the size-step class for a value, or undefined when it fits at the
 * variant's natural size. Only `primary` steps down: `secondary` and `compact`
 * are already below the width that needs it.
 */
export function valueSizeFor(value: string | number, variant: StatisticCardVariant): string | undefined {
  if (variant !== "primary") return undefined

  const length = String(value).length
  const step = VALUE_WIDTH_STEPS.findIndex((limit) => length <= limit)
  if (step <= 0) return undefined

  return STEP_CLASSES[step]
}
