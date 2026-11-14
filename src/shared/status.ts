import type { CommissionStatus } from './domain'

export const COMMISSION_STATUS_LABELS: Record<CommissionStatus, string> = {
  draft: '草稿',
  active: '进行中',
  completed: '已完成',
  cancelled: '已取消'
}

/**
 * 合理的委托状态流转。
 * 归档是独立动作，不改变状态。
 */
export const COMMISSION_STATUS_TRANSITIONS: Record<CommissionStatus, readonly CommissionStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: ['active'],
  cancelled: ['draft']
}

export function allowedNextStatuses(status: CommissionStatus): readonly CommissionStatus[] {
  return COMMISSION_STATUS_TRANSITIONS[status]
}

export function canTransitionCommissionStatus(
  from: CommissionStatus,
  to: CommissionStatus
): boolean {
  return from === to || COMMISSION_STATUS_TRANSITIONS[from].includes(to)
}
