import { describe, expect, it } from 'vitest'
import { DataError } from './errors'
import {
  assertAmountConsistency,
  derivePaymentStatus,
  isSettledStatus,
  outstandingCentsOf
} from './payment'

function codeOf(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof DataError) return error.code
    throw error
  }
  throw new Error('预期抛错但没有抛出')
}

describe('付款状态推导', () => {
  it('覆盖五种状态', () => {
    expect(derivePaymentStatus(null, 0)).toBe('unquoted')
    expect(derivePaymentStatus(0, 0)).toBe('not_required')
    expect(derivePaymentStatus(12800, 0)).toBe('unpaid')
    expect(derivePaymentStatus(12800, 5000)).toBe('partial')
    expect(derivePaymentStatus(12800, 12800)).toBe('paid')
  })

  it('未收金额与结清标记', () => {
    expect(outstandingCentsOf(null, 0)).toBeNull()
    expect(outstandingCentsOf(0, 0)).toBe(0)
    expect(outstandingCentsOf(12800, 5000)).toBe(7800)
    expect(outstandingCentsOf(12800, 12800)).toBe(0)

    expect(isSettledStatus('paid')).toBe(true)
    expect(isSettledStatus('not_required')).toBe(true)
    expect(isSettledStatus('unpaid')).toBe(false)
    expect(isSettledStatus('partial')).toBe(false)
    expect(isSettledStatus('unquoted')).toBe(false)
  })
})

describe('金额组合校验', () => {
  it('未报价只能没有收款', () => {
    expect(() => assertAmountConsistency(null, 0)).not.toThrow()
    expect(codeOf(() => assertAmountConsistency(null, 100))).toBe('PAYMENT_REQUIRES_QUOTE')
  })

  it('免费委托不能登记收款', () => {
    expect(() => assertAmountConsistency(0, 0)).not.toThrow()
    expect(codeOf(() => assertAmountConsistency(0, 100))).toBe('PAYMENT_REQUIRES_QUOTE')
  })

  it('正常报价允许 0 到报价之间的收款', () => {
    expect(() => assertAmountConsistency(12800, 0)).not.toThrow()
    expect(() => assertAmountConsistency(12800, 5000)).not.toThrow()
    expect(() => assertAmountConsistency(12800, 12800)).not.toThrow()
  })

  it('超额收款被拒绝，错误码区分场景', () => {
    expect(codeOf(() => assertAmountConsistency(12800, 12801))).toBe('OVERPAY')
    expect(codeOf(() => assertAmountConsistency(12800, 20000))).toBe('OVERPAY')
    expect(codeOf(() => assertAmountConsistency(12800, 20000, { quoteChanged: true }))).toBe(
      'QUOTE_BELOW_PAID'
    )
  })

  it('负数或非整数金额被拒绝', () => {
    expect(codeOf(() => assertAmountConsistency(12800, -1))).toBe('INVALID_AMOUNT')
    expect(codeOf(() => assertAmountConsistency(12.5, 0))).toBe('INVALID_AMOUNT')
  })

  it('错误信息可读（会回传给界面）', () => {
    expect(() => assertAmountConsistency(12800, 20000)).toThrowError(/不能超过报价/)
    expect(() => assertAmountConsistency(null, 100)).toThrowError(/未报价/)
  })
})
