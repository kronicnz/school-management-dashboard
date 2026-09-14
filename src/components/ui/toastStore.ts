import type { ReactNode } from "react"

export type ToastVariant = "success" | "error"

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

const DEFAULT_DURATION = 4500
const MAX_TOASTS = 5

let currentToasts: ToastItem[] = []
const listeners = new Set<() => void>()
const timers = new Map<string, number>()

function emitChange() {
  for (const listener of listeners) {
    listener()
  }
}

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getSnapshot() {
  return currentToasts
}

function clearTimer(id: string) {
  const timer = timers.get(id)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    timers.delete(id)
  }
}

export function removeToast(id: string) {
  clearTimer(id)
  const next = currentToasts.filter((toast) => toast.id !== id)
  if (next.length === currentToasts.length) return
  currentToasts = next
  emitChange()
}

export function pushToast(options: ToastOptions) {
  const id = crypto.randomUUID()
  const item: ToastItem = {
    id,
    title: options.title,
    description: options.description,
    variant: options.variant ?? "success",
  }

  currentToasts = [item, ...currentToasts].slice(0, MAX_TOASTS)
  emitChange()

  const timer = window.setTimeout(() => {
    removeToast(id)
  }, options.duration ?? DEFAULT_DURATION)

  timers.set(id, timer)
  return id
}

export function clearToasts() {
  for (const timer of timers.values()) {
    window.clearTimeout(timer)
  }
  timers.clear()
  currentToasts = []
  emitChange()
}
