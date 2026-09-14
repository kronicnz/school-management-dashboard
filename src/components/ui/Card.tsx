import { forwardRef, type HTMLAttributes } from "react"
import { cn } from "../../utils/cn"

export interface CardProps extends HTMLAttributes<HTMLDivElement> {}

const Card = forwardRef<HTMLDivElement, CardProps>(({ className, ...props }, ref) => {
  return <div ref={ref} className={cn("rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[0_24px_60px_-36px_rgba(15,23,42,0.45)] backdrop-blur-sm", className)} {...props} />
})
Card.displayName = "Card"

const CardHeader = forwardRef<HTMLDivElement, CardProps>(({ className, ...props }, ref) => {
  return <div ref={ref} className={cn("mb-4 flex items-center justify-between gap-4", className)} {...props} />
})
CardHeader.displayName = "CardHeader"

const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(({ className, ...props }, ref) => {
  return <h3 ref={ref} className={cn("text-lg font-semibold text-[var(--color-text)]", className)} {...props} />
})
CardTitle.displayName = "CardTitle"

const CardContent = forwardRef<HTMLDivElement, CardProps>(({ className, ...props }, ref) => {
  return <div ref={ref} className={cn(className)} {...props} />
})
CardContent.displayName = "CardContent"

export { Card, CardHeader, CardTitle, CardContent }
