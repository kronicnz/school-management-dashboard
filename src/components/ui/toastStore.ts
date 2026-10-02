import type { ReactNode } from "react"

export type ToastVariant = "success" | "error" | "warning"

export interface ToastOptions {
  title: string
  description?: ReactNode
  variant?: ToastVariant
  duration?: number
}

interface ToastItem extends Required<Pick<ToastOptions, "title">> {
  id: string
  description?: ReactNode
  variant: ToastVariant
}

interface ToastStoreState {
  currentToasts: ToastItem[]
  listeners: Set<() => void>
  timers: Map<string, number>
}

const DEFAULT_DURATION = 4500
const MAX_TOASTS = 5

const store = ((globalThis as typeof globalThis & { __schoolManagementToastStore?: ToastStoreState }).__schoolManagementToastStore ??= {
  currentToasts: [],
  listeners: new Set<() => void>(),
  timers: new Map<string, number>(),
})

let toastSequence = 0

function createToastId() {
  toastSequence += 1
  return `toast-${Date.now()}-${toastSequence}-${Math.random().toString(36).slice(2, 8)}`
}

function emitChange() {
  for (const listener of store.listeners) {
    listener()
  }
}

export function subscribe(listener: () => void) {
  store.listeners.add(listener)
  return () => store.listeners.delete(listener)
}

export function getSnapshot() {
  return store.currentToasts
}

function clearTimer(id: string) {
  const timer = store.timers.get(id)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    store.timers.delete(id)
  }
}

export function removeToast(id: string) {
  clearTimer(id)
  const next = store.currentToasts.filter((toast) => toast.id !== id)
  if (next.length === store.currentToasts.length) return
  store.currentToasts = next
  emitChange()
}

export function pushToast(options: ToastOptions) {
  const id = createToastId()
  const item: ToastItem = {
    id,
    title: options.title,
    description: options.description,
    variant: options.variant ?? "success",
  }

  store.currentToasts = [item, ...store.currentToasts].slice(0, MAX_TOASTS)
  emitChange()

  const timer = window.setTimeout(() => {
    removeToast(id)
  }, options.duration ?? DEFAULT_DURATION)

  store.timers.set(id, timer)
  return id
}

export function clearToasts() {
  for (const timer of store.timers.values()) {
    window.clearTimeout(timer)
  }
  store.timers.clear()
  store.currentToasts = []
  emitChange()
}
