import { create } from 'zustand'
import type { RouteId } from '@/config/navigation'

/**
 * 工时记录页的一次性筛选意图。
 * 由日历等页面写入，工时页消费后立刻清空，避免下次进入时重复触发。
 */
export interface TimeFilterIntent {
  /** YYYY-MM-DD */
  from: string
  /** YYYY-MM-DD */
  to: string
  /** 只看该任务的工时；null / 省略表示不按任务收窄 */
  taskId?: string | null
}

export interface NavigationState {
  active: RouteId
  /** 日历页选中的日期（YYYY-MM-DD）；切到别的页面再回来时保留 */
  calendarDate: string | null
  /** 一次性意图：绘画任务页打开后定位并高亮该任务，消费后清空 */
  focusTaskId: string | null
  /** 一次性意图：工时记录页打开后应用该日期区间筛选，消费后清空 */
  timeFilter: TimeFilterIntent | null
  setActive: (route: RouteId) => void
  setCalendarDate: (date: string | null) => void
  /** 请求绘画任务页定位到某个任务（需调用方同时 setActive('tasks')） */
  focusTask: (taskId: string) => void
  clearFocusTask: () => void
  /** 请求工时记录页按日期区间（可再按任务）筛选（需调用方同时 setActive('time')） */
  openTimeEntries: (filter: TimeFilterIntent) => void
  clearTimeFilter: () => void
}

/**
 * 当前页面。P0 只有概览页与占位页，因此先用状态切换；
 * 等页面数量增加、需要历史记录时再引入路由库。
 *
 * P6.7 增加三个跨模块跳转字段：它们都是「一次性意图」，
 * 由发起方写入、目标页面消费后清空，不作为长期状态。
 */
export const useNavigationStore = create<NavigationState>((set) => ({
  active: 'dashboard',
  calendarDate: null,
  focusTaskId: null,
  timeFilter: null,
  setActive: (active) => set({ active }),
  setCalendarDate: (calendarDate) => set({ calendarDate }),
  focusTask: (focusTaskId) => set({ focusTaskId }),
  clearFocusTask: () => set({ focusTaskId: null }),
  openTimeEntries: (timeFilter) => set({ timeFilter }),
  clearTimeFilter: () => set({ timeFilter: null })
}))
