import type { Client, Commission, CommissionStatus } from '@shared/domain'
import { clientNameOf } from './format'

/**
 * 委托列表的过滤、搜索、排序逻辑。
 *
 * 纯函数：不读系统时钟、不访问组件状态。
 * 当前时间通过 QueryContext 显式传入，测试可用固定值重复验证逾期筛选。
 */

export type CommissionSort = 'created-desc' | 'deadline-asc' | 'priority-asc'
export type PaymentFilter = 'all' | 'unsettled' | 'paid' | 'unquoted' | 'free'

export interface CommissionQuery {
  /** 搜索：委托名或客户名，忽略大小写 */
  text: string
  status: CommissionStatus | 'all'
  payment: PaymentFilter
  clientId: string | 'all'
  overdueOnly: boolean
  includeArchived: boolean
  sort: CommissionSort
}

export interface QueryContext {
  /** 当前时刻（毫秒），用于时刻型逾期判断 */
  nowMs: number
  /** 当前本地日期 `YYYY-MM-DD`，用于日期型逾期判断 */
  todayISO: string
}

export const DEFAULT_COMMISSION_QUERY: CommissionQuery = {
  text: '',
  status: 'all',
  payment: 'all',
  clientId: 'all',
  overdueOnly: false,
  includeArchived: false,
  sort: 'created-desc'
}

/** 是否逾期：日期型按日历日期比较，时刻型按瞬间比较。 */
export function isCommissionOverdue(commission: Commission, context: QueryContext): boolean {
  const deadline = commission.deadline
  if (deadline.kind === 'date') return context.todayISO > deadline.date
  if (deadline.kind === 'datetime') return Date.parse(deadline.at) < context.nowMs
  return false
}

function matchesPayment(commission: Commission, filter: PaymentFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'unsettled':
      return commission.paymentStatus === 'unpaid' || commission.paymentStatus === 'partial'
    case 'paid':
      return commission.paymentStatus === 'paid'
    case 'unquoted':
      return commission.paymentStatus === 'unquoted'
    case 'free':
      return commission.paymentStatus === 'not_required'
  }
}

function deadlineSortValue(commission: Commission): number {
  const deadline = commission.deadline
  if (deadline.kind === 'date') return Date.parse(`${deadline.date}T00:00:00.000Z`)
  if (deadline.kind === 'datetime') return Date.parse(deadline.at)
  return Number.POSITIVE_INFINITY
}

function compareBySort(a: Commission, b: Commission, sort: CommissionSort): number {
  switch (sort) {
    case 'created-desc':
      return b.createdAt.localeCompare(a.createdAt)
    case 'deadline-asc': {
      const diff = deadlineSortValue(a) - deadlineSortValue(b)
      return diff !== 0 ? diff : b.createdAt.localeCompare(a.createdAt)
    }
    case 'priority-asc': {
      const diff = a.priority - b.priority
      return diff !== 0 ? diff : b.createdAt.localeCompare(a.createdAt)
    }
  }
}

/**
 * 应用搜索 / 过滤 / 排序。
 * 不修改入参数组，返回新数组。
 */
export function applyCommissionQuery(
  rows: readonly Commission[],
  clientsById: ReadonlyMap<string, Client>,
  query: CommissionQuery,
  context: QueryContext
): Commission[] {
  const keyword = query.text.trim().toLowerCase()

  const filtered = rows.filter((commission) => {
    if (!query.includeArchived && commission.archivedAt !== null) return false
    if (query.status !== 'all' && commission.status !== query.status) return false
    if (query.clientId !== 'all' && commission.clientId !== query.clientId) return false
    if (!matchesPayment(commission, query.payment)) return false
    if (query.overdueOnly && !isCommissionOverdue(commission, context)) return false
    if (keyword.length > 0) {
      const haystack = `${commission.title}\n${clientNameOf(commission, clientsById)}`.toLowerCase()
      if (!haystack.includes(keyword)) return false
    }
    return true
  })

  return filtered.slice().sort((a, b) => compareBySort(a, b, query.sort))
}
