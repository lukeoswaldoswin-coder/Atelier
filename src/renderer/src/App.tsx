import { useEffect } from 'react'
import { AppShell, type AppShellLayout } from '@/components/layout/app-shell'
import type { NavItem } from '@/config/navigation'
import { routeMap } from '@/config/navigation'
import { applyTheme } from '@/lib/theme'
import { ComingSoonPage } from '@/pages/coming-soon-page'
import { CommissionsPage } from '@/pages/commissions/commissions-page'
import { DashboardPage } from '@/pages/dashboard-page'
import { useNavigationStore } from '@/stores/navigation-store'
import { useThemeStore } from '@/stores/theme-store'

function renderPage(route: NavItem) {
  switch (route.id) {
    case 'dashboard':
      return <DashboardPage />
    case 'commissions':
      return <CommissionsPage />
    default:
      return <ComingSoonPage route={route} />
  }
}

export default function App() {
  const theme = useThemeStore((state) => state.theme)
  const active = useNavigationStore((state) => state.active)
  const route = routeMap[active]
  const layout: AppShellLayout = active === 'commissions' ? 'wide' : 'reading'

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <AppShell route={route} layout={layout}>
      {renderPage(route)}
    </AppShell>
  )
}
