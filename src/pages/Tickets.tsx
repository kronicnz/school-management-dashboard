import { useCallback, useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import {
  ArchiveRestore,
  ArrowRightLeft,
  Clock3,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Ticket,
} from "lucide-react"
import { useAuth } from "../context/useAuth"
import {
  addTicketComment,
  archiveTicket,
  createTicketFromTemplate,
  assignTicket,
  fetchStaff,
  fetchTicketAttachments,
  fetchTicketAuditLog,
  fetchTicketCategories,
  fetchTicketComments,
  fetchTicketManagementReport,
  fetchTicketNotifications,
  fetchProfilesByIds,
  fetchTicketTemplateSteps,
  fetchTicketTemplates,
  fetchTickets,
  hasItAdminRole,
  hasItStaffRole,
  requestTicketClose,
  restoreTicket,
  transitionTicketStatus,
  type StaffDirectoryRow,
} from "../lib/api/supabaseApi"
import type {
  Ticket as TicketRow,
  TicketAttachment,
  TicketAuditLog,
  TicketCategory,
  TicketComment,
  TicketManagementReport,
  TicketNotification,
  TicketTemplate,
  TicketTemplateStep,
} from "../lib/api/database.types"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card"
import { Button } from "../components/ui/button"
import { DataTable } from "../components/ui/DataTable"
import { Dialog } from "../components/ui/Dialog"
import { Input } from "../components/ui/Input"
import { Select } from "../components/ui/Select"
import { StatisticCard, StatisticGrid } from "../components/ui/StatisticCard"
import { TableAvatar } from "../components/ui/TableAvatar"
import { TableBadge } from "../components/ui/TableBadge"
import { Textarea } from "../components/ui/Textarea"
import { useToast } from "../components/ui/useToast"
import { getErrorMessage } from "../utils/getErrorMessage"
import { labelize } from "../utils/labelize"
import { logError } from "../utils/logger"

type DetailData = {
  comments: TicketComment[]
  auditLog: TicketAuditLog[]
  attachments: TicketAttachment[]
  notifications: TicketNotification[]
}

function badgeTone(value: string): "emerald" | "cyan" | "amber" | "slate" | "violet" {
  if (["resolved", "closed"].includes(value)) return "emerald"
  if (["in_progress", "assigned"].includes(value)) return "cyan"
  if (value === "pending_user") return "amber"
  if (value === "archived") return "slate"
  return "violet"
}

function formatTicketDate(value: string | null) {
  if (!value) return "-"
  return format(new Date(value), "dd MMM yyyy, HH:mm")
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeFieldOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return []
  return options
    .map((option) => {
      if (typeof option === "string") return option
      if (option && typeof option === "object" && "label" in option && typeof (option as { label?: unknown }).label === "string") {
        return (option as { label: string }).label
      }
      return ""
    })
    .filter(Boolean)
}

function formatStaffLabel(staff: StaffDirectoryRow) {
  return [staff.first_name, staff.last_name].filter(Boolean).join(" ") || staff.email
}

function isActiveItStaff(staff: StaffDirectoryRow) {
  const roles = [staff.role, staff.primary_role, ...staff.roles].filter((role): role is string => Boolean(role))
  return staff.status === "active" && roles.includes("it_staff")
}

function canAccessTicket(ticket: TicketRow | null, userId: string | undefined, isAdmin: boolean, isStaff: boolean) {
  if (!ticket) return false
  if (isAdmin) return true
  if (isStaff) return ticket.requester_id === userId || ticket.assigned_to === userId
  return ticket.requester_id === userId
}

function canProcessTicket(ticket: TicketRow | null, userId: string | undefined, isAdmin: boolean) {
  if (!ticket) return false
  return isAdmin || ticket.requester_id === userId || ticket.assigned_to === userId
}

export default function TicketsPage() {
  const toast = useToast()
  const { user } = useAuth()
  const [tickets, setTickets] = useState<TicketRow[]>([])
  const [categories, setCategories] = useState<TicketCategory[]>([])
  const [templates, setTemplates] = useState<TicketTemplate[]>([])
  const [report, setReport] = useState<TicketManagementReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [ticketPeople, setTicketPeople] = useState({ requester: "", assigned: "" })
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [priorityFilter, setPriorityFilter] = useState("")
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailData>({ comments: [], auditLog: [], attachments: [], notifications: [] })
  const [commentDraft, setCommentDraft] = useState("")
  const [commentType, setCommentType] = useState("public")
  const [statusDraft, setStatusDraft] = useState("in_progress")
  const [wizardOpen, setWizardOpen] = useState(false)
  const [wizardStep, setWizardStep] = useState(1)
  const [wizardCategoryId, setWizardCategoryId] = useState("")
  const [wizardTemplateId, setWizardTemplateId] = useState("")
  const [wizardTemplateSteps, setWizardTemplateSteps] = useState<TicketTemplateStep[]>([])
  const [wizardAnswers, setWizardAnswers] = useState<Record<string, string>>({})
  const [wizardTitle, setWizardTitle] = useState("")
  const [wizardSummary, setWizardSummary] = useState("")
  const [wizardPriority, setWizardPriority] = useState("medium")
  const [wizardSubmitting, setWizardSubmitting] = useState(false)
  const [staffDirectory, setStaffDirectory] = useState<StaffDirectoryRow[]>([])
  const [staffDirectoryLoading, setStaffDirectoryLoading] = useState(false)
  const [assigneeSearch, setAssigneeSearch] = useState("")
  const [assignmentTargetId, setAssignmentTargetId] = useState("")

  const isAdmin = hasItAdminRole(user?.roles)
  const isStaff = hasItStaffRole(user?.roles) && !isAdmin

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === wizardCategoryId) ?? null,
    [categories, wizardCategoryId]
  )

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === wizardTemplateId) ?? null,
    [templates, wizardTemplateId]
  )

  const wizardTemplates = useMemo(
    () => templates.filter((template) => template.category_id === wizardCategoryId),
    [templates, wizardCategoryId]
  )

  const wizardReviewSummary = useMemo(() => {
    const answerLines = wizardTemplateSteps
      .map((step) => {
        const value = wizardAnswers[step.step_key]
        if (!value) return ""
        return `${step.label}: ${value}`
      })
      .filter(Boolean)
      .join("; ")

    return wizardSummary.trim() || answerLines || selectedTemplate?.description || ""
  }, [wizardAnswers, wizardSummary, wizardTemplateSteps, selectedTemplate])

  const wizardDeviceContext = useMemo(
    () => ({
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      platform: typeof navigator !== "undefined" ? navigator.platform : null,
      language: typeof navigator !== "undefined" ? navigator.language : null,
      route: typeof window !== "undefined" ? window.location.pathname : null,
    }),
    []
  )

  const eligibleAssignees = useMemo(
    () => staffDirectory.filter((staff) => isActiveItStaff(staff) && staff.profile_id && staff.profile_id !== user?.id),
    [staffDirectory, user?.id]
  )

  const filteredAssignees = useMemo(() => {
    const query = assigneeSearch.trim().toLowerCase()
    if (!query) return eligibleAssignees

    return eligibleAssignees.filter((staff) => {
      const haystack = [formatStaffLabel(staff), staff.email, staff.department ?? "", staff.role ?? ""]
        .join(" ")
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [assigneeSearch, eligibleAssignees])

  function resetWizard() {
    setWizardStep(1)
    setWizardCategoryId("")
    setWizardTemplateId("")
    setWizardTemplateSteps([])
    setWizardAnswers({})
    setWizardTitle("")
    setWizardSummary("")
    setWizardPriority("medium")
    setWizardSubmitting(false)
  }

  function openWizard() {
    resetWizard()
    setWizardOpen(true)
  }

  useEffect(() => {
    if (!isAdmin) {
      setStaffDirectory([])
      setStaffDirectoryLoading(false)
      return
    }

    let cancelled = false

    setStaffDirectoryLoading(true)

    void fetchStaff()
      .then((rows) => {
        if (!cancelled) {
          setStaffDirectory(rows)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          logError("Failed to load staff directory", error)
          toast.error("Staff directory failed to load", getErrorMessage(error))
          setStaffDirectory([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setStaffDirectoryLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [isAdmin, toast])

  const loadTickets = useCallback(async () => {
    try {
      setLoading(true)
      const [ticketData, categoryData, templateData, reportData] = await Promise.all([
        fetchTickets(),
        fetchTicketCategories(),
        fetchTicketTemplates(),
        fetchTicketManagementReport().catch((error) => {
          logError("Failed to load ticket report", error)
          return null
        }),
      ])
      setTickets(ticketData)
      setCategories(categoryData)
      setTemplates(templateData)
      setReport(reportData)
    } catch (error) {
      logError("Failed to load tickets", error)
      toast.error("Tickets failed to load", getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    queueMicrotask(() => {
      void loadTickets()
    })
  }, [loadTickets])

  useEffect(() => {
    if (!wizardTemplateId) {
      return
    }

    let cancelled = false

    void fetchTicketTemplateSteps(wizardTemplateId)
      .then((steps) => {
        if (!cancelled) {
          setWizardTemplateSteps(steps)
          setWizardStep(3)
        }
      })
      .catch((error) => {
        logError("Failed to load ticket template steps", error)
        toast.error("Template failed to load", getErrorMessage(error))
      })

    return () => {
      cancelled = true
    }
  }, [toast, wizardTemplateId])

  const selectedTicket = useMemo(
    () => tickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
    [selectedTicketId, tickets]
  )

  const selectedTicketAccessible = useMemo(
    () => canAccessTicket(selectedTicket, user?.id, isAdmin, isStaff),
    [selectedTicket, user?.id, isAdmin, isStaff]
  )

  const selectedTicketCanProcess = useMemo(
    () => canProcessTicket(selectedTicket, user?.id, isAdmin),
    [selectedTicket, user?.id, isAdmin]
  )

  useEffect(() => {
    if (!selectedTicket) {
      setAssignmentTargetId("")
      setAssigneeSearch("")
      return
    }

    if (!isAdmin) {
      setAssignmentTargetId("")
      return
    }

    const assignedMatch = eligibleAssignees.some((staff) => staff.profile_id === selectedTicket.assigned_to)
      ? selectedTicket.assigned_to ?? ""
      : ""

    setAssignmentTargetId(assignedMatch)
    setAssigneeSearch("")
  }, [eligibleAssignees, isAdmin, selectedTicket])

  useEffect(() => {
    if (!selectedTicket) {
      return
    }

    setStatusDraft(selectedTicket.status)
    setCommentType(selectedTicket.requester_id === user?.id ? "public" : "internal")
  }, [selectedTicket, user?.id])

  const visibleTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      const canSeeTicket =
        isAdmin ||
        (isStaff ? ticket.requester_id === user?.id || ticket.assigned_to === user?.id : ticket.requester_id === user?.id)

      if (!canSeeTicket) return false

      const categoryName = categories.find((category) => category.id === ticket.category_id)?.name ?? ""
      const haystack = [ticket.ticket_number, ticket.title, ticket.summary ?? "", ticket.status, ticket.priority, categoryName]
        .join(" ")
        .toLowerCase()

      const matchesSearch = !search || haystack.includes(search.toLowerCase())
      const matchesStatus = !statusFilter || ticket.status === statusFilter
      const matchesPriority = !priorityFilter || ticket.priority === priorityFilter
      return matchesSearch && matchesStatus && matchesPriority
    })
  }, [tickets, categories, isAdmin, isStaff, user?.id, search, statusFilter, priorityFilter])

  useEffect(() => {
    if (!selectedTicket) {
      return
    }

    let cancelled = false
    const profileIds = [selectedTicket.requester_id, selectedTicket.assigned_to].filter((id): id is string => Boolean(id))

    setDetailLoading(true)
    setTicketPeople({ requester: "", assigned: "" })

    void Promise.all([
      fetchTicketComments(selectedTicket.id),
      fetchTicketAuditLog(selectedTicket.id),
      fetchTicketAttachments(selectedTicket.id),
      fetchTicketNotifications(selectedTicket.id),
    ])
      .then(([comments, auditLog, attachments, notifications]) => {
        if (cancelled) return
        setDetail({ comments, auditLog, attachments, notifications })
      })
      .catch((error) => {
        if (cancelled) return
        logError("Failed to load ticket detail", error)
        toast.error("Ticket details failed", getErrorMessage(error))
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false)
        }
      })

    void fetchProfilesByIds(profileIds)
      .then((profiles) => {
        if (cancelled) return

        const profileMap = new Map(profiles.map((profile) => [profile.id, profile.full_name?.trim() || profile.email]))

        setTicketPeople({
          requester: profileMap.get(selectedTicket.requester_id) ?? selectedTicket.requester_id,
          assigned: selectedTicket.assigned_to
            ? profileMap.get(selectedTicket.assigned_to) ?? selectedTicket.assigned_to
            : "Unassigned",
        })
      })
      .catch((error) => {
        if (cancelled) return
        logError("Failed to load ticket profile names", error)
        setTicketPeople({
          requester: selectedTicket.requester_id,
          assigned: selectedTicket.assigned_to ?? "Unassigned",
        })
      })

    return () => {
      cancelled = true
    }
  }, [selectedTicket, toast])

  const totalTickets = report?.total_count ?? tickets.length
  const totalOpen = report
    ? report.new_count + report.assigned_count + report.in_progress_count + report.pending_user_count
    : tickets.filter((ticket) => !["resolved", "closed", "archived"].includes(ticket.status)).length
  const unassigned = report?.unassigned_count ?? tickets.filter((ticket) => !ticket.assigned_to).length
  const inProgressTickets = report?.in_progress_count ?? tickets.filter((ticket) => ticket.status === "in_progress").length
  const pendingUserTickets = report?.pending_user_count ?? tickets.filter((ticket) => ticket.status === "pending_user").length
  const highPriority = tickets.filter((ticket) => ["high", "critical"].includes(ticket.priority)).length
  const hasFilters = Boolean(search || statusFilter || priorityFilter)
  const visibleTicketCount = visibleTickets.length

  function clearFilters() {
    setSearch("")
    setStatusFilter("")
    setPriorityFilter("")
  }

  const columns = [
    {
      accessor: "ticket_number",
      header: "Ticket #",
      sortable: true,
      searchable: true,
      className: "whitespace-nowrap min-w-[180px]",
      cell: (value: string, row: TicketRow) => (
        <div className="flex items-center gap-3 whitespace-nowrap">
          <TableAvatar>
            {value.slice(0, 2).toUpperCase() || row.ticket_number.slice(0, 2).toUpperCase() || "TK"}
          </TableAvatar>
          <div className="min-w-0">
            <div className="font-mono text-sm text-white">{value}</div>
            <div className="text-xs text-slate-400">Ticket reference</div>
          </div>
        </div>
      ),
    },
    {
      accessor: "title",
      header: "Title",
      sortable: true,
      searchable: true,
      className: "min-w-[300px]",
      cell: (value: string) => <span className="block min-w-0 max-w-[320px] truncate font-medium text-white" title={value}>{value}</span>,
    },
    {
      accessor: "category_id",
      header: "Category",
      sortable: true,
      className: "min-w-[240px]",
      cell: (_value: string, row: TicketRow) => {
        const categoryName = categories.find((category) => category.id === row.category_id)?.name ?? row.category_id
        return <span className="block min-w-0 max-w-[240px] truncate text-slate-400" title={categoryName}>{categoryName}</span>
      },
    },
    {
      accessor: "priority",
      header: "Priority",
      sortable: true,
      className: "whitespace-nowrap min-w-[150px]",
      cell: (value: string) => <span className="text-slate-400">{labelize(value)}</span>,
    },
    {
      accessor: "status",
      header: "Status",
      sortable: true,
      className: "whitespace-nowrap min-w-[150px]",
      cell: (value: string) => (
        <TableBadge tone={badgeTone(value)}>
          {labelize(value)}
        </TableBadge>
      ),
    },
    {
      accessor: "assigned_to",
      header: "Assignment",
      sortable: true,
      className: "min-w-[240px]",
      cell: (value: string | null) => <span className="block min-w-0 max-w-[260px] truncate text-slate-400" title={value ?? "Unassigned"}>{value ?? "Unassigned"}</span>,
    },
    {
      accessor: "updated_at",
      header: "Updated",
      sortable: true,
      className: "whitespace-nowrap min-w-[180px]",
      cell: (value: string) => <span className="text-slate-400">{formatTicketDate(value)}</span>,
    },
  ]

  async function handleCommentSubmit() {
    if (!selectedTicket || !commentDraft.trim()) return

    try {
      await addTicketComment({
        ticketId: selectedTicket.id,
        content: commentDraft.trim(),
        commentType,
        isCloseRequest: false,
      })
      setCommentDraft("")
      await loadTickets()
      toast.success("Comment added", "The ticket timeline has been updated.")
    } catch (error) {
      toast.error("Comment failed", getErrorMessage(error))
    }
  }

  async function handleStatusChange(nextStatus: string) {
    if (!selectedTicket) return

    try {
      await transitionTicketStatus(selectedTicket.id, nextStatus, "Updated from the Tickets screen", isAdmin)
      await loadTickets()
      toast.success("Ticket updated", `Status changed to ${labelize(nextStatus)}.`)
    } catch (error) {
      toast.error("Status change failed", getErrorMessage(error))
    }
  }

  async function handleCloseRequest() {
    if (!selectedTicket) return

    try {
      await requestTicketClose(selectedTicket.id, commentDraft.trim() || undefined)
      setCommentDraft("")
      await loadTickets()
      toast.success("Close requested", "The requester close request was recorded.")
    } catch (error) {
      toast.error("Close request failed", getErrorMessage(error))
    }
  }

  async function handleArchiveToggle() {
    if (!selectedTicket) return

    try {
      if (selectedTicket.is_deleted) {
        await restoreTicket(selectedTicket.id, "Restored from Tickets screen")
        toast.success("Ticket restored", "The archived ticket was restored.")
      } else {
        await archiveTicket(selectedTicket.id, "Archived from Tickets screen")
        toast.success("Ticket archived", "The ticket was moved to archive.")
      }
      await loadTickets()
    } catch (error) {
      toast.error("Archive action failed", getErrorMessage(error))
    }
  }

  async function handleAssignToSelf() {
    if (!selectedTicket || !user?.id) return

    try {
      await assignTicket(selectedTicket.id, user.id, "Assigned to self from Tickets screen")
      await loadTickets()
      toast.success("Ticket assigned", "The ticket is now assigned to you.")
    } catch (error) {
      toast.error("Assignment failed", getErrorMessage(error))
    }
  }

  async function handleAssignToStaff() {
    if (!selectedTicket || !assignmentTargetId) return

    try {
      await assignTicket(selectedTicket.id, assignmentTargetId, "Assigned from Tickets screen")
      await loadTickets()
      toast.success("Ticket assigned", "The ticket has been assigned.")
    } catch (error) {
      toast.error("Assignment failed", getErrorMessage(error))
    }
  }

  function updateWizardAnswer(stepKey: string, value: string) {
    setWizardAnswers((current) => ({ ...current, [stepKey]: value }))
  }

  function buildTemplatePayload() {
    return {
      category_id: wizardCategoryId,
      template_id: wizardTemplateId,
      template_steps: wizardTemplateSteps,
      answers: wizardAnswers,
      requested_by: user?.id ?? null,
    }
  }

  async function handleCreateTicket() {
    if (!selectedTemplate || !selectedCategory) return

    const title = wizardTitle.trim() || selectedTemplate.name
    const summary = wizardSummary.trim() || wizardReviewSummary

    try {
      setWizardSubmitting(true)
      const created = await createTicketFromTemplate({
        templateCode: selectedTemplate.code,
        title,
        summary,
        priority: wizardPriority,
        submissionPayload: buildTemplatePayload(),
        deviceContext: wizardDeviceContext,
        requestContext: {
          category: selectedCategory.name,
          template: selectedTemplate.name,
          route: typeof window !== "undefined" ? window.location.pathname : null,
        },
      })

      toast.success("Ticket created", `Ticket ${created.ticket_number} was submitted successfully.`)
      setWizardOpen(false)
      resetWizard()
      await loadTickets()
      setDetailLoading(true)
      setDetail({ comments: [], auditLog: [], attachments: [], notifications: [] })
      setTicketPeople({ requester: "", assigned: "" })
      setSelectedTicketId(created.id)
    } catch (error) {
      toast.error("Ticket creation failed", getErrorMessage(error))
    } finally {
      setWizardSubmitting(false)
    }
  }

  const detailStatusOptions = ["new", "assigned", "in_progress", "pending_user", "resolved", "closed", "reopened", "archived"]

  const detailActions = selectedTicket && selectedTicketAccessible && isAdmin
    ? [
        { label: selectedTicket.is_deleted ? "Restore" : "Archive", onClick: handleArchiveToggle, icon: ArchiveRestore },
      ]
    : []

  function renderWizardField(step: TicketTemplateStep) {
    const config = asRecord(step.config)
    const fieldType = String(config.field_type ?? config.type ?? "short_text")
    const prompt = String(config.prompt ?? step.label)
    const helperText = typeof config.helper_text === "string" ? config.helper_text : ""
    const options = normalizeFieldOptions(config.options)
    const value = wizardAnswers[step.step_key] ?? ""

    return (
      <div key={step.id} className="space-y-2 rounded-xl border border-[var(--color-border)] p-4">
        <div>
          <div className="text-sm font-medium text-[var(--color-text)]">{prompt}</div>
          {helperText ? <div className="text-xs text-[var(--color-muted)]">{helperText}</div> : null}
        </div>

        {fieldType === "yes_no" ? (
          <Select value={value} onChange={(event) => updateWizardAnswer(step.step_key, event.target.value)}>
            <option value="">Select</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </Select>
        ) : fieldType === "select" || fieldType === "segment" ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {(options.length > 0 ? options : ["Yes", "No"]).map((option) => (
              <Button
                key={option}
                type="button"
                variant={value === option ? "outline" : "ghost"}
                onClick={() => updateWizardAnswer(step.step_key, option)}
                className="justify-start"
              >
                {option}
              </Button>
            ))}
          </div>
        ) : fieldType === "textarea" ? (
          <Textarea
            value={value}
            onChange={(event) => updateWizardAnswer(step.step_key, event.target.value)}
            rows={4}
            placeholder={prompt}
          />
        ) : (
          <Input
            value={value}
            onChange={(event) => updateWizardAnswer(step.step_key, event.target.value)}
            placeholder={prompt}
          />
        )}
      </div>
    )
  }

  const pageHeading = isAdmin ? "All Tickets" : isStaff ? "My Assigned" : "My Tickets"
  const pageSummary = isAdmin
    ? "Operational queue, templates, and reporting across the ICT domain."
    : isStaff
      ? "Tickets assigned to you and the current support workload."
      : "Your own ICT requests and request history."

  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)]">
        <RefreshCw className="size-6 animate-spin text-[var(--color-accent)]" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] px-3 py-1 text-xs uppercase tracking-wide text-[var(--color-muted)]">
              <Ticket className="size-3.5" />
              ICT Tickets
            </p>
            <h1 className="text-2xl font-semibold text-[var(--color-text)]">{pageHeading}</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">{pageSummary}</p>
          </div>
          <div className="grid gap-2 text-sm text-[var(--color-muted)]">
            <div className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2">
              <ShieldCheck className="size-4" />
              {user?.roles.join(", ") || "No roles"}
            </div>
            <Button onClick={openWizard} className="justify-center">
              <Plus className="mr-2 size-4" />
              Add Ticket
            </Button>
          </div>
        </div>
      </section>

      <StatisticGrid>
        <StatisticCard label="Total Tickets" value={totalTickets} icon={Ticket} description="All tickets captured in the system" accentClassName="text-cyan-300" glowClassName="from-cyan-400/25 via-cyan-400/10 to-transparent" />
        <StatisticCard label="Open" value={totalOpen} icon={ClipboardList} description="Tickets still waiting on action" accentClassName="text-amber-300" glowClassName="from-amber-400/25 via-amber-400/10 to-transparent" />
        <StatisticCard label="Unassigned" value={unassigned} icon={ArrowRightLeft} description="Tickets needing an owner" accentClassName="text-rose-300" glowClassName="from-rose-400/25 via-rose-400/10 to-transparent" />
        <StatisticCard label="In Progress" value={inProgressTickets} icon={RefreshCw} description="Tickets actively being worked" accentClassName="text-emerald-300" glowClassName="from-emerald-400/25 via-emerald-400/10 to-transparent" />
        <StatisticCard label="Pending User" value={pendingUserTickets} icon={MessageSquare} description="Waiting on requester input" accentClassName="text-cyan-300" glowClassName="from-cyan-400/25 via-cyan-400/10 to-transparent" />
        <StatisticCard label="High Priority" value={highPriority} icon={Clock3} description="Work needing fast attention" accentClassName="text-amber-300" glowClassName="from-amber-400/25 via-amber-400/10 to-transparent" />
      </StatisticGrid>

      <section className="space-y-4">
        <Card className="w-full overflow-hidden">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Ticket Queue</CardTitle>
                <p className="mt-1 text-sm text-[var(--color-muted)]">
                  Showing {visibleTicketCount} of {totalTickets} tickets
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                {hasFilters ? (
                  <Button variant="ghost" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => void loadTickets()}>
                  <RefreshCw className="mr-2 size-4" />
                  Refresh queue
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-4 pb-0 sm:px-0">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="relative md:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted)]" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tickets" className="pl-9" />
              </div>
              <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">All statuses</option>
                <option value="new">New</option>
                <option value="assigned">Assigned</option>
                <option value="in_progress">In progress</option>
                <option value="pending_user">Pending user</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
                <option value="archived">Archived</option>
              </Select>
              <Select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
                <option value="">All priorities</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </Select>
            </div>

            <DataTable
              data={visibleTickets}
              columns={columns}
              initialSort={{ id: "updated_at", desc: true }}
              emptyMessage="No tickets matched the current filters"
              onRowClick={(row) => {
                setSelectedTicketId(row.id)
                setStatusDraft(row.status)
                setCommentType(row.requester_id === user?.id ? "public" : "internal")
                setDetailLoading(true)
                setDetail({ comments: [], auditLog: [], attachments: [], notifications: [] })
                setTicketPeople({ requester: "", assigned: "" })
              }}
            />
          </CardContent>
        </Card>
      </section>

      <Dialog
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open)
          if (!open) resetWizard()
        }}
        title="New Ticket"
        contentClassName="max-w-[96rem]"
      >
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3 text-xs text-[var(--color-muted)]">
            <span>Step {wizardStep} of 4</span>
            <span>{selectedCategory?.name ?? "Choose a category"}</span>
          </div>

          <div className="grid gap-2 sm:grid-cols-4">
            {[
              "Category",
              "Issue",
              "Questions",
              "Review",
            ].map((label, index) => (
              <div
                key={label}
                className={`rounded-lg border px-3 py-2 text-sm ${wizardStep >= index + 1 ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-[var(--color-text)]" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}
              >
                {label}
              </div>
            ))}
          </div>

          {wizardStep === 1 && (
            <div className="space-y-3">
              <div>
                <h3 className="text-lg font-semibold text-[var(--color-text)]">Pick a category</h3>
                <p className="text-sm text-[var(--color-muted)]">Choose the school ICT area that best matches the issue.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {categories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={`rounded-xl border p-4 text-left transition ${wizardCategoryId === category.id ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]" : "border-[var(--color-border)] hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-row-hover)]"}`}
                    onClick={() => {
                      setWizardCategoryId(category.id)
                      setWizardTemplateId("")
                      setWizardTemplateSteps([])
                      setWizardAnswers({})
                      setWizardStep(2)
                      setWizardTitle("")
                      setWizardSummary("")
                    }}
                  >
                    <div className="font-medium text-[var(--color-text)]">{category.name}</div>
                    <div className="mt-1 text-sm text-[var(--color-muted)]">{labelize(category.code)}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--color-text)]">Pick an issue</h3>
                  <p className="text-sm text-[var(--color-muted)]">Templates are tailored to the selected school device or service.</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setWizardStep(1)}
                >
                  <ChevronLeft className="mr-2 size-4" />
                  Back
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {wizardTemplates.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className={`rounded-xl border p-4 text-left transition ${wizardTemplateId === template.id ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)]" : "border-[var(--color-border)] hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-row-hover)]"}`}
                    onClick={() => {
                      setWizardTemplateId(template.id)
                      setWizardAnswers({})
                      setWizardTitle(template.name)
                      setWizardSummary(template.description ?? `${selectedCategory?.name ?? "ICT"} - ${template.name}`)
                    }}
                  >
                    <div className="font-medium text-[var(--color-text)]">{template.name}</div>
                    <div className="mt-1 text-sm text-[var(--color-muted)]">{template.description || "No description available"}</div>
                  </button>
                ))}
              </div>

              {wizardTemplates.length === 0 ? (
                <p className="text-sm text-[var(--color-muted)]">No templates are seeded for this category yet.</p>
              ) : null}
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--color-text)]">Answer the questions</h3>
                  <p className="text-sm text-[var(--color-muted)]">These steps drive the ticket summary and help IT triage faster.</p>
                </div>
                <Button type="button" variant="ghost" onClick={() => setWizardStep(2)}>
                  <ChevronLeft className="mr-2 size-4" />
                  Back
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-4">
                  <div className="rounded-xl border border-[var(--color-border)] p-4">
                    <div className="text-sm font-medium text-[var(--color-text)]">Ticket title</div>
                    <Input value={wizardTitle} onChange={(event) => setWizardTitle(event.target.value)} placeholder="Short summary title" />
                  </div>
                  <div className="rounded-xl border border-[var(--color-border)] p-4">
                    <div className="text-sm font-medium text-[var(--color-text)]">Priority</div>
                    <Select value={wizardPriority} onChange={(event) => setWizardPriority(event.target.value)}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </Select>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border)] p-4">
                    <div className="text-sm font-medium text-[var(--color-text)]">Summary</div>
                    <Textarea value={wizardSummary} onChange={(event) => setWizardSummary(event.target.value)} rows={4} placeholder="What is happening and who is affected?" />
                  </div>
                </div>

                <div className="space-y-4">
                  {wizardTemplateSteps.length === 0 ? (
                    <p className="text-sm text-[var(--color-muted)]">Loading template questions...</p>
                  ) : (
                    wizardTemplateSteps.map((step) => renderWizardField(step))
                  )}
                </div>
              </div>
            </div>
          )}

          {wizardStep === 4 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--color-text)]">Review</h3>
                  <p className="text-sm text-[var(--color-muted)]">Check the summary before submitting the ticket.</p>
                </div>
                <Button type="button" variant="ghost" onClick={() => setWizardStep(3)}>
                  <ChevronLeft className="mr-2 size-4" />
                  Back
                </Button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3 rounded-xl border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted)]">
                  <div><span className="text-[var(--color-text)]">Category:</span> {selectedCategory?.name}</div>
                  <div><span className="text-[var(--color-text)]">Issue:</span> {selectedTemplate?.name}</div>
                  <div><span className="text-[var(--color-text)]">Priority:</span> {labelize(wizardPriority)}</div>
                  <div><span className="text-[var(--color-text)]">Title:</span> {wizardTitle || selectedTemplate?.name}</div>
                  <div><span className="text-[var(--color-text)]">Summary:</span> {wizardReviewSummary}</div>
                </div>

                <div className="space-y-3 rounded-xl border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted)]">
                  <div className="text-[var(--color-text)]">Answers</div>
                  {wizardTemplateSteps.map((step) => (
                    <div key={step.id} className="flex justify-between gap-4 border-b border-[var(--color-border)] py-2 last:border-b-0">
                      <span>{step.label}</span>
                      <span className="text-[var(--color-text)]">{wizardAnswers[step.step_key] || "-"}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-[var(--color-border)] p-4 text-xs text-[var(--color-muted)]">
                Device context will capture browser details, route, and submission metadata automatically.
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
            <Button type="button" variant="ghost" onClick={() => { setWizardOpen(false); resetWizard() }}>
              Cancel
            </Button>

            <div className="flex gap-2">
              {wizardStep > 1 && wizardStep < 4 ? (
                <Button type="button" variant="ghost" onClick={() => setWizardStep((step) => Math.max(1, step - 1))}>
                  <ChevronLeft className="mr-2 size-4" />
                  Back
                </Button>
              ) : null}

              {wizardStep === 1 ? (
                <Button type="button" onClick={() => wizardCategoryId && setWizardStep(2)} disabled={!wizardCategoryId}>
                  Continue
                  <ChevronRight className="ml-2 size-4" />
                </Button>
              ) : null}

              {wizardStep === 2 ? (
                <Button type="button" onClick={() => wizardTemplateId && setWizardStep(3)} disabled={!wizardTemplateId}>
                  Continue
                  <ChevronRight className="ml-2 size-4" />
                </Button>
              ) : null}

              {wizardStep === 3 ? (
                <Button
                  type="button"
                  onClick={() => setWizardStep(4)}
                  disabled={wizardTemplateSteps.some((step) => step.required && !wizardAnswers[step.step_key]?.trim())}
                >
                  Review
                  <ChevronRight className="ml-2 size-4" />
                </Button>
              ) : null}

              {wizardStep === 4 ? (
                <Button type="button" onClick={() => void handleCreateTicket()} disabled={wizardSubmitting || !wizardTemplateId || !wizardCategoryId}>
                  {wizardSubmitting ? "Submitting..." : "Submit Ticket"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(selectedTicket)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedTicketId(null)
            setDetailLoading(false)
          }
        }}
        title={selectedTicket?.ticket_number ?? "Ticket details"}
      >
        {selectedTicket ? (
          selectedTicketAccessible ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-[var(--color-border)] p-3">
                  <div className="text-xs text-[var(--color-muted)]">Status</div>
                  <div className="mt-1 font-medium text-[var(--color-text)]">{labelize(selectedTicket.status)}</div>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] p-3">
                  <div className="text-xs text-[var(--color-muted)]">Priority</div>
                  <div className="mt-1 font-medium text-[var(--color-text)]">{labelize(selectedTicket.priority)}</div>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] p-3">
                  <div className="text-xs text-[var(--color-muted)]">Requester</div>
                  <div className="mt-1 truncate font-medium text-[var(--color-text)]">{ticketPeople.requester || selectedTicket.requester_id}</div>
                </div>
                <div className="rounded-lg border border-[var(--color-border)] p-3">
                  <div className="text-xs text-[var(--color-muted)]">Assigned</div>
                  <div className="mt-1 truncate font-medium text-[var(--color-text)]">{ticketPeople.assigned || selectedTicket.assigned_to || "Unassigned"}</div>
                </div>
              </div>

              <div className="rounded-lg border border-[var(--color-border)] p-3 text-sm text-[var(--color-muted)]">
                {isAdmin
                  ? "Admin controls are available for assignment, status changes, and archive actions."
                  : isStaff
                    ? "Assigned by Admin only. You can update status and comments on this ticket."
                    : "Requester-only access. You can request closure and add comments on your own ticket."
                }
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Summary</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-[var(--color-muted)]">
                    <p className="text-[var(--color-text)]">{selectedTicket.title}</p>
                    <p>{selectedTicket.summary || "No summary stored."}</p>
                    <p>Created {formatTicketDate(selectedTicket.created_at)}</p>
                    <p>Updated {formatTicketDate(selectedTicket.updated_at)}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {isAdmin ? (
                      <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
                        <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Assignment</div>
                        <Input
                          value={assigneeSearch}
                          onChange={(event) => setAssigneeSearch(event.target.value)}
                          placeholder="Filter active IT staff"
                        />
                        <Select
                          value={assignmentTargetId}
                          onChange={(event) => setAssignmentTargetId(event.target.value)}
                          disabled={staffDirectoryLoading || filteredAssignees.length === 0}
                        >
                          <option value="">Select staff member</option>
                          {filteredAssignees.map((staff) => (
                            <option key={staff.id} value={staff.profile_id ?? ""}>
                              {formatStaffLabel(staff)}
                            </option>
                          ))}
                        </Select>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" onClick={() => void handleAssignToStaff()} disabled={!assignmentTargetId}>
                            Assign
                          </Button>
                          <Button variant="outline" onClick={() => void handleAssignToSelf()}>
                            Assign to me
                          </Button>
                        </div>
                        <div className="text-xs text-[var(--color-muted)]">
                          {staffDirectoryLoading
                            ? "Loading assignees..."
                            : `${filteredAssignees.length} of ${eligibleAssignees.length} active IT staff available`}
                        </div>
                      </div>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                      {detailActions.map((action) => {
                        const Icon = action.icon
                        return (
                          <Button key={action.label} variant="outline" onClick={action.onClick}>
                            <Icon className="mr-2 size-4" />
                            {action.label}
                          </Button>
                        )
                      })}
                    </div>

                    {selectedTicketCanProcess && (isAdmin || isStaff) ? (
                      <>
                        <div className="grid gap-2 md:grid-cols-2">
                          <Select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)}>
                            {detailStatusOptions.map((option) => (
                              <option key={option} value={option}>
                                {labelize(option)}
                              </option>
                            ))}
                          </Select>
                          <Button variant="outline" onClick={() => void handleStatusChange(statusDraft)}>
                            Change status
                          </Button>
                        </div>
                        <div className="grid gap-2 md:grid-cols-2">
                          <Button variant="ghost" onClick={() => void loadTickets()}>
                            Refresh queue
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2">
                        <Button variant="ghost" onClick={() => void handleCloseRequest()}>
                          Request close
                        </Button>
                        <Button variant="ghost" onClick={() => void loadTickets()}>
                          Refresh queue
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Add Comment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} rows={4} placeholder="Write a public or internal note" />
                  {(isAdmin || isStaff) && (
                    <Select value={commentType} onChange={(event) => setCommentType(event.target.value)}>
                      <option value="public">Public</option>
                      <option value="internal">Internal</option>
                    </Select>
                  )}
                  <Button onClick={() => void handleCommentSubmit()} disabled={!commentDraft.trim()}>
                    <MessageSquare className="mr-2 size-4" />
                    Add comment
                  </Button>
                </CardContent>
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Comments</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {detailLoading ? (
                      <p className="text-sm text-[var(--color-muted)]">Loading detail...</p>
                    ) : detail.comments.length === 0 ? (
                      <p className="text-sm text-[var(--color-muted)]">No comments yet.</p>
                    ) : (
                      detail.comments.map((comment) => (
                        <div key={comment.id} className="rounded-lg border border-[var(--color-border)] p-3">
                          <div className="flex items-center justify-between gap-2 text-xs text-[var(--color-muted)]">
                            <span>{labelize(comment.comment_type)}</span>
                            <span>{formatTicketDate(comment.created_at)}</span>
                          </div>
                          <p className="mt-2 text-sm text-[var(--color-text)]">{comment.content}</p>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Activity</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm text-[var(--color-muted)]">
                    <div>
                      <div className="text-[var(--color-text)]">Audit log</div>
                      <div className="mt-2 space-y-2">
                        {detail.auditLog.slice(0, 5).map((entry) => (
                          <div key={entry.id} className="rounded-lg border border-[var(--color-border)] p-3">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="text-[var(--color-text)]">{labelize(entry.action)}</span>
                              <span>{formatTicketDate(entry.changed_at)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[var(--color-text)]">Attachments</div>
                      <p className="mt-1">{detail.attachments.length} uploaded file(s)</p>
                    </div>
                    <div>
                      <div className="text-[var(--color-text)]">Notifications</div>
                      <p className="mt-1">{detail.notifications.length} tracked notification(s)</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--color-border)] p-4 text-sm text-[var(--color-muted)]">
              This ticket is not accessible with your current permissions.
            </div>
          )
        ) : null}
      </Dialog>
    </div>
  )
}
