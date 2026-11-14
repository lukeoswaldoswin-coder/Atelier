import { DataError } from './errors'
import type { PaymentStatus } from './domain'

/**
 * 付款状态与金额的一致性规则（P1.1.5）。
 *
 * 核心原则：**金额是事实，付款状态是推导结果**。
 * 渲染进程不能提交 payment_status，只能提交金额；状态由本文件推导。
 */

/** 视为「未结清」的状态（用于列表标记）。 */
export const UNSETTLED_PAYMENT_STATUSES: readonly PaymentStatus[] = ['unpaid', 'partial']

/**
 * 校验金额组合是否合法，不合法时抛出带错误码的 DataError。
 *
 * 语义：
 * - quote = null：未报价，paid 必须为 0；
 * - quote = 0：明确免费，paid 必须为 0；
 * - quote > 0：0 ≤ paid ≤ quote。
 */
export function assertAmountConsistency(
  quoteCents: number | null,
  paidCents: number,
  options: { quoteChanged?: boolean } = {}
): void {
  if (!Number.isInteger(paidCents) || paidCents < 0) {
    throw new DataError('INVALID_AMOUNT', '已收金额必须是非负的整数分')
  }
  if (quoteCents !== null && (!Number.isInteger(quoteCents) || quoteCents < 0)) {
    throw new DataError('INVALID_AMOUNT', '报价金额必须是非负的整数分')
  }

  if (quoteCents === null) {
    if (paidCents !== 0) {
      throw new DataError('PAYMENT_REQUIRES_QUOTE', '未报价的委托不能登记收款，请先填写报价')
    }
    return
  }

  if (quoteCents === 0) {
    if (paidCents !== 0) {
      throw new DataError('PAYMENT_REQUIRES_QUOTE', '免费委托不能登记收款')
    }
    return
  }

  if (paidCents > quoteCents) {
    throw new DataError(
      options.quoteChanged ? 'QUOTE_BELOW_PAID' : 'OVERPAY',
      options.quoteChanged ? '报价金额不能低于已收金额' : '已收金额不能超过报价金额'
    )
  }
}

/** 由金额推导付款状态。调用前应先通过 assertAmountConsistency。 */
export function derivePaymentStatus(quoteCents: number | null, paidCents: number): PaymentStatus {
  if (quoteCents === null) return 'unquoted'
  if (quoteCents === 0) return 'not_required'
  if (paidCents === 0) return 'unpaid'
  if (paidCents < quoteCents) return 'partial'
  return 'paid'
}

/** 未收金额：未报价为 null（尚无金额），免费或已付清为 0，其余为欠款。 */
export function outstandingCentsOf(quoteCents: number | null, paidCents: number): number | null {
  if (quoteCents === null) return null
  return Math.max(quoteCents - paidCents, 0)
}

/** 是否已结清（免费委托视为无需结清）。 */
export function isSettledStatus(status: PaymentStatus): boolean {
  return status === 'paid' || status === 'not_required'
}
