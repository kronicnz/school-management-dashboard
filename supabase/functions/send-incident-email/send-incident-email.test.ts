declare const Deno: any;

import { strict as assert } from "node:assert"
import { buildPreview, collectRecipients, escapeHtml } from "./shared.ts"

Deno.test("escapeHtml sanitizes html characters", () => {
  assert.equal(escapeHtml(`<script>alert('x')</script> & "test"`), "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;test&quot;")
})

Deno.test("buildPreview escapes content in html output", () => {
  const preview = buildPreview({
    incident: {
      id: "inc_1",
      severity: "high",
      status: "open",
      visibility: "standard",
      occurred_at: "2026-09-11T00:00:00.000Z",
      reported_at: "2026-09-11T01:00:00.000Z",
      description: `<script>alert('x')</script>`,
      action_taken: "Line 1\nLine 2",
      resolution_summary: "Resolved",
    },
    category: { name: "Behaviour" },
    primaryStudent: { first_name: "Sam", last_name: "Taylor", email: "sam@example.com" },
    taggedStudents: [{ first_name: "Tina", last_name: "Ng", email: "tina@example.com" }],
    assignee: { full_name: "Counsellor One", email: "counsellor@example.com" },
    followUps: [{ status: "open", notes: "Follow up note" }],
    recipients: ["sam@example.com"],
    templateKey: "incident_summary",
  })

  assert.ok(preview.html.includes("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;"))
  assert.ok(!preview.html.includes("<script>"))
  assert.ok(preview.body.includes("Line 1"))
})

Deno.test("collectRecipients filters and dedupes email addresses", () => {
  const recipients = collectRecipients({
    extraRecipients: ["Other@Example.com", "invalid", "other@example.com"],
    assigneeEmail: "Counsellor@example.com",
    primaryStudentEmail: "student@example.com",
    taggedStudentEmails: ["tagged@example.com", "student@example.com", null],
  })

  assert.deepEqual(recipients, [
    "other@example.com",
    "counsellor@example.com",
    "student@example.com",
    "tagged@example.com",
  ])
})
