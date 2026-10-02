import { useEffect, useId, useRef, type ReactNode } from "react"
import { X } from "lucide-react"
import { Button } from "./button"

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
  contentClassName?: string
}

/** Everything that can hold focus inside the dialog, in DOM order. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",")

export function Dialog({ open, onOpenChange, title, children, contentClassName = "" }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => { document.body.style.overflow = "" }
  }, [open])

  useEffect(() => {
    if (!open) return

    // Focus moves into the dialog on open and returns to whatever opened it on
    // close. Without the restore, a keyboard user who dismisses a dialog is
    // dropped at the top of the document and has to tab back to the trigger.
    const panel = panelRef.current
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const initial = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(initial ?? panel)?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false)
        return
      }

      // Tab is kept inside the dialog. A modal that lets focus walk out into the
      // page behind it is not modal to a keyboard or a screen reader.
      if (event.key !== "Tab" || !panel) return

      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      )
      if (items.length === 0) {
        event.preventDefault()
        return
      }

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("keydown", handleKeyDown)
      previouslyFocused?.focus()
    }
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="presentation">
      <div className="absolute inset-0 bg-[var(--color-overlay)] backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div
        ref={panelRef}
        className="relative flex max-h-[92vh] w-full max-w-[96rem] flex-col overflow-hidden rounded-t-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] text-[var(--color-text)] shadow-2xl sm:min-h-[85vh] sm:max-h-[90vh] sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3 sm:px-6 sm:py-4">
          <h2 id={titleId} className="min-w-0 text-base font-semibold text-[var(--color-text)] sm:text-lg">
            {title}
          </h2>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} aria-label="Close dialog">
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto no-scrollbar px-4 py-4 sm:px-6 sm:py-5 ${contentClassName}`}>{children}</div>
      </div>
    </div>
  )
}
