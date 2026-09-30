import { useCallback, useEffect, useState, type FormEventHandler } from "react"
import { Plus, Pencil, Trash2, RefreshCw, Search, BookOpen, School, Users, BarChart3 } from "lucide-react"
import { createClass, deleteClass, fetchClasses, updateClass } from "../lib/api/supabaseApi"
import type { Class } from "../lib/api/database.types"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/Input"
import { Select } from "../components/ui/Select"
import { Dialog } from "../components/ui/Dialog"
import { DataTable } from "../components/ui/DataTable"
import { FormField } from "../components/ui/FormField"
import { StatisticCard, StatisticGrid } from "../components/ui/StatisticCard"
import { TableAvatar } from "../components/ui/TableAvatar"
import { useToast } from "../components/ui/useToast"
import { getErrorMessage } from "../utils/getErrorMessage"
import { logError } from "../utils/logger"

function getEmptyClassForm() {
  return {
    name: "",
    grade_level: "",
    subject: "",
    room_number: "",
    capacity: "",
    school_year: "2025-2026",
  }
}

export default function ClassesPage() {
  const toast = useToast()
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterGrade, setFilterGrade] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editingClass, setEditingClass] = useState<Class | null>(null)
  const [formData, setFormData] = useState(getEmptyClassForm)

  const loadClasses = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchClasses()
      setClasses(data)
    } catch (error) {
      logError("Failed to load classes", error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => {
      void loadClasses()
    })
  }, [loadClasses])

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault()
    const payload = { ...formData, capacity: formData.capacity ? Number(formData.capacity) : null }

    try {
      if (editingClass) {
        await updateClass(editingClass.id, payload)
        toast.success("Class updated", `${formData.name} was saved successfully.`)
      } else {
        await createClass(payload)
        toast.success("Class created", `${formData.name} was added successfully.`)
      }

      setShowForm(false)
      setEditingClass(null)
      setFormData(getEmptyClassForm())
      await loadClasses()
    } catch (error) {
      toast.error(editingClass ? "Class update failed" : "Class creation failed", getErrorMessage(error))
    }
  }

  function handleEdit(cls: Class) {
    setEditingClass(cls)
    setFormData({
      name: cls.name,
      grade_level: cls.grade_level ?? "",
      subject: cls.subject ?? "",
      room_number: cls.room_number ?? "",
      capacity: cls.capacity?.toString() ?? "",
      school_year: cls.school_year ?? "2025-2026",
    })
    setShowForm(true)
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this class?")) return
    try {
      await deleteClass(id)
      toast.success("Class deleted", "The class record was removed.")
      await loadClasses()
    } catch (error) {
      toast.error("Class delete failed", getErrorMessage(error))
    }
  }

  const filteredClasses = classes.filter((c) => {
    const matchesSearch = !search || c.name.toLowerCase().includes(search.toLowerCase()) || (c.subject ?? "").toLowerCase().includes(search.toLowerCase())
    const matchesGrade = !filterGrade || c.grade_level === filterGrade
    return matchesSearch && matchesGrade
  })

  const grades = [...new Set(classes.map((c) => c.grade_level).filter(Boolean))] as string[]
  const totalClasses = classes.length
  const totalCapacity = classes.reduce((sum, cls) => sum + (cls.capacity ?? 0), 0)
  const roomsAssigned = classes.filter((cls) => Boolean(cls.room_number)).length
  const subjectLinkedClasses = classes.filter((cls) => Boolean(cls.subject)).length
  const averageCapacity = totalClasses > 0 ? Math.round(totalCapacity / totalClasses) : 0

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text)]">Classes</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => loadClasses()}>
            <RefreshCw className="size-4 mr-1" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setEditingClass(null); setFormData(getEmptyClassForm()); setShowForm(true) }}>
            <Plus className="size-4 mr-1" />
            Add Class
          </Button>
        </div>
      </div>

      <section className="mb-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Class Overview</h2>
          <p className="text-xs text-[var(--color-muted)]">Capacity and curriculum coverage at a glance.</p>
        </div>
        <StatisticGrid>
          <StatisticCard label="Total Classes" value={totalClasses} icon={Plus} description="Class sections scheduled in the system" tone="information" />
          <StatisticCard label="Grades Represented" value={grades.length} icon={RefreshCw} description="Distinct grade levels in use" tone="primary" />
          <StatisticCard label="Subject Linked" value={subjectLinkedClasses} icon={BookOpen} description="Classes tied to subject assignments" tone="pending" />
          <StatisticCard label="Rooms Assigned" value={roomsAssigned} icon={School} description="Classes with a room allocation" tone="completed" />
          <StatisticCard label="Total Capacity" value={totalCapacity} icon={Users} description="Combined seats across all classes" tone="information" />
          <StatisticCard label="Avg Capacity" value={averageCapacity} icon={BarChart3} description="Average seats per class" tone="primary" />
        </StatisticGrid>
      </section>

      <Card className="min-w-0 overflow-hidden border-white/10 p-0">
        <CardHeader className="mb-0 flex-col items-start justify-start border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base">Class Directory</CardTitle>
            <p className="mt-1 text-xs text-slate-400">Search, filter, and manage classes and capacity.</p>
          </div>
        </CardHeader>

        <CardContent className="min-w-0 space-y-4 px-0 py-0">
          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <Input placeholder="Search classes..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={filterGrade} onChange={(e) => setFilterGrade(e.target.value)} className="w-full sm:w-52 sm:flex-none">
              <option value="">All Grades</option>
              {grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          </div>

          <DataTable
            data={filteredClasses}
            columns={[
              {
                accessor: "name",
                header: "Name",
                sortable: true,
                className: "min-w-[260px]",
                cell: (value: string) => (
                  <div className="flex items-center gap-3">
                    <TableAvatar>{value?.slice(0, 2).toUpperCase() || "CL"}</TableAvatar>
                    <div className="min-w-0">
                      <div className="font-medium text-white">{value}</div>
                      <div className="text-xs text-slate-400">Class section</div>
                    </div>
                  </div>
                ),
              },
              { accessor: "grade_level", header: "Grade", sortable: true, className: "whitespace-nowrap min-w-[120px]", cell: (value: string | null) => <span className="text-slate-400">{value ?? "-"}</span> },
              { accessor: "school_year", header: "Year", sortable: true, className: "whitespace-nowrap min-w-[140px]", cell: (value: string) => <span className="text-slate-400">{value}</span> },
              { accessor: "subject", header: "Subject", sortable: true, className: "min-w-[220px]", cell: (value: string | null) => <span className="text-slate-400">{value ?? "-"}</span> },
              { accessor: "room_number", header: "Room", sortable: true, className: "whitespace-nowrap min-w-[120px]", cell: (value: string | null) => <span className="text-slate-400">{value ?? "-"}</span> },
              { accessor: "capacity", header: "Capacity", sortable: true, className: "whitespace-nowrap min-w-[120px]", cell: (value: number | null) => <span className="text-slate-400">{value ?? "-"}</span> },
              {
                accessor: "actions",
                header: "Actions",
                searchable: false,
                className: "whitespace-nowrap min-w-[110px]",
                cell: (_: unknown, cls: Class) => (
                  <div className="flex items-center gap-1 whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
                    <Button variant="ghost" size="sm" onClick={() => handleEdit(cls)}><Pencil className="size-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(cls.id)}><Trash2 className="size-4 text-rose-400" /></Button>
                  </div>
                ),
              },
            ]}
            initialSort={{ id: "name", desc: false }}
            itemsPerPageOptions={[10, 25, 50]}
            emptyMessage={loading ? "Loading classes..." : "No classes found"}
            searchable={false}
          />
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm} title={editingClass ? "Edit Class" : "Add Class"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <FormField label="Class Name" htmlFor="class-name">
            <Input id="class-name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Grade Level" htmlFor="class-grade-level">
              <Input id="class-grade-level" value={formData.grade_level} onChange={(e) => setFormData({ ...formData, grade_level: e.target.value })} />
            </FormField>
            <FormField label="Subject" htmlFor="class-subject">
              <Input id="class-subject" value={formData.subject} onChange={(e) => setFormData({ ...formData, subject: e.target.value })} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Room Number" htmlFor="class-room-number">
              <Input id="class-room-number" value={formData.room_number} onChange={(e) => setFormData({ ...formData, room_number: e.target.value })} />
            </FormField>
            <FormField label="Capacity" htmlFor="class-capacity">
              <Input id="class-capacity" type="number" value={formData.capacity} onChange={(e) => setFormData({ ...formData, capacity: e.target.value })} />
            </FormField>
          </div>
          <FormField label="School Year" htmlFor="class-school-year">
            <Input id="class-school-year" value={formData.school_year} onChange={(e) => setFormData({ ...formData, school_year: e.target.value })} />
          </FormField>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingClass(null) }}>Cancel</Button>
            <Button type="submit">{editingClass ? "Save Changes" : "Add Class"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  )
}
