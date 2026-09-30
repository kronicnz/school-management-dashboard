import type { ReactNode } from "react"
import { cn } from "../../utils/cn"

type PageHeaderProps = {
  breadcrumb?: string
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}

export function PageHeader({ breadcrumb, title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between", className)}>
      <div className="min-w-0 flex-1">
        {breadcrumb ? <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">{breadcrumb}</p> : null}
        <h1 className="mt-1 truncate text-[1.35rem] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[1.55rem] lg:text-[1.7rem]">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--color-muted-foreground)]">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
