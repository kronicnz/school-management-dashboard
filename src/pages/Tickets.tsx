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
  fetchTicketNotifications,
  fetchProfilesByIds,
  fetchTicketTemplateSteps,
  fetchTicketTemplates,
  fetchTickets,
  addRmTicketComment,
  archiveRmTicket,
  assignRmTicket,
  createRmTicketFromTemplate,
  fetchRmTicketAttachments,
  fetchRmTicketAuditLog,
  fetchRmTicketCategories,
  fetchRmTicketComments,
  fetchRmTicketNotifications,
  fetchRmTicketTemplateSteps,
  fetchRmTicketTemplates,
  fetchRmTickets,
  claimRmTicket,
  requestRmTicketClose,
  restoreRmTicket,
  transitionRmTicketStatus,
  claimTicket,
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
import { useLocation, useSearchParams } from "react-router-dom"
import { can, capabilitiesForRoles } from "../lib/access/permissions"
import type { Capability } from "../lib/access/registry"

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

/**
 * Assignee eligibility is a capability check, not a role-name list, so it stays
 * in step with the `has_permission` guard inside `assign_ticket` /
 * `assign_rm_ticket`. The two must name the same capability or the dropdown
 * would offer someone the server then rejects.
 */
function canTakeAssignment(staff: StaffDirectoryRow, capability: Capability) {
  // `staff.role` and `staff.primary_role` are legacy single-role columns and are
  // deliberately not consulted: `roles` is the projection of `user_roles`.
  return staff.status === "active" && capabilitiesForRoles(staff.roles).has(capability)
}

function canAccessTicket(
  ticket: TicketRow | null,
  userId: string | undefined,
  canViewAll: boolean,
  canViewAssigned: boolean
) {
  if (!ticket) return false
  if (canViewAll) return true
  if (canViewAssigned) return ticket.requester_id === userId || ticket.assigned_to === userId
  return ticket.requester_id === userId
}

function canProcessTicket(
  ticket: TicketRow | null,
  userId: string | undefined,
  canManageAll: boolean,
  canViewAssigned: boolean
) {
  if (!ticket) return false
  if (canManageAll) return true
  if (canViewAssigned) return ticket.requester_id === userId || ticket.assigned_to === userId
  return ticket.requester_id === userId
}

type TicketModuleKind = "ict" | "rm"

function isIctAssignee(staff: StaffDirectoryRow) {
  return canTakeAssignment(staff, "ict.update_assigned")
}

function isRmAssignee(staff: StaffDirectoryRow) {
  return canTakeAssignment(staff, "rm.assign")
}

