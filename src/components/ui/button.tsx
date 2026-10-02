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
    // One effect per state, on a property list rather than `transition-all`, so a
    // button cannot pick up an unrelated animation from a later class. No scale
    // on press: it moves the label out from under the pointer, which reads as
    // a glitch on dense toolbars where buttons sit shoulder to shoulder.
    const baseStyles =
      "relative inline-flex cursor-pointer select-none items-center justify-center rounded-lg font-medium transition-[color,background-color,border-color,box-shadow,filter] duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-50"

    const variants = {
      default:
        "bg-[var(--color-accent-strong)] text-[var(--color-button-text)] shadow-sm hover:brightness-95",
      outline:
        "border border-[var(--color-border)] bg-[var(--color-surface-soft)] text-[var(--color-text)] hover:border-[color-mix(in_srgb,var(--color-text)_18%,var(--color-border))] hover:bg-[var(--color-row-hover)]",
      ghost:
        "text-[var(--color-muted)] hover:bg-[var(--color-row-hover)] hover:text-[var(--color-text)]",
      danger:
        "bg-[var(--color-danger-fill)] text-[var(--color-button-text)] shadow-sm hover:bg-[var(--color-danger-fill-hover)]",
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
