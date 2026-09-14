import { cloneElement, forwardRef, isValidElement, type ButtonHTMLAttributes, type ReactElement } from "react"
import { cn } from "../../utils/cn"
import { Spinner } from "./Spinner"

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "outline" | "ghost" | "danger"
  size?: "sm" | "md" | "lg"
  isLoading?: boolean
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", isLoading = false, disabled, asChild = false, type, children, ...props }, ref) => {
    const baseStyles =
      "relative inline-flex items-center justify-center font-medium rounded-lg transition-all duration-150 ease-out cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-50 active:scale-95 active:brightness-95 hover:brightness-105"

    const variants = {
      default: "bg-[var(--color-accent-strong)] text-[var(--color-button-text)] shadow-md shadow-sky-500/20 hover:shadow-sky-500/30 active:bg-blue-700",
      outline: "border border-[var(--color-border)] bg-[var(--color-surface-soft)] text-[var(--color-text)] hover:bg-[var(--color-row-hover)] backdrop-blur-sm active:bg-[var(--color-row-hover)]",
      ghost: "text-[var(--color-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-text)] active:bg-[var(--color-row-hover)]",
      danger: "bg-rose-600 text-[var(--color-button-text)] shadow-md shadow-rose-600/20 hover:bg-rose-500 hover:shadow-rose-500/30 active:bg-rose-700",
    }

    const sizes = {
      sm: "h-8 px-3 text-xs gap-1.5",
      md: "h-10 px-4 text-sm gap-2",
      lg: "h-12 px-6 text-base gap-2.5",
    }

    const mergedClassName = cn(baseStyles, variants[variant], sizes[size], className)

    if (asChild && isValidElement(children)) {
      const child = children as ReactElement<{ className?: string }>

      return cloneElement(child, {
        className: cn(mergedClassName, child.props.className),
        ...(disabled ? { "aria-disabled": true, tabIndex: -1 } : {}),
        ...props,
      })
    }

    return (
      <button
        ref={ref}
        type={type ?? "button"}
        disabled={disabled || isLoading}
        className={mergedClassName}
        {...props}
      >
        {isLoading && <Spinner size="sm" />}
        {children}
      </button>
    )
  }
)

Button.displayName = "Button"
