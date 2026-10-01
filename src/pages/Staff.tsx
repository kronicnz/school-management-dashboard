import { useCallback, useEffect, useState, type FormEvent } from "react"
import { Plus, Pencil, Trash2, RefreshCw, CloudDownload, Search, Clock3, School, Layers3 } from "lucide-react"
import { fetchStaff, createStaff, updateStaff, deleteStaff, syncStaffFromGoogleWorkspace, fetchClasses, resolveProfileIdByEmail } from "../lib/api/supabaseApi"
import type { Class } from "../lib/api/database.types"
import type { StaffDirectoryRow } from "../lib/api/supabaseApi"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/Input"
import { Select } from "../components/ui/Select"
import { Dialog } from "../components/ui/Dialog"
import { DataTable } from "../components/ui/DataTable"
import { FormField } from "../components/ui/FormField"
import { StatisticCard, StatisticGrid } from "../components/ui/StatisticCard"
import { TableAvatar } from "../components/ui/TableAvatar"
import { TableBadge } from "../components/ui/TableBadge"
import { useToast } from "../components/ui/useToast"
import { getErrorMessage } from "../utils/getErrorMessage"
import { logError } from "../utils/logger"
import { labelize } from "../utils/labelize"

type StaffFormData = {
  first_name: string
  last_name: string
  email: string
  phone: string
  department: string
  status: string
  profile_id: string
}

function getEmptyStaffForm(): StaffFormData {
  return {
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    department: "",
    status: "active",
    profile_id: "",
  }
}

function normalizeStatValue(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase()
}

