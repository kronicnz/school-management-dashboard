export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === "string" && error.trim()) return error

  if (error && typeof error === "object") {
    const maybeMessage = "message" in error ? (error as { message?: unknown }).message : undefined
    if (typeof maybeMessage === "string" && maybeMessage.trim()) return maybeMessage

    const details = "details" in error ? (error as { details?: unknown }).details : undefined
    const hint = "hint" in error ? (error as { hint?: unknown }).hint : undefined
    const parts = [details, hint].filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    if (parts.length > 0) return parts.join(" | ")
  }

  return "Unknown error"
}
