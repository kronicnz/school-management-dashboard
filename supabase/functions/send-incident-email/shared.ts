export function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

export function toIsoText(value: string | null | undefined) {
  if (!value) return "-"
  return new Date(value).toLocaleString()
}

export type IncidentEmailPreviewPayload = {
  incident: any
  category: any
  primaryStudent: any
  taggedStudents: any[]
  assignee: any
  followUps: any[]
  recipients: string[]
  templateKey: string
}

export function buildPreview(payload: IncidentEmailPreviewPayload) {
  const incident = payload.incident
  const category = payload.category
  const primaryStudent = payload.primaryStudent
  const subject = `[Behaviour] ${category?.name ?? "Incident"} - ${primaryStudent?.first_name ?? "Student"} ${primaryStudent?.last_name ?? ""}`.trim()
  const taggedLines = payload.taggedStudents.length > 0
    ? payload.taggedStudents.map((student) => `- ${student.first_name} ${student.last_name}${student.email ? ` <${student.email}>` : ""}`).join("\n")
    : "- None"
  const followUpLines = payload.followUps.length > 0
    ? payload.followUps.map((followUp) => `- ${followUp.status}: ${followUp.notes}`).join("\n")
    : "- None"

  const body = [
    `Incident: ${incident.id}`,
    `Primary student: ${primaryStudent.first_name} ${primaryStudent.last_name}${primaryStudent.email ? ` <${primaryStudent.email}>` : ""}`,
    `Category: ${category?.name ?? "Unknown"}`,
    `Severity: ${incident.severity}`,
    `Status: ${incident.status}`,
    `Visibility: ${incident.visibility}`,
    `Occurred at: ${toIsoText(incident.occurred_at)}`,
    `Reported at: ${toIsoText(incident.reported_at)}`,
    `Assignee: ${payload.assignee?.full_name ?? payload.assignee?.email ?? "Unassigned"}`,
    "",
    "Tagged students:",
    taggedLines,
    "",
    "Recent follow-ups:",
    followUpLines,
    "",
    "Description:",
    incident.description,
    "",
    "Action taken:",
    incident.action_taken ?? "-",
    "",
    "Resolution summary:",
    incident.resolution_summary ?? "-",
  ].join("\n")

  const html = `
    <div style="font-family: sans-serif; color: #111827; line-height: 1.5;">
      <h2 style="margin: 0 0 12px;">${escapeHtml(subject)}</h2>
      <p><strong>Primary student:</strong> ${escapeHtml(primaryStudent.first_name)} ${escapeHtml(primaryStudent.last_name)}${primaryStudent.email ? ` &lt;${escapeHtml(primaryStudent.email)}&gt;` : ""}</p>
      <p><strong>Category:</strong> ${escapeHtml(category?.name ?? "Unknown")}</p>
      <p><strong>Severity:</strong> ${escapeHtml(incident.severity)}</p>
      <p><strong>Status:</strong> ${escapeHtml(incident.status)}</p>
      <p><strong>Visibility:</strong> ${escapeHtml(incident.visibility)}</p>
      <p><strong>Assignee:</strong> ${escapeHtml(payload.assignee?.full_name ?? payload.assignee?.email ?? "Unassigned")}</p>
      <p><strong>Tagged students:</strong><br/>${escapeHtml(taggedLines).replaceAll("\n", "<br/>")}</p>
      <p><strong>Follow-ups:</strong><br/>${escapeHtml(followUpLines).replaceAll("\n", "<br/>")}</p>
      <p><strong>Description:</strong><br/>${escapeHtml(incident.description).replaceAll("\n", "<br/>")}</p>
      <p><strong>Action taken:</strong><br/>${escapeHtml(incident.action_taken ?? "-").replaceAll("\n", "<br/>")}</p>
      <p><strong>Resolution summary:</strong><br/>${escapeHtml(incident.resolution_summary ?? "-").replaceAll("\n", "<br/>")}</p>
    </div>
  `

  return { subject, body, html }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeEmail(value: unknown) {
  const text = String(value ?? "").trim()
  if (!text || !EMAIL_PATTERN.test(text)) return null
  return text.toLowerCase()
}

export function collectRecipients(options: {
  extraRecipients: unknown[]
  assigneeEmail?: unknown
  primaryStudentEmail?: unknown
  taggedStudentEmails?: unknown[]
}) {
  const recipients = [
    ...options.extraRecipients,
    options.assigneeEmail,
    options.primaryStudentEmail,
    ...(options.taggedStudentEmails ?? []),
  ]
    .map(normalizeEmail)
    .filter((value): value is string => Boolean(value))

  return Array.from(new Set(recipients))
}
