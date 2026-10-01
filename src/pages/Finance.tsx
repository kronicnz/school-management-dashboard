import { useCallback, useEffect, useState } from "react"
import { FinanceOverview } from "../components/finance/FinanceOverview"
import type { FinanceSnapshot } from "../components/dashboard/types"
import { useAuth } from "../context/useAuth"
import { fetchFinanceDashboardData } from "../lib/api/supabaseApi"
import { can } from "../lib/access/permissions"
import { buildFinanceViewSnapshot } from "../lib/finance/financeSnapshot"
import { logError } from "../utils/logger"

export default function FinancePage() {
  const { user } = useAuth()
  const [state, setState] = useState<{ snapshot: FinanceSnapshot | null; loading: boolean }>({ snapshot: null, loading: true })

  // Read-only finance roles can review the mirror but must not ingest, correct, or post.
  // The edge function enforces this server-side; the flag exists so a read-only user is
  // not shown controls that can only ever fail.
  const canManage = can(user?.roles, "finance.manage")

  // Stable identity matters here: FinanceOverview holds a Supabase Realtime channel keyed
  // on onRefresh. An inline function would re-subscribe the channel on every render,
  // tearing down the subscription and dropping the events it exists to catch.
  const refresh = useCallback(async () => {
    try {
      const data = await fetchFinanceDashboardData()
      setState({ snapshot: buildFinanceViewSnapshot(data), loading: false })
    } catch (error) {
      logError("Failed to load the finance mirror", error)
      setState((previous) => ({ ...previous, loading: false }))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return <FinanceOverview snapshot={state.snapshot} loading={state.loading} canManage={canManage} onRefresh={refresh} />
}
