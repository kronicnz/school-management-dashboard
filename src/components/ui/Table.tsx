import { forwardRef, type HTMLAttributes, type TableHTMLAttributes, type TdHTMLAttributes, type ThHTMLAttributes } from "react"
import { cn } from "../../utils/cn"

export function TableShell({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("w-full min-w-0 overflow-x-auto overscroll-x-contain no-scrollbar rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-table)]", className)} {...props} />
}

export function TableToolbar({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)} {...props} />
}

export const Table = forwardRef<HTMLTableElement, TableHTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => {
    return <table ref={ref} className={cn("w-full min-w-full border-collapse text-sm text-left", className)} {...props} />
  }
)
Table.displayName = "Table"

export const TableHeader = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => {
    return <thead ref={ref} className={cn("sticky top-0 z-10 bg-[var(--color-surface)] text-[var(--color-muted)] backdrop-blur-sm", className)} {...props} />
  }
)
TableHeader.displayName = "TableHeader"

export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => {
    return <tr ref={ref} className={cn("border-b border-[var(--color-border-muted)] transition-colors even:bg-[var(--color-row)] hover:bg-[var(--color-row-hover)]", className)} {...props} />
  }
)
TableRow.displayName = "TableRow"

type TableCellProps = TdHTMLAttributes<HTMLTableCellElement> & ThHTMLAttributes<HTMLTableCellElement> & {
  as?: "td" | "th"
}

export const TableCell = forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, as = "td", ...props }, ref) => {
    const Component = as
    return <Component ref={ref as never} className={cn("px-4 py-3.5 align-middle text-[var(--color-text)]", className)} {...props} />
  }
)
TableCell.displayName = "TableCell"

export const TableFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    return <div ref={ref} className={cn("flex flex-col gap-4 border-t border-[var(--color-border)] px-4 py-4 text-sm text-[var(--color-muted)] sm:flex-row sm:items-center sm:justify-between", className)} {...props} />
  }
)
TableFooter.displayName = "TableFooter"
