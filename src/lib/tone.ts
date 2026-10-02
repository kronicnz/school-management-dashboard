import type { TableBadgeTone } from "../components/ui/TableBadge"

/** A signed delta reads as a movement, so the sign decides the colour. */
export function toneForDelta(delta?: string): TableBadgeTone {
  if (!delta) return "slate"
  if (delta.startsWith("+")) return "emerald"
  if (delta.startsWith("-")) return "cyan"
  return "slate"
}

/**
 * Slate is the neutral tone and disappears against a muted surface, so activity rows
 * promote it to indigo before it is rendered on a coloured disc.
 */
export function toneForActivity(tone: TableBadgeTone): TableBadgeTone {
  return tone === "slate" ? "indigo" : tone
}
