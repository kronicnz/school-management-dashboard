import type { HTMLAttributes } from "react"
import { cn } from "../../utils/cn"
import { StatisticGrid } from "./StatisticCard"

/**
 * The single loading placeholder.
 *
 * Dashboard and finance each hand-rolled their own skeleton blocks with matching
 * class strings, which is how the two surfaces drifted apart without anyone
 * noticing. Everything below is a named measurement of the real thing it stands
 * in for, so a placeholder that no longer matches its content is a one-line
 * change here rather than a hunt through two modules.
 *
 * Every skeleton is aria-hidden: the loading container carries the status role and
 * the announcement, so individual blocks must not be announced as content.
 */

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-2xl bg-[var(--color-surface-soft)] motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

/**
 * Stands in for a section heading. The height is the line box of a `text-base`
 * font-semibold CardTitle, so the loaded page does not jump when it arrives.
 */
export function SkeletonHeading({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Skeleton className={cn("h-7 w-40 rounded-lg", className)} {...props} />
}

/**
 * Stands in for a KPI row. The height is the `primary` StatisticCard: label,
 * value and one description line at the standard padding. The grid is the real
 * StatisticGrid, so the placeholder has the same column count at every width.
 */
export function SkeletonStats({ count = 4, className, ...props }: HTMLAttributes<HTMLDivElement> & { count?: number }) {
  return (
    <StatisticGrid className={className} {...props}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-[7.5rem]" />
      ))}
    </StatisticGrid>
  )
}

/** Stands in for a single chart or panel. */
export function SkeletonPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <Skeleton className={cn("h-72", className)} {...props} />
}
