// @ts-nocheck
// deno-lint-ignore-file
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { buildPreview, collectRecipients } from "./shared.ts"

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    status,
  })
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    const body = await req.json()
    const incidentId = body?.incidentId
    const templateKey = body?.templateKey || "incident_summary"
    const dryRun = Boolean(body?.dryRun)
    const extraRecipients = Array.isArray(body?.extraRecipients) ? body.extraRecipients : []

    if (!incidentId) {
      return jsonResponse({ error: "incidentId is required" }, 400)
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!supabaseUrl || !supabaseKey) {
      return jsonResponse({ error: "Missing Supabase configuration" }, 500)
    }

    const authHeader = req.headers.get("Authorization") ?? ""
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization token" }, 401)
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    })

    const { data: userRes, error: userError } = await supabase.auth.getUser()
    if (userError || !userRes.user) {
      return jsonResponse({ error: "Unable to identify the current user" }, 401)
    }

    const userId = userRes.user.id
    const { data: roleRows, error: roleError } = await supabase
      .from("user_roles")
      .select("role, active, effective_from, effective_to")
      .eq("profile_id", userId)

    if (roleError) {
      return jsonResponse({ error: roleError.message }, 400)
    }

    const activeRoles = (roleRows || [])
      .filter((row) => row.active && (!row.effective_from || new Date(row.effective_from).getTime() <= Date.now()) && (!row.effective_to || new Date(row.effective_to).getTime() >= Date.now()))
      .map((row) => row.role)

    const allowedRoles = new Set(["counsellor", "principal", "deputy_principal", "counsellor_delegate", "leadership_delegate"])
    if (!activeRoles.some((role) => allowedRoles.has(role))) {
      return jsonResponse({ error: "insufficient_privilege" }, 403)
    }

    const { data: incident, error: incidentError } = await supabase.from("incidents").select("*").eq("id", incidentId).single()
    if (incidentError) return jsonResponse({ error: incidentError.message }, 400)

    const [{ data: category, error: categoryError }, { data: taggedLinks, error: taggedError }, { data: followUps, error: followUpsError }] = await Promise.all([
      supabase.from("incident_categories").select("*").eq("id", incident.category_id).single(),
      supabase.from("incident_students").select("*").eq("incident_id", incidentId).order("tagged_at", { ascending: true }),
      supabase.from("incident_follow_ups").select("*").eq("incident_id", incidentId).order("created_at", { ascending: false }),
    ])

    if (categoryError) return jsonResponse({ error: categoryError.message }, 400)
    if (taggedError) return jsonResponse({ error: taggedError.message }, 400)
    if (followUpsError) return jsonResponse({ error: followUpsError.message }, 400)

    const { data: primaryStudent, error: primaryStudentError } = await supabase.from("students").select("*").eq("id", incident.student_id).single()
    if (primaryStudentError) {
      return jsonResponse({ error: primaryStudentError.message }, 400)
    }

    const taggedStudentIds = (taggedLinks || []).map((row) => row.student_id)
    const { data: taggedStudents, error: taggedStudentsError } = taggedStudentIds.length > 0
      ? await supabase.from("students").select("*").in("id", taggedStudentIds)
      : { data: [], error: null }
    if (taggedStudentsError) {
      return jsonResponse({ error: taggedStudentsError.message }, 400)
    }

    const assignee = incident.assigned_to
      ? (await supabase.from("profiles").select("id, email, full_name").eq("id", incident.assigned_to).single()).data
      : null

    const recipients = collectRecipients({
      extraRecipients,
      assigneeEmail: assignee?.email,
      primaryStudentEmail: primaryStudent.email,
      taggedStudentEmails: (taggedStudents || []).map((student) => student.email),
    })

    const preview = buildPreview({
      incident,
      category,
      primaryStudent,
      taggedStudents: taggedStudents || [],
      assignee,
      followUps: followUps || [],
      recipients,
      templateKey,
    })

    if (dryRun) {
      return jsonResponse({
        ok: true,
        previewOnly: true,
        recipients,
        templateKey,
        ...preview,
      }, 200)
    }

    const logPayload = {
      incident_id: incidentId,
      sender_id: userId,
      recipients,
      template_key: templateKey,
      subject: preview.subject,
      merged_payload: {
        incident,
        category,
        primaryStudent,
        taggedStudents: taggedStudents || [],
        assignee,
        followUps: followUps || [],
      },
      status: "queued",
    }

    const { data: logRow, error: logError } = await supabase.from("incident_email_dispatch_log").insert(logPayload).select("id").single()
    if (logError) {
      return jsonResponse({ error: logError.message }, 400)
    }

    const webhookUrl = Deno.env.get("EMAIL_WEBHOOK_URL") || Deno.env.get("EMAIL_SEND_WEBHOOK_URL")
    if (!webhookUrl) {
      await supabase
        .from("incident_email_dispatch_log")
        .update({ status: "failed", error: "Missing EMAIL_WEBHOOK_URL configuration" })
        .eq("id", logRow.id)
      return jsonResponse({ error: "Missing EMAIL_WEBHOOK_URL configuration" }, 500)
    }

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        templateKey,
        recipients,
        subject: preview.subject,
        text: preview.body,
        html: preview.html,
        mergedPayload: logPayload.merged_payload,
      }),
    })

    const responseText = await response.text()
    if (!response.ok) {
      await supabase
        .from("incident_email_dispatch_log")
        .update({ status: "failed", error: responseText || `Webhook failed with status ${response.status}` })
        .eq("id", logRow.id)
      return jsonResponse({ error: responseText || `Webhook failed with status ${response.status}` }, 502)
    }

    let providerMessageId: string | null = null
    try {
      const parsed = JSON.parse(responseText)
      providerMessageId = parsed?.message_id ?? parsed?.messageId ?? parsed?.id ?? null
    } catch {
      providerMessageId = null
    }

    await supabase
      .from("incident_email_dispatch_log")
      .update({
        status: "sent",
        error: null,
        provider_message_id: providerMessageId,
        sent_at: new Date().toISOString(),
      })
      .eq("id", logRow.id)

    return jsonResponse({
      ok: true,
      sent: true,
      recipients,
      templateKey,
      subject: preview.subject,
      providerMessageId,
    }, 200)
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500)
  }
})
