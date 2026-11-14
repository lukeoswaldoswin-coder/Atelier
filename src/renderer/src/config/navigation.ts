import {
  CalendarDays,
  LayoutDashboard,
  Settings,
  Timer,
  Users,
  type LucideIcon
} from 'lucide-react'

/** 侧边栏路由标识。新增页面时必须在这里登记，App 才能渲染对应内容。 */
export type RouteId = 'dashboard' | 'commissions' | 'calendar' | 'time' | 'settings'

export interface NavItem {
  id: RouteId
  label: string
  description: string
  icon: LucideIcon
  /** 该页面计划在哪个开发阶段实现，用于如实告知用户当前状态。 */
  phase: string
  implemented: boolean
}

export interface NavGroup {
  id: string
  title: string
  items: readonly NavItem[]
}

export const navGroups: readonly NavGroup[] = [
  {
    id: 'workspace',
    title: '工作台',
    items: [
      {
        id: 'dashboard',
        label: '概览',
        description: '进行中委托、近期交稿与今日绘画任务的汇总视图。',
        icon: LayoutDashboard,
        phase: 'P0',
        implemented: true
      }
    ]
  },
  {
    id: 'commissions',
    title: '委托',
    items: [
      {
        id: 'commissions',
        label: '委托管理',
        description: '客户资料、需求说明、交稿日期、金额与付款状态。',
        icon: Users,
        phase: 'P1.2',
        implemented: true
      }
    ]
  },
  {
    id: 'planning',
    title: '排期',
    items: [
      {
        id: 'calendar',
        label: '日历',
        description: '月视图 / 周视图、任务计划日期与委托截止日期。',
        icon: CalendarDays,
        phase: 'P3',
        implemented: true
      },
      {
        id: 'time',
        label: '工时记录',
        description: '计时、暂停、手动补录，以及预计工时与实际工时的对比。',
        icon: Timer,
        phase: 'P4',
        implemented: false
      }
    ]
  },
  {
    id: 'system',
    title: '系统',
    items: [
      {
        id: 'settings',
        label: '设置',
        description: '主题，以及数据备份、恢复与导出。',
        icon: Settings,
        phase: 'P6',
        implemented: false
      }
    ]
  }
]

export const navItems: readonly NavItem[] = navGroups.flatMap((group) => group.items)

export const routeMap: Record<RouteId, NavItem> = Object.fromEntries(
  navItems.map((item) => [item.id, item])
) as Record<RouteId, NavItem>
