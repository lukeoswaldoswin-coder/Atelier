import type { Client, Commission, CommissionStatus } from '@shared/domain'
import { Badge } from '@/components/ui/badge'
import { isCommissionOverdue, type QueryContext } from '@/lib/commission-query'
import {
  clientNameOf,
  formatDeadline,
  paymentPresentation,
  statusLabel,
  type PaymentTone
} from '@/lib/format'
import { cn } from '@/lib/utils'

const STATUS_VARIANT: Record<CommissionStatus, 'muted' | 'default' | 'success' | 'outline'> = {
  draft: 'muted',
  active: 'default',
  completed: 'success',
  cancelled: 'outline'
}

const TONE_CLASS: Record<PaymentTone, string> = {
  muted: 'text-muted-foreground',
  warning: 'text-warning',
  primary: 'text-primary',
  success: 'text-success'
}

/** 列表行：委托名为主要信息，客户名为次要信息。点击进入编辑面板。 */
export function CommissionRow({
  commission,
  clientsById,
  context,
  onSelect
}: {
  commission: Commission
  clientsById: ReadonlyMap<string, Client>
  context: QueryContext
  onSelect: (commission: Commission) => void
}) {
  const overdue = isCommissionOverdue(commission, context)
  const payment = paymentPresentation(commission)

  return (
    <button
      type="button"
      onClick={() => onSelect(commission)}
      className="grid w-full grid-cols-[minmax(0,1fr)_92px_128px_190px] items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
      data-testid="commission-row"
    >
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{commission.title}</span>
          {commission.archivedAt !== null ? <Badge variant="outline">已归档</Badge> : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {clientNameOf(commission, clientsById)}
        </span>
      </span>

      <span>
        <Badge variant={STATUS_VARIANT[commission.status]}>{statusLabel(commission.status)}</Badge>
      </span>

      <span
        className={cn(
          'flex min-w-0 items-center gap-1.5 text-xs',
          overdue ? 'text-warning' : 'text-muted-foreground'
        )}
      >
        <span className="truncate">{formatDeadline(commission.deadline)}</span>
        {overdue ? (
          <span className="shrink-0 rounded bg-warning/15 px-1 py-0.5 text-[10px] leading-none">逾期</span>
        ) : null}
      </span>

      <span className="min-w-0">
        <span className={cn('block text-xs font-medium', TONE_CLASS[payment.tone])}>
          {payment.label}
        </span>
        <span className="block truncate text-[11px] text-muted-foreground">{payment.detail}</span>
      </span>
    </button>
  )
}
