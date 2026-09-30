import { useMemo, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useAuth } from "../../context/useAuth"
import { AppHeader } from "./AppHeader"
import { AppSidebar } from "./AppSidebar"

type AppShellProps = {
  children: React.ReactNode
}

function getDisplayName(fullName: string | undefined, email: string | undefined) {
  return fullName?.trim() || email?.split("@")[0] || "User"
}

export function AppShell({ children }: AppShellProps) {
  const { signOut, user, activeRole, setActiveRole } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchValue, setSearchValue] = useState("")
  const email = user?.email ?? undefined
  const fullName = typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name : undefined

  const roles = useMemo(() => user?.roles ?? [], [user?.roles])
  const displayName = useMemo(() => getDisplayName(fullName, email), [email, fullName])

  const notifications = useMemo(
    () => [
      { title: "Attendance sync complete", message: "The latest classroom attendance batch has been processed.", time: "5m" },
      { title: "3 tickets awaiting triage", message: "Support requests need assignment from the queue.", time: "18m" },
      { title: "Asset warranty expiring soon", message: "Several devices are due for review this month.", time: "1h" },
    ],
    []
  )

  async function handleSignOut() {
    await signOut()
    navigate("/login")
  }

  return (
    <div className="min-h-dvh bg-[var(--color-background)] text-[var(--color-foreground)] md:grid md:grid-cols-[280px_minmax(0,1fr)]">
      <AppSidebar
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        activeRole={activeRole}
        displayName={displayName}
        email={email}
        roles={roles}
        onSignOut={handleSignOut}
      />

      <div className="min-w-0 flex min-h-dvh flex-col">
        <AppHeader
          pathname={location.pathname}
          activeRole={activeRole}
          roles={roles}
          onActiveRoleChange={setActiveRole}
          displayName={displayName}
          email={email}
          searchValue={searchValue}
          onSearchValueChange={setSearchValue}
          onMenuClick={() => setSidebarOpen((value) => !value)}
          onSignOut={handleSignOut}
          notifications={notifications}
        />

        <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
          {children}
        </main>
      </div>
    </div>
  )
}
