import type { ReactNode } from "react"
import { cn } from "../../utils/cn"

type TableAvatarProps = {
  children: ReactNode
  className?: string
}

export function TableAvatar({ children, className }: TableAvatarProps) {
  return (
    <div
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-information)_10%,transparent)] text-xs font-semibold text-[var(--color-information)] ring-1 ring-[color-mix(in_srgb,var(--color-information)_20%,transparent)]",
        className
      )}
    >
      {children}
    </div>
  )
}
