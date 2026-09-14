import { useCallback, useMemo, type ReactNode } from "react"
import { clearToasts, pushToast, removeToast, type ToastOptions } from "./toastStore"

export function useToast() {
  const dismiss = useCallback((id: string) => {
    removeToast(id)
  }, [])

  const dismissAll = useCallback(() => {
    clearToasts()
  }, [])

  const toast = useCallback((options: ToastOptions) => pushToast(options), [])

  return useMemo(
    () => ({
      toast,
      success: (title: string, description?: ReactNode, duration?: number) =>
        pushToast({ title, description, duration, variant: "success" }),
      error: (title: string, description?: ReactNode, duration?: number) =>
        pushToast({ title, description, duration, variant: "error" }),
      dismiss,
      dismissAll,
    }),
    [dismiss, dismissAll, toast]
  )
}
