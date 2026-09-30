import type { HTMLAttributes } from "react"
import { Link } from "react-router-dom"
import type { LucideIcon } from "lucide-react"
import { Card } from "./Card"
import { cn } from "../../utils/cn"

/**
 * The single KPI primitive. Every module KPI header and every dashboard stat
 * renders this component, so value scale, label treatment, radius, border, and
 * hover behaviour cannot drift apart between modules.
 *
 * `tone` is a semantic name only. The mapping below resolves to the token scale
 * in src/index.css, so no raw palette colour can reach a component.
 */
export type StatisticTone =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "information"
  | "pending"
  | "destructive"
  | "overdue"
  | "completed"
  | "inactive"

const toneIconClasses: Record<StatisticTone, string> = {
  neutral: "text-[var(--color-muted)]",
  primary: "text-[var(--color-primary)]",
  success: "text-[var(--color-success)]",
  warning: "text-[var(--color-warning)]",
  information: "text-[var(--color-information)]",
  pending: "text-[var(--color-pending)]",
  destructive: "text-[var(--color-destructive)]",
  overdue: "text-[var(--color-overdue)]",
  completed: "text-[var(--color-completed)]",
  inactive: "text-[var(--color-inactive)]",
}

/** One value scale, three weights of emphasis. */
const valueClasses = {
  primary: "text-[clamp(1.25rem,1.05rem+0.7vw,1.75rem)]",
  secondary: "text-xl",
  compact: "text-base",
} as const

export type StatisticCardVariant = keyof typeof valueClasses

type StatisticCardProps = {
  label: string
  value: string | number
  icon?: LucideIcon
  description?: string
  tone?: StatisticTone
  variant?: StatisticCardVariant
  /** Makes the whole card a single link. Never render buttons inside it. */
  href?: string
  className?: string
}

export function StatisticCard({
  label,
  value,
  icon: Icon,
  description,
  tone = "neutral",
  variant = "primary",
  href,
  className,
}: StatisticCardProps) {
  const interactive = Boolean(href)

  const body =
    variant === "compact" ? (
      <div className="flex min-w-0 items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? <Icon className={cn("size-4 shrink-0", toneIconClasses[tone])} aria-hidden="true" /> : null}
          <span className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">{label}</span>
        </div>
        <span className={cn("shrink-0 font-semibold tabular-nums leading-none text-[var(--color-text)]", valueClasses[variant])}>{value}</span>
      </div>
    ) : (
      <div
        className={cn(
          "flex h-full flex-col gap-2.5 px-4 py-3.5",
          variant === "primary" ? "sm:px-5" : undefined,
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-muted)]">{label}</p>
          {Icon ? (
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)]",
                toneIconClasses[tone],
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>
          ) : null}
        </div>
        <p className={cn("font-semibold tabular-nums leading-none tracking-tight text-[var(--color-text)]", valueClasses[variant])}>{value}</p>
        {description ? <p className="text-xs leading-5 text-[var(--color-muted)]">{description}</p> : null}
      </div>
    )

  const card = (
    <Card
      className={cn(
        "h-full p-0",
        variant === "secondary" && "bg-[var(--color-surface-soft)]",
        interactive && [
          "transition-colors motion-reduce:transition-none",
          "hover:border-[color-mix(in_srgb,var(--color-primary)_32%,var(--color-border))]",
        ],
        className,
      )}
    >
      {body}
    </Card>
  )

  if (!href) {
    return card
  }

  return (
    <Link
      to={href}
      className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-canvas)]"
    >
      <span className="sr-only">Open {label}</span>
      {card}
    </Link>
  )
}

type StatisticGridProps = HTMLAttributes<HTMLDivElement>

/**
 * Two columns on small screens, then auto-fit. The minmax floor is sized so a
 * currency value never truncates or wraps mid-number, and the value itself is
 * clamped rather than shrunk with a smaller font.
 */
export function StatisticGrid({ className, ...props }: StatisticGridProps) {
  return (
    <div
      className={cn("grid grid-cols-2 gap-3 sm:[grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]", className)}
      {...props}
    />
  )
}
