import type { ReactNode } from "react"
import { AppShell } from "./AppShell"

interface DashboardLayoutProps {
  children: ReactNode
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return <AppShell>{children}</AppShell>
}
