import { forwardRef, useCallback, useEffect, useMemo, useState, type FormEvent, type TextareaHTMLAttributes } from "react"
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Copy,
  FileDown,
  FileJson,
  Mail,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Undo2,
  Users,
  MessageSquare,
  X,
  AlertTriangle,
  UserPlus,
  Search,
  FileText,
  History,
  Send,
  Save,
} from "lucide-react"
import {
  createIncident,
  createIncidentComment,
  createIncidentFollowUp,
  fetchIncidentAssignees,
  fetchIncidentAuditLog,
  fetchIncidentCategories,
  fetchIncidentComments,
  fetchIncidentEmailDispatchLog,
  fetchIncidentFollowUps,
  fetchIncidentManagementReport,
  fetchIncidentStudents,
  fetchIncidents,
  fetchRetentionDueReport,
  fetchStudents,
  replaceIncidentStudents,
  restoreIncident,
  sendIncidentMergedEmail,
  setIncidentVisibility,
  softDeleteIncident,
  updateIncident,
  updateIncidentFollowUp,
} from "../lib/api/supabaseApi"
import type {
  Incident,
  IncidentCategory,
  IncidentComment,
  IncidentEmailDispatchLog,
  IncidentFollowUp,
  IncidentInsert,
  IncidentManagementReport,
  IncidentStudent,
  Profile,
  Student,
} from "../lib/api/database.types"
import { useAuth } from "../context/useAuth"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card"
import { Button } from "../components/ui/button"
import { Dialog } from "../components/ui/Dialog"
import { FormField } from "../components/ui/FormField"
import { Input } from "../components/ui/Input"
import { Select } from "../components/ui/Select"
import { DataTable } from "../components/ui/DataTable"
import { StatisticCard, StatisticGrid } from "../components/ui/StatisticCard"
import { TableAvatar } from "../components/ui/TableAvatar"
import { TableBadge } from "../components/ui/TableBadge"
import { useToast } from "../components/ui/useToast"
import { getErrorMessage } from "../utils/getErrorMessage"
import type { CreateDraft, DetailDraft, EmailPreview, RetentionRow } from "./incidents/types"
import { csvEscape, downloadTextFile, formatDate, leadershipRoles, severityBadgeTone, visibilityBadgeTone } from "./incidents/utils"

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className = "", ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      className={`w-full rounded-md border border-white/15 bg-slate-900/70 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500 transition-colors no-scrollbar ${className}`}
      {...props}
    />
  )
})
Textarea.displayName = "Textarea"

