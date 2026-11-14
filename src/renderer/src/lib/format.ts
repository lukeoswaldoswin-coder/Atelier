import type { Client, Commission, Deadline, PaymentStatus } from '@shared/domain'
import { COMMISSION_STATUS_LABELS } from '@shared/status'
import type { CommissionStatus } from '@shared/domain'
import { formatDateTimeInZone } from '@shared/time'

/**
 * 界面展示用的格式化函数（纯函数，不读系统时钟、不读组件状态）。
 *
 * 约定：
 * - 金额统一人民币格式 ¥1,200.00（手写实现，输出确定，便于测试精确断言）；
 * - 日期型截止是纯日历日期，函数不接收时区参数，从结构上杜绝时区换算；
 * - 时刻型截止按“创建时区”显示，与查看者所在时区无关。
 */

/** 整数分 → `¥1,200.00`。 */
export function formatYuanFromCents(cents: number): string {
  const rounded = Math.round(cents)
  const negative = rounded < 0
  const absolute = Math.abs(rounded)
  const yuan = Math.floor(absolute / 100)
  const fen = absolute % 100
  const grouped = String(yuan).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}¥${grouped}.${String(fen).padStart(2, '0')}`
}

/**
 * 日期型截止：原样返回 `YYYY-MM-DD`。
 * 故意不接收时区参数——日历日期一旦换算就会漂移。
 */
export function formatDeadlineDate(date: string): string {
  return date
}

/** 时刻型截止：按创建时区显示为 `2026-12-31 18:00`。 */
export function formatDeadlineDateTime(at: string, authorTimeZone: string): string {
  return formatDateTimeInZone(at, authorTimeZone)
}

/** 时刻型截止的紧凑形式：`12-31 18:00`（列表用）。 */
export function formatDeadlineDateTimeCompact(at: string, authorTimeZone: string): string {
  return formatDeadlineDateTime(at, authorTimeZone).slice(5)
}

export function formatDeadline(deadline: Deadline): string {
  if (deadline.kind === 'date') return formatDeadlineDate(deadline.date)
  if (deadline.kind === 'datetime') return formatDeadlineDateTimeCompact(deadline.at, deadline.timeZone)
  return '—'
}

export { COMMISSION_STATUS_LABELS }

export function statusLabel(status: CommissionStatus): string {
  return COMMISSION_STATUS_LABELS[status]
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unquoted: '未报价',
  not_required: '免费',
  unpaid: '未付款',
  partial: '部分付款',
  paid: '已付清'
}

/** 付款区块的颜色语义，只做辅助，文字标签才是主要区分手段。 */
export type PaymentTone = 'muted' | 'warning' | 'primary' | 'success'

export interface PaymentPresentation {
  label: string
  detail: string
  tone: PaymentTone
}

/** 五种付款状态的展示规则。 */
export function paymentPresentation(commission: Commission): PaymentPresentation {
  const paid = formatYuanFromCents(commission.paidAmountCents)
  const outstanding =
    commission.outstandingCents === null ? null : formatYuanFromCents(commission.outstandingCents)

  switch (commission.paymentStatus) {
    case 'unquoted':
      return { label: PAYMENT_STATUS_LABELS.unquoted, detail: '—', tone: 'muted' }
    case 'not_required':
      return { label: PAYMENT_STATUS_LABELS.not_required, detail: paid, tone: 'muted' }
    case 'unpaid':
      return {
        label: PAYMENT_STATUS_LABELS.unpaid,
        detail: outstanding ? `未收 ${outstanding}` : '—',
        tone: 'warning'
      }
    case 'partial':
      return {
        label: PAYMENT_STATUS_LABELS.partial,
        detail: outstanding ? `已收 ${paid} · 未收 ${outstanding}` : `已收 ${paid}`,
        tone: 'primary'
      }
    case 'paid':
      return { label: PAYMENT_STATUS_LABELS.paid, detail: paid, tone: 'success' }
  }
}

/**
 * 委托所属客户名。
 * 传入的映射表必须包含已归档客户，否则历史委托会显示空白。
 */
export function clientNameOf(commission: Commission, clientsById: ReadonlyMap<string, Client>): string {
  return clientsById.get(commission.clientId)?.name ?? '未知客户'
}
