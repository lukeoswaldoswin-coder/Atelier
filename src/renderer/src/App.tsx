import { useEffect } from 'react'
import { AppShell } from '@/components/layout/app-shell'
import { routeMap } from '@/config/navigation'
import { applyTheme } from '@/lib/theme'
import { ComingSoonPage } from '@/pages/coming-soon-page'
import { DashboardPage } from '@/pages/dashboard-page'
import { useNavigationStore } from '@/stores/navigation-store'
import { useThemeStore } from '@/stores/theme-store'

export default function App() {
  const theme = useThemeStore((state) => state.theme)
  const active = useNavigationStore((state) => state.active)
  const route = routeMap[active]

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <AppShell route={route}>
      {route.implemented ? <DashboardPage /> : <ComingSoonPage route={route} />}
    </AppShell>
  )
}
