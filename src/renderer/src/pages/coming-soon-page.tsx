import type { NavItem } from '@/config/navigation'
import { Badge } from '@/components/ui/badge'

/** 尚未实现页面的占位视图：只说明该功能属于哪个阶段，不伪造任何数据或交互。 */
export function ComingSoonPage({ route }: { route: NavItem }) {
  const Icon = route.icon

  return (
    <div className="flex min-h-[55vh] flex-col items-center justify-center rounded-lg border border-dashed border-border/70 px-6 py-16 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <h2 className="text-sm font-medium">{route.label}</h2>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">{route.description}</p>
      <Badge variant="outline" className="mt-4">
        计划在 {route.phase} 阶段实现
      </Badge>
    </div>
  )
}
