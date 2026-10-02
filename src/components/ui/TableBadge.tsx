import type { ReactNode } from "react"
import { cn } from "../../utils/cn"

/**
 * Badge tones resolve to the semantic token scale rather than raw Tailwind
 * palette values, so a badge is legible in both themes. The previous
 * `text-amber-400` on a light surface measured 1.24:1 and `text-cyan-400`
 * measured 1.39:1 on dark; both are effectively invisible.
 */
const badgeTones = {
  slate: "text-[var(--color-inactive)]",
  emerald: "text-[var(--color-success)]",
  cyan: "text-[var(--color-information)]",
  amber: "text-[var(--color-warning)]",
  rose: "text-[var(--color-destructive)]",
  purple: "text-[var(--color-pending)]",
  indigo: "text-[var(--color-primary)]",
  violet: "text-[var(--color-pending)]",
} as const

/** The tint token paired with each badge tone, used for the background wash. */
const badgeWash = {
  slate: "var(--color-inactive)",
  emerald: "var(--color-success)",
  cyan: "var(--color-information)",
  amber: "var(--color-warning)",
  rose: "var(--color-destructive)",
  purple: "var(--color-pending)",
  indigo: "var(--color-primary)",
  violet: "var(--color-pending)",
} as const

export type TableBadgeTone = keyof typeof badgeTones

type TableBadgeProps = {
  children: ReactNode
  tone?: TableBadgeTone
  uppercase?: boolean
  className?: string
}

export function TableBadge({ children, tone = "slate", uppercase = false, className }: TableBadgeProps) {
  const wash = badgeWash[tone]

  return (
    <span
      className={cn(
        // whitespace-nowrap keeps a status label on one line rather than
        // clipping it, which matters once the grid narrows on small screens.
        "inline-flex max-w-full items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        badgeTones[tone],
        uppercase && "uppercase",
        className,
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${wash} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${wash} 28%, transparent)`,
      }}
    >
      {children}
    </span>
  )
}
