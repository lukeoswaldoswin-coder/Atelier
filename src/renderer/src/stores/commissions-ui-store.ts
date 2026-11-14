import { create } from 'zustand'
import { DEFAULT_COMMISSION_QUERY, type CommissionQuery } from '@/lib/commission-query'

export type CommissionsTab = 'commissions' | 'clients'

interface CommissionsUiState {
  /** 委托 / 客户 页签 */
  tab: CommissionsTab
  /** 当前选中的委托（详情面板，P1.2.4 接入） */
  selectedId: string | null
  /** 查询条件：搜索、筛选、排序（界面在 P1.2.5 接入） */
  query: CommissionQuery
  /** 委托页签是否显示已归档（P1.2.4 接入） */
  includeArchived: boolean
  /** 客户页签是否显示已归档 */
  clientsIncludeArchived: boolean
  /** 委托列表滚动位置，切走再回来时恢复 */
  listScrollTop: number
  /** 客户列表滚动位置 */
  clientsScrollTop: number
  setTab: (tab: CommissionsTab) => void
  setSelectedId: (id: string | null) => void
  setQuery: (patch: Partial<CommissionQuery>) => void
  setIncludeArchived: (value: boolean) => void
  setClientsIncludeArchived: (value: boolean) => void
  setListScrollTop: (value: number) => void
  setClientsScrollTop: (value: number) => void
}

/**
 * 委托管理页的界面状态。
 * 放在 store 而不是组件里，保证切到别的页面再回来时选中项、筛选和滚动位置不丢。
 * 两个页签的「显示已归档」互相独立。
 */
export const useCommissionsUiStore = create<CommissionsUiState>((set) => ({
  tab: 'commissions',
  selectedId: null,
  query: DEFAULT_COMMISSION_QUERY,
  includeArchived: false,
  clientsIncludeArchived: false,
  listScrollTop: 0,
  clientsScrollTop: 0,
  setTab: (tab) => set({ tab }),
  setSelectedId: (selectedId) => set({ selectedId }),
  setQuery: (patch) => set((state) => ({ query: { ...state.query, ...patch } })),
  setIncludeArchived: (includeArchived) => set({ includeArchived }),
  setClientsIncludeArchived: (clientsIncludeArchived) => set({ clientsIncludeArchived }),
  setListScrollTop: (listScrollTop) => set({ listScrollTop }),
  setClientsScrollTop: (clientsScrollTop) => set({ clientsScrollTop })
}))
