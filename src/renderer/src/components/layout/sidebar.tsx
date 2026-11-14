import { Palette } from 'lucide-react'
import { navGroups } from '@/config/navigation'
import { cn } from '@/lib/utils'
import { useNavigationStore } from '@/stores/navigation-store'

/**
 * 左侧导航栏。
 * 所有未实现页面都会显示所属阶段，避免用户误以为功能已经可用。
 */
export function Sidebar() {
  const active = useNavigationStore((state) => state.active)
  const setActive = useNavigationStore((state) => state.setActive)

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center gap-2 px-4">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Palette className="size-4" aria-hidden="true" />
        </span>
        <span className="text-sm font-semibold tracking-tight">Atelier</span>
        <span className="ml-auto rounded border border-sidebar-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          P0
        </span>
      </div>

      <nav aria-label="主导航" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {navGroups.map((group) => (
          <div key={group.id} className="mb-4 last:mb-0">
            <div className="px-2 pb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground/80 uppercase">
              {group.title}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = item.id === active
                const Icon = item.icon
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => setActive(item.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'group flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                        isActive
                          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
                      )}
                    >
                      <Icon
                        className={cn(
                          'size-4 shrink-0',
                          isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate">{item.label}</span>
                      {!item.implemented ? (
                        <span className="ml-auto text-[10px] text-muted-foreground/70">{item.phase}</span>
                      ) : null}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        数据保存在本机
        <br />
        不会上传云端
      </div>
    </aside>
  )
}
