import { Bell, ChevronDown, Menu, Search } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Button } from "../ui/button"
import { Input } from "../ui/Input"
import { ThemeToggle } from "../ui/ThemeToggle"
import { TableBadge } from "../ui/TableBadge"
import { cn } from "../../utils/cn"
import { ROLE_LABELS, isAppRole, type AppRole } from "../../lib/access/registry"
import { normalizeRoles } from "../../lib/access/permissions"
import { ROLE_PRECEDENCE } from "../../lib/access/registry"
import { getRoleQuickNote, getShellPageMeta } from "./navigation"
import { PageHeader } from "./PageHeader"

// Switcher order follows the same precedence the default active role uses.
const ROLE_ORDER = ROLE_PRECEDENCE

type NotificationItem = {
  title: string
  message: string
  time: string
}

type AppHeaderProps = {
  pathname: string
  activeRole: AppRole | null
  roles: string[]
  onActiveRoleChange: (role: AppRole) => void
  displayName: string
  email?: string
  searchValue: string
  onSearchValueChange: (value: string) => void
  onMenuClick: () => void
  onSignOut: () => void | Promise<void>
  notifications: NotificationItem[]
  children?: ReactNode
}

export function AppHeader({
  pathname,
  activeRole,
  roles,
  onActiveRoleChange,
  displayName,
  email,
  searchValue,
  onSearchValueChange,
  onMenuClick,
  onSignOut,
  notifications,
}: AppHeaderProps) {
  const pageMeta = useMemo(() => getShellPageMeta(pathname, activeRole), [activeRole, pathname])
  const quickNote = useMemo(() => getRoleQuickNote(activeRole), [activeRole])
  const [menu, setMenu] = useState<"notifications" | "profile" | "roles" | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Only a user holding more than one role gets a switcher, and the options
  // always come from the roles actually held.
  const heldRoles = useMemo(
    () => normalizeRoles(roles).filter(isAppRole).sort(
      (left, right) => ROLE_ORDER.indexOf(left) - ROLE_ORDER.indexOf(right),
    ),
    [roles],
  )
  const showRoleSwitcher = heldRoles.length > 1

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!menuRef.current) return
      if (event.target instanceof Node && menuRef.current.contains(event.target)) return
      setMenu(null)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null)
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("touchstart", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("touchstart", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  return (
    <div className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-background)_92%,transparent)] shadow-sm backdrop-blur-xl">
      <div className="px-3 py-2 sm:px-4 sm:py-3 lg:px-8 lg:py-4">
        <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(24rem,30rem)] lg:gap-4 lg:items-start">
          <div className="flex items-start gap-3 min-w-0">
            <Button variant="ghost" size="sm" className="h-10 w-10 shrink-0 md:hidden" onClick={onMenuClick} aria-label="Toggle navigation">
              <Menu className="size-4" />
            </Button>

            <div className="min-w-0 flex-1">
              <div className="lg:hidden">
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-[var(--color-muted-foreground)]">{pageMeta.breadcrumb}</p>
                <h1 className="mt-1 truncate text-[1.1rem] font-semibold tracking-tight text-[var(--color-foreground)] sm:text-[1.2rem]">{pageMeta.title}</h1>
                <p className="mt-1 truncate text-xs leading-5 text-[var(--color-muted-foreground)]">{quickNote}</p>
              </div>

              <div className="hidden lg:block">
                <PageHeader breadcrumb={pageMeta.breadcrumb} title={pageMeta.title} description={quickNote} className="gap-1" />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <TableBadge tone="violet">{activeRole ? ROLE_LABELS[activeRole] : "Workspace"}</TableBadge>
                  {showRoleSwitcher ? (
                    <div className="relative">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1.5 px-2.5 text-xs"
                        onClick={() => setMenu(menu === "roles" ? null : "roles")}
                        aria-expanded={menu === "roles"}
                        aria-haspopup="menu"
                      >
                        Switch view
                        <ChevronDown className="size-3.5" />
                      </Button>

                      <div
                        className={cn(
                          "absolute left-0 top-[calc(100%+0.5rem)] z-50 w-[min(calc(100vw-1rem),16rem)] origin-top-left overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card-elevated)] shadow-2xl transition-[opacity,transform] duration-150 motion-reduce:transition-none",
                          menu === "roles" ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0"
                        )}
                        role="menu"
                        aria-label="Switch dashboard view"
                      >
                        {heldRoles.map((role) => (
                          <button
                            key={role}
                            type="button"
                            role="menuitemradio"
                            aria-checked={role === activeRole}
                            className={cn(
                              "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--color-secondary)]",
                              role === activeRole
                                ? "font-semibold text-[var(--color-foreground)]"
                                : "text-[var(--color-muted-foreground)]"
                            )}
                            onClick={() => {
                              onActiveRoleChange(role)
                              setMenu(null)
                            }}
                          >
                            <span>{ROLE_LABELS[role]}</span>
                            {role === activeRole ? <span aria-hidden="true">✓</span> : null}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <TableBadge tone="slate">{roles.length > 0 ? `${roles.length} roles` : "Workspace"}</TableBadge>
                </div>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-2 lg:justify-self-end" ref={menuRef}>
            <div className="relative lg:w-[clamp(24rem,28vw,32rem)]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
              <Input
                value={searchValue}
                onChange={(event) => onSearchValueChange(event.target.value)}
                placeholder="Search students, staff, tickets..."
                aria-label="Global search"
                className="h-10 rounded-2xl pl-10 pr-16"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-[var(--color-border)] bg-[var(--color-secondary)] px-2 py-0.5 text-xs font-medium text-[var(--color-muted-foreground)]">
                / K
              </span>
            </div>

            <div className="flex items-center justify-end gap-2">
              <div className="relative lg:hidden">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 w-10 gap-0 px-0"
                  onClick={() => setMenu(menu === "notifications" ? null : "notifications")}
                  aria-expanded={menu === "notifications"}
                  aria-haspopup="menu"
                  aria-label={notifications.length > 0 ? `Alerts, ${notifications.length} unread` : "Alerts"}
                >
                  <Bell className="size-4" />
                  {notifications.length > 0 ? <TableBadge tone="rose" className="ml-1 hidden sm:inline-flex">{notifications.length}</TableBadge> : null}
                </Button>

                <div
                  className={cn(
                    "absolute right-0 top-[calc(100%+0.75rem)] w-[min(calc(100vw-1rem),22rem)] origin-top-right overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card-elevated)] shadow-2xl transition-[opacity,transform] duration-150 motion-reduce:transition-none",
                    menu === "notifications" ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0"
                  )}
                  role="menu"
                  aria-label="Notifications"
                >
                  <div className="border-b border-[var(--color-border)] px-4 py-3">
                    <div className="text-sm font-semibold text-[var(--color-foreground)]">Notifications</div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">Recent system and workflow updates</div>
                  </div>
                  <div className="max-h-80 overflow-auto p-2">
                    {notifications.length > 0 ? (
                      notifications.map((item) => (
                        <button key={`${item.title}-${item.time}`} type="button" className="flex w-full flex-col items-start gap-1 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[var(--color-secondary)]" role="menuitem">
                          <div className="flex w-full items-center justify-between gap-3">
                            <span className="truncate text-sm font-medium text-[var(--color-foreground)]">{item.title}</span>
                            <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">{item.time}</span>
                          </div>
                          <p className="text-xs leading-5 text-[var(--color-muted-foreground)]">{item.message}</p>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-6 text-sm text-[var(--color-muted-foreground)]">No new notifications</div>
                    )}
                  </div>
                </div>
              </div>

              <ThemeToggle className="h-10 w-10 px-0 sm:w-auto sm:px-3" />

              <div className="relative">
                <Button variant="outline" size="sm" onClick={() => setMenu(menu === "profile" ? null : "profile")} aria-expanded={menu === "profile"} aria-haspopup="menu" className="h-10 gap-2 px-3">
                  <div className="flex size-7 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-xs font-semibold text-[var(--color-primary)]">
                    {(displayName?.[0] ?? email?.[0] ?? "U").toUpperCase()}
                  </div>
                  <span className="hidden md:inline max-w-32 truncate">{displayName}</span>
                  <ChevronDown className="size-4 text-[var(--color-muted-foreground)]" />
                </Button>

                <div
                  className={cn(
                    "absolute right-0 top-[calc(100%+0.75rem)] w-[min(calc(100vw-1rem),20rem)] origin-top-right overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card-elevated)] shadow-2xl transition-[opacity,transform] duration-150 motion-reduce:transition-none",
                    menu === "profile" ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0"
                  )}
                  role="menu"
                  aria-label="Profile"
                >
                  <div className="border-b border-[var(--color-border)] px-4 py-4">
                    <div className="text-sm font-semibold text-[var(--color-foreground)]">{displayName}</div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">{email ?? "No email available"}</div>
                  </div>
                  <div className="flex flex-wrap gap-2 px-4 py-3">
                    <TableBadge tone="violet">{activeRole ? ROLE_LABELS[activeRole] : "Workspace"}</TableBadge>
                    {showRoleSwitcher ? <TableBadge tone="slate">{heldRoles.length} roles</TableBadge> : null}
                  </div>
                  <div className="px-4 pb-3 text-xs leading-5 text-[var(--color-muted-foreground)]">Roles: {roles.length > 0 ? roles.join(", ") : "None"}</div>
                  <div className="border-t border-[var(--color-border)] px-2 py-2">
                    <button type="button" className="w-full rounded-xl px-3 py-2 text-left text-sm text-[var(--color-foreground)] transition-colors hover:bg-[var(--color-secondary)]" role="menuitem" onClick={onSignOut}>
                      Sign out
                    </button>
                  </div>
                </div>
              </div>

              <div className="relative lg:block hidden">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 gap-2 px-3"
                  onClick={() => setMenu(menu === "notifications" ? null : "notifications")}
                  aria-expanded={menu === "notifications"}
                  aria-haspopup="menu"
                  aria-label={notifications.length > 0 ? `Alerts, ${notifications.length} unread` : "Alerts"}
                >
                  <Bell className="size-4" />
                  <span className="hidden xl:inline">Alerts</span>
                  {notifications.length > 0 ? <TableBadge tone="rose" className="ml-1">{notifications.length}</TableBadge> : null}
                </Button>

                <div
                  className={cn(
                    "absolute right-0 top-[calc(100%+0.75rem)] w-[min(calc(100vw-1rem),22rem)] origin-top-right overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card-elevated)] shadow-2xl transition-[opacity,transform] duration-150 motion-reduce:transition-none",
                    menu === "notifications" ? "visible translate-y-0 opacity-100" : "invisible translate-y-1 opacity-0"
                  )}
                  role="menu"
                  aria-label="Notifications"
                >
                  <div className="border-b border-[var(--color-border)] px-4 py-3">
                    <div className="text-sm font-semibold text-[var(--color-foreground)]">Notifications</div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">Recent system and workflow updates</div>
                  </div>
                  <div className="max-h-80 overflow-auto p-2">
                    {notifications.length > 0 ? (
                      notifications.map((item) => (
                        <button key={`${item.title}-${item.time}`} type="button" className="flex w-full flex-col items-start gap-1 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[var(--color-secondary)]" role="menuitem">
                          <div className="flex w-full items-center justify-between gap-3">
                            <span className="truncate text-sm font-medium text-[var(--color-foreground)]">{item.title}</span>
                            <span className="shrink-0 text-xs text-[var(--color-muted-foreground)]">{item.time}</span>
                          </div>
                          <p className="text-xs leading-5 text-[var(--color-muted-foreground)]">{item.message}</p>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-6 text-sm text-[var(--color-muted-foreground)]">No new notifications</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
