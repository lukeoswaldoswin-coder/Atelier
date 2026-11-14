import type { ReactNode } from 'react'
import type { NavItem } from '@/config/navigation'
import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'

export function AppShell({ route, children }: { route: NavItem; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar route={route} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-6 py-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
