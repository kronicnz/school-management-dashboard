import { useCallback, useEffect, useState, useMemo } from "react"
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  CloudDownload,
  Laptop,
  UserPlus,
  UserMinus,
  AlertTriangle,
  Search,
} from "lucide-react"
import {
  fetchAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  syncAssetsFromGoogleWorkspace,
  assignAsset,
  fetchStudents,
  fetchStaff,
} from "../lib/api/supabaseApi"
import type { Asset, Student, Staff } from "../lib/api/database.types"
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

export default function AssetsPage() {
  const toast = useToast()
  const [assets, setAssets] = useState<Asset[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [staffMembers, setStaffMembers] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const [search, setSearch] = useState("")
  const [filterStatus, setFilterStatus] = useState("")
  const [filterLocationCategory, setFilterLocationCategory] = useState("")

  // Form State
  const [showForm, setShowForm] = useState(false)
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null)
  const [formData, setFormData] = useState({
    asset_tag: "",
    name: "",
    category: "",
    model: "",
    serial_number: "",
    status: "available",
    location: "",
    purchase_date: "",
    purchase_cost: "",
    condition: "good",
    notes: "",
  })

  // Assignment Modal State
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [assigneeType, setAssigneeType] = useState<"student" | "staff">("student")
  const [selectedAssigneeId, setSelectedAssigneeId] = useState("")
  const [isAssigning, setIsAssigning] = useState(false)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [assetsData, studentsData, staffData] = await Promise.all([
        fetchAssets(),
        fetchStudents(),
        fetchStaff(),
      ])
      setAssets(assetsData ?? [])
      setStudents(studentsData ?? [])
      setStaffMembers(staffData ?? [])
    } catch (error) {
      logError("Failed to load assets data", error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void loadData()
    })
  }, [loadData])

  async function handleGoogleSync() {
    try {
      setIsSyncing(true)
      const res = await syncAssetsFromGoogleWorkspace()
      toast.success("Asset sync complete", `Successfully synced ${res.syncCount} devices from Google Workspace.`)
      await loadData()
    } catch (error) {
      toast.error("Asset sync failed", getErrorMessage(error))
    } finally {
      setIsSyncing(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    try {
      const payload = {
        ...formData,
        purchase_cost: formData.purchase_cost ? Number(formData.purchase_cost) : null,
        purchase_date: formData.purchase_date || null,
      }
      if (editingAsset) {
        await updateAsset(editingAsset.id, payload)
      } else {
        await createAsset(payload)
      }
      toast.success(editingAsset ? "Asset updated" : "Asset created", `${payload.name} was saved successfully.`)
      setShowForm(false)
      setEditingAsset(null)
      resetForm()
      await loadData()
    } catch (error) {
      toast.error(editingAsset ? "Asset update failed" : "Asset creation failed", getErrorMessage(error))
    }
  }

  function resetForm() {
    setFormData({
      asset_tag: "",
      name: "",
      category: "",
      model: "",
      serial_number: "",
      status: "available",
      location: "",
      purchase_date: "",
      purchase_cost: "",
      condition: "good",
      notes: "",
    })
  }

  function handleEdit(a: Asset) {
    setEditingAsset(a)
    setFormData({
      asset_tag: a.asset_tag,
      name: a.name,
      category: a.category ?? "",
      model: a.model ?? "",
      serial_number: a.serial_number ?? "",
      status: a.status ?? "available",
      location: a.location ?? "",
      purchase_date: a.purchase_date ? a.purchase_date.split("T")[0] : "",
      purchase_cost: a.purchase_cost?.toString() ?? "",
      condition: a.condition ?? "good",
      notes: a.notes ?? "",
    })
    setShowForm(true)
  }

  async function handleDelete(id: string) {
    if (!confirm("Are you sure you want to delete this asset?")) return
    try {
      await deleteAsset(id)
      toast.success("Asset deleted", "The asset record was removed.")
      await loadData()
    } catch (error) {
      toast.error("Asset delete failed", getErrorMessage(error))
    }
  }

  function openAssignModal(asset: Asset) {
    setSelectedAsset(asset)
    setSelectedAssigneeId(asset.assigned_to || "")
    setAssigneeType(asset.assigned_to_type === "staff" ? "staff" : "student")
    setShowAssignModal(true)
  }

  async function handleAssignSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAsset) return

    try {
      setIsAssigning(true)
      await assignAsset(selectedAsset.id, selectedAssigneeId || null, selectedAssigneeId ? assigneeType : null)

      toast.success("Asset assigned", `${selectedAsset.name} was assigned successfully.`)
      setShowAssignModal(false)
      setSelectedAsset(null)
      await loadData()
    } catch (error) {
      toast.error("Asset assignment failed", getErrorMessage(error))
    } finally {
      setIsAssigning(false)
    }
  }

  async function handleUnassign(asset: Asset) {
    if (!confirm(`Unassign ${asset.name} (${asset.asset_tag})?`)) return
    try {
      await assignAsset(asset.id, null, null)
      toast.success("Asset unassigned", `${asset.name} was unassigned successfully.`)
      await loadData()
    } catch (error) {
      toast.error("Asset unassign failed", getErrorMessage(error))
    }
  }

  function getLocationCategory(location: string | null | undefined): string {
    const normalized = (location || "").trim().toLowerCase()

    if (!normalized) return "unspecified"
    if (normalized.includes("deprovision")) return "deprovisioned"
    if (
      normalized.includes("school-owned") ||
      normalized.includes("school owned") ||
      normalized.includes("school_owned")
    ) {
      return "school_owned"
    }
    if (
      normalized.includes("student") ||
      normalized.includes("year 7") ||
      normalized.includes("year 8") ||
      normalized.includes("pupil")
    ) {
      return "student_pool"
    }
    if (normalized.includes("staff") || normalized.includes("teacher")) return "staff_pool"
    if (
      normalized.includes("shared") ||
      normalized.includes("lab") ||
      normalized.includes("library") ||
      normalized.includes("cart") ||
      normalized.includes("trolley")
    ) {
      return "shared_pool"
    }

    return "other"
  }

  const studentNameById = useMemo(
    () => new Map(students.map((s) => [s.id, `${s.first_name} ${s.last_name}`])),
    [students]
  )

  const staffNameById = useMemo(
    () => new Map(staffMembers.map((s) => [s.id, `${s.first_name} ${s.last_name}`])),
    [staffMembers]
  )

  const getAssignedToName = useCallback(
    (asset: Asset): string => {
      if (!asset.assigned_to) return ""
      if (asset.assigned_to_type === "student") return studentNameById.get(asset.assigned_to) || ""
      if (asset.assigned_to_type === "staff") return staffNameById.get(asset.assigned_to) || ""
      return ""
    },
    [staffNameById, studentNameById]
  )

  const filteredAssets = useMemo(() => {
    return assets.filter((a) => {
      const matchesStatus = !filterStatus || a.status === filterStatus
      const locationCategory = getLocationCategory(a.location)
      const matchesLocationCategory =
        !filterLocationCategory || locationCategory === filterLocationCategory
      const query = search.trim().toLowerCase()
      if (!query) return matchesStatus && matchesLocationCategory

      const matchesSearch =
        a.asset_tag?.toLowerCase().includes(query) ||
        a.name?.toLowerCase().includes(query) ||
        a.serial_number?.toLowerCase().includes(query) ||
        a.model?.toLowerCase().includes(query) ||
        a.category?.toLowerCase().includes(query) ||
        a.location?.toLowerCase().includes(query) ||
        getAssignedToName(a).toLowerCase().includes(query)

      return matchesStatus && matchesLocationCategory && matchesSearch
    })
  }, [assets, filterStatus, filterLocationCategory, getAssignedToName, search])

  const totalAssets = assets.length
  const availableAssets = assets.filter((asset) => asset.status === "available").length
  const assignedAssets = assets.filter((asset) => Boolean(asset.assigned_to)).length
  const maintenanceAssets = assets.filter((asset) => asset.status === "maintenance").length
  const retiredAssets = assets.filter((asset) => asset.status === "retired").length
  const lostAssets = assets.filter((asset) => asset.status === "lost").length

  const statuses = ["available", "in_use", "maintenance", "retired", "lost"]
  const locationCategories = [
    { value: "school_owned", label: "School-owned" },
    { value: "deprovisioned", label: "Deprovisioned" },
    { value: "student_pool", label: "Student Pool" },
    { value: "staff_pool", label: "Staff Pool" },
    { value: "shared_pool", label: "Shared Pool" },
    { value: "unspecified", label: "Unspecified" },
    { value: "other", label: "Other" },
  ]
  const conditions = ["excellent", "good", "fair", "poor"]

  const columns = [
    {
      accessor: "asset_tag",
      header: "Asset Tag",
      sortable: true,
      className: "whitespace-nowrap min-w-[160px]",
      cell: (val: string) => (
        <div className="flex items-center gap-3 whitespace-nowrap">
          <TableAvatar>{val.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "AS"}</TableAvatar>
          <span className="font-mono font-medium text-white">{val}</span>
        </div>
      ),
    },
    {
      accessor: "name",
      header: "Name & Model",
      sortable: true,
      className: "min-w-[260px]",
      cell: (_: any, row: Asset) => {
        const name = row.name || "Unnamed Asset"
        const subtext = row.model || row.category || ""
        const isDuplicate =
          subtext.trim().toLowerCase() === name.trim().toLowerCase()

        return (
          <div className="max-w-[260px]">
            <div className="font-medium text-slate-200 truncate" title={name}>
              {name}
            </div>
            {subtext && !isDuplicate && (
              <div className="text-xs text-slate-400 truncate" title={subtext}>
                {subtext}
              </div>
            )}
          </div>
        )
      },
    },
    {
      accessor: "serial_number",
      header: "Serial Number",
      sortable: true,
      className: "whitespace-nowrap min-w-[160px]",
      cell: (val: string) => (
        <span className="font-mono text-xs text-slate-300 whitespace-nowrap">
          {val || "-"}
        </span>
      ),
    },
    {
      accessor: "status",
      header: "Status",
      sortable: true,
      className: "whitespace-nowrap min-w-[130px]",
      cell: (val: string) => {
        const tone =
          val === "available" ? "emerald" :
          val === "in_use" ? "cyan" :
          val === "maintenance" ? "amber" :
          val === "retired" ? "rose" :
          val === "lost" ? "purple" :
          "slate"
        return <TableBadge tone={tone} className="capitalize">{(val || "available").replace("_", " ")}</TableBadge>
      },
    },
    {
      accessor: "location",
      header: "Location",
      sortable: true,
      className: "min-w-[220px]",
      cell: (val: string) => (
        <span className="text-xs text-slate-400 max-w-[200px] truncate block" title={val || "-"}>
          {val || "-"}
        </span>
      ),
    },
    {
      accessor: "assigned_to",
      header: "Assigned To",
      sortable: true,
      className: "whitespace-nowrap min-w-[180px]",
      cell: (_: any, row: Asset) => {
        const assignedName = getAssignedToName(row)
        if (!row.assigned_to) {
          return <span className="text-xs text-slate-500 whitespace-nowrap">Unassigned</span>
        }
        return (
          <div className="whitespace-nowrap">
            <div className="text-xs font-medium text-indigo-300">
              {assignedName || "Assigned User"}
            </div>
            <div className="text-[10px] capitalize text-slate-400">{row.assigned_to_type || "User"}</div>
          </div>
        )
      },
    },
    {
      accessor: "actions",
      header: "Actions",
      sortable: false,
      className: "whitespace-nowrap min-w-[120px]",
      cell: (_: any, row: Asset) => (
        <div className="flex items-center gap-1 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          {row.assigned_to ? (
            <Button
              variant="ghost"
              size="sm"
              title="Unassign Device"
              onClick={() => handleUnassign(row)}
              className="text-amber-400 hover:text-amber-300 hover:bg-amber-400/10"
            >
              <UserMinus className="size-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              title="Assign Device"
              onClick={() => openAssignModal(row)}
              className="text-indigo-400 hover:text-indigo-300 hover:bg-indigo-400/10"
            >
              <UserPlus className="size-4" />
            </Button>
          )}
          <Button variant="ghost" size="sm" title="Edit" onClick={() => handleEdit(row)}>
            <Pencil className="size-4 text-slate-300" />
          </Button>
          <Button variant="ghost" size="sm" title="Delete" onClick={() => handleDelete(row.id)}>
            <Trash2 className="size-4 text-rose-400" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">Assets & Devices</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void loadData()} isLoading={loading && !isSyncing}>
            <RefreshCw className="size-4 mr-1" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setEditingAsset(null)
              resetForm()
              setShowForm(true)
            }}
          >
            <Plus className="size-4 mr-1" />
            Add Asset
          </Button>
          <Button variant="default" size="sm" onClick={handleGoogleSync} isLoading={isSyncing}>
            <CloudDownload className="size-4 mr-1" />
            Sync Google
          </Button>
        </div>
      </div>

      <section className="mb-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Asset Overview</h2>
          <p className="text-xs text-slate-400">Device lifecycle counts and assignment status.</p>
        </div>
        <StatisticGrid>
          <StatisticCard label="Total Assets" value={totalAssets} icon={Laptop} description="Inventory items tracked in the register" accentClassName="text-cyan-300" />
          <StatisticCard label="Available" value={availableAssets} icon={RefreshCw} description="Ready to assign or issue" accentClassName="text-emerald-300" glowClassName="from-emerald-400/25 via-emerald-400/10 to-transparent" />
          <StatisticCard label="Assigned" value={assignedAssets} icon={UserPlus} description="Currently allocated to users" accentClassName="text-amber-300" glowClassName="from-amber-400/25 via-amber-400/10 to-transparent" />
          <StatisticCard label="Maintenance" value={maintenanceAssets} icon={UserMinus} description="Temporarily unavailable for use" accentClassName="text-rose-300" glowClassName="from-rose-400/25 via-rose-400/10 to-transparent" />
          <StatisticCard label="Retired" value={retiredAssets} icon={Trash2} description="Removed from active circulation" accentClassName="text-slate-300" glowClassName="from-slate-400/25 via-slate-400/10 to-transparent" />
          <StatisticCard label="Lost" value={lostAssets} icon={AlertTriangle} description="Items marked as missing" accentClassName="text-rose-300" glowClassName="from-rose-400/25 via-rose-400/10 to-transparent" />
        </StatisticGrid>
      </section>

      <Card className="min-w-0 overflow-hidden border-white/10 p-0">
        <CardHeader className="mb-0 flex-col items-start justify-start border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base">Asset Directory</CardTitle>
            <p className="mt-1 text-xs text-slate-400">Search, filter, and manage the asset inventory.</p>
          </div>
        </CardHeader>

        <CardContent className="min-w-0 space-y-4 px-0 py-0">
          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <Input
                placeholder="Search assets..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full sm:w-44 sm:flex-none">
              <option value="">All Statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ")}
                </option>
              ))}
            </Select>
            <Select
              value={filterLocationCategory}
              onChange={(e) => setFilterLocationCategory(e.target.value)}
              className="w-full sm:w-52 sm:flex-none"
            >
              <option value="">All Locations</option>
              {locationCategories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </Select>
          </div>

          <DataTable
            data={filteredAssets}
            columns={columns}
            initialSort={{ id: "asset_tag", desc: false }}
            itemsPerPageOptions={[10, 25, 50, 100]}
            emptyMessage={loading ? "Loading assets..." : "No assets found"}
            searchable={false}
          />
        </CardContent>
      </Card>

      {/* Add/Edit Asset Dialog */}
      <Dialog
        open={showForm}
        onOpenChange={setShowForm}
        title={editingAsset ? "Edit Asset" : "Add Asset"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Asset Tag *" htmlFor="asset-tag">
              <Input
                id="asset-tag"
                value={formData.asset_tag}
                onChange={(e) => setFormData({ ...formData, asset_tag: e.target.value })}
                required
              />
            </FormField>
            <FormField label="Name *" htmlFor="asset-name">
              <Input
                id="asset-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Category" htmlFor="asset-category">
              <Input
                id="asset-category"
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                placeholder="e.g. Chromebook, Tablet"
              />
            </FormField>
            <FormField label="Model" htmlFor="asset-model">
              <Input
                id="asset-model"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Serial Number" htmlFor="asset-serial-number">
              <Input
                id="asset-serial-number"
                value={formData.serial_number}
                onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
              />
            </FormField>
            <FormField label="Status" htmlFor="asset-status">
              <Select
                id="asset-status"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ")}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Location" htmlFor="asset-location">
              <Input
                id="asset-location"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
              />
            </FormField>
            <FormField label="Condition" htmlFor="asset-condition">
              <Select
                id="asset-condition"
                value={formData.condition}
                onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
              >
                {conditions.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Purchase Date" htmlFor="asset-purchase-date">
              <Input
                id="asset-purchase-date"
                type="date"
                value={formData.purchase_date}
                onChange={(e) => setFormData({ ...formData, purchase_date: e.target.value })}
              />
            </FormField>
            <FormField label="Purchase Cost ($)" htmlFor="asset-purchase-cost">
              <Input
                id="asset-purchase-cost"
                type="number"
                step="0.01"
                value={formData.purchase_cost}
                onChange={(e) => setFormData({ ...formData, purchase_cost: e.target.value })}
              />
            </FormField>
          </div>
          <FormField label="Notes" htmlFor="asset-notes">
            <textarea
              id="asset-notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              rows={2}
            />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowForm(false)
                setEditingAsset(null)
              }}
            >
              Cancel
            </Button>
            <Button type="submit">{editingAsset ? "Save Changes" : "Add Asset"}</Button>
          </div>
        </form>
      </Dialog>

      {/* Assign Device Dialog */}
      <Dialog
        open={showAssignModal}
        onOpenChange={setShowAssignModal}
        title={`Assign Asset: ${selectedAsset?.asset_tag || ""}`}
      >
        <form onSubmit={handleAssignSubmit} className="space-y-4">
          <div className="space-y-2">
            <span className="block text-sm font-medium text-slate-300">Assignee Type</span>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="assigneeType"
                  value="student"
                  checked={assigneeType === "student"}
                  onChange={() => {
                    setAssigneeType("student")
                    setSelectedAssigneeId("")
                  }}
                  className="accent-indigo-500"
                />
                Student
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="assigneeType"
                  value="staff"
                  checked={assigneeType === "staff"}
                  onChange={() => {
                    setAssigneeType("staff")
                    setSelectedAssigneeId("")
                  }}
                  className="accent-indigo-500"
                />
                Staff Member
              </label>
            </div>
          </div>

          <FormField label={`Select ${assigneeType === "student" ? "Student" : "Staff Member"}`} htmlFor="asset-assignee" labelClassName="text-sm font-medium text-slate-300">
            <Select
              id="asset-assignee"
              value={selectedAssigneeId}
              onChange={(e) => setSelectedAssigneeId(e.target.value)}
            >
              <option value="">-- Unassigned --</option>
              {assigneeType === "student"
                ? students.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.last_name}, {s.first_name} ({s.email || "No Email"})
                    </option>
                  ))
                : staffMembers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.last_name}, {s.first_name} ({s.email || "No Email"})
                    </option>
                  ))}
            </Select>
          </FormField>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowAssignModal(false)
                setSelectedAsset(null)
              }}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={isAssigning}>
              Save Assignment
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
