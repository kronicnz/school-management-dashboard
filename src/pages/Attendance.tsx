import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { format } from "date-fns"
import { CalendarClock, CheckCircle2, Clock3, Percent, Plus, RefreshCw, Save, Search, XCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card"
import { Button } from "../components/ui/button"
import { Dialog } from "../components/ui/Dialog"
import { DataTable } from "../components/ui/DataTable"
import { FormField } from "../components/ui/FormField"
import { Input } from "../components/ui/Input"
import { Select } from "../components/ui/Select"
import { StatisticCard, StatisticGrid } from "../components/ui/StatisticCard"
import { TableAvatar } from "../components/ui/TableAvatar"
import { TableBadge } from "../components/ui/TableBadge"
import { Textarea } from "../components/ui/Textarea"
import { useToast } from "../components/ui/useToast"
import {
  createAttendanceRecord,
  fetchAttendanceRecords,
  fetchClasses,
  fetchStudents,
  updateAttendanceRecord,
} from "../lib/api/supabaseApi"
import type { Attendance, Class, Student } from "../lib/api/database.types"
import { labelize } from "../utils/labelize"
import { logError } from "../utils/logger"

const attendanceStatuses = ["present", "late", "absent", "excused"] as const
type AttendanceStatus = (typeof attendanceStatuses)[number]

type AttendanceDraft = Omit<Attendance, "status"> & {
  status: AttendanceStatus
  studentName: string
  classNameLabel: string
  dirty: boolean
}

type CreateAttendanceDraft = {
  student_id: string
  class_id: string
  status: AttendanceStatus
  notes: string
}

function formatDateInput(value: Date) {
  return format(value, "yyyy-MM-dd")
}

function statusTone(status: AttendanceStatus): "emerald" | "amber" | "rose" | "indigo" {
  switch (status) {
    case "present":
      return "emerald"
    case "late":
      return "amber"
    case "absent":
      return "rose"
    case "excused":
    default:
      return "indigo"
  }
}

export default function AttendancePage() {
  const toast = useToast()
  const [selectedDate, setSelectedDate] = useState(() => formatDateInput(new Date()))
  const [students, setStudents] = useState<Student[]>([])
  const [classes, setClasses] = useState<Class[]>([])
  const [rows, setRows] = useState<AttendanceDraft[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState("")
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [createForm, setCreateForm] = useState<CreateAttendanceDraft>({
    student_id: "",
    class_id: "",
    status: "present",
    notes: "",
  })

  const studentClassIdById = useMemo(
    () => new Map(students.map((student) => [student.id, student.class_id ?? ""])),
    [students]
  )

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return rows

    return rows.filter((row) => {
      return [row.studentName, row.classNameLabel, row.status, row.notes ?? ""]
        .join(" ")
        .toLowerCase()
        .includes(query)
    })
  }, [rows, search])

  const summary = useMemo(() => {
    const total = rows.length
    const present = rows.filter((row) => row.status === "present").length
    const late = rows.filter((row) => row.status === "late").length
    const absent = rows.filter((row) => row.status === "absent").length
    const excused = rows.filter((row) => row.status === "excused").length

    return { total, present, late, absent, excused }
  }, [rows])

  const attendanceRate = summary.total > 0 ? Math.round((summary.present / summary.total) * 100) : 0

  const dirtyCount = useMemo(() => rows.filter((row) => row.dirty).length, [rows])

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const [studentRows, classRows, attendanceRows] = await Promise.all([
        fetchStudents(),
        fetchClasses(),
        fetchAttendanceRecords(selectedDate),
      ])

      const localStudentNameById = new Map(studentRows.map((student) => [student.id, `${student.first_name} ${student.last_name}`]))
      const localClassNameById = new Map(classRows.map((cls) => [cls.id, cls.name]))

      setStudents(studentRows)
      setClasses(classRows)
      setRows(
        attendanceRows.map((record) => ({
          ...record,
          status: record.status as AttendanceStatus,
          studentName: record.student_id ? localStudentNameById.get(record.student_id) ?? "Unknown student" : "Unknown student",
          classNameLabel: record.class_id
            ? localClassNameById.get(record.class_id) ?? "Unknown class"
            : "No class set",
          dirty: false,
        }))
      )
    } catch (error) {
      logError("Failed to load attendance", error)
      toast.error("Failed to load attendance", error instanceof Error ? error.message : "Unable to load records.")
    } finally {
      setLoading(false)
    }
  }, [selectedDate, toast])

  useEffect(() => {
    queueMicrotask(() => {
      void loadData()
    })
  }, [loadData])

  function updateRow(id: string, patch: Partial<AttendanceDraft>) {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              ...patch,
              dirty: true,
            }
          : row
      )
    )
  }

  async function handleSaveRow(row: AttendanceDraft) {
    try {
      const payload = {
        status: row.status,
        notes: row.notes || null,
      }
      await updateAttendanceRecord(row.id, payload)
      toast.success("Attendance saved", `${row.studentName} was updated successfully.`)
      await loadData()
    } catch (error) {
      toast.error("Failed to save attendance", error instanceof Error ? error.message : "Unable to save row.")
    }
  }

  async function handleSaveAll() {
    const dirtyRows = rows.filter((row) => row.dirty)
    if (dirtyRows.length === 0) {
      toast.success("No changes to save", "Attendance data is already up to date.")
      return
    }

    try {
      setSaving(true)
      await Promise.all(
        dirtyRows.map((row) =>
          updateAttendanceRecord(row.id, {
            status: row.status,
            notes: row.notes || null,
          })
        )
      )
      toast.success("Attendance saved", `${dirtyRows.length} row${dirtyRows.length === 1 ? "" : "s"} updated.`)
      await loadData()
    } catch (error) {
      toast.error("Failed to save attendance", error instanceof Error ? error.message : "Unable to save changes.")
    } finally {
      setSaving(false)
    }
  }

  function handleCreateFormChange(studentId: string) {
    setCreateForm((current) => ({
      ...current,
      student_id: studentId,
      class_id: studentClassIdById.get(studentId) ?? "",
    }))
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!createForm.student_id) {
      toast.error("Missing student", "Select a student before creating an attendance record.")
      return
    }

    try {
      await createAttendanceRecord({
        student_id: createForm.student_id,
        class_id: createForm.class_id || null,
        date: selectedDate,
        status: createForm.status,
        notes: createForm.notes.trim() || null,
      })

      toast.success("Attendance created", "The record was added successfully.")
      setShowCreateDialog(false)
      setCreateForm({
        student_id: "",
        class_id: "",
        status: "present",
        notes: "",
      })
      await loadData()
    } catch (error) {
      toast.error("Failed to create attendance", error instanceof Error ? error.message : "Unable to create record.")
    }
  }

  const columns = [
    {
      accessor: "studentName",
      header: "Student",
      sortable: true,
      className: "min-w-[260px]",
      cell: (value: string) => (
        <div className="flex items-center gap-3">
          <TableAvatar>{value.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "S"}</TableAvatar>
          <div className="min-w-0">
            <div className="font-medium text-white">{value}</div>
            <div className="text-xs text-slate-400">Student record</div>
          </div>
        </div>
      ),
    },
    {
      accessor: "classNameLabel",
      header: "Class",
      sortable: true,
      className: "min-w-[220px]",
      cell: (value: string) => <span className="text-slate-400">{value}</span>,
    },
    {
      accessor: "status",
      header: "Status",
      sortable: true,
      className: "min-w-[180px]",
      cell: (value: AttendanceStatus, row: AttendanceDraft) => (
        <div onClick={(event) => event.stopPropagation()}>
          <Select value={value} onChange={(event) => updateRow(row.id, { status: event.target.value as AttendanceStatus })} className="w-40">
            {attendanceStatuses.map((status) => (
              <option key={status} value={status}>
                {labelize(status)}
              </option>
            ))}
          </Select>
        </div>
      ),
    },
    {
      accessor: "notes",
      header: "Notes",
      sortable: true,
      className: "min-w-[240px]",
      cell: (value: string | null, row: AttendanceDraft) => (
        <div onClick={(event) => event.stopPropagation()}>
          <Input
            value={value ?? ""}
            onChange={(event) => updateRow(row.id, { notes: event.target.value })}
            placeholder="Optional notes"
          />
        </div>
      ),
    },
    {
      accessor: "dirty",
      header: "State",
      sortable: true,
      className: "whitespace-nowrap min-w-[140px]",
      cell: (value: boolean, row: AttendanceDraft) => (
        <div className="flex items-center gap-2">
          <TableBadge tone={statusTone(row.status)}>
            {labelize(row.status)}
          </TableBadge>
          {value ? <span className="text-xs text-amber-400">Unsaved</span> : <span className="text-xs text-emerald-400">Saved</span>}
        </div>
      ),
    },
    {
      accessor: "id",
      header: "Actions",
      sortable: false,
      searchable: false,
      className: "whitespace-nowrap min-w-[120px]",
      cell: (_: unknown, row: AttendanceDraft) => (
        <div onClick={(event) => event.stopPropagation()}>
          <Button variant="outline" size="sm" onClick={() => void handleSaveRow(row)} disabled={!row.dirty}>
            <Save className="mr-1 size-4" />
            Save
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="w-full max-w-full min-w-0 space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]">School management</p>
          <h1 className="mt-2 text-3xl font-bold text-[var(--color-text)]">Attendance Overview</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="w-auto"
          />
          <Button variant="outline" size="sm" onClick={() => void loadData()}>
            <RefreshCw className="mr-1 size-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-1 size-4" />
            Add Record
          </Button>
          <Button size="sm" onClick={() => void handleSaveAll()} isLoading={saving} disabled={saving}>
            <Save className="mr-1 size-4" />
            Save Attendance
          </Button>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Attendance Snapshot</h2>
          <p className="text-xs text-[var(--color-muted)]">Live records for the selected date.</p>
        </div>
        <StatisticGrid>
          <StatisticCard label="Total Records" value={summary.total} icon={CalendarClock} description="Entries captured for the selected date" tone="information" />
          <StatisticCard label="Present" value={summary.present} icon={CheckCircle2} description="Marked present in class" tone="success" />
          <StatisticCard label="Late" value={summary.late} icon={Clock3} description="Recorded after the start time" tone="warning" />
          <StatisticCard label="Absent" value={summary.absent} icon={XCircle} description="Missing from the attendance list" tone="destructive" />
          <StatisticCard label="Excused" value={summary.excused} icon={RefreshCw} description="Absences approved or excused" tone="pending" />
          <StatisticCard label="Attendance Rate" value={`${attendanceRate}%`} icon={Percent} description="Present rate for the selected date" tone="completed" />
        </StatisticGrid>
      </section>

      <section className="space-y-4">
        <Card className="min-w-0 overflow-hidden border-[var(--color-border)] bg-[var(--color-surface)] p-0">
          <CardHeader className="mb-0 flex-col items-start justify-start border-b border-[var(--color-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <CardTitle className="text-base">Attendance Register</CardTitle>
              <p className="mt-1 text-xs text-[var(--color-muted)]">Edit records inline and persist changes to Supabase.</p>
            </div>
            <div className="relative w-full sm:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted)]" />
              <Input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search student, class, notes"
                className="pl-9"
              />
            </div>
          </CardHeader>

          <CardContent className="min-w-0 space-y-4 px-0 py-0">
            <DataTable
              data={filteredRows}
              columns={columns}
              initialSort={{ id: "studentName", desc: false }}
              itemsPerPageOptions={[10, 25, 50]}
              emptyMessage={loading ? "Loading attendance..." : "No attendance records found for this date."}
              searchable={false}
            />

            <div className="text-xs text-[var(--color-muted)]">
              Unsaved changes: <span className="font-semibold text-[var(--color-text)]">{dirtyCount}</span>
            </div>
          </CardContent>
        </Card>
      </section>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog} title="Add Attendance Record">
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <FormField label="Student" htmlFor="attendance-student" required>
            <Select
              id="attendance-student"
              value={createForm.student_id}
              onChange={(event) => handleCreateFormChange(event.target.value)}
              required
            >
              <option value="">Select student</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.first_name} {student.last_name}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Class" htmlFor="attendance-class">
            <Select
              id="attendance-class"
              value={createForm.class_id}
              onChange={(event) => setCreateForm((current) => ({ ...current, class_id: event.target.value }))}
            >
              <option value="">No class</option>
              {classes.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Status" htmlFor="attendance-status" required>
            <Select
              id="attendance-status"
              value={createForm.status}
              onChange={(event) => setCreateForm((current) => ({ ...current, status: event.target.value as AttendanceStatus }))}
              required
            >
              {attendanceStatuses.map((status) => (
                <option key={status} value={status}>
                  {labelize(status)}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Notes" htmlFor="attendance-notes">
            <Textarea
              id="attendance-notes"
              value={createForm.notes}
              onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))}
              rows={3}
              placeholder="Optional note"
            />
          </FormField>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button type="submit">Create Record</Button>
          </div>
        </form>
      </Dialog>
    </div>
  )
}
