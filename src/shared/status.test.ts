import { describe, expect, it } from 'vitest'
import {
  COMMISSION_STATUS_LABELS,
  allowedNextStatuses,
  canTransitionCommissionStatus
} from './status'

describe('委托状态机', () => {
  it('各状态的合理下一步', () => {
    expect(allowedNextStatuses('draft')).toEqual(['active', 'cancelled'])
    expect(allowedNextStatuses('active')).toEqual(['completed', 'cancelled'])
    expect(allowedNextStatuses('completed')).toEqual(['active'])
    expect(allowedNextStatuses('cancelled')).toEqual(['draft'])
  })

  it('允许的流转返回 true', () => {
    expect(canTransitionCommissionStatus('draft', 'active')).toBe(true)
    expect(canTransitionCommissionStatus('active', 'completed')).toBe(true)
    expect(canTransitionCommissionStatus('completed', 'active')).toBe(true)
    expect(canTransitionCommissionStatus('cancelled', 'draft')).toBe(true)
  })

  it('同状态视为允许（幂等更新）', () => {
    expect(canTransitionCommissionStatus('active', 'active')).toBe(true)
  })

  it('拒绝跳步与不合理回退', () => {
    expect(canTransitionCommissionStatus('draft', 'completed')).toBe(false)
    expect(canTransitionCommissionStatus('completed', 'cancelled')).toBe(false)
    expect(canTransitionCommissionStatus('cancelled', 'active')).toBe(false)
    expect(canTransitionCommissionStatus('cancelled', 'completed')).toBe(false)
  })

  it('状态都有中文标签', () => {
    expect(COMMISSION_STATUS_LABELS.draft).toBe('草稿')
    expect(COMMISSION_STATUS_LABELS.active).toBe('进行中')
    expect(COMMISSION_STATUS_LABELS.completed).toBe('已完成')
    expect(COMMISSION_STATUS_LABELS.cancelled).toBe('已取消')
  })
})
