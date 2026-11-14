import { create } from 'zustand'
import type { RouteId } from '@/config/navigation'

export interface NavigationState {
  active: RouteId
  setActive: (route: RouteId) => void
}

/**
 * 当前页面。P0 只有概览页与占位页，因此先用状态切换；
 * 等页面数量增加、需要历史记录时再引入路由库。
 */
export const useNavigationStore = create<NavigationState>((set) => ({
  active: 'dashboard',
  setActive: (active) => set({ active })
}))
