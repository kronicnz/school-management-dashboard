/**
 * Flattens whatever a rejected request carried into something a person can act on.
 *
 * Supabase and the edge functions surface upstream failures as a bare `{}` on some
 * paths, which stringifies to "[object Object]" and tells the user nothing. Each branch
 * peels one more layer so the toast names the actual server message.
 */
export function extractErrorMessage(value: unknown): string {
  if (!value) return "An unknown error occurred"

  if (typeof value === "string") {
    if (value === "[object Object]") return "An unknown server error occurred"
    return value
  }

  if (value instanceof Error) {
    if (value.message && value.message !== "[object Object]") {
      return value.message
    }
    if ("cause" in value && value.cause) {
      return extractErrorMessage(value.cause)
    }
    const record = value as unknown as Record<string, unknown>
    if (record.details) return extractErrorMessage(record.details)
    if (record.error) return extractErrorMessage(record.error)
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>

    if (typeof record.message === "string" && record.message.trim()) return record.message.trim()
    if (typeof record.error === "string" && record.error.trim()) return record.error.trim()
    if (typeof record.details === "string" && record.details.trim()) return record.details.trim()
    if (typeof record.hint === "string" && record.hint.trim()) return record.hint.trim()

    if (record.error) {
      const nested = extractErrorMessage(record.error)
      if (nested && nested !== "An unknown error occurred") return nested
    }
    if (record.message) {
      const nested = extractErrorMessage(record.message)
      if (nested && nested !== "An unknown error occurred") return nested
    }
    if (record.details) {
      const nested = extractErrorMessage(record.details)
      if (nested && nested !== "An unknown error occurred") return nested
    }

    try {
      const json = JSON.stringify(value)
      if (json && json !== "{}") return json
    } catch {
      // ignore
    }

    const entries = Object.entries(record).slice(0, 6)
    if (entries.length > 0) {
      return entries
        .map(([key, val]) => `${key}=${typeof val === "object" ? extractErrorMessage(val) : String(val)}`)
        .join("; ")
    }
  }

  return String(value)
}
