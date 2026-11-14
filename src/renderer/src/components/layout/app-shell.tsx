import type { ReactNode } from 'react'
import type { NavItem } from '@/config/navigation'
import { Sidebar } from './sidebar'
import { TopBar } from './top-bar'

/**
 * reading：阅读宽度（仪表盘等偏文档型页面，最大 5xl 居中）
 * wide：撑满内容区（列表 + 详情这类需要横向空间的页面）
 */
export type AppShellLayout = 'reading' | 'wide'

export function AppShell({
  route,
  layout = 'reading',
  children
}: {
  route: NavItem
  layout?: AppShellLayout
  children: ReactNode
}) {
  const contentClass =
    layout === 'wide' ? 'h-full w-full px-6 py-4' : 'mx-auto w-full max-w-5xl px-6 py-6'

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar route={route} />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className={contentClass}>{children}</div>
        </main>
      </div>
    </div>
  )
}
