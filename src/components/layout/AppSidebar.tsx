import { LogOut, School } from "lucide-react"
import { Link, useLocation } from "react-router-dom"
import { Button } from "../ui/button"
import { TableBadge } from "../ui/TableBadge"
import { cn } from "../../utils/cn"
import { ROLE_LABELS, type AppRole } from "../../lib/access/registry"
import { getShellNavGroups } from "./navigation"
import { Sheet } from "../ui/Sheet"

type AppSidebarProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeRole: AppRole | null
  displayName: string
  email?: string
  roles: string[]
  onSignOut: () => void | Promise<void>
}

export function AppSidebar({
  open,
  onOpenChange,
  activeRole,
  displayName,
  email,
  roles,
  onSignOut,
}: AppSidebarProps) {
  const location = useLocation()
  const navGroups = getShellNavGroups(roles, activeRole)

  const navContent = (
    <>
      <div className="flex h-16 items-center gap-3 border-b border-[var(--color-border)] px-5 lg:px-6">
        <div className="flex size-10 items-center justify-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-secondary)] text-[var(--color-primary)] shadow-sm">
          <School className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--color-foreground)]">School Management</div>
          <div className="text-xs text-[var(--color-muted-foreground)]">Enterprise operations suite</div>
        </div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 py-4 lg:px-4">
        <div className="flex flex-col gap-1.5">
          {navGroups.map((group) => (
            <div key={group.section} className="flex flex-col gap-1.5">
              <p className="px-3 text-xs font-semibold uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">{group.label}</p>
              {group.items.map((item) => {
                const Icon = item.icon
                const active = location.pathname === item.to || (item.to !== "/" && location.pathname.startsWith(item.to))

                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => onOpenChange(false)}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-foreground)] ring-1 ring-[color-mix(in_srgb,var(--color-primary)_28%,transparent)]"
                        : "text-[var(--color-muted-foreground)] hover:bg-[var(--color-secondary)] hover:text-[var(--color-foreground)]"
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </Link>
                )
              })}
            </div>
          ))}
        </div>

      </nav>

      <div className="border-t border-[var(--color-border)] p-4">
        <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-[var(--color-foreground)]">{displayName}</div>
              <div className="truncate text-xs text-[var(--color-muted-foreground)]">{email ?? "No email available"}</div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <TableBadge tone="violet">{activeRole ? ROLE_LABELS[activeRole] : "Workspace"}</TableBadge>
            {roles.length > 1 ? <TableBadge tone="slate">{roles.length} roles</TableBadge> : null}
          </div>

          <div className="mt-3 text-xs leading-5 text-[var(--color-muted-foreground)]">
            <div>Roles: {roles.length > 0 ? roles.join(", ") : "None"}</div>
            <div>{displayName === "User" ? "Signed-in workspace" : "Workspace ready"}</div>
          </div>

          <Button variant="outline" size="sm" onClick={onSignOut} className="mt-4 w-full justify-start">
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </div>
    </>
  )

  return (
    <>
      <aside className="hidden min-h-dvh w-[280px] flex-col border-r border-[var(--color-border)] bg-[var(--color-card)] shadow-[0_0_0_1px_rgba(15,23,42,0.02)] md:flex">
        {navContent}
      </aside>

      <Sheet open={open} onOpenChange={onOpenChange} side="left" ariaLabel="Navigation" panelClassName="w-[min(86vw,20rem)] border-r-0 bg-[var(--color-card-elevated)]" showCloseButton={false}>
        {navContent}
      </Sheet>
    </>
  )
}
