import { useEffect } from "react"
import { X } from "lucide-react"
import { Button } from "./button"

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
  contentClassName?: string
}

export function Dialog({ open, onOpenChange, title, children, contentClassName = "" }: DialogProps) {
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

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-[var(--color-overlay)] backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div
        className={`relative w-full max-w-[96rem] min-h-[85vh] max-h-[90vh] overflow-y-auto no-scrollbar rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6 text-[var(--color-text)] shadow-2xl sm:p-8 ${contentClassName}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-[var(--color-text)]">{title}</h2>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            <X className="size-4" />
          </Button>
        </div>
        {children}
      </div>
    </div>
  )
}
