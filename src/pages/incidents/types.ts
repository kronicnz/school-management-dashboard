export type RetentionRow = {
  incident_id: string
  category_id: string
  severity: string
  archive_due_at: string
  dispose_due_at: string
  should_archive: boolean
  should_dispose: boolean
}

export type DetailDraft = {
  status: string
  severity: string
  visibility: "standard" | "sensitive"
  assigned_to: string
  description: string
  resolution_summary: string
  action_taken: string
  sensitivity_review_requested: boolean
  tagged_student_ids: string[]
}

export type CreateDraft = {
  student_id: string
  category_id: string
  occurred_at: string
  severity: string
  status: string
  visibility: "standard" | "sensitive"
  assigned_to: string
  description: string
  action_taken: string
  resolution_summary: string
  tagged_student_ids: string[]
  follow_up_notes: string
  follow_up_due_at: string
  follow_up_next_action: string
}

export type EmailPreview = {
  subject: string
  body: string
  html: string
  recipients: string[]
}
