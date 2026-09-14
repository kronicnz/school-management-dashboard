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
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-cyan-500/10 text-xs font-semibold text-cyan-300 ring-1 ring-cyan-500/20",
        className
      )}
    >
      {children}
    </div>
  )
}
