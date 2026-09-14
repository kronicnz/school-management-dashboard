export function normalizeOrgUnitPath(targetOrgPath: string) {
  const trimmed = targetOrgPath.trim()
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return withLeadingSlash.toLowerCase().replace(/\/+$/, "")
}

export function matchesOrgUnitPath(userOrgPath: string | null | undefined, targetOrgPath: string) {
  const normalizedTarget = normalizeOrgUnitPath(targetOrgPath)
  const normalizedUser = (userOrgPath || "").trim().toLowerCase().replace(/\/+$/, "")
  return normalizedUser === normalizedTarget || normalizedUser.startsWith(`${normalizedTarget}/`)
}

export function dedupeById<T extends { id: string }>(records: T[]) {
  return Array.from(new Map(records.map((record) => [record.id, record] as const)).values())
}
