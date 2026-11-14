import { useEffect } from 'react'
import { AppShell, type AppShellLayout } from '@/components/layout/app-shell'
import type { NavItem } from '@/config/navigation'
import { routeMap } from '@/config/navigation'
import { useTimePolling } from '@/data/time-polling'
import { applyTheme } from '@/lib/theme'
import { ComingSoonPage } from '@/pages/coming-soon-page'
import { CalendarPage } from '@/pages/calendar/calendar-page'
import { CommissionsPage } from '@/pages/commissions/commissions-page'
import { DashboardPage } from '@/pages/dashboard-page'
import { SettingsPage } from '@/pages/settings/settings-page'
import { TimePage } from '@/pages/time/time-page'
import { useNavigationStore } from '@/stores/navigation-store'
import { useThemeStore } from '@/stores/theme-store'

function renderPage(route: NavItem) {
  switch (route.id) {
    case 'dashboard':
      return <DashboardPage />
    case 'commissions':
      return <CommissionsPage />
    case 'calendar':
      return <CalendarPage />
    case 'settings':
      return <SettingsPage />
    case 'time':
      return <TimePage />
    default:
      return <ComingSoonPage route={route} />
  }
}

export default function App() {
  const theme = useThemeStore((state) => state.theme)
  const active = useNavigationStore((state) => state.active)
  const route = routeMap[active]
  const layout: AppShellLayout = active === 'commissions' || active === 'calendar' ? 'wide' : 'reading'

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useTimePolling()

  return (
    <AppShell route={route} layout={layout}>
      {renderPage(route)}
    </AppShell>
  )
}
