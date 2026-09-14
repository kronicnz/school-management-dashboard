import type { HTMLAttributes } from "react"
import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "./Card"
import { cn } from "../../utils/cn"

type StatisticCardProps = {
  label: string
  value: string | number
  icon: LucideIcon
  description?: string
  accentClassName?: string
  glowClassName?: string
  className?: string
}

export function StatisticCard({
  label,
  value,
  icon: Icon,
  description,
  accentClassName = "text-cyan-300",
  glowClassName = "from-cyan-400/25 via-cyan-400/10 to-transparent",
  className,
}: StatisticCardProps) {
  return (
    <Card
      className={cn(
        "group relative overflow-hidden border-[var(--color-border)] bg-[var(--color-surface)] p-0 shadow-xl transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--color-border-muted)]",
        className
      )}
    >
      <div className={cn("absolute inset-x-0 top-0 h-px bg-gradient-to-r", glowClassName)} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.06),_transparent_42%)]" />
      <CardContent className="relative flex min-w-0 items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-3.5">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[var(--color-muted)]">
            {label}
          </p>
          <p className="text-xl font-semibold tabular-nums leading-none tracking-tight text-[var(--color-text)] sm:text-[1.9rem]">
            {value}
          </p>
          {description ? (
            <p className="max-w-[28ch] text-[11px] leading-4 text-[var(--color-muted)]">{description}</p>
          ) : null}
        </div>
        <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-inner sm:size-14">
          <div className={cn("absolute inset-0 bg-gradient-to-br opacity-80", glowClassName)} />
          <Icon className={cn("relative size-4 sm:size-5", accentClassName)} />
        </div>
      </CardContent>
    </Card>
  )
}

type StatisticGridProps = HTMLAttributes<HTMLDivElement>

export function StatisticGrid({ className, ...props }: StatisticGridProps) {
  return <div className={cn("grid gap-3 sm:[grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]", className)} {...props} />
}
