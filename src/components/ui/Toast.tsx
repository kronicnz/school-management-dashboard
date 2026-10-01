import { useSyncExternalStore, type ReactNode } from "react"
import { AlertCircle, AlertTriangle, CheckCircle2, X } from "lucide-react"
import { cn } from "../../utils/cn"
import { getSnapshot, removeToast, subscribe, type ToastVariant } from "./toastStore"

function getVariantStyles(variant: ToastVariant) {
  if (variant === "success") {
    return {
      wrapper: "border-emerald-400/20 bg-emerald-500/10 text-emerald-50 shadow-2xl shadow-emerald-950/30",
      icon: "text-emerald-300",
      accent: "bg-emerald-400",
    }
  }

  // A partial result is neither a success nor a failure, so it gets its own treatment
  // instead of being reported with the wrong tone.
  if (variant === "warning") {
    return {
      wrapper: "border-amber-400/20 bg-amber-500/10 text-amber-50 shadow-2xl shadow-amber-950/30",
      icon: "text-amber-300",
      accent: "bg-amber-400",
    }
  }

  return {
    wrapper: "border-rose-400/20 bg-rose-500/10 text-rose-50 shadow-2xl shadow-rose-950/30",
    icon: "text-rose-300",
    accent: "bg-rose-400",
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return <>{children}</>
}

export function ToastViewport() {
  const toasts = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[9999] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 sm:right-6 sm:top-6">
      {toasts.map((toast) => {
        const styles = getVariantStyles(toast.variant)
        const Icon = toast.variant === "success" ? CheckCircle2 : toast.variant === "warning" ? AlertTriangle : AlertCircle

        return (
          <div
            key={toast.id}
            role={toast.variant === "error" ? "alert" : "status"}
            aria-live={toast.variant === "error" ? "assertive" : "polite"}
            className={cn(
              "pointer-events-auto relative overflow-hidden rounded-xl border px-4 py-3 backdrop-blur-md transition-all duration-200 ease-out",
              styles.wrapper
            )}
          >
            <div className={cn("absolute left-0 top-0 h-full w-1", styles.accent)} />
            <div className="flex items-start gap-3 pl-1 pr-7">
              <Icon className={cn("mt-0.5 size-5 shrink-0", styles.icon)} />
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm font-semibold leading-tight text-inherit">{toast.title}</p>
                {toast.description && <div className="text-sm leading-snug text-inherit/90">{toast.description}</div>}
              </div>
            </div>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="absolute right-2 top-2 rounded-md p-1 text-inherit/70 transition hover:bg-white/10 hover:text-inherit"
              aria-label="Dismiss notification"
            >
              <X className="size-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
