import { forwardRef, startTransition, useState, useMemo, useCallback, useDeferredValue } from "react"
import { cn } from "../../utils/cn"
import { Button } from "./button"
import { Select } from "./Select"
import { Table, TableCell, TableFooter, TableHeader, TableRow, TableShell } from "./Table"
import type { ReactNode, KeyboardEvent } from "react"

interface ColumnConfig<T> {
  accessor?: keyof T | string
  header: string
  sortable?: boolean
  searchable?: boolean
  className?: string
  cell?: (value: any, row: T) => ReactNode
}

interface DataTableProps<T> {
  data: T[]
  columns: ColumnConfig<T>[]
  initialSort?: { id: keyof T | string; desc: boolean }
  itemsPerPageOptions?: number[]
  emptyMessage?: string
  className?: string
  onRowClick?: (row: T) => void
  searchQuery?: string
  searchable?: boolean
}

export const DataTable = forwardRef<
  HTMLDivElement,
  DataTableProps<any>
>(({ data, columns, initialSort, itemsPerPageOptions = [10, 25, 50, 100], emptyMessage = "No data found", className, onRowClick, searchQuery = "", searchable = true }, ref) => {
  const [page, setPageState] = useState(1)
  const [itemsPerPage, setItemsPerPageState] = useState(itemsPerPageOptions[0])
  const [sortId, setSortId] = useState<keyof any | string | null>(initialSort?.id ?? null)
  const [sortDesc, setSortDesc] = useState<boolean>(initialSort?.desc ?? false)
  const deferredSearchQuery = useDeferredValue(searchQuery)

  const searchableColumns = useMemo(
    () => (searchable ? columns.filter((column) => column.accessor && (column.searchable ?? true)) : []),
    [columns, searchable]
  )

  const filteredData = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase()
    if (!query) return data

    const terms = query.split(/\s+/).filter(Boolean)

    return data.filter((row) =>
      terms.every((term) => {
        const matchesColumn = searchableColumns.some((column) => {
          const value = row[column.accessor as keyof typeof row]
          if (value === null || value === undefined) return false
          return String(value).toLowerCase().includes(term)
        })
        if (matchesColumn) return true

        return Object.keys(row as object).some((key) => {
          if (!/name/i.test(key)) return false
          const alreadyCovered = searchableColumns.some((column) => column.accessor === key)
          if (alreadyCovered) return false
          const value = (row as any)[key]
          if (value === null || value === undefined) return false
          return String(value).toLowerCase().includes(term)
        })
      })
    )
  }, [data, deferredSearchQuery, searchableColumns])

  const sortedData = useMemo(() => {
    if (!sortId) return filteredData

    return [...filteredData].sort((a, b) => {
      const aValue = a[sortId as keyof typeof a]
      const bValue = b[sortId as keyof typeof b]

      if (aValue === null || aValue === undefined) return 1
      if (bValue === null || bValue === undefined) return -1
      if (aValue === bValue) return 0

      const comparison =
        typeof aValue === "number" && typeof bValue === "number"
          ? aValue - bValue
          : String(aValue).localeCompare(String(bValue))
      return sortDesc ? -comparison : comparison
    })
  }, [filteredData, sortId, sortDesc])

  const totalPages = useMemo(() => Math.max(1, Math.ceil(sortedData.length / itemsPerPage)), [sortedData.length, itemsPerPage])
  const currentPage = Math.min(page, totalPages)

  const paginatedData = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage
    return sortedData.slice(startIndex, startIndex + itemsPerPage)
  }, [sortedData, currentPage, itemsPerPage])

  const setPage = useCallback((pageNum: number) => {
    startTransition(() => {
      setPageState(Math.max(1, Math.min(pageNum, totalPages)))
    })
  }, [totalPages])

  const setItemsPerPage = useCallback((itemsPerPageNum: number) => {
    startTransition(() => {
      setItemsPerPageState(itemsPerPageNum)
      setPageState(1)
    })
  }, [])

  const toggleSort = useCallback((columnId: keyof any | string) => {
    startTransition(() => {
      if (sortId === columnId) {
        setSortDesc(prev => !prev)
      } else {
        setSortId(columnId)
        setSortDesc(false)
      }
    })
  }, [sortId])

  const handleHeaderClick = useCallback((column: ColumnConfig<any>) => {
    if (column.sortable && column.accessor) {
      toggleSort(column.accessor)
    }
  }, [toggleSort])

  return (
    <div className={cn("w-full max-w-full min-w-0 flex flex-col", className)} ref={ref}>
      <TableShell>
        <Table className="w-full">
          <TableHeader>
            <TableRow className="border-b border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]">
              {columns.map((column) => {
                const isSortable = Boolean(column.sortable && column.accessor)
                const isActiveSort = isSortable && sortId === column.accessor
                return (
                  <TableCell
                    key={String(column.accessor ?? column.header)}
                    as="th"
                    scope="col"
                    className={cn(
                      "px-4 py-3.5 font-semibold whitespace-nowrap transition-colors",
                      column.className,
                      isSortable && "cursor-pointer select-none hover:bg-[var(--color-row-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]",
                      isActiveSort && "bg-[var(--color-row-hover)]"
                    )}
                    aria-sort={
                      isActiveSort ? (sortDesc ? "descending" : "ascending") : undefined
                    }
                    onClick={() => handleHeaderClick(column)}
                    {...(isSortable
                      ? {
                          role: "button",
                          tabIndex: 0,
                          onKeyDown: (e: KeyboardEvent) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault()
                              handleHeaderClick(column)
                            }
                          },
                        }
                      : {})}
                  >
                    <div className="flex items-center space-x-2 whitespace-nowrap">
                      <span>{column.header}</span>
                      {isSortable && (
                        <span className="size-3 opacity-50">
                          {isActiveSort ? (sortDesc ? "▲" : "▼") : null}
                        </span>
                      )}
                    </div>
                  </TableCell>
                )
              })}
            </TableRow>
          </TableHeader>
          <tbody>
            {paginatedData.length > 0 ? (
              paginatedData.map((row, rowIndex) => (
                <TableRow
                  key={row.id ?? rowIndex}
                  className={cn(onRowClick && "cursor-pointer")}
                  onClick={onRowClick ? () => startTransition(() => onRowClick(row)) : undefined}
                >
                  {columns.map((column) => {
                    let cellContent: ReactNode

                    if (column.cell) {
                      const value = column.accessor ? row[column.accessor as keyof typeof row] : undefined
                      cellContent = column.cell(value, row)
                    } else {
                      const value = column.accessor ? row[column.accessor as keyof typeof row] : undefined
                      cellContent =
                        value === null || value === undefined ? (
                          "-"
                        ) : (
                          <span className="block max-w-[26rem] truncate" title={String(value)}>
                            {String(value)}
                          </span>
                        )
                    }

                    return (
                      <TableCell
                        key={String(column.accessor ?? column.header)}
                        className={cn("align-middle text-[var(--color-text)]", column.className)}
                      >
                        {cellContent}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            ) : (
                <TableRow>
                  <TableCell as="td" colSpan={columns.length} className="px-4 py-6 text-center text-[var(--color-muted)]">
                    {/* An empty table because a search matched nothing is a different
                        situation from an empty table, and it needs a different next
                        step: clear the search rather than go and create a record. */}
                    {data.length === 0 && searchQuery.trim()
                      ? `No rows match "${searchQuery.trim()}".`
                      : emptyMessage}
                  </TableCell>
                </TableRow>
              )}
          </tbody>
        </Table>
      </TableShell>

      {/* ALIGNED PAGINATION FOOTER */}
      {data.length > 0 && (
        <TableFooter>
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span>Showing</span>
            <span className="font-medium text-[var(--color-text)]">
              {paginatedData.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1}
            </span>
            <span>to</span>
            <span className="font-medium text-[var(--color-text)]">
              {Math.min(currentPage * itemsPerPage, sortedData.length)}
            </span>
            <span>of</span>
            <span className="font-medium text-[var(--color-text)]">{sortedData.length}</span>
            <span>entries</span>
          </div>

          <div className="flex flex-wrap items-center justify-center sm:justify-end gap-4 sm:gap-6">
            <div className="flex items-center gap-2 whitespace-nowrap">
              <Select 
                value={itemsPerPage} 
                onChange={(e: any) => setItemsPerPage(Number(e?.target?.value ?? e))}
                className="w-20"
                sizeVariant="sm"
              >
                {itemsPerPageOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
              <span className="text-[var(--color-muted)]">per page</span>
            </div>

            <div className="flex items-center gap-2.5 whitespace-nowrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(currentPage - 1)}
                disabled={currentPage <= 1}
              >
                Previous
              </Button>
              <span className="px-1 text-[var(--color-muted)]">
                Page <strong className="font-medium text-[var(--color-text)]">{currentPage}</strong> of{" "}
                <strong className="font-medium text-[var(--color-text)]">{totalPages}</strong>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </TableFooter>
      )}
    </div>
  )
})

DataTable.displayName = "DataTable"
