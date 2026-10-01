import { Suspense, lazy, useEffect, useRef, type ReactNode } from "react"
import { Navigate, Outlet, useLocation, useRoutes, useSearchParams } from "react-router-dom"
import { useAuth } from "./context/useAuth"
import { DashboardLayout } from "./components/layout/DashboardLayout"
import { useToast } from "./components/ui/useToast"
import { canAccessRoute } from "./lib/access/routes"

const LoginPage = lazy(() => import("./pages/Login"))
const SetPasswordPage = lazy(() => import("./pages/SetPassword"))
const DashboardPage = lazy(() => import("./pages/Dashboard"))
const StudentsPage = lazy(() => import("./pages/Students"))
const ClassesPage = lazy(() => import("./pages/Classes"))
const StaffPage = lazy(() => import("./pages/Staff"))
const AdminPage = lazy(() => import("./pages/Admin"))
const AssetsPage = lazy(() => import("./pages/Assets"))
const AttendancePage = lazy(() => import("./pages/Attendance"))
const IncidentsPage = lazy(() => import("./pages/Incidents"))
const TicketsPage = lazy(() => import("./pages/Tickets"))
const FinancePage = lazy(() => import("./pages/Finance"))
const SandboxPage = lazy(() => import("./pages/Sandbox"))

function TicketsRedirectRoute() {
  const [searchParams] = useSearchParams()
  const category = searchParams.get("category")?.trim().toLowerCase()

  return <Navigate to={category === "property_rm" ? "/rm-tickets" : "/ict-tickets"} replace />
}

function ProtectedRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-canvas)] flex items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[var(--color-accent)] border-t-transparent" />
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

function PublicRoute() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--color-canvas)] flex items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[var(--color-accent)] border-t-transparent" />
      </div>
    )
  }

  if (user) {
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

function RouteGuard({ path, children }: { path: string; children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const toast = useToast()
  const blockedPathRef = useRef<string | null>(null)
  const allowed = canAccessRoute(path, user?.roles)

  useEffect(() => {
    if (allowed) {
      blockedPathRef.current = null
      return
    }

    if (blockedPathRef.current === location.pathname) {
      return
    }

    blockedPathRef.current = location.pathname
    toast.error("Page unavailable", "This page is not available for your current access level.")
  }, [allowed, location.pathname, toast])

  if (!allowed) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

function AppLayout() {
  return (
      <DashboardLayout>
        <Suspense fallback={
        <div className="min-h-screen bg-[var(--color-canvas)] flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-[var(--color-accent)] border-t-transparent" />
        </div>
      }>
        <Outlet />
      </Suspense>
    </DashboardLayout>
  )
}

const routes = [
  {
    // Deliberately outside PublicRoute. PublicRoute bounces any signed-in user to
    // the dashboard, and someone who has just followed an invitation or reset link
    // is signed in by the time this renders - they would never see the form.
    // It also sits outside RouteGuard, because a brand new login has no roles yet
    // and would be redirected away before it could set a password.
    path: "/set-password",
    element: <SetPasswordPage />,
  },
  {
    element: <PublicRoute />,
    children: [
      { path: "/login", element: <LoginPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: "/",
        element: <AppLayout />,
        children: [
          { index: true, element: <RouteGuard path="/"><DashboardPage /></RouteGuard> },
          { path: "students", element: <RouteGuard path="/students"><StudentsPage /></RouteGuard> },
          { path: "classes", element: <RouteGuard path="/classes"><ClassesPage /></RouteGuard> },
          { path: "staff", element: <RouteGuard path="/staff"><StaffPage /></RouteGuard> },
          { path: "admin", element: <RouteGuard path="/admin"><AdminPage /></RouteGuard> },
          { path: "assets", element: <RouteGuard path="/assets"><AssetsPage /></RouteGuard> },
          { path: "attendance", element: <RouteGuard path="/attendance"><AttendancePage /></RouteGuard> },
          { path: "incidents", element: <RouteGuard path="/incidents"><IncidentsPage /></RouteGuard> },
          // Guarded for consistency: the old canAccessRoute default let this
          // through undeclared, but the route still needs a ticket capability
          // to be worth showing at all.
          { path: "tickets", element: <RouteGuard path="/tickets"><TicketsRedirectRoute /></RouteGuard> },
          { path: "ict-tickets", element: <RouteGuard path="/ict-tickets"><TicketsPage /></RouteGuard> },
          { path: "rm-tickets", element: <RouteGuard path="/rm-tickets"><TicketsPage /></RouteGuard> },
          { path: "finance", element: <RouteGuard path="/finance"><FinancePage /></RouteGuard> },
        ],
      },
      { path: "sandbox", element: <SandboxPage /> },
    ],
  },
]

export default function App() {
  return useRoutes(routes)
}