export default function StaffPage() {
  const toast = useToast()
  const [staff, setStaff] = useState<StaffDirectoryRow[]>([])
  const [, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterStatus, setFilterStatus] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editingStaff, setEditingStaff] = useState<StaffDirectoryRow | null>(null)
  const [formData, setFormData] = useState<StaffFormData>(getEmptyStaffForm)

  const loadStaff = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchStaff()
      setStaff(data)
    } catch (error) {
      logError("Failed to load staff", error)
    } finally {
      setLoading(false)
    }
  }, [])

  async function handleSync() {
    try {
      setLoading(true)
      const result = await syncStaffFromGoogleWorkspace()
      toast.success(
        "Staff sync complete",
        `Synced ${result.staffSyncCount} staff from Google Workspace${result.errors.length > 0 ? ` with ${result.errors.length} errors` : ""}.`
      )
      await loadStaff()
    } catch (error) {
      logError("Failed to sync staff", error)
      toast.error("Staff sync failed", getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  const loadClasses = useCallback(async () => {
    try {
      const data = await fetchClasses()
      setClasses(data)
    } catch (error) {
      logError("Failed to load classes", error)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void loadStaff()
      void loadClasses()
    })
  }, [loadClasses, loadStaff])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()

    try {
      const resolvedProfileId =
        editingStaff?.profile_id?.trim() ||
        formData.profile_id.trim() ||
        (formData.email.trim() ? await resolveProfileIdByEmail(formData.email.trim()) : null) ||
        null

      const payload = {
        first_name: formData.first_name,
        last_name: formData.last_name,
        email: formData.email,
        phone: formData.phone || null,
        department: formData.department || null,
        status: formData.status,
        profile_id: resolvedProfileId,
      }

      if (editingStaff) {
        await updateStaff(editingStaff.id, payload)
        toast.success("Staff updated", `${formData.first_name} ${formData.last_name} was saved successfully.`)
      } else {
        await createStaff(payload)
        toast.success("Staff created", `${formData.first_name} ${formData.last_name} was added successfully.`)
      }

      setShowForm(false)
      setEditingStaff(null)
      setFormData(getEmptyStaffForm())
      await loadStaff()
    } catch (error) {
      toast.error(editingStaff ? "Staff update failed" : "Staff creation failed", getErrorMessage(error))
    }
  }

  function handleEdit(s: StaffDirectoryRow) {
    setEditingStaff(s)
    setShowForm(true)

    setFormData({
      first_name: s.first_name,
      last_name: s.last_name,
      email: s.email ?? "",
      phone: s.phone ?? "",
      department: s.department ?? "",
      status: s.status ?? "active",
      profile_id: s.profile_id ?? "",
    })
  }

  async function handleDelete(id: string) {
    // Removing a staff row does NOT revoke access: the auth account, its role
    // grants, and its audit trail all survive. Revocation is an explicit action on
    // the Admin page, so say this before the record disappears rather than letting
    // an admin assume deleting a person signed them out.
    const target = staff.find((member) => member.id === id)
    const confirmed = window.confirm(
      target
        ? `Delete ${target.first_name} ${target.last_name}?\n\n`
          + "This removes the staff record only. Any login, role grants, and account history "
          + "are kept, and the person can still sign in. Revoke their access from the Admin "
          + "page if that is what you intend."
        : "Delete this staff member?\n\nThis removes the staff record only. Any login and role "
          + "grants are kept."
    )
    if (!confirmed) return
    try {
      await deleteStaff(id)
      toast.success("Staff record deleted", "The login and any role grants were left untouched.")
      await loadStaff()
    } catch (error) {
      toast.error("Staff delete failed", getErrorMessage(error))
    }
  }

  const filteredStaff = staff.filter((s) => {
    const matchesSearch = !search || `${s.first_name} ${s.last_name}`.toLowerCase().includes(search.toLowerCase()) || (s.email ?? "").toLowerCase().includes(search.toLowerCase())
    const matchesStatus = !filterStatus || s.status === filterStatus
    return matchesSearch && matchesStatus
  })

  const totalStaff = staff.length
  const activeStaff = staff.filter((member) => normalizeStatValue(member.status) === "active").length
  const inactiveStaff = staff.filter((member) => normalizeStatValue(member.status) === "inactive").length
  // `staff.status` only ever holds active / inactive / on_leave. This used to count
  // "pending", which the database check constraint rejects, so the tile was always
  // zero - a metric that could not move is worse than no metric.
  const onLeaveStaff = staff.filter((member) => normalizeStatValue(member.status) === "on_leave").length
  // `teacher` is retired, so a `staff` grant is the teaching role now. Counting
  // only the literal "teacher" string left this tile permanently at zero.
  const teachingStaff = staff.filter((member) =>
    member.roles.some((role) => {
      const value = normalizeStatValue(role)
      return value === "staff" || value.includes("teacher")
    }),
  ).length
  const departments = new Set(staff.map((member) => member.department?.trim()).filter(Boolean)).size

  const staffColumns = [
    {
      accessor: "last_name",
      header: "Name",
      sortable: true,
      className: "min-w-[260px]",
      cell: (_: any, row: StaffDirectoryRow) => (
        <div className="flex items-center gap-3 whitespace-nowrap">
          <TableAvatar>{`${row.first_name?.[0] ?? ""}${row.last_name?.[0] ?? ""}`.trim() || "S"}</TableAvatar>
          <div className="min-w-0">
            <div className="font-medium text-[var(--color-text)]">{row.first_name} {row.last_name}</div>
            <div className="text-xs text-[var(--color-muted)]">{row.org_unit_path || "No org unit"}</div>
          </div>
        </div>
      ),
    },
    {
      accessor: "email",
      header: "Email",
      sortable: true,
      className: "min-w-[260px]",
      cell: (value: any) => <span className="text-[var(--color-muted)]">{value ?? "-"}</span>,
    },
    {
      accessor: "status",
      header: "Status",
      sortable: true,
      className: "whitespace-nowrap min-w-[140px]",
      cell: (value: any) => (
        <TableBadge tone={value === "active" ? "emerald" : value === "inactive" ? "rose" : "slate"}>
          {value}
        </TableBadge>
      ),
    },
    {
      accessor: "roles",
      header: "Roles",
      sortable: true,
      className: "min-w-[220px]",
      cell: (_: any, row: StaffDirectoryRow) => (
        <div className="flex flex-wrap gap-1.5">
          {row.roles.length > 0 ? (
            row.roles.map((role) => (
              <span key={role} className="rounded-full border border-[var(--color-border)] bg-[var(--color-row-hover)] px-2 py-0.5 text-xs text-[var(--color-text)]">
                {labelize(role)}
              </span>
            ))
          ) : (
            <span className="text-[var(--color-muted)]">No roles</span>
          )}
        </div>
      ),
    },
    {
      accessor: "department",
      header: "Department",
      sortable: true,
      className: "whitespace-nowrap min-w-[180px]",
      cell: (value: any) => <span className="text-[var(--color-muted)]">{value ?? "-"}</span>,
    },
    {
      accessor: "actions",
      header: "Actions",
      sortable: false,
      className: "whitespace-nowrap min-w-[110px]",
      cell: (_: any, row: StaffDirectoryRow) => (
        <div className="flex items-center gap-1 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => handleEdit(row)}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handleDelete(row.id)}>
            <Trash2 className="size-4 text-[var(--color-destructive)]" />
          </Button>
        </div>
      ),
    },
  ]

  function handleAddStaff() {
    setEditingStaff(null)
    setFormData(getEmptyStaffForm())
    setShowForm(true)
  }

  return (
    <div className="w-full max-w-full min-w-0 overflow-x-hidden">
      {/* The app header already carries the page title, breadcrumb and role note, so
          this row is the module's actions only. */}
      <div className="mb-6 flex flex-wrap items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => loadStaff()}>
          <RefreshCw className="size-4 mr-1" />
          Refresh
        </Button>
        <Button size="sm" onClick={handleAddStaff}>
          <Plus className="size-4 mr-1" />
          Add Staff
        </Button>
        <Button variant="default" size="sm" onClick={handleSync}>
          <CloudDownload className="size-4 mr-1" />
          Sync Google
        </Button>
      </div>

      <section className="mb-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Staff Overview</h2>
          <p className="text-xs text-[var(--color-muted)]">Live roster counts and scope breakdown.</p>
        </div>
        <StatisticGrid>
          <StatisticCard label="Total Staff" value={totalStaff} icon={Plus} description="All staff identity records" tone="information" />
          <StatisticCard label="Active" value={activeStaff} icon={RefreshCw} description="Staff currently marked active" tone="success" />
          <StatisticCard label="Inactive" value={inactiveStaff} icon={Trash2} description="Staff currently marked inactive" tone="destructive" />
          <StatisticCard label="On Leave" value={onLeaveStaff} icon={Clock3} description="Records currently marked on leave" tone="warning" />
          <StatisticCard label="Teaching Staff" value={teachingStaff} icon={School} description="Records in teaching roles" tone="primary" />
          <StatisticCard label="Departments" value={departments} icon={Layers3} description="Unique departments represented" tone="pending" />
        </StatisticGrid>
      </section>

      <Card className="min-w-0 overflow-hidden border-[var(--color-border)] p-0">
        <CardHeader className="mb-0 flex-col items-start justify-start border-b border-[var(--color-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base">Staff Directory</CardTitle>
            <p className="mt-1 text-xs text-[var(--color-muted)]">Search, filter, and manage staff identity records. Role editing lives in Admin.</p>
          </div>
        </CardHeader>

        <CardContent className="min-w-0 space-y-4 px-0 py-0">
          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted)]" />
              <Input placeholder="Search staff..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full sm:w-52 sm:flex-none">
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </Select>
          </div>

          <DataTable
            data={filteredStaff}
            columns={staffColumns}
            initialSort={{ id: "last_name", desc: false }}
            itemsPerPageOptions={[10, 25, 50, 100]}
            emptyMessage={loading ? "Loading staff..." : "No staff found"}
          />
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm} title={editingStaff ? "Edit Staff" : "Add Staff"}>
        <form onSubmit={handleSubmit} className="space-y-1">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="First Name" htmlFor="staff-first-name">
              <Input id="staff-first-name" value={formData.first_name} onChange={(e) => setFormData({ ...formData, first_name: e.target.value })} required />
            </FormField>
            <FormField label="Last Name" htmlFor="staff-last-name">
              <Input id="staff-last-name" value={formData.last_name} onChange={(e) => setFormData({ ...formData, last_name: e.target.value })} required />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Email" htmlFor="staff-email">
              <Input id="staff-email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} required />
            </FormField>
            <FormField label="Phone" htmlFor="staff-phone">
              <Input id="staff-phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Department" htmlFor="staff-department">
              <Input id="staff-department" value={formData.department} onChange={(e) => setFormData({ ...formData, department: e.target.value })} />
            </FormField>
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-row-hover)] px-3 py-2 text-xs text-[var(--color-muted)]">
              The staff record links to the matching profile automatically on save.
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingStaff(null) }}>Cancel</Button>
            <Button type="submit">{editingStaff ? "Save Changes" : "Add Staff"}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
