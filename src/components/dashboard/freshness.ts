import type { TableBadgeTone } from "../ui/TableBadge"

/** A snapshot older than this is surfaced as stale rather than presented as current. */
const STALE_AFTER_MS = 5 * 60 * 1000

export function freshnessFrom(lastUpdated: Date | null | undefined, now: Date) {
  if (!lastUpdated) return { label: "Last updated: unknown", tone: "slate" as TableBadgeTone, stale: true }

  const ageMs = now.getTime() - lastUpdated.getTime()
  const minutes = Math.max(0, Math.round(ageMs / 60000))
  const stale = ageMs > STALE_AFTER_MS

  const relative =
    minutes < 1
      ? "less than a minute ago"
      : minutes === 1
        ? "1 minute ago"
        : minutes < 60
          ? `${minutes} minutes ago`
          : minutes === 60
            ? "1 hour ago"
            : `${Math.round(minutes / 60)} hours ago`

  return {
    label: `Last updated ${relative}`,
    tone: stale ? ("amber" as TableBadgeTone) : ("slate" as TableBadgeTone),
    stale,
  }
}
