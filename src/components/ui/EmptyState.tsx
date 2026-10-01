import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "../../utils/cn"

/**
 * The single "there is nothing here" surface.
 *
 * The dashed placeholder block was written out by hand at least six times across
 * the dashboard, finance and admin modules, each with a different radius, min-height
 * and text tier, so an empty list never looked like the same component twice. Both
 * sizes below are the two shapes the product actually needs, and the copy is part
 * of the contract: say what is empty, and give the reader the next action.
 *
 * `inline` sits inside a panel or a list. `section` replaces a whole region, so it
 * carries more padding and may hold a primary action.
 */

type EmptyStateProps = {
  icon?: LucideIcon
  title?: string
  description?: string
  action?: ReactNode
  size?: "inline" | "section"
  className?: string
}

export function EmptyState({ icon: Icon, title, description, action, size = "inline", className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface-soft)] text-center",
        size === "section" ? "gap-3 px-6 py-14" : "min-h-28 gap-1 px-4 py-6",
        className,
      )}
    >
      {Icon ? <Icon className="size-5 text-[var(--color-subtle)]" aria-hidden="true" /> : null}
      {title ? <p className="text-sm font-semibold text-[var(--color-text)]">{title}</p> : null}
      {description ? <p className="max-w-xl text-sm leading-5 text-[var(--color-muted)]">{description}</p> : null}
      {action ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  )
}
