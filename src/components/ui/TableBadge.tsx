import type { ReactNode } from "react"
import { cn } from "../../utils/cn"

const tableBadgeTones = {
  slate: "bg-slate-400/10 text-slate-400 border-slate-400/20",
  emerald: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
  cyan: "bg-cyan-400/10 text-cyan-400 border-cyan-400/20",
  amber: "bg-amber-400/10 text-amber-400 border-amber-400/20",
  rose: "bg-rose-400/10 text-rose-400 border-rose-400/20",
  purple: "bg-purple-400/10 text-purple-400 border-purple-400/20",
  indigo: "bg-indigo-400/10 text-indigo-400 border-indigo-400/20",
  violet: "bg-violet-400/10 text-violet-400 border-violet-400/20",
} as const

export type TableBadgeTone = keyof typeof tableBadgeTones

type TableBadgeProps = {
  children: ReactNode
  tone?: TableBadgeTone
  uppercase?: boolean
  className?: string
}

export function TableBadge({ children, tone = "slate", uppercase = false, className }: TableBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap capitalize",
        tableBadgeTones[tone],
        uppercase && "uppercase",
        className
      )}
    >
      {children}
    </span>
  )
}
