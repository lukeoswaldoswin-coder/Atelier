import type { NavItem } from '@/config/navigation'
import { Badge } from '@/components/ui/badge'
import { ThemeToggle } from '@/components/theme/theme-toggle'
import { TimeIndicator } from './time-indicator'

export function TopBar({ route }: { route: NavItem }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
      <div className="min-w-0">
        <h1 className="truncate text-sm font-semibold tracking-tight">{route.label}</h1>
        <p className="truncate text-[11px] text-muted-foreground">{route.description}</p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <TimeIndicator />
        {route.implemented ? null : <Badge variant="outline">阶段 {route.phase}</Badge>}
        <ThemeToggle />
      </div>
    </header>
  )
}
