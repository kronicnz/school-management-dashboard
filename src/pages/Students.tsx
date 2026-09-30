import { useCallback, useEffect, useState } from "react"
import { Plus, Pencil, Trash2, RefreshCw, CloudDownload, Search, BookOpen, GraduationCap, Users } from "lucide-react"
import { fetchStudents, createStudent, updateStudent, deleteStudent, fetchClasses, syncStudentsFromGoogleWorkspace } from "../lib/api/supabaseApi"
import type { Student, Class } from "../lib/api/database.types"
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

function getEmptyStudentForm() {
  return {
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    grade_level: "",
    class_id: "",
    parent_name: "",
    parent_phone: "",
    status: "active",
  }
}

export default function StudentsPage() {
  const toast = useToast()
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [filterStatus, setFilterStatus] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [formData, setFormData] = useState(getEmptyStudentForm)

  const loadStudents = useCallback(async () => {
    try {
      setLoading(true)
      const data = await fetchStudents()
      setStudents(data)
    } catch (error) {
      logError("Failed to load students", error)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleSync = async () => {
    try {
      setLoading(true)
      const result = await syncStudentsFromGoogleWorkspace()
      toast.success(
        "Student sync complete",
        `Synced ${result.syncCount} students from Google Workspace${result.errors.length > 0 ? ` with ${result.errors.length} errors` : ""}.`
      )
      await loadStudents()
    } catch (error) {
      logError("Failed to sync students", error)
      toast.error("Student sync failed", getErrorMessage(error))
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
      void loadStudents()
      void loadClasses()
    })
  }, [loadClasses, loadStudents])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    try {
      if (editingStudent) {
        await updateStudent(editingStudent.id, formData)
        toast.success("Student updated", `${formData.first_name} ${formData.last_name} was saved successfully.`)
      } else {
        await createStudent(formData)
        toast.success("Student created", `${formData.first_name} ${formData.last_name} was added successfully.`)
      }

      setShowForm(false)
      setEditingStudent(null)
      setFormData(getEmptyStudentForm())
      await loadStudents()
    } catch (error) {
      toast.error(editingStudent ? "Student update failed" : "Student creation failed", getErrorMessage(error))
    }
  }

  function handleEdit(student: Student) {
    setEditingStudent(student)
    setFormData({
      first_name: student.first_name,
      last_name: student.last_name,
      email: student.email ?? "",
      phone: student.phone ?? "",
      grade_level: student.grade_level ?? "",
      class_id: student.class_id ?? "",
      parent_name: student.parent_name ?? "",
      parent_phone: student.parent_phone ?? "",
      status: student.status ?? "active",
    })
    setShowForm(true)
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this student?")) return
    try {
      await deleteStudent(id)
      toast.success("Student deleted", "The student record was removed.")
      await loadStudents()
    } catch (error) {
      toast.error("Student delete failed", getErrorMessage(error))
    }
  }

  const filteredStudents = students.filter((s) => {
    const matchesSearch = !search || `${s.first_name} ${s.last_name}`.toLowerCase().includes(search.toLowerCase()) || (s.email ?? "").toLowerCase().includes(search.toLowerCase())
    const matchesStatus = !filterStatus || s.status === filterStatus
    return matchesSearch && matchesStatus
  })

  const totalStudents = students.length
  const activeStudents = students.filter((student) => student.status === "active").length
  const inactiveStudents = students.filter((student) => student.status === "inactive").length
  const assignedStudents = students.filter((student) => Boolean(student.class_id)).length
  const unassignedStudents = totalStudents - assignedStudents
  const yearGroups = new Set(students.map((student) => student.year_group).filter(Boolean)).size

  const studentColumns = [
    {
      accessor: "last_name",
      header: "Name",
      sortable: true,
      className: "min-w-[260px]",
      cell: (_: any, row: Student) => (
        <div className="flex items-center gap-3 whitespace-nowrap">
          <TableAvatar>{`${row.first_name?.[0] ?? ""}${row.last_name?.[0] ?? ""}`.trim() || "S"}</TableAvatar>
          <div className="min-w-0">
            <div className="font-medium text-white">{row.first_name} {row.last_name}</div>
            <div className="text-xs text-slate-400">{row.class_id ? "Assigned to class" : "No class assigned"}</div>
          </div>
        </div>
      ),
    },
    {
      accessor: "year_group",
      header: "Year",
      sortable: true,
      className: "whitespace-nowrap min-w-[120px]",
      cell: (value: any) => <span className="text-slate-400">{value ?? "-"}</span>,
    },
    {
      accessor: "email",
      header: "Email",
      sortable: true,
      className: "min-w-[240px]",
      cell: (value: any) => <span className="text-slate-400">{value ?? "-"}</span>,
    },
    {
      accessor: "status",
      header: "Status",
      sortable: true,
      className: "whitespace-nowrap min-w-[140px]",
      cell: (value: any) => (
        <TableBadge tone={value === "active" ? "emerald" : value === "graduated" ? "cyan" : "rose"}>
          {value}
        </TableBadge>
      ),
    },
    {
      accessor: "actions",
      header: "Actions",
      sortable: false,
      className: "whitespace-nowrap min-w-[110px]",
      cell: (_: any, row: Student) => (
        <div className="flex items-center gap-1 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="sm" onClick={() => handleEdit(row)}>
            <Pencil className="size-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handleDelete(row.id)}>
            <Trash2 className="size-4 text-rose-400" />
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="w-full max-w-full min-w-0 overflow-x-hidden">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">Students</h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => loadStudents()}>
            <RefreshCw className="size-4 mr-1" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => { setEditingStudent(null); setFormData(getEmptyStudentForm()); setShowForm(true) }}>
            <Plus className="size-4 mr-1" />
            Add Student
          </Button>
          <Button variant="default" size="sm" onClick={handleSync}>
            <CloudDownload className="size-4 mr-1" />
            Sync Google
          </Button>
        </div>
      </div>

      <section className="mb-5 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Student Overview</h2>
          <p className="text-xs text-slate-400">Compact counts for the current student cohort.</p>
        </div>
        <StatisticGrid>
          <StatisticCard label="Total Students" value={totalStudents} icon={Plus} description="Full roster tracked in the system" tone="information" />
          <StatisticCard label="Active" value={activeStudents} icon={RefreshCw} description="Currently enrolled and in good standing" tone="success" />
          <StatisticCard label="Inactive" value={inactiveStudents} icon={Trash2} description="Archived or inactive records" tone="destructive" />
          <StatisticCard label="Assigned Classes" value={assignedStudents} icon={BookOpen} description="Students linked to classes" tone="warning" />
          <StatisticCard label="Unassigned Students" value={unassignedStudents} icon={Users} description="Students not linked to a class" tone="warning" />
          <StatisticCard label="Year Groups" value={yearGroups} icon={GraduationCap} description="Distinct year levels represented" tone="primary" />
        </StatisticGrid>
      </section>

      <Card className="min-w-0 overflow-hidden border-white/10 p-0">
        <CardHeader className="mb-0 flex-col items-start justify-start border-b border-white/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-base">Student Directory</CardTitle>
            <p className="mt-1 text-xs text-slate-400">Search, filter, and manage the student roster.</p>
          </div>
        </CardHeader>

        <CardContent className="min-w-0 space-y-4 px-0 py-0">
          <div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-500" />
              <Input placeholder="Search students..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="w-full sm:w-52 sm:flex-none">
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="graduated">Graduated</option>
              <option value="transferred">Transferred</option>
            </Select>
          </div>

          <DataTable
            data={filteredStudents}
            columns={studentColumns}
            initialSort={{ id: "last_name", desc: false }}
            itemsPerPageOptions={[10, 25, 50, 100]}
            emptyMessage={loading ? "Loading students..." : "No students found"}
          />
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm} title={editingStudent ? "Edit Student" : "Add Student"}>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <FormField label="First Name" htmlFor="student-first-name">
              <Input id="student-first-name" value={formData.first_name} onChange={(e) => setFormData({ ...formData, first_name: e.target.value })} required />
            </FormField>
            <FormField label="Last Name" htmlFor="student-last-name">
              <Input id="student-last-name" value={formData.last_name} onChange={(e) => setFormData({ ...formData, last_name: e.target.value })} required />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Email" htmlFor="student-email">
              <Input id="student-email" type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
            </FormField>
            <FormField label="Phone" htmlFor="student-phone">
              <Input id="student-phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Grade Level" htmlFor="student-grade-level">
              <Input id="student-grade-level" value={formData.grade_level} onChange={(e) => setFormData({ ...formData, grade_level: e.target.value })} />
            </FormField>
            <FormField label="Class" htmlFor="student-class">
              <Select id="student-class" value={formData.class_id} onChange={(e) => setFormData({ ...formData, class_id: e.target.value })}>
                <option value="">None</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Parent Name" htmlFor="student-parent-name">
              <Input id="student-parent-name" value={formData.parent_name} onChange={(e) => setFormData({ ...formData, parent_name: e.target.value })} />
            </FormField>
            <FormField label="Parent Phone" htmlFor="student-parent-phone">
              <Input id="student-parent-phone" value={formData.parent_phone} onChange={(e) => setFormData({ ...formData, parent_phone: e.target.value })} />
            </FormField>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingStudent(null) }}>Cancel</Button>
            <Button type="submit">{editingStudent ? "Save Changes" : "Add Student"}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