export default function IncidentsPage() {
  const toast = useToast()
  const { user } = useAuth()
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [categories, setCategories] = useState<IncidentCategory[]>([])
  const [assignees, setAssignees] = useState<Array<Profile & { roles: string[] }>>([])
  const [incidentStudents, setIncidentStudents] = useState<IncidentStudent[]>([])
  const [incidentFollowUps, setIncidentFollowUps] = useState<IncidentFollowUp[]>([])
  const [comments, setComments] = useState<IncidentComment[]>([])
  const [auditLog, setAuditLog] = useState<any[]>([])
  const [emailLogs, setEmailLogs] = useState<IncidentEmailDispatchLog[]>([])
  const [report, setReport] = useState<IncidentManagementReport | null>(null)
  const [retentionRows, setRetentionRows] = useState<RetentionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [visibilityFilter, setVisibilityFilter] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null)
  const [detailDraft, setDetailDraft] = useState<DetailDraft | null>(null)
  const [detailActiveTab, setDetailActiveTab] = useState<"details" | "activity" | "communication">("details")
  const [commentDraft, setCommentDraft] = useState("")
  const [followUpDraft, setFollowUpDraft] = useState({ notes: "", due_at: "", next_action: "" })
  const [emailTemplateKey, setEmailTemplateKey] = useState("incident_summary")
  const [emailExtraRecipients, setEmailExtraRecipients] = useState("")
  const [emailPreview, setEmailPreview] = useState<EmailPreview | null>(null)
  const [createForm, setCreateForm] = useState<CreateDraft>({
    student_id: "",
    category_id: "",
    occurred_at: new Date().toISOString().slice(0, 16),
    severity: "low",
    status: "open",
    visibility: "standard",
    assigned_to: "",
    description: "",
    action_taken: "",
    resolution_summary: "",
    tagged_student_ids: [],
    follow_up_notes: "",
    follow_up_due_at: "",
    follow_up_next_action: "",
  })

  const isTeacherOnly = user?.roles.includes("teacher") && !user?.roles.some((role) => leadershipRoles.includes(role))
  const canManageSensitive = Boolean(user?.roles.some((role) => leadershipRoles.includes(role)))

  const studentNameMap = useMemo(() => {
    const map = new Map<string, string>()
    students.forEach((student) => {
      map.set(student.id, `${student.first_name} ${student.last_name}`)
    })
    return map
  }, [students])

  const studentEmailMap = useMemo(() => {
    const map = new Map<string, string | null>()
    students.forEach((student) => {
      map.set(student.id, student.email)
    })
    return map
  }, [students])

  const categoryNameMap = useMemo(() => {
    const map = new Map<string, string>()
    categories.forEach((category) => {
      map.set(category.id, category.name)
    })
    return map
  }, [categories])

  const assigneeNameMap = useMemo(() => {
    const map = new Map<string, string>()
    assignees.forEach((assignee) => {
      map.set(assignee.id, assignee.full_name ?? assignee.email)
    })
    return map
  }, [assignees])

  const assigneeEmailMap = useMemo(() => {
    const map = new Map<string, string | null>()
    assignees.forEach((assignee) => {
      map.set(assignee.id, assignee.email)
    })
    return map
  }, [assignees])

  const incidentStudentsByIncident = useMemo(() => {
    const map = new Map<string, IncidentStudent[]>()
    incidentStudents.forEach((row) => {
      const rows = map.get(row.incident_id) ?? []
      rows.push(row)
      map.set(row.incident_id, rows)
    })
    return map
  }, [incidentStudents])

  const incidentFollowUpsByIncident = useMemo(() => {
    const map = new Map<string, IncidentFollowUp[]>()
    incidentFollowUps.forEach((row) => {
      const rows = map.get(row.incident_id) ?? []
      rows.push(row)
      map.set(row.incident_id, rows)
    })
    return map
  }, [incidentFollowUps])

  const filteredIncidents = useMemo(() => {
    return incidents.filter((incident) => {
      const studentName = studentNameMap.get(incident.student_id) ?? ""
      const categoryName = categoryNameMap.get(incident.category_id) ?? ""
      const assigneeName = assigneeNameMap.get(incident.assigned_to ?? "") ?? ""
      const taggedStudents = incidentStudentsByIncident.get(incident.id) ?? []
      const taggedNames = taggedStudents.map((tagged) => studentNameMap.get(tagged.student_id) ?? "").join(" ")

      const matchesSearch =
        !search ||
        [
          studentName,
          categoryName,
          assigneeName,
          incident.description,
          incident.action_taken ?? "",
          incident.resolution_summary ?? "",
          taggedNames,
        ]
          .join(" ")
          .toLowerCase()
          .includes(search.toLowerCase())

      const matchesStatus = !statusFilter || incident.status === statusFilter
      const matchesVisibility = !visibilityFilter || incident.visibility === visibilityFilter
      return matchesSearch && matchesStatus && matchesVisibility
    })
  }, [assigneeNameMap, categoryNameMap, incidentStudentsByIncident, incidents, search, statusFilter, studentNameMap, visibilityFilter])

  const openIncident = useMemo(
    () => incidents.filter((incident) => !incident.is_deleted && incident.status !== "closed").length,
    [incidents]
  )
  const totalIncidents = report?.total_count ?? incidents.length
  const inReviewCount = useMemo(() => incidents.filter((incident) => incident.status === "in_review").length, [incidents])
  const resolvedCount = useMemo(() => incidents.filter((incident) => incident.status === "resolved").length, [incidents])
  const closedCount = report?.closed_count ?? incidents.filter((incident) => incident.status === "closed").length
  const currentTime = useMemo(() => Number(new Date()), [])
  const overdueFollowUpCount = useMemo(
    () => incidentFollowUps.filter((followUp) => followUp.due_at && followUp.status !== "done" && new Date(followUp.due_at).getTime() < currentTime).length,
    [currentTime, incidentFollowUps]
  )

  const selectedIncident = useMemo(
    () => incidents.find((incident) => incident.id === selectedIncidentId) ?? null,
    [incidents, selectedIncidentId]
  )

  function resetIncidentDetailState() {
    setComments([])
    setAuditLog([])
    setEmailLogs([])
    setEmailPreview(null)
    setDetailDraft(null)
    setDetailActiveTab("details")
  }

  function openIncidentDetails(incidentId: string) {
    setSelectedIncidentId(incidentId)
    resetIncidentDetailState()
  }

  function closeIncidentDetails() {
    setSelectedIncidentId(null)
    resetIncidentDetailState()
  }

  const selectedIncidentTags = useMemo(() => {
    if (!selectedIncidentId) return []
    return incidentStudentsByIncident.get(selectedIncidentId) ?? []
  }, [incidentStudentsByIncident, selectedIncidentId])

  const selectedIncidentFollowUps = useMemo(() => {
    if (!selectedIncidentId) return []
    return incidentFollowUpsByIncident.get(selectedIncidentId) ?? []
  }, [incidentFollowUpsByIncident, selectedIncidentId])

  const selectedIncidentAssigneeName = selectedIncident ? assigneeNameMap.get(selectedIncident.assigned_to ?? "") ?? "Unassigned" : "Unassigned"

  const selectedIncidentRecipientEmails = useMemo(() => {
    if (!selectedIncident) return []
    const emails = [
      studentEmailMap.get(selectedIncident.student_id),
      ...(selectedIncidentTags || []).map((tagged) => studentEmailMap.get(tagged.student_id) ?? null),
      ...(selectedIncident.assigned_to ? [assigneeEmailMap.get(selectedIncident.assigned_to) ?? null] : []),
    ]
      .flat()
      .filter((value): value is string => Boolean(value))

    return Array.from(new Set(emails))
  }, [assigneeEmailMap, selectedIncident, selectedIncidentTags, studentEmailMap])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [incidentRows, studentRows, categoryRows, assigneeRows, taggedRows, followUpRows, reportRow, retentionDueRows] = await Promise.all([
        fetchIncidents(),
        fetchStudents(),
        fetchIncidentCategories(),
        fetchIncidentAssignees().catch(() => []),
        fetchIncidentStudents().catch(() => []),
        fetchIncidentFollowUps().catch(() => []),
        fetchIncidentManagementReport().catch(() => null),
        fetchRetentionDueReport().catch(() => []),
      ])

      setIncidents(incidentRows)
      setStudents(studentRows)
      setCategories(categoryRows)
      setAssignees(assigneeRows)
      setIncidentStudents(taggedRows)
      setIncidentFollowUps(followUpRows)
      setReport(reportRow)
      setRetentionRows(retentionDueRows)
    } catch (error) {
      toast.error("Failed to load incidents", getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [toast])

  const loadDetailData = useCallback(async (incidentId: string) => {
    try {
      setDetailLoading(true)
      const [commentRows, auditRows, emailRows] = await Promise.all([
        fetchIncidentComments(incidentId).catch(() => []),
        fetchIncidentAuditLog(incidentId).catch(() => []),
        fetchIncidentEmailDispatchLog(incidentId).catch(() => []),
      ])
      setComments(commentRows)
      setAuditLog(auditRows)
      setEmailLogs(emailRows)
    } catch (error) {
      toast.error("Failed to load incident details", getErrorMessage(error))
    } finally {
      setDetailLoading(false)
    }
  }, [toast])

  useEffect(() => {
    queueMicrotask(() => {
      void loadData()
    })
  }, [loadData])

  useEffect(() => {
    if (!selectedIncidentId) return

    queueMicrotask(() => {
      void loadDetailData(selectedIncidentId)
    })
  }, [loadDetailData, selectedIncidentId])

  useEffect(() => {
    if (!selectedIncident) {
      queueMicrotask(() => {
        setDetailDraft(null)
      })
      return
    }

    queueMicrotask(() => {
      setDetailDraft({
        status: selectedIncident.status,
        severity: selectedIncident.severity,
        visibility: selectedIncident.visibility as "standard" | "sensitive",
        assigned_to: selectedIncident.assigned_to ?? "",
        description: selectedIncident.description,
        resolution_summary: selectedIncident.resolution_summary ?? "",
        action_taken: selectedIncident.action_taken ?? "",
        sensitivity_review_requested: selectedIncident.sensitivity_review_requested,
        tagged_student_ids: selectedIncidentTags.map((row) => row.student_id),
      })
    })
  }, [selectedIncident, selectedIncidentTags])

  function handleAddTaggedStudentToCreate(studentId: string) {
    if (!studentId) return
    if (!createForm.tagged_student_ids.includes(studentId)) {
      setCreateForm((prev) => ({
        ...prev,
        tagged_student_ids: [...prev.tagged_student_ids, studentId],
      }))
    }
  }

  function handleRemoveTaggedStudentFromCreate(studentId: string) {
    setCreateForm((prev) => ({
      ...prev,
      tagged_student_ids: prev.tagged_student_ids.filter((id) => id !== studentId),
    }))
  }

  function handleAddTaggedStudentToDetail(studentId: string) {
    if (!studentId || !detailDraft) return
    if (!detailDraft.tagged_student_ids.includes(studentId)) {
      setDetailDraft((prev) =>
        prev
          ? {
              ...prev,
              tagged_student_ids: [...prev.tagged_student_ids, studentId],
            }
          : null
      )
    }
  }

  function handleRemoveTaggedStudentFromDetail(studentId: string) {
    if (!detailDraft) return
    setDetailDraft((prev) =>
      prev
        ? {
            ...prev,
            tagged_student_ids: prev.tagged_student_ids.filter((id) => id !== studentId),
          }
        : null
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!user?.id) {
      toast.error("Cannot create incident", "You must be signed in to create incidents.")
      return
    }

    if (!user.roles || user.roles.length === 0) {
      toast.error(
        "Cannot create incident",
        "No incident role is assigned to your account. Ask leadership to add your role before creating incidents."
      )
      return
    }

    const payload: IncidentInsert = {
      student_id: createForm.student_id,
      category_id: createForm.category_id,
      created_by: user.id,
      occurred_at: new Date(createForm.occurred_at).toISOString(),
      severity: createForm.severity,
      status: createForm.status,
      visibility: isTeacherOnly ? "standard" : createForm.visibility,
      assigned_to: canManageSensitive ? createForm.assigned_to || null : null,
      description: createForm.description,
      action_taken: createForm.action_taken || null,
      resolution_summary: createForm.resolution_summary || null,
    }

    try {
      const incident = await createIncident(payload)

      if (createForm.tagged_student_ids.length > 0) {
        await replaceIncidentStudents(incident.id, createForm.tagged_student_ids)
      }

      if (canManageSensitive && createForm.follow_up_notes.trim()) {
        await createIncidentFollowUp({
          incident_id: incident.id,
          author_id: user.id,
          assigned_to: createForm.assigned_to || null,
          due_at: createForm.follow_up_due_at ? new Date(createForm.follow_up_due_at).toISOString() : null,
          status: "open",
          notes: createForm.follow_up_notes.trim(),
          next_action: createForm.follow_up_next_action.trim() || null,
          visibility: isTeacherOnly ? "standard" : createForm.visibility,
        })
      }

      toast.success("Incident created", `Incident ${incident.id} was created successfully.`)
      setShowForm(false)
      setCreateForm({
        student_id: "",
        category_id: "",
        occurred_at: new Date().toISOString().slice(0, 16),
        severity: "low",
        status: "open",
        visibility: "standard",
        assigned_to: "",
        description: "",
        action_taken: "",
        resolution_summary: "",
        tagged_student_ids: [],
        follow_up_notes: "",
        follow_up_due_at: "",
        follow_up_next_action: "",
      })
      await loadData()
    } catch (error) {
      toast.error("Failed to create incident", getErrorMessage(error))
    }
  }

  async function handleSaveDetail() {
    if (!selectedIncident || !detailDraft) return
    try {
      await updateIncident(selectedIncident.id, {
        status: detailDraft.status,
        severity: detailDraft.severity,
        visibility: canManageSensitive ? detailDraft.visibility : selectedIncident.visibility,
        assigned_to: canManageSensitive ? detailDraft.assigned_to || null : selectedIncident.assigned_to,
        description: detailDraft.description.trim(),
        resolution_summary: detailDraft.resolution_summary.trim() || null,
        action_taken: detailDraft.action_taken.trim() || null,
        sensitivity_review_requested: detailDraft.sensitivity_review_requested,
      })

      if (user?.id) {
        await replaceIncidentStudents(selectedIncident.id, detailDraft.tagged_student_ids)
      }

      toast.success("Incident saved", "The incident details were updated successfully.")
      closeIncidentDetails()
      await loadData()
    } catch (error) {
      toast.error("Failed to save incident", getErrorMessage(error))
    }
  }

  async function handleSoftDelete(incidentId: string) {
    const reason = window.prompt("Reason for soft delete")
    if (!reason) return

    try {
      await softDeleteIncident(incidentId, reason)
      toast.success("Incident soft deleted", "The incident was moved to the deleted state.")
      await loadData()
    } catch (error) {
      toast.error("Failed to soft delete incident", getErrorMessage(error))
    }
  }

  async function handleRestore(incidentId: string) {
    const reason = window.prompt("Reason for restore")
    if (!reason) return

    try {
      await restoreIncident(incidentId, reason)
      toast.success("Incident restored", "The incident was restored successfully.")
      await loadData()
    } catch (error) {
      toast.error("Failed to restore incident", getErrorMessage(error))
    }
  }

  async function handleVisibilityChange(incident: Incident, nextVisibility: "standard" | "sensitive") {
    const reason = window.prompt(`Reason for visibility change to ${nextVisibility}`)
    if (!reason) return

    try {
      await setIncidentVisibility(incident.id, nextVisibility, reason)
      toast.success("Incident visibility updated", `Visibility changed to ${nextVisibility}.`)
      await loadData()
    } catch (error) {
      toast.error("Failed to update incident visibility", getErrorMessage(error))
    }
  }

  async function handleStatusChange(incident: Incident, nextStatus: string) {
    try {
      await updateIncident(incident.id, { status: nextStatus })
      toast.success("Incident status updated", `Status changed to ${nextStatus}.`)
      await loadData()
    } catch (error) {
      toast.error("Failed to update incident status", getErrorMessage(error))
    }
  }

  async function handleAddComment() {
    if (!selectedIncident || !user?.id || !commentDraft.trim()) return
    try {
      await createIncidentComment({
        incident_id: selectedIncident.id,
        author_id: user.id,
        content: commentDraft.trim(),
        visibility: selectedIncident.visibility,
      })
      setCommentDraft("")
      toast.success("Comment added", "The comment was saved successfully.")
      await loadDetailData(selectedIncident.id)
    } catch (error) {
      toast.error("Failed to add comment", getErrorMessage(error))
    }
  }

  async function handleAddFollowUp() {
    if (!selectedIncident || !user?.id || !followUpDraft.notes.trim() || !canManageSensitive) return
    try {
      await createIncidentFollowUp({
        incident_id: selectedIncident.id,
        author_id: user.id,
        assigned_to: detailDraft?.assigned_to || null,
        due_at: followUpDraft.due_at ? new Date(followUpDraft.due_at).toISOString() : null,
        notes: followUpDraft.notes.trim(),
        next_action: followUpDraft.next_action.trim() || null,
        status: "open",
        visibility: detailDraft?.visibility ?? selectedIncident.visibility,
      })
      setFollowUpDraft({ notes: "", due_at: "", next_action: "" })
      toast.success("Follow-up added", "The follow-up task was saved successfully.")
      await loadData()
      await loadDetailData(selectedIncident.id)
    } catch (error) {
      toast.error("Failed to add follow-up", getErrorMessage(error))
    }
  }

  async function handleFollowUpStatusChange(followUp: IncidentFollowUp, status: string) {
    try {
      await updateIncidentFollowUp(followUp.id, {
        status,
        completed_at: status === "done" ? new Date().toISOString() : followUp.completed_at,
      })
      toast.success("Follow-up updated", "The follow-up status was saved successfully.")
      if (selectedIncidentId) {
        await loadData()
        await loadDetailData(selectedIncidentId)
      }
    } catch (error) {
      toast.error("Failed to update follow-up", getErrorMessage(error))
    }
  }

  async function handlePreviewEmail() {
    if (!selectedIncident) return
    try {
      const response = await sendIncidentMergedEmail({
        incidentId: selectedIncident.id,
        templateKey: emailTemplateKey,
        recipients: selectedIncidentRecipientEmails,
        extraRecipients: emailExtraRecipients.split(",").map((value) => value.trim()).filter(Boolean),
        dryRun: true,
      })
      setEmailPreview(response as EmailPreview)
      toast.success("Email preview generated", "A preview of the merged email is ready.")
    } catch (error) {
      toast.error("Failed to generate email preview", getErrorMessage(error))
    }
  }

  async function handleSendEmail() {
    if (!selectedIncident) return
    try {
      const response = await sendIncidentMergedEmail({
        incidentId: selectedIncident.id,
        templateKey: emailTemplateKey,
        recipients: selectedIncidentRecipientEmails,
        extraRecipients: emailExtraRecipients.split(",").map((value) => value.trim()).filter(Boolean),
      })
      toast.success("Email sent", typeof response === "object" ? "Incident email dispatch completed successfully." : "Incident email dispatch completed successfully.")
      await loadDetailData(selectedIncident.id)
    } catch (error) {
      toast.error("Failed to send email", getErrorMessage(error))
    }
  }

  function exportIncidents(format: "csv" | "json") {
    const rows = filteredIncidents.map((incident) => ({
      id: incident.id,
      student: studentNameMap.get(incident.student_id) ?? incident.student_id,
      category: categoryNameMap.get(incident.category_id) ?? incident.category_id,
      assignee: assigneeNameMap.get(incident.assigned_to ?? "") ?? "",
      tagged_students: (incidentStudentsByIncident.get(incident.id) ?? [])
        .map((row) => studentNameMap.get(row.student_id) ?? row.student_id)
        .join("; "),
      severity: incident.severity,
      status: incident.status,
      visibility: incident.visibility,
      reported_at: incident.reported_at,
      occurred_at: incident.occurred_at,
    }))

    if (format === "json") {
      downloadTextFile(`incidents-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(rows, null, 2), "application/json")
      return
    }

    const headers = ["id", "student", "category", "assignee", "tagged_students", "severity", "status", "visibility", "reported_at", "occurred_at"]
    const csv = [headers.join(","), ...rows.map((row) => headers.map((key) => csvEscape((row as Record<string, unknown>)[key])).join(","))].join("\n")
    downloadTextFile(`incidents-${new Date().toISOString().slice(0, 10)}.csv`, csv, "text/csv")
  }

  const incidentColumns = [
    {
      accessor: "student_id",
      header: "Student",
      sortable: true,
      className: "min-w-[260px]",
      cell: (value: string) => {
        const name = studentNameMap.get(value) ?? "Unknown"
        return (
          <div className="flex items-center gap-3">
            <TableAvatar>{name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "S"}</TableAvatar>
            <div className="min-w-0">
              <div className="font-medium text-white">{name}</div>
              <div className="text-xs text-slate-400">Student linked to incident</div>
            </div>
          </div>
        )
      },
    },
    {
      accessor: "category_id",
      header: "Category",
      sortable: true,
      className: "min-w-[220px]",
      cell: (value: string) => <span className="text-slate-400">{categoryNameMap.get(value) ?? "Unknown"}</span>,
    },
    {
      accessor: "severity",
      header: "Severity",
      sortable: true,
      className: "whitespace-nowrap min-w-[130px]",
      cell: (value: string) => (
        <TableBadge tone={severityBadgeTone(value)} uppercase>
          {value}
        </TableBadge>
      ),
    },
    {
      accessor: "status",
      header: "Status",
      sortable: true,
      className: "whitespace-nowrap min-w-[180px]",
      cell: (value: string, row: Incident) => (
        <div onClick={(event) => event.stopPropagation()}>
          <Select value={value} onChange={(event) => handleStatusChange(row, event.target.value)} disabled={row.is_deleted} className="w-36">
            <option value="open">open</option>
            <option value="in_review">in_review</option>
            <option value="resolved">resolved</option>
            <option value="closed">closed</option>
          </Select>
        </div>
      ),
    },
    {
      accessor: "assigned_to",
      header: "Counselor",
      sortable: true,
      className: "min-w-[240px]",
      cell: (value: string | null) => {
        const name = value ? assigneeNameMap.get(value) ?? value : "Unassigned"
        return <span className="text-slate-400">{name}</span>
      },
    },
    {
      accessor: "tagged_count",
      header: "Tagged",
      className: "whitespace-nowrap min-w-[120px]",
      cell: (_: unknown, row: Incident) => {
        const tagged = incidentStudentsByIncident.get(row.id) ?? []
        return (
          <span className="inline-flex items-center gap-1 text-slate-300">
            <Users className="size-3.5 text-slate-400" />
            {tagged.length}
          </span>
        )
      },
    },
    {
      accessor: "followup_count",
      header: "Follow-ups",
      className: "whitespace-nowrap min-w-[160px]",
      cell: (_: unknown, row: Incident) => {
        const rows = incidentFollowUpsByIncident.get(row.id) ?? []
        const overdue = rows.filter((followUp) => followUp.due_at && followUp.status !== "done" && new Date(followUp.due_at).getTime() < currentTime).length
        return (
          <span className={`inline-flex items-center gap-1 ${overdue > 0 ? "text-amber-300 font-medium" : "text-slate-400"}`}>
            <CalendarClock className="size-3.5" />
            {rows.length}{overdue > 0 ? ` (${overdue} overdue)` : ""}
          </span>
        )
      },
    },
    {
      accessor: "visibility",
      header: "Visibility",
      sortable: true,
      className: "whitespace-nowrap min-w-[160px]",
      cell: (value: string, row: Incident) => (
        <div className="flex items-center gap-2">
          <TableBadge tone={visibilityBadgeTone(value)}>{value}</TableBadge>
          {canManageSensitive && !row.is_deleted ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={(event) => {
                event.stopPropagation()
                void handleVisibilityChange(row, value === "standard" ? "sensitive" : "standard")
              }}
              title="Change visibility"
            >
              {value === "standard" ? <ShieldAlert className="size-4" /> : <ShieldCheck className="size-4" />}
            </Button>
          ) : null}
        </div>
      ),
    },
    {
      accessor: "is_deleted",
      header: "Archive",
      sortable: true,
      className: "whitespace-nowrap min-w-[120px]",
      cell: (value: boolean, row: Incident) => (
        <div className="flex items-center gap-1 whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
          {canManageSensitive ? (
            value ? (
              <Button variant="ghost" size="sm" onClick={() => void handleRestore(row.id)} title="Restore incident">
                <Undo2 className="size-4" />
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => void handleSoftDelete(row.id)} title="Soft delete incident">
                <Trash2 className="size-4 text-rose-400" />
              </Button>
            )
          ) : (
            <span className="text-xs text-slate-400">{value ? "archived" : "active"}</span>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="w-full max-w-full min-w-0 overflow-x-hidden">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Behaviour Incidents</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadData()}>
            <RefreshCw className="mr-1 size-4" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportIncidents("csv")}>
            <FileDown className="mr-1 size-4" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportIncidents("json")}>
            <FileJson className="mr-1 size-4" />
            JSON
          </Button>
          <Button size="sm" onClick={() => setShowForm(true)}>
            <Plus className="mr-1 size-4" />
            Add Incident
          </Button>
        </div>
      </div>

      <section className="mb-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Incident Overview</h2>
          <p className="text-xs text-[var(--color-muted)]">Operational counts for case handling and follow-up.</p>
        </div>
        <StatisticGrid>
          <StatisticCard label="Total Cases" value={totalIncidents} icon={FileText} description="All incident records in scope" accentClassName="text-cyan-300" />
          <StatisticCard label="Open" value={report?.open_count ?? openIncident} icon={Clock3} description="Cases waiting to be worked" accentClassName="text-amber-300" glowClassName="from-amber-400/25 via-amber-400/10 to-transparent" />
          <StatisticCard label="In Review" value={report?.in_review_count ?? inReviewCount} icon={RefreshCw} description="Cases currently under assessment" accentClassName="text-rose-300" glowClassName="from-rose-400/25 via-rose-400/10 to-transparent" />
          <StatisticCard label="Resolved" value={report?.resolved_count ?? resolvedCount} icon={CheckCircle2} description="Cases closed with action completed" accentClassName="text-emerald-300" glowClassName="from-emerald-400/25 via-emerald-400/10 to-transparent" />
          <StatisticCard label="Closed" value={closedCount} icon={X} description="Cases fully closed from the workflow" accentClassName="text-slate-300" glowClassName="from-slate-400/25 via-slate-400/10 to-transparent" />
          <StatisticCard label="Overdue" value={report?.overdue_follow_up_count ?? overdueFollowUpCount} icon={AlertTriangle} description="Follow-ups past their due date" accentClassName="text-rose-300" glowClassName="from-rose-400/25 via-rose-400/10 to-transparent" />
        </StatisticGrid>
      </section>

      <Card className="min-w-0 overflow-hidden border-white/10 p-0">
        <CardHeader className="mb-0 flex-col items-start justify-start border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base">Incident Directory</CardTitle>
            <p className="mt-1 text-xs text-slate-400">Search, filter, and inspect the incident log.</p>
          </div>
        </CardHeader>

        <CardContent className="min-w-0 space-y-4 px-0 py-0">
          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <div className="relative min-w-0 lg:col-span-1">
              <Input
                placeholder="Search incidents by student, category, counselor, description..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
              />
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
            </div>
            <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full lg:w-52 lg:flex-none">
              <option value="">All Statuses</option>
              <option value="open">Open</option>
              <option value="in_review">In Review</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </Select>
            <Select value={visibilityFilter} onChange={(event) => setVisibilityFilter(event.target.value)} className="w-full lg:w-52 lg:flex-none">
              <option value="">All Visibility</option>
              <option value="standard">Standard</option>
              <option value="sensitive">Sensitive</option>
            </Select>
            {(search || statusFilter || visibilityFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("")
                  setStatusFilter("")
                  setVisibilityFilter("")
                }}
                className="text-xs text-slate-400 hover:text-white"
              >
                Reset Filters
              </Button>
            )}
          </div>

          <DataTable
            data={filteredIncidents}
            columns={incidentColumns}
            initialSort={{ id: "reported_at", desc: true }}
            itemsPerPageOptions={[10, 25, 50, 100]}
            emptyMessage={loading ? "Loading incidents..." : "No incidents found"}
            onRowClick={(incident) => openIncidentDetails(incident.id)}
            searchable={false}
          />

          <Card className="border-[var(--color-border)] bg-[var(--color-surface)]">
            <CardContent className="space-y-4 p-4">
              <div className="flex items-center gap-2 text-[var(--color-text)]">
                <Clock3 className="size-4 text-[var(--color-accent)]" />
                <h2 className="text-lg font-semibold">Retention Due</h2>
              </div>
              {retentionRows.length > 0 ? (
                <DataTable
                  data={retentionRows.slice(0, 8)}
                  columns={[
                { accessor: "incident_id", header: "Incident", sortable: true, cell: (value: string) => <span className="font-medium text-white">{value}</span> },
                { accessor: "severity", header: "Severity", sortable: true, cell: (value: string) => <span className="text-slate-400">{value}</span> },
                { accessor: "archive_due_at", header: "Archive Due", sortable: true, cell: (value: string) => <span className="text-slate-400">{formatDate(value)}</span> },
                { accessor: "dispose_due_at", header: "Dispose Due", sortable: true, cell: (value: string) => <span className="text-slate-400">{formatDate(value)}</span> },
                { accessor: "flags", header: "Flags", searchable: false, cell: (_: unknown, row: RetentionRow) => <span className="text-slate-400">{[row.should_archive ? "archive" : null, row.should_dispose ? "dispose" : null].filter(Boolean).join(", ") || "-"}</span> },
                  ]}
                  initialSort={{ id: "archive_due_at", desc: false }}
                  itemsPerPageOptions={[5, 8]}
                  emptyMessage="No retention items due."
                  searchable={false}
                />
              ) : (
                <p className="text-sm text-[var(--color-muted)]">No retention items due.</p>
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      {/* ADD INCIDENT DIALOG - WIDENED TO max-w-6xl */}
      <Dialog open={showForm} onOpenChange={setShowForm} title="Add New Behaviour Incident">
        <div className="w-full max-w-6xl mx-auto space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="Primary Student"
                htmlFor="incident-primary-student"
                required
                labelClassName="text-xs font-semibold uppercase tracking-wider text-slate-300"
              >
                <Select id="incident-primary-student" value={createForm.student_id} onChange={(event) => setCreateForm({ ...createForm, student_id: event.target.value })} required>
                  <option value="">Select primary student</option>
                  {students.map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.first_name} {student.last_name}
                    </option>
                  ))}
                </Select>
              </FormField>

              <FormField
                label="Category"
                htmlFor="incident-category"
                required
                labelClassName="text-xs font-semibold uppercase tracking-wider text-slate-300"
              >
                <Select id="incident-category" value={createForm.category_id} onChange={(event) => setCreateForm({ ...createForm, category_id: event.target.value })} required>
                  <option value="">Select category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                label="Occurred At"
                htmlFor="incident-occurred-at"
                required
                labelClassName="text-xs font-semibold uppercase tracking-wider text-slate-300"
              >
                <Input id="incident-occurred-at" type="datetime-local" value={createForm.occurred_at} onChange={(event) => setCreateForm({ ...createForm, occurred_at: event.target.value })} required />
              </FormField>
              <FormField label="Severity" htmlFor="incident-severity" labelClassName="text-xs font-semibold uppercase tracking-wider text-slate-300">
                <Select id="incident-severity" value={createForm.severity} onChange={(event) => setCreateForm({ ...createForm, severity: event.target.value })}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </Select>
              </FormField>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Status" htmlFor="incident-status" labelClassName="text-xs font-semibold uppercase tracking-wider text-slate-300">
                <Select id="incident-status" value={createForm.status} onChange={(event) => setCreateForm({ ...createForm, status: event.target.value })}>
                  <option value="open">Open</option>
                  <option value="in_review">In Review</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </Select>
              </FormField>
              <FormField label="Visibility" htmlFor="incident-visibility" labelClassName="text-xs font-semibold uppercase tracking-wider text-slate-300">
                <Select
                  id="incident-visibility"
                  value={isTeacherOnly ? "standard" : createForm.visibility}
                  onChange={(event) => setCreateForm({ ...createForm, visibility: event.target.value as "standard" | "sensitive" })}
                  disabled={Boolean(isTeacherOnly)}
                >
                  <option value="standard">Standard</option>
                  <option value="sensitive">Sensitive</option>
                </Select>
              </FormField>
            </div>

            {canManageSensitive ? (
              <FormField label="Assigned Counselor" htmlFor="incident-assigned-counselor" labelClassName="text-xs font-semibold uppercase tracking-wider text-slate-300">
                <Select id="incident-assigned-counselor" value={createForm.assigned_to} onChange={(event) => setCreateForm({ ...createForm, assigned_to: event.target.value })}>
                  <option value="">Unassigned</option>
                  {assignees.map((assignee) => (
                    <option key={assignee.id} value={assignee.id}>
                      {assignee.full_name ?? assignee.email}
                    </option>
                  ))}
                </Select>
              </FormField>
            ) : null}

            <FormField
              label={`Tagged Students (${createForm.tagged_student_ids.length})`}
              labelClassName="text-xs font-semibold uppercase tracking-wider text-slate-300"
              contentClassName="space-y-3"
            >
              <div className="flex items-center justify-between">
                {createForm.tagged_student_ids.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCreateForm((prev) => ({ ...prev, tagged_student_ids: [] }))}
                    className="text-xs text-slate-400 hover:text-rose-300 transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <Select
                value=""
                onChange={(event) => {
                  handleAddTaggedStudentToCreate(event.target.value)
                }}
              >
                <option value="">Select a student to tag...</option>
                {students
                  .filter((s) => s.id !== createForm.student_id && !createForm.tagged_student_ids.includes(s.id))
                  .map((student) => (
                    <option key={student.id} value={student.id}>
                      {student.first_name} {student.last_name}
                    </option>
                  ))}
              </Select>

              <div className="mt-2 min-h-[44px] rounded-lg border border-white/10 bg-slate-900/60 p-2.5 no-scrollbar">
                {createForm.tagged_student_ids.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {createForm.tagged_student_ids.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 px-3 py-1 text-xs font-medium text-cyan-200 shadow-sm"
                      >
                        <Users className="size-3 text-cyan-400" />
                        <span>{studentNameMap.get(id) ?? "Unknown Student"}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveTaggedStudentFromCreate(id)}
                          className="ml-0.5 rounded-full p-0.5 hover:bg-rose-500/20 hover:text-rose-300 transition-colors focus:outline-none focus:ring-1 focus:ring-rose-400"
                          title="Remove student"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-xs text-slate-500 italic py-0.5">
                    <UserPlus className="size-3.5 text-slate-500" />
                    No tagged students selected. Choose a student from the list above to tag them.
                  </div>
                )}
              </div>
            </FormField>

            <FormField
              label="Description"
              htmlFor="incident-description"
              required
              labelClassName="text-xs font-semibold uppercase tracking-wider text-slate-300"
            >
              <Textarea
                id="incident-description"
                rows={4}
                value={createForm.description}
                onChange={(event) => setCreateForm({ ...createForm, description: event.target.value })}
                placeholder="Describe what occurred during the incident..."
                required
              />
            </FormField>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField label="Action Taken" htmlFor="incident-action-taken" labelClassName="text-xs font-semibold uppercase tracking-wider text-slate-300">
                <Textarea
                  id="incident-action-taken"
                  rows={3}
                  value={createForm.action_taken}
                  onChange={(event) => setCreateForm({ ...createForm, action_taken: event.target.value })}
                  placeholder="Immediate actions taken..."
                />
              </FormField>

              <FormField label="Resolution Summary" htmlFor="incident-resolution-summary" labelClassName="text-xs font-semibold uppercase tracking-wider text-slate-300">
                <Textarea
                  id="incident-resolution-summary"
                  rows={3}
                  value={createForm.resolution_summary}
                  onChange={(event) => setCreateForm({ ...createForm, resolution_summary: event.target.value })}
                  placeholder="Resolution details if applicable..."
                />
              </FormField>
            </div>

            {canManageSensitive ? (
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-300 flex items-center gap-1.5">
                  <CalendarClock className="size-3.5" />
                  Initial Follow-up Plan
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField label="Due Date & Time" htmlFor="incident-follow-up-due-at" labelClassName="text-xs font-medium text-slate-300">
                    <Input id="incident-follow-up-due-at" type="datetime-local" value={createForm.follow_up_due_at} onChange={(event) => setCreateForm({ ...createForm, follow_up_due_at: event.target.value })} />
                  </FormField>
                  <FormField label="Next Action" htmlFor="incident-follow-up-next-action" labelClassName="text-xs font-medium text-slate-300">
                    <Input id="incident-follow-up-next-action" value={createForm.follow_up_next_action} onChange={(event) => setCreateForm({ ...createForm, follow_up_next_action: event.target.value })} placeholder="e.g. Parent phone call, Counselor check-in" />
                  </FormField>
                </div>
                <FormField label="Follow-up Notes" htmlFor="incident-follow-up-notes" labelClassName="text-xs font-medium text-slate-300">
                  <Textarea
                    id="incident-follow-up-notes"
                    rows={2.5}
                    value={createForm.follow_up_notes}
                    onChange={(event) => setCreateForm({ ...createForm, follow_up_notes: event.target.value })}
                    placeholder="Notes regarding follow-up actions..."
                  />
                </FormField>
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-3 border-t border-white/10">
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="submit">Create Incident</Button>
            </div>
          </form>
        </div>
      </Dialog>

      {/* EDIT & VIEW INCIDENT MODAL - WIDENED TO max-w-6xl WITH HIDDEN SCROLLBARS */}
      <Dialog
        open={Boolean(selectedIncident)}
        onOpenChange={(open) => (!open ? closeIncidentDetails() : null)}
        title="Incident Details"
      >
        {selectedIncident && detailDraft ? (
          <div className="w-full max-w-6xl mx-auto space-y-5">
            {/* COMPACT OVERVIEW SUMMARY STRIP */}
            <div className="rounded-lg border border-white/10 bg-slate-900/80 p-4 text-xs text-slate-300 shadow-inner">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <span className="text-slate-500 block uppercase font-medium text-[10px]">Primary Student</span>
                  <span className="font-semibold text-white text-sm">{studentNameMap.get(selectedIncident.student_id) ?? "Unknown"}</span>
                </div>
                <div>
                  <span className="text-slate-500 block uppercase font-medium text-[10px]">Category</span>
                  <span className="font-semibold text-slate-200">{categoryNameMap.get(selectedIncident.category_id) ?? "Unknown"}</span>
                </div>
                <div>
                  <span className="text-slate-500 block uppercase font-medium text-[10px]">Counselor</span>
                  <span className="font-semibold text-slate-200">{selectedIncidentAssigneeName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block uppercase font-medium text-[10px]">Occurred At</span>
                  <span className="font-semibold text-slate-200">{formatDate(selectedIncident.occurred_at)}</span>
                </div>
              </div>
            </div>

            {/* MODAL TABS */}
            <div className="flex border-b border-white/10 space-x-1">
              <button
                type="button"
                onClick={() => setDetailActiveTab("details")}
                className={`flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 ${
                  detailActiveTab === "details"
                    ? "border-cyan-400 text-cyan-300 bg-white/[0.04]"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                }`}
              >
                <FileText className="size-3.5" />
                Details & Form
              </button>
              <button
                type="button"
                onClick={() => setDetailActiveTab("activity")}
                className={`flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 ${
                  detailActiveTab === "activity"
                    ? "border-cyan-400 text-cyan-300 bg-white/[0.04]"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                }`}
              >
                <MessageSquare className="size-3.5" />
                Follow-ups & Comments
                <span className="ml-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 border border-white/10">
                  {comments.length + selectedIncidentFollowUps.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setDetailActiveTab("communication")}
                className={`flex items-center gap-2 px-5 py-2.5 text-xs font-semibold rounded-t-lg transition-colors border-b-2 ${
                  detailActiveTab === "communication"
                    ? "border-cyan-400 text-cyan-300 bg-white/[0.04]"
                    : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/[0.02]"
                }`}
              >
                <Mail className="size-3.5" />
                Communication & Audit
                <span className="ml-1 rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300 border border-white/10">
                  {auditLog.length + emailLogs.length}
                </span>
              </button>
            </div>

            {/* TAB 1: EDIT FORM & DETAILS */}
            {detailActiveTab === "details" && (
              <div className="space-y-4 pt-1">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-4">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">Status</label>
                    <Select value={detailDraft.status} onChange={(event) => setDetailDraft({ ...detailDraft, status: event.target.value })}>
                      <option value="open">Open</option>
                      <option value="in_review">In Review</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </Select>
                  </div>

                  <div className="space-y-4">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">Severity</label>
                    <Select value={detailDraft.severity} onChange={(event) => setDetailDraft({ ...detailDraft, severity: event.target.value })}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-4">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">Visibility</label>
                    <Select
                      value={detailDraft.visibility}
                      onChange={(event) => setDetailDraft({ ...detailDraft, visibility: event.target.value as "standard" | "sensitive" })}
                      disabled={!canManageSensitive}
                    >
                      <option value="standard">Standard</option>
                      <option value="sensitive">Sensitive</option>
                    </Select>
                  </div>

                  <div className="space-y-4">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">Assigned Counselor</label>
                    <Select
                      value={detailDraft.assigned_to}
                      onChange={(event) => setDetailDraft({ ...detailDraft, assigned_to: event.target.value })}
                      disabled={!canManageSensitive}
                    >
                      <option value="">Unassigned</option>
                      {assignees.map((assignee) => (
                        <option key={assignee.id} value={assignee.id}>
                          {assignee.full_name ?? assignee.email}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                      Tagged Students ({detailDraft.tagged_student_ids.length})
                    </label>
                    {detailDraft.tagged_student_ids.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setDetailDraft((prev) => (prev ? { ...prev, tagged_student_ids: [] } : null))}
                        className="text-xs text-slate-400 hover:text-rose-300 transition-colors"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  <Select
                    value=""
                    onChange={(event) => {
                      handleAddTaggedStudentToDetail(event.target.value)
                    }}
                  >
                    <option value="">Select a student to tag...</option>
                    {students
                      .filter((s) => s.id !== selectedIncident.student_id && !detailDraft.tagged_student_ids.includes(s.id))
                      .map((student) => (
                        <option key={student.id} value={student.id}>
                          {student.first_name} {student.last_name}
                        </option>
                      ))}
                  </Select>

                  <div className="mt-2 min-h-[44px] rounded-lg border border-white/10 bg-slate-900/60 p-2.5 no-scrollbar">
                    {detailDraft.tagged_student_ids.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {detailDraft.tagged_student_ids.map((id) => (
                          <span
                            key={id}
                            className="inline-flex items-center gap-1.5 rounded-full bg-cyan-500/15 border border-cyan-500/30 px-3 py-1 text-xs font-medium text-cyan-200 shadow-sm"
                          >
                            <Users className="size-3 text-cyan-400" />
                            <span>{studentNameMap.get(id) ?? "Unknown Student"}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveTaggedStudentFromDetail(id)}
                              className="ml-0.5 rounded-full p-0.5 hover:bg-rose-500/20 hover:text-rose-300 transition-colors focus:outline-none focus:ring-1 focus:ring-rose-400"
                              title="Remove student"
                            >
                              <X className="size-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-slate-500 italic py-0.5">
                        <UserPlus className="size-3.5 text-slate-500" />
                        No tagged students selected.
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">Incident Description</label>
                  <Textarea
                    rows={4}
                    value={detailDraft.description}
                    onChange={(event) => setDetailDraft({ ...detailDraft, description: event.target.value })}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-4">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">Action Taken</label>
                    <Textarea
                      rows={3}
                      value={detailDraft.action_taken}
                      onChange={(event) => setDetailDraft({ ...detailDraft, action_taken: event.target.value })}
                      placeholder="Actions taken..."
                    />
                  </div>

                  <div className="space-y-4">
                    <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">Resolution Summary</label>
                    <Textarea
                      rows={3}
                      value={detailDraft.resolution_summary}
                      onChange={(event) => setDetailDraft({ ...detailDraft, resolution_summary: event.target.value })}
                      placeholder="Resolution summary..."
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-white/10">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      className="rounded border-white/20 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
                      checked={detailDraft.sensitivity_review_requested}
                      disabled={!canManageSensitive}
                      onChange={(event) => setDetailDraft({ ...detailDraft, sensitivity_review_requested: event.target.checked })}
                    />
                    <span>Sensitivity review requested</span>
                  </label>

                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void navigator.clipboard.writeText(
                          `${studentNameMap.get(selectedIncident.student_id) ?? "Student"} - ${selectedIncident.description}`
                        )
                      }
                    >
                      <Copy className="mr-1 size-3.5" />
                      Copy Summary
                    </Button>
                    <Button type="button" size="sm" onClick={() => void handleSaveDetail()}>
                      <Save className="mr-1.5 size-3.5" />
                      Save Changes
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: FOLLOW-UPS & COMMENTS */}
            {detailActiveTab === "activity" && (
              <div className="flex flex-col gap-5 pt-1">
                {/* 1. DISCUSSION COMMENTS BLOCK */}
                <Card className="border-white/10 bg-white/[0.02]">
                  <CardContent className="space-y-4 p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-white font-semibold text-sm">
                        <MessageSquare className="size-4 text-cyan-300" />
                        Discussion Comments
                      </div>
                      <span className="text-xs text-slate-400 font-medium">{comments.length} comment(s)</span>
                    </div>

                    <div className="space-y-3 max-h-64 overflow-y-auto pr-2 no-scrollbar">
                      {comments.length > 0 ? (
                        comments.map((comment) => (
                          <div key={comment.id} className="rounded-lg border border-white/10 bg-slate-900/60 p-3.5 text-xs text-slate-300">
                            <div className="mb-1 text-[10px] text-slate-500 font-medium">{formatDate(comment.created_at)}</div>
                            <p className="whitespace-pre-wrap leading-relaxed">{comment.content}</p>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-slate-400 py-4 text-center italic">No comments added yet.</p>
                      )}
                    </div>

                    <div className="pt-3 border-t border-white/10 space-y-2.5">
                      <Textarea
                        rows={3}
                        value={commentDraft}
                        onChange={(event) => setCommentDraft(event.target.value)}
                        placeholder="Write a comment or update..."
                        className="text-xs"
                      />
                      <div className="flex justify-end">
                        <Button size="sm" onClick={() => void handleAddComment()}>
                          Post Comment
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* 2. FOLLOW-UP TASKS BLOCK */}
                <Card className="border-white/10 bg-white/[0.02]">
                  <CardContent className="space-y-4 p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-white font-semibold text-sm">
                        <CalendarClock className="size-4 text-cyan-300" />
                        Follow-up Tasks
                      </div>
                      <span className="text-xs text-slate-400 font-medium">{selectedIncidentFollowUps.length} item(s)</span>
                    </div>

                    <div className="space-y-3 max-h-64 overflow-y-auto pr-2 no-scrollbar">
                      {selectedIncidentFollowUps.length > 0 ? (
                        selectedIncidentFollowUps.map((followUp) => (
                          <div key={followUp.id} className="rounded-lg border border-white/10 bg-slate-900/60 p-3.5 text-xs text-slate-300 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-white uppercase text-[10px] tracking-wider">{followUp.status}</span>
                              <Select
                                value={followUp.status}
                                onChange={(event) => void handleFollowUpStatusChange(followUp, event.target.value)}
                                className="w-32 h-7 text-xs"
                              >
                                <option value="open">open</option>
                                <option value="in_progress">in_progress</option>
                                <option value="done">done</option>
                                <option value="cancelled">cancelled</option>
                              </Select>
                            </div>
                            <p className="whitespace-pre-wrap text-slate-200 leading-relaxed">{followUp.notes}</p>
                            <div className="text-[10px] text-slate-500 pt-1 border-t border-white/5 flex flex-wrap gap-3">
                              <span>Due: {formatDate(followUp.due_at)}</span>
                              <span>Completed: {formatDate(followUp.completed_at)}</span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-slate-400 py-4 text-center italic">No follow-ups recorded.</p>
                      )}
                    </div>

                    {canManageSensitive ? (
                      <div className="pt-3 border-t border-white/10 space-y-3">
                        <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Add New Follow-up</div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Input
                            type="datetime-local"
                            value={followUpDraft.due_at}
                            onChange={(event) => setFollowUpDraft({ ...followUpDraft, due_at: event.target.value })}
                            className="text-xs"
                          />
                          <Input
                            value={followUpDraft.next_action}
                            onChange={(event) => setFollowUpDraft({ ...followUpDraft, next_action: event.target.value })}
                            placeholder="Next action..."
                            className="text-xs"
                          />
                        </div>
                        <Textarea
                          rows={2.5}
                          value={followUpDraft.notes}
                          onChange={(event) => setFollowUpDraft({ ...followUpDraft, notes: event.target.value })}
                          placeholder="Follow-up note details..."
                          className="text-xs"
                        />
                        <div className="flex justify-end">
                          <Button size="sm" onClick={() => void handleAddFollowUp()}>
                            Add Follow-up
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-[11px] text-slate-500 italic">Follow-up management requires leadership/counseling permissions.</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* TAB 3: COMMUNICATION & AUDIT */}
            {detailActiveTab === "communication" && (
              <div className="space-y-4 pt-1">
                {canManageSensitive ? (
                  <Card className="border-white/10 bg-white/[0.02]">
                    <CardContent className="space-y-3 p-5">
                      <div className="flex items-center gap-2 text-white font-semibold text-sm">
                        <Mail className="size-4 text-cyan-300" />
                        Merged Email Dispatch
                      </div>
                      <div className="text-xs text-slate-400">
                        <span className="font-semibold text-slate-300">Recipients:</span> {selectedIncidentRecipientEmails.join(", ") || "None"}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Input
                          value={emailTemplateKey}
                          onChange={(event) => setEmailTemplateKey(event.target.value)}
                          placeholder="Template key"
                          className="text-xs"
                        />
                        <Input
                          value={emailExtraRecipients}
                          onChange={(event) => setEmailExtraRecipients(event.target.value)}
                          placeholder="Extra recipients, comma separated"
                          className="text-xs"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => void handlePreviewEmail()}>
                          Preview Draft
                        </Button>
                        <Button type="button" size="sm" onClick={() => void handleSendEmail()}>
                          <Send className="mr-1.5 size-3.5" />
                          Send Merged Email
                        </Button>
                      </div>

                      {emailPreview ? (
                        <div className="rounded-lg border border-white/10 bg-slate-950/80 p-4 text-xs text-slate-300 space-y-2 mt-2">
                          <div className="font-semibold text-white">Subject: {emailPreview.subject}</div>
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-[11px] text-slate-300 font-mono bg-slate-900/90 p-3 rounded border border-white/5 no-scrollbar">
                            {emailPreview.body}
                          </pre>
                        </div>
                      ) : null}
                    </CardContent>
                  </Card>
                ) : null}

                <Card className="border-white/10 bg-white/[0.02]">
                  <CardContent className="space-y-3 p-5">
                    <div className="flex items-center gap-2 text-white font-semibold text-sm">
                      <History className="size-4 text-emerald-300" />
                      Audit & Email Logs
                    </div>
                    {detailLoading ? <p className="text-xs text-slate-400">Loading history logs...</p> : null}
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Audit History</div>
                        <div className="space-y-2 max-h-56 overflow-y-auto pr-2 no-scrollbar">
                          {auditLog.length > 0 ? (
                            auditLog.slice(0, 10).map((row) => (
                              <div key={row.id} className="rounded-md border border-white/10 bg-slate-900/60 p-3 text-xs text-slate-300">
                                <div className="font-medium text-white">{row.action}</div>
                                <div className="text-[10px] text-slate-500">{formatDate(row.changed_at)}</div>
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-slate-400 italic">No audit records.</p>
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Dispatch Log</div>
                        <div className="space-y-2 max-h-56 overflow-y-auto pr-2 no-scrollbar">
                          {emailLogs.length > 0 ? (
                            emailLogs.map((row) => (
                              <div key={row.id} className="rounded-md border border-white/10 bg-slate-900/60 p-3 text-xs text-slate-300 space-y-0.5">
                                <div className="font-medium text-white flex items-center justify-between">
                                  <span>{row.template_key}</span>
                                  <span className="text-[10px] uppercase font-semibold text-cyan-300">{row.status}</span>
                                </div>
                                <div className="text-[11px] text-slate-400">{row.subject}</div>
                                <div className="text-[10px] text-slate-500">{formatDate(row.created_at)}</div>
                                {row.error ? <div className="text-rose-300 text-[10px]">{row.error}</div> : null}
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-slate-400 italic">No emails dispatched.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}
