export const leadershipRoles = ["counsellor", "principal", "deputy_principal", "counsellor_delegate", "leadership_delegate"]

export function formatDate(value: string | null | undefined) {
  if (!value) return "-"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

export function csvEscape(value: unknown) {
  const text = String(value ?? "")
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll("\"", "\"\"")}"`
  }
  return text
}

export function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

export function severityBadgeTone(severity: string): "emerald" | "cyan" | "amber" | "rose" {
  switch (severity?.toLowerCase()) {
    case "critical":
      return "rose"
    case "high":
      return "amber"
    case "medium":
      return "cyan"
    case "low":
    default:
      return "emerald"
  }
}

export function visibilityBadgeTone(visibility: string): "rose" | "cyan" {
  return visibility === "sensitive" ? "rose" : "cyan"
}
