import { Suspense, lazy, useEffect, useRef, type ReactNode } from "react"
import { Navigate, Outlet, useLocation, useRoutes } from "react-router-dom"
import { useAuth } from "./context/useAuth"
import { DashboardLayout } from "./components/layout/DashboardLayout"
import { useToast } from "./components/ui/useToast"
import { getResolvedRoleTier, isRouteAllowedForTier, type RoleTier } from "./lib/role-tier"

const LoginPage = lazy(() => import("./pages/Login"))
const DashboardPage = lazy(() => import("./pages/Dashboard"))
const StudentsPage = lazy(() => import("./pages/Students"))
const ClassesPage = lazy(() => import("./pages/Classes"))
const StaffPage = lazy(() => import("./pages/Staff"))
const AdminPage = lazy(() => import("./pages/Admin"))
const AssetsPage = lazy(() => import("./pages/Assets"))
const AttendancePage = lazy(() => import("./pages/Attendance"))
const IncidentsPage = lazy(() => import("./pages/Incidents"))
const TicketsPage = lazy(() => import("./pages/Tickets"))
const SandboxPage = lazy(() => import("./pages/Sandbox"))

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

function TierRouteGuard({ allowedTiers, children }: { allowedTiers: RoleTier[]; children: ReactNode }) {
  const { user } = useAuth()
  const location = useLocation()
  const toast = useToast()
  const blockedPathRef = useRef<string | null>(null)
  const tier = getResolvedRoleTier(user?.roles)
  const allowed = isRouteAllowedForTier(location.pathname, tier) && allowedTiers.includes(tier)

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
          { index: true, element: <TierRouteGuard allowedTiers={["minimal_access", "operational_staff", "leadership", "it_admin"]}><DashboardPage /></TierRouteGuard> },
          { path: "students", element: <TierRouteGuard allowedTiers={["operational_staff", "leadership", "it_admin"]}><StudentsPage /></TierRouteGuard> },
          { path: "classes", element: <TierRouteGuard allowedTiers={["operational_staff", "leadership", "it_admin"]}><ClassesPage /></TierRouteGuard> },
          { path: "staff", element: <TierRouteGuard allowedTiers={["leadership", "it_admin"]}><StaffPage /></TierRouteGuard> },
          { path: "admin", element: <TierRouteGuard allowedTiers={["it_admin"]}><AdminPage /></TierRouteGuard> },
          { path: "assets", element: <TierRouteGuard allowedTiers={["it_admin"]}><AssetsPage /></TierRouteGuard> },
          { path: "attendance", element: <TierRouteGuard allowedTiers={["operational_staff", "leadership", "it_admin"]}><AttendancePage /></TierRouteGuard> },
          { path: "incidents", element: <TierRouteGuard allowedTiers={["operational_staff", "leadership", "it_admin"]}><IncidentsPage /></TierRouteGuard> },
          { path: "tickets", element: <TierRouteGuard allowedTiers={["operational_staff", "leadership", "it_admin"]}><TicketsPage /></TierRouteGuard> },
        ],
      },
      { path: "sandbox", element: <SandboxPage /> },
    ],
  },
]

export default function App() {
  return useRoutes(routes)
}
