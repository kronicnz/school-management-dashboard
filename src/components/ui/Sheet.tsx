import { createPortal } from "react-dom"
import { useEffect } from "react"
import { X } from "lucide-react"
import { cn } from "../../utils/cn"
import { Button } from "./button"

type SheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  side?: "left" | "right"
  ariaLabel: string
  children: React.ReactNode
  className?: string
  panelClassName?: string
  overlayClassName?: string
  showCloseButton?: boolean
}

export function Sheet({
  open,
  onOpenChange,
  side = "right",
  ariaLabel,
  children,
  className,
  panelClassName,
  overlayClassName,
  showCloseButton = true,
}: SheetProps) {
  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [open, onOpenChange])

  if (!open || typeof document === "undefined") return null

  return createPortal(
    <div className={cn("fixed inset-0 z-50 md:hidden", className)}>
      <button
        type="button"
        className={cn(
          "absolute inset-0 bg-[color-mix(in_srgb,var(--color-foreground)_55%,transparent)] transition-opacity",
          overlayClassName
        )}
        onClick={() => onOpenChange(false)}
        aria-label="Close navigation"
      />

      <section
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className={cn(
          "relative flex h-full w-[min(86vw,20rem)] flex-col border-[var(--color-border)] bg-[var(--color-card-elevated)] shadow-2xl transition-transform duration-200",
          side === "left"
            ? "border-r"
            : "ml-auto border-l",
          side === "left" ? "translate-x-0" : "translate-x-0",
          panelClassName
        )}
      >
        {showCloseButton ? (
          <div className="flex items-start justify-end border-b border-[var(--color-border)] px-4 py-3">
            <Button variant="ghost" size="sm" className="h-10 w-10 px-0" onClick={() => onOpenChange(false)} aria-label="Close navigation">
              <X className="size-4" />
            </Button>
          </div>
        ) : null}
        {children}
      </section>
    </div>,
    document.body
  )
}