export default function TicketsPage() {
  const toast = useToast()
  const { user } = useAuth()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const moduleKind: TicketModuleKind = location.pathname.startsWith("/rm-tickets") ? "rm" : "ict"
  const isRmModule = moduleKind === "rm"
  const moduleLabel = isRmModule ? "R&M Tickets" : "ICT Tickets"
  const moduleSubject = isRmModule ? "R&M ticket" : "ICT ticket"
  const moduleSubjectPlural = isRmModule ? "R&M tickets" : "ICT tickets"
  const moduleAssigneeLabel = isRmModule ? "active property managers and staff" : "active IT staff"
  const moduleRouteLabel = isRmModule ? "R&M Tickets screen" : "ICT Tickets screen"
  const moduleTheme = isRmModule
    ? {
        accent: "var(--color-warning)",
        accentSoft: "color-mix(in_srgb,var(--color-warning)_10%,transparent)",
        accentBorder: "border-[color-mix(in_srgb,var(--color-warning)_35%,var(--color-border))]",
        label: "Property repairs and maintenance",
        surface: "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-warning)_14%,transparent),transparent)]",
      }
    : {
        accent: "var(--color-info)",
        accentSoft: "color-mix(in_srgb,var(--color-info)_10%,transparent)",
        accentBorder: "border-[color-mix(in_srgb,var(--color-info)_35%,var(--color-border))]",
        label: "ICT support and services",
        surface: "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-info)_14%,transparent),transparent)]",
      }
  const ticketApi = useMemo(
    () =>
      isRmModule
        ? {
            addComment: addRmTicketComment,
            archive: archiveRmTicket,
            assign: assignRmTicket,
            claim: claimRmTicket,
            create: createRmTicketFromTemplate,
            fetchAttachments: fetchRmTicketAttachments,
            fetchAuditLog: fetchRmTicketAuditLog,
            fetchCategories: fetchRmTicketCategories,
            fetchComments: fetchRmTicketComments,
            fetchNotifications: fetchRmTicketNotifications,
            fetchTemplates: fetchRmTicketTemplates,
            fetchTemplateSteps: fetchRmTicketTemplateSteps,
            fetchTickets: fetchRmTickets,
            requestClose: requestRmTicketClose,
            restore: restoreRmTicket,
            transitionStatus: transitionRmTicketStatus,
          }
        : {
            addComment: addTicketComment,
            archive: archiveTicket,
            assign: assignTicket,
            claim: claimTicket,
            create: createTicketFromTemplate,
            fetchAttachments: fetchTicketAttachments,
            fetchAuditLog: fetchTicketAuditLog,
            fetchCategories: fetchTicketCategories,
            fetchComments: fetchTicketComments,
            fetchNotifications: fetchTicketNotifications,
            fetchTemplates: fetchTicketTemplates,
            fetchTemplateSteps: fetchTicketTemplateSteps,
            fetchTickets,
            requestClose: requestTicketClose,
            restore: restoreTicket,
            transitionStatus: transitionTicketStatus,
          },
    [isRmModule]
  )
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
  const [wizardTemplateQuery, setWizardTemplateQuery] = useState("")
  const [wizardTemplateSteps, setWizardTemplateSteps] = useState<TicketTemplateStep[]>([])
  const [wizardAnswers, setWizardAnswers] = useState<Record<string, string>>({})
  const [wizardTitle, setWizardTitle] = useState("")
  const [wizardSummary, setWizardSummary] = useState("")
  const [wizardPriority, setWizardPriority] = useState("medium")
  const [wizardSubmitting, setWizardSubmitting] = useState(false)
  const [staffDirectoryRows, setStaffDirectoryRows] = useState<StaffDirectoryRow[]>([])
  const [staffDirectoryLoadingState, setStaffDirectoryLoadingState] = useState(false)
  const [assigneeSearch, setAssigneeSearch] = useState("")
  const [assignmentTargetId, setAssignmentTargetId] = useState("")

  // One capability set drives the whole page, switched on the module prefix.
  const canViewAllTickets = can(user?.roles, isRmModule ? "rm.view_all" : "ict.view_all")
  const canViewAssignedTickets = can(user?.roles, isRmModule ? "rm.view_assigned" : "ict.view_assigned")
  const canManageAllTickets = can(user?.roles, isRmModule ? "rm.assign" : "ict.assign")
  const canCreateTicket = can(user?.roles, isRmModule ? "rm.create" : "ict.create")
  // The transition RPCs take an `override` flag that the database gates on the
  // same assign capability, so this is the one flag they both want.
  const categoryFilterCode = searchParams.get("category")?.trim().toLowerCase() ?? ""
  const moduleCategories = useMemo(
    () => (isRmModule ? categories : categories.filter((category) => category.code !== "property_rm")),
    [categories, isRmModule]
  )
  const moduleTickets = useMemo(
    () =>
      isRmModule
        ? tickets
        : tickets.filter((ticket) => moduleCategories.find((category) => category.id === ticket.category_id)?.code !== "property_rm"),
    [isRmModule, moduleCategories, tickets]
  )

  const categoryById = useMemo(() => new Map(moduleCategories.map((category) => [category.id, category])), [moduleCategories])

  const activeCategory = useMemo(() => {
    if (!categoryFilterCode) return null
    return moduleCategories.find((category) => category.code === categoryFilterCode) ?? null
  }, [moduleCategories, categoryFilterCode])

  const selectedCategory = useMemo(
    () => moduleCategories.find((category) => category.id === wizardCategoryId) ?? null,
    [moduleCategories, wizardCategoryId]
  )

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === wizardTemplateId) ?? null,
    [templates, wizardTemplateId]
  )

  const wizardTemplates = useMemo(
    () => templates.filter((template) => template.category_id === wizardCategoryId),
    [templates, wizardCategoryId]
  )

  const filteredWizardTemplates = useMemo(() => {
    const query = wizardTemplateQuery.trim().toLowerCase()
    if (!query) return wizardTemplates

    return wizardTemplates.filter((template) => {
      const haystack = [template.name, template.description ?? "", template.code].join(" ").toLowerCase()
      return haystack.includes(query)
    })
  }, [wizardTemplateQuery, wizardTemplates])

  const wizardRequiredStepCount = useMemo(
    () => wizardTemplateSteps.filter((step) => step.required).length,
    [wizardTemplateSteps]
  )

  const wizardAnsweredStepCount = useMemo(
    () => wizardTemplateSteps.filter((step) => Boolean(wizardAnswers[step.step_key]?.trim())).length,
    [wizardAnswers, wizardTemplateSteps]
  )

  const wizardAnsweredRequiredCount = useMemo(
    () => wizardTemplateSteps.filter((step) => step.required && Boolean(wizardAnswers[step.step_key]?.trim())).length,
    [wizardAnswers, wizardTemplateSteps]
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
    () =>
      (canManageAllTickets ? staffDirectoryRows : []).filter((staff) =>
        (isRmModule ? isRmAssignee(staff) : isIctAssignee(staff)) && staff.profile_id && staff.profile_id !== user?.id
      ),
    [canManageAllTickets, isRmModule, staffDirectoryRows, user?.id]
  )

  const staffDirectoryLoading = canManageAllTickets ? staffDirectoryLoadingState : false

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
    setWizardTemplateQuery("")
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
    if (!canManageAllTickets) {
      return
    }

    let cancelled = false

    queueMicrotask(() => {
      if (!cancelled) {
        setStaffDirectoryLoadingState(true)
      }
    })

    void fetchStaff()
      .then((rows) => {
        if (!cancelled) {
          setStaffDirectoryRows(rows)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          logError("Failed to load staff directory", error)
          toast.error("Staff directory failed to load", getErrorMessage(error))
          setStaffDirectoryRows([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setStaffDirectoryLoadingState(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [canManageAllTickets, toast])

  const loadTickets = useCallback(async () => {
    try {
      setLoading(true)
      const [ticketData, categoryData, templateData] = await Promise.all([
        ticketApi.fetchTickets(),
        ticketApi.fetchCategories(),
        ticketApi.fetchTemplates(),
      ])
      setTickets(ticketData)
      setCategories(categoryData)
      setTemplates(templateData)
      setReport(null)
    } catch (error) {
      logError("Failed to load tickets", error)
      toast.error("Tickets failed to load", getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [ticketApi, toast])

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

    void ticketApi.fetchTemplateSteps(wizardTemplateId)
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
  }, [ticketApi, toast, wizardTemplateId])

  const selectedTicket = useMemo(
    () => moduleTickets.find((ticket) => ticket.id === selectedTicketId) ?? null,
    [selectedTicketId, moduleTickets]
  )

  const selectedTicketAccessible = useMemo(
    () => canAccessTicket(selectedTicket, user?.id, canViewAllTickets, canViewAssignedTickets),
    [canViewAllTickets, canViewAssignedTickets, selectedTicket, user?.id]
  )

  const selectedTicketCanProcess = useMemo(
    () => canProcessTicket(selectedTicket, user?.id, canManageAllTickets, canViewAssignedTickets),
    [canManageAllTickets, canViewAssignedTickets, selectedTicket, user?.id]
  )

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled) return

      if (!selectedTicket) {
        setAssignmentTargetId("")
        setAssigneeSearch("")
        return
      }

      if (!canManageAllTickets) {
        setAssignmentTargetId("")
        return
      }

      const assignedMatch = eligibleAssignees.some((staff) => staff.profile_id === selectedTicket.assigned_to)
        ? selectedTicket.assigned_to ?? ""
        : ""

      setAssignmentTargetId(assignedMatch)
      setAssigneeSearch("")
    })

    return () => {
      cancelled = true
    }
  }, [eligibleAssignees, canManageAllTickets, selectedTicket])

  useEffect(() => {
    let cancelled = false

    queueMicrotask(() => {
      if (cancelled || !selectedTicket) {
        return
      }

      setStatusDraft(selectedTicket.status)
      setCommentType(selectedTicket.requester_id === user?.id ? "public" : "internal")
    })

    return () => {
      cancelled = true
    }
  }, [selectedTicket, user?.id])

  const visibleTickets = useMemo(() => {
    return moduleTickets.filter((ticket) => {
      const canSeeTicket = canAccessTicket(ticket, user?.id, canViewAllTickets, canViewAssignedTickets)

      if (!canSeeTicket) return false

      const categoryName = moduleCategories.find((category) => category.id === ticket.category_id)?.name ?? ""
      const categoryCode = categoryById.get(ticket.category_id)?.code ?? ""
      const matchesCategory = !categoryFilterCode || categoryCode === categoryFilterCode
      const haystack = [ticket.ticket_number, ticket.title, ticket.summary ?? "", ticket.status, ticket.priority, categoryName]
        .join(" ")
        .toLowerCase()

      const matchesSearch = !search || haystack.includes(search.toLowerCase())
      const matchesStatus = !statusFilter || ticket.status === statusFilter
      const matchesPriority = !priorityFilter || ticket.priority === priorityFilter
      return matchesCategory && matchesSearch && matchesStatus && matchesPriority
    })
  }, [moduleTickets, moduleCategories, categoryById, categoryFilterCode, canViewAllTickets, canViewAssignedTickets, user?.id, search, statusFilter, priorityFilter])

  useEffect(() => {
    if (!selectedTicket) {
      return
    }

    let cancelled = false
    const profileIds = [selectedTicket.requester_id, selectedTicket.assigned_to].filter((id): id is string => Boolean(id))

    queueMicrotask(() => {
      if (cancelled) return

      setDetailLoading(true)
      setTicketPeople({ requester: "", assigned: "" })
    })

    void Promise.all([
      ticketApi.fetchComments(selectedTicket.id),
      ticketApi.fetchAuditLog(selectedTicket.id),
      ticketApi.fetchAttachments(selectedTicket.id),
      ticketApi.fetchNotifications(selectedTicket.id),
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
  }, [selectedTicket, ticketApi, toast])

  const totalTickets = report?.total_count ?? moduleTickets.length
  const totalOpen = report
    ? report.new_count + report.assigned_count + report.in_progress_count + report.pending_user_count
    : moduleTickets.filter((ticket) => !["resolved", "closed", "archived"].includes(ticket.status)).length
  const unassigned = report?.unassigned_count ?? moduleTickets.filter((ticket) => !ticket.assigned_to).length
  const inProgressTickets = report?.in_progress_count ?? moduleTickets.filter((ticket) => ticket.status === "in_progress").length
  const pendingUserTickets = report?.pending_user_count ?? moduleTickets.filter((ticket) => ticket.status === "pending_user").length
  const highPriority = moduleTickets.filter((ticket) => ["high", "critical"].includes(ticket.priority)).length
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
            <div className="font-mono text-sm text-[var(--color-text)]">{value}</div>
            <div className="text-xs text-[var(--color-muted)]">Ticket reference</div>
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
      cell: (value: string) => <span className="block min-w-0 max-w-[320px] truncate font-medium text-[var(--color-text)]" title={value}>{value}</span>,
    },
    {
      accessor: "category_id",
      header: "Category",
      sortable: true,
      className: "min-w-[240px]",
      cell: (_value: string, row: TicketRow) => {
        const categoryName = moduleCategories.find((category) => category.id === row.category_id)?.name ?? row.category_id
        return <span className="block min-w-0 max-w-[240px] truncate text-[var(--color-muted)]" title={categoryName}>{categoryName}</span>
      },
    },
    {
      accessor: "priority",
      header: "Priority",
      sortable: true,
      className: "whitespace-nowrap min-w-[150px]",
      cell: (value: string) => <span className="text-[var(--color-muted)]">{labelize(value)}</span>,
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
      cell: (value: string | null) => <span className="block min-w-0 max-w-[260px] truncate text-[var(--color-muted)]" title={value ?? "Unassigned"}>{value ?? "Unassigned"}</span>,
    },
    {
      accessor: "updated_at",
      header: "Updated",
      sortable: true,
      className: "whitespace-nowrap min-w-[180px]",
      cell: (value: string) => <span className="text-[var(--color-muted)]">{formatTicketDate(value)}</span>,
    },
  ]

  async function handleCommentSubmit() {
    if (!selectedTicket || !commentDraft.trim()) return

    try {
      await ticketApi.addComment({
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
      await ticketApi.transitionStatus(selectedTicket.id, nextStatus, `Updated from the ${moduleRouteLabel}`, canManageAllTickets)
      await loadTickets()
      toast.success("Ticket updated", `Status changed to ${labelize(nextStatus)}.`)
    } catch (error) {
      toast.error("Status change failed", getErrorMessage(error))
    }
  }

  async function handleCloseRequest() {
    if (!selectedTicket) return

    try {
      await ticketApi.requestClose(selectedTicket.id, commentDraft.trim() || undefined)
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
        await ticketApi.restore(selectedTicket.id, `Restored from the ${moduleRouteLabel}`)
        toast.success("Ticket restored", "The archived ticket was restored.")
      } else {
        await ticketApi.archive(selectedTicket.id, `Archived from the ${moduleRouteLabel}`)
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
      // The claim RPC, not the assign RPC: it refuses to overwrite an existing
      // assignee and reports "already taken" separately from "not permitted".
      await ticketApi.claim(selectedTicket.id, `Taken from the ${moduleRouteLabel}`)
      await loadTickets()
      toast.success("Ticket taken", "The ticket is now assigned to you.")
    } catch (error) {
      toast.error("Could not take ticket", getErrorMessage(error))
    }
  }

  async function handleAssignToStaff() {
    if (!selectedTicket || !assignmentTargetId) return

    try {
      await ticketApi.assign(selectedTicket.id, assignmentTargetId, `Assigned from the ${moduleRouteLabel}`)
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
      const created = await ticketApi.create({
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

  const detailActions = selectedTicket && selectedTicketAccessible && (canManageAllTickets)
    ? [
        { label: selectedTicket.is_deleted ? "Restore" : "Archive", onClick: handleArchiveToggle, icon: ArchiveRestore },
      ]
    : []

  const wizardSteps = ["Category", "Issue", "Details", "Review"]
  const wizardProgress = Math.round(((wizardStep - 1) / Math.max(wizardSteps.length - 1, 1)) * 100)

  function renderWizardField(step: TicketTemplateStep) {
    const config = asRecord(step.config)
    const fieldType = String(config.field_type ?? config.type ?? "short_text")
    const prompt = String(config.prompt ?? step.label)
    const helperText = typeof config.helper_text === "string" ? config.helper_text : ""
    const options = normalizeFieldOptions(config.options)
    const value = wizardAnswers[step.step_key] ?? ""
    const isComplete = Boolean(value.trim())
    const fieldId = `wizard-step-${step.id}`
    const hintId = helperText ? `${fieldId}-hint` : undefined

    const fieldTypeLabel =
      fieldType === "yes_no"
        ? "Yes / No"
        : fieldType === "select"
          ? "Choice"
          : fieldType === "segment"
            ? "Quick pick"
        : fieldType === "textarea"
          ? "Notes"
          : "Text"
    const fieldSpanClass = fieldType === "textarea" ? "lg:col-span-2" : ""

    return (
      <fieldset
        key={step.id}
        className={`flex min-h-[9rem] flex-col justify-start gap-3 rounded-3xl border p-3.5 transition ${fieldSpanClass} ${isComplete ? `border-[color-mix(in_srgb,var(--color-accent)_40%,var(--color-border))] ${moduleTheme.surface}` : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}
      >
        <legend className="sr-only">{prompt}</legend>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <label htmlFor={fieldId} className="block text-sm font-semibold text-[var(--color-text)]">
              {prompt}
              {step.required ? <span className="ml-2 text-xs font-medium uppercase tracking-wide text-[var(--color-accent)]">Required</span> : null}
            </label>
            <p className="text-[11px] leading-4 text-[var(--color-muted)]">Use a clear, complete answer that the support team can act on quickly.</p>
          </div>
          <TableBadge tone={isComplete ? (isRmModule ? "amber" : "cyan") : "slate"}>{fieldTypeLabel}</TableBadge>
        </div>

        {helperText ? (
          <p id={hintId} className="text-xs leading-relaxed text-[var(--color-muted)]">
            {helperText}
          </p>
        ) : null}

        {fieldType === "yes_no" ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { label: "Yes", description: "The issue is confirmed" },
              { label: "No", description: "The issue does not apply" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={value === option.label}
                onClick={() => updateWizardAnswer(step.step_key, option.label)}
                className={`min-h-16 rounded-xl border px-3 py-2.5 text-left transition ${value === option.label ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]" : "border-[var(--color-border)] hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-row-hover)]"}`}
              >
                <div className="text-sm font-medium text-[var(--color-text)]">{option.label}</div>
                <div className="mt-1 text-xs text-[var(--color-muted)]">{option.description}</div>
              </button>
            ))}
          </div>
        ) : fieldType === "select" || fieldType === "segment" ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {(options.length > 0 ? options : ["Yes", "No"]).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => updateWizardAnswer(step.step_key, option)}
                className={`min-h-16 rounded-xl border px-3 py-2.5 text-left transition ${value === option ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]" : "border-[var(--color-border)] hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-row-hover)]"}`}
              >
                <div className="text-sm font-medium text-[var(--color-text)]">{option}</div>
              </button>
            ))}
          </div>
        ) : fieldType === "textarea" ? (
          <Textarea
            id={fieldId}
            aria-describedby={hintId}
            value={value}
            onChange={(event) => updateWizardAnswer(step.step_key, event.target.value)}
            rows={3}
            placeholder={`Enter ${prompt.toLowerCase()}`}
          />
        ) : (
          <Input
            id={fieldId}
            aria-describedby={hintId}
            value={value}
            onChange={(event) => updateWizardAnswer(step.step_key, event.target.value)}
            placeholder={`Enter ${prompt.toLowerCase()}`}
          />
        )}
      </fieldset>
    )
  }

  const pageHeading = activeCategory ? `${activeCategory.name} Queue` : canManageAllTickets ? `All ${moduleLabel}` : canViewAssignedTickets ? "My Assigned" : "My Tickets"
  const pageSummary = activeCategory
    ? `Viewing the ${activeCategory.name} slice of the existing ${moduleSubjectPlural.toLowerCase()} queue for ${isRmModule ? "facilities and leadership" : "IT support"}.`
    : canManageAllTickets
      ? `Operational queue, templates, and reporting across the ${moduleSubjectPlural.toLowerCase()} domain.`
      : canViewAssignedTickets
        ? `Tickets assigned to you and the current ${moduleSubject.toLowerCase()} workload.`
        : `Your own ${moduleSubjectPlural.toLowerCase()} and request history.`

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
              {moduleLabel}
            </p>
            <h1 className="text-2xl font-semibold text-[var(--color-text)]">{pageHeading}</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--color-muted)]">{pageSummary}</p>
            {activeCategory ? (
              <div className="mt-3">
                <TableBadge tone="violet">{activeCategory.name}</TableBadge>
              </div>
            ) : null}
          </div>
          <div className="grid gap-2 text-sm text-[var(--color-muted)]">
            <div className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2">
              <ShieldCheck className="size-4" />
              {user?.roles.join(", ") || "No roles"}
            </div>
              {canCreateTicket ? (
                <Button size="sm" onClick={openWizard} className="justify-center">
                  <Plus className="mr-2 size-4" />
                  Add {isRmModule ? "R&M Ticket" : "Ticket"}
                </Button>
              ) : null}
            </div>
          </div>
        </section>

      <StatisticGrid>
        <StatisticCard label="Total Tickets" value={totalTickets} icon={Ticket} description={`All ${moduleSubjectPlural.toLowerCase()} captured in the system`} tone="information" />
        <StatisticCard label="Open" value={totalOpen} icon={ClipboardList} description="Tickets still waiting on action" tone="warning" />
        <StatisticCard label="Unassigned" value={unassigned} icon={ArrowRightLeft} description={`Tickets needing an owner in the ${moduleSubject.toLowerCase()} queue`} tone="destructive" />
        <StatisticCard label="In Progress" value={inProgressTickets} icon={RefreshCw} description="Tickets actively being worked" tone="pending" />
        <StatisticCard label="Pending User" value={pendingUserTickets} icon={MessageSquare} description="Waiting on requester input" tone="inactive" />
        <StatisticCard label="High Priority" value={highPriority} icon={Clock3} description={`Work needing fast attention in the ${moduleSubject.toLowerCase()} queue`} tone="overdue" />
      </StatisticGrid>

      <section className="space-y-4">
        <Card className="w-full overflow-hidden">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>{moduleLabel} Queue</CardTitle>
                <p className="mt-1 text-sm text-[var(--color-muted)]">
                  Showing {visibleTicketCount} of {totalTickets} {moduleSubjectPlural.toLowerCase()}
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
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${moduleSubjectPlural.toLowerCase()}`} className="pl-9" />
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
               emptyMessage={`No ${moduleSubjectPlural.toLowerCase()} matched the current filters`}
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
        contentClassName="max-w-[88rem]"
      >
        <div className="space-y-5">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">
                <span className="rounded-full border border-[var(--color-border)] px-3 py-1">{moduleLabel}</span>
                <span>•</span>
                <span>{moduleTheme.label}</span>
              </div>
              <div>
                <h3 className="text-2xl font-semibold text-[var(--color-text)]">Create a ticket</h3>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--color-muted)]">
                  Select a category, choose a template, fill in the details, then review before submission.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
              <div className="flex items-center justify-between gap-3 text-sm text-[var(--color-muted)]">
                <span>Step {wizardStep} of {wizardSteps.length}</span>
                <span>{wizardProgress}% complete</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-secondary)]">
                <div className="h-full rounded-full bg-[var(--color-accent)] transition-all" style={{ width: `${wizardProgress}%` }} />
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {wizardSteps.map((label, index) => (
                  <div
                    key={label}
                    className={`rounded-2xl border px-3 py-2 text-sm transition ${wizardStep >= index + 1 ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-[var(--color-text)]" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{label}</span>
                      <span className="text-[11px] uppercase tracking-wide">{index + 1}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {wizardStep === 1 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-[var(--color-text)]">Choose a category</h3>
              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
                {moduleCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className={`flex min-h-32 flex-col justify-between rounded-2xl border p-4 text-left transition ${wizardCategoryId === category.id ? `border-[var(--color-accent)] ${moduleTheme.surface} shadow-sm` : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-row-hover)]"}`}
                    onClick={() => {
                      setWizardCategoryId(category.id)
                      setWizardTemplateId("")
                      setWizardTemplateQuery("")
                      setWizardTemplateSteps([])
                      setWizardAnswers({})
                      setWizardStep(2)
                      setWizardTitle("")
                      setWizardSummary("")
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold leading-snug text-[var(--color-text)]">{category.name}</div>
                        <div className="mt-1 text-xs uppercase tracking-wide text-[var(--color-muted)]">{labelize(category.code)}</div>
                      </div>
                      <TableBadge tone={wizardCategoryId === category.id ? "cyan" : "slate"}>{templates.filter((template) => template.category_id === category.id).length}</TableBadge>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--color-text)]">Choose an issue template</h3>
                  <p className="text-sm text-[var(--color-muted)]">Pick the template that best matches the request.</p>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setWizardStep(1)}>
                  <ChevronLeft className="mr-2 size-4" />
                  Back
                </Button>
              </div>

              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted)]" />
                <Input
                  value={wizardTemplateQuery}
                  onChange={(event) => setWizardTemplateQuery(event.target.value)}
                  placeholder={`Search ${moduleSubjectPlural.toLowerCase()} templates`}
                  className="pl-9"
                />
              </div>

              <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr))]">
                {filteredWizardTemplates.map((template) => {
                  const stepCount = wizardTemplateSteps.length && wizardTemplateId === template.id ? wizardTemplateSteps.length : 0
                  return (
                    <button
                      key={template.id}
                      type="button"
                      className={`flex min-h-32 flex-col justify-between rounded-2xl border p-4 text-left transition ${wizardTemplateId === template.id ? `border-[var(--color-accent)] ${moduleTheme.surface} shadow-sm` : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-row-hover)]"}`}
                      onClick={() => {
                        setWizardTemplateId(template.id)
                        setWizardAnswers({})
                        setWizardTitle(template.name)
                        setWizardSummary(template.description ?? `${selectedCategory?.name ?? moduleLabel} - ${template.name}`)
                      }}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold leading-snug text-[var(--color-text)]">{template.name}</div>
                          <div className="mt-1 text-sm text-[var(--color-muted)]">{template.description || "No description available"}</div>
                        </div>
                        <TableBadge tone={wizardTemplateId === template.id ? "violet" : "slate"}>{template.code}</TableBadge>
                      </div>
                      <div className="mt-3 text-xs text-[var(--color-muted)]">{stepCount > 0 ? `${stepCount} question(s)` : "Questions load after selection"}</div>
                    </button>
                  )
                })}
              </div>

              {filteredWizardTemplates.length === 0 ? <p className="text-sm text-[var(--color-muted)]">No templates match the current search.</p> : null}
            </div>
          )}

          {wizardStep === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--color-text)]">Fill in the request</h3>
                  <p className="text-sm text-[var(--color-muted)]">Keep the title short and the summary specific.</p>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setWizardStep(2)}>
                  <ChevronLeft className="mr-2 size-4" />
                  Back
                </Button>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className={`space-y-4 rounded-2xl border ${moduleTheme.accentBorder} bg-[var(--color-surface)] p-4 shadow-sm`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--color-text)]">Ticket details</div>
                      <p className="mt-1 text-xs text-[var(--color-muted)]">Simple, focused inputs.</p>
                    </div>
                    <TableBadge tone={wizardAnsweredRequiredCount === wizardRequiredStepCount ? "emerald" : "amber"}>
                      {wizardAnsweredRequiredCount}/{wizardRequiredStepCount || 0} required
                    </TableBadge>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5 md:col-span-2">
                      <label htmlFor="wizard-title" className="text-sm font-medium text-[var(--color-text)]">Ticket title</label>
                      <Input id="wizard-title" value={wizardTitle} onChange={(event) => setWizardTitle(event.target.value)} placeholder="Short, scannable summary" />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="wizard-priority" className="text-sm font-medium text-[var(--color-text)]">Priority level</label>
                      <Select id="wizard-priority" value={wizardPriority} onChange={(event) => setWizardPriority(event.target.value)}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                        <option value="critical">Critical</option>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <div className="text-sm font-medium text-[var(--color-text)]">Completion</div>
                      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-3">
                        <div className="h-2 overflow-hidden rounded-full bg-[var(--color-secondary)]">
                          <div className="h-full rounded-full bg-[var(--color-accent)] transition-all" style={{ width: `${wizardProgress}%` }} />
                        </div>
                        <div className="mt-2 text-xs text-[var(--color-muted)]">{wizardProgress}% complete</div>
                      </div>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <label htmlFor="wizard-summary" className="text-sm font-medium text-[var(--color-text)]">Request summary</label>
                      <Textarea
                        id="wizard-summary"
                        value={wizardSummary}
                        onChange={(event) => setWizardSummary(event.target.value)}
                        rows={3}
                        placeholder="Describe what is happening, where it is happening, and who is affected."
                      />
                    </div>
                  </div>
                </div>

                <div className={`space-y-4 rounded-2xl border ${moduleTheme.accentBorder} bg-[var(--color-surface)] p-4 shadow-sm`}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--color-text)]">Template questions</div>
                      <p className="mt-1 text-xs text-[var(--color-muted)]">Answer each prompt clearly.</p>
                    </div>
                    <TableBadge tone={wizardAnsweredRequiredCount === wizardRequiredStepCount ? "emerald" : "amber"}>
                      {wizardAnsweredRequiredCount}/{wizardRequiredStepCount || 0} required
                    </TableBadge>
                  </div>

                  {wizardTemplateSteps.length === 0 ? (
                    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-elevated)] p-4 text-sm text-[var(--color-muted)]">Loading template questions...</div>
                  ) : (
                    <div className="grid gap-3 lg:grid-cols-2">
                      {wizardTemplateSteps.map((step) => renderWizardField(step))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {wizardStep === 4 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-[var(--color-text)]">Review and submit</h3>
                  <p className="text-sm text-[var(--color-muted)]">Check the final snapshot and answers before submission.</p>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setWizardStep(3)}>
                  <ChevronLeft className="mr-2 size-4" />
                  Back
                </Button>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className={`space-y-3 rounded-2xl border ${moduleTheme.accentBorder} bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted)] shadow-sm`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--color-text)]">Submission snapshot</span>
                    <TableBadge tone="cyan">Ready to submit</TableBadge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-2xl border border-[var(--color-border)] p-3"><div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Category</div><div className="mt-1 text-[var(--color-text)]">{selectedCategory?.name}</div></div>
                    <div className="rounded-2xl border border-[var(--color-border)] p-3"><div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Template</div><div className="mt-1 text-[var(--color-text)]">{selectedTemplate?.name}</div></div>
                    <div className="rounded-2xl border border-[var(--color-border)] p-3"><div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Priority</div><div className="mt-1 text-[var(--color-text)]">{labelize(wizardPriority)}</div></div>
                    <div className="rounded-2xl border border-[var(--color-border)] p-3"><div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Answered</div><div className="mt-1 text-[var(--color-text)]">{wizardAnsweredStepCount}/{wizardTemplateSteps.length || 0}</div></div>
                  </div>
                  <div className="rounded-2xl border border-[var(--color-border)] p-3"><div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Title</div><div className="mt-1 text-[var(--color-text)]">{wizardTitle || selectedTemplate?.name}</div></div>
                  <div className="rounded-2xl border border-[var(--color-border)] p-3"><div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Summary</div><div className="mt-1 text-[var(--color-text)]">{wizardReviewSummary}</div></div>
                </div>

                <div className={`space-y-3 rounded-2xl border ${moduleTheme.accentBorder} bg-[var(--color-surface)] p-4 text-sm text-[var(--color-muted)] shadow-sm`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[var(--color-text)]">Answers</span>
                    <TableBadge tone={wizardAnsweredRequiredCount === wizardRequiredStepCount ? "emerald" : "amber"}>
                      {wizardAnsweredRequiredCount}/{wizardRequiredStepCount || 0} required
                    </TableBadge>
                  </div>
                  <div className="grid gap-2 lg:grid-cols-2">
                    {wizardTemplateSteps.map((step) => (
                      <div key={step.id} className="flex flex-col rounded-2xl border border-[var(--color-border)] p-3">
                        <div className="flex items-center justify-between gap-3 text-[11px] uppercase tracking-wide">
                          <span>{step.label}</span>
                          <span>{step.required ? "Required" : "Optional"}</span>
                        </div>
                        <div className="mt-1.5 text-sm text-[var(--color-text)]">{wizardAnswers[step.step_key] || "Not answered"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--color-border)] p-3 text-xs text-[var(--color-muted)]">
                Device context captures browser details, route, and submission metadata automatically.
              </div>
            </div>
          )}

          <div className="border-t border-[var(--color-border)] pt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button type="button" size="sm" variant="ghost" onClick={() => { setWizardOpen(false); resetWizard() }}>
                Cancel
              </Button>

              <div className="flex flex-wrap gap-2 sm:justify-end">
                {wizardStep > 1 && wizardStep < 4 ? (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setWizardStep((step) => Math.max(1, step - 1))}>
                    <ChevronLeft className="mr-2 size-4" />
                    Back
                  </Button>
                ) : null}

                {wizardStep === 1 ? (
                  <Button type="button" size="sm" onClick={() => wizardCategoryId && setWizardStep(2)} disabled={!wizardCategoryId}>
                    Continue
                    <ChevronRight className="ml-2 size-4" />
                  </Button>
                ) : null}

                {wizardStep === 2 ? (
                  <Button type="button" size="sm" onClick={() => wizardTemplateId && setWizardStep(3)} disabled={!wizardTemplateId}>
                    Continue
                    <ChevronRight className="ml-2 size-4" />
                  </Button>
                ) : null}

                {wizardStep === 3 ? (
                  <Button type="button" size="sm" onClick={() => setWizardStep(4)} disabled={wizardTemplateSteps.some((step) => step.required && !wizardAnswers[step.step_key]?.trim())}>
                    Review
                    <ChevronRight className="ml-2 size-4" />
                  </Button>
                ) : null}

                {wizardStep === 4 ? (
                  <Button type="button" size="sm" onClick={() => void handleCreateTicket()} disabled={wizardSubmitting || !wizardTemplateId || !wizardCategoryId}>
                    {wizardSubmitting ? "Submitting..." : "Submit Ticket"}
                  </Button>
                ) : null}
              </div>
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
                {canManageAllTickets
                  ? "Admin controls are available for assignment, status changes, and archive actions."
                  : canViewAssignedTickets
                    ? "You can update status and comments on tickets assigned to you."
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
                    {canManageAllTickets ? (
                      <div className="space-y-3 rounded-lg border border-[var(--color-border)] p-3">
                        <div className="text-xs uppercase tracking-wide text-[var(--color-muted)]">Assignment</div>
                        <div className="grid gap-2 md:grid-cols-2">
                          <Input
                            value={assigneeSearch}
                            onChange={(event) => setAssigneeSearch(event.target.value)}
                            placeholder={`Filter ${moduleAssigneeLabel}`}
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
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Button size="sm" variant="outline" onClick={() => void handleAssignToStaff()} disabled={!assignmentTargetId} className="w-full justify-center">
                            Assign
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => void handleAssignToSelf()} className="w-full justify-center">
                            Assign to me
                          </Button>
                        </div>
                        <div className="text-xs text-[var(--color-muted)]">
                            {staffDirectoryLoading
                            ? "Loading assignees..."
                            : `${filteredAssignees.length} of ${eligibleAssignees.length} ${moduleAssigneeLabel} available`}
                        </div>
                      </div>
                    ) : null}

                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {detailActions.map((action) => {
                        const Icon = action.icon
                        return (
                          <Button key={action.label} size="sm" variant="outline" onClick={action.onClick} className="w-full justify-center">
                            <Icon className="mr-2 size-4" />
                            {action.label}
                          </Button>
                        )
                      })}
                    </div>

                    {selectedTicketCanProcess ? (
                      <>
                        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                          <Select value={statusDraft} onChange={(event) => setStatusDraft(event.target.value)}>
                            {detailStatusOptions.map((option) => (
                              <option key={option} value={option}>
                                {labelize(option)}
                              </option>
                            ))}
                          </Select>
                          <Button size="sm" variant="outline" onClick={() => void handleStatusChange(statusDraft)} className="w-full md:w-auto">
                            Change status
                          </Button>
                        </div>
                        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                          <div />
                          <Button size="sm" variant="ghost" onClick={() => void loadTickets()} className="w-full md:w-auto">
                            Refresh queue
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="grid gap-2 md:grid-cols-2">
                        <Button size="sm" variant="ghost" onClick={() => void handleCloseRequest()} className="w-full justify-center">
                          Request close
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void loadTickets()} className="w-full justify-center">
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
                  <Textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} rows={3} placeholder="Write a public or internal note" />
                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                    {selectedTicketCanProcess && (
                      <Select value={commentType} onChange={(event) => setCommentType(event.target.value)}>
                        <option value="public">Public</option>
                        <option value="internal">Internal</option>
                      </Select>
                    )}
                    <Button size="sm" onClick={() => void handleCommentSubmit()} disabled={!commentDraft.trim()} className="w-full md:w-auto">
                      <MessageSquare className="mr-2 size-4" />
                      Add comment
                    </Button>
                  </div>
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
