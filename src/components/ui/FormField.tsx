import type { HTMLAttributes, ReactNode } from "react"
import { cn } from "../../utils/cn"

export interface FormFieldProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode
  htmlFor?: string
  required?: boolean
  helperText?: ReactNode
  error?: ReactNode
  labelClassName?: string
  contentClassName?: string
  helperClassName?: string
}

const FormField = ({
  label,
  htmlFor,
  required,
  helperText,
  error,
  className,
  labelClassName,
  contentClassName,
  helperClassName,
  children,
  ...props
}: FormFieldProps) => {
  return (
    <div className={cn("space-y-2", className)} {...props}>
      <label htmlFor={htmlFor} className={cn("block text-sm font-medium text-[var(--color-muted)]", labelClassName)}>
        {label}
        {required && <span className="text-rose-400"> *</span>}
      </label>

      <div className={contentClassName}>{children}</div>

      {helperText && (
        <p className={cn("text-xs text-[var(--color-muted)]", error ? "text-rose-400" : undefined, helperClassName)}>{error ?? helperText}</p>
      )}
    </div>
  )
}

export { FormField }
