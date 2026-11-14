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

/** 列表只读行：委托名为主要信息，客户名为次要信息。 */
export function CommissionRow({
  commission,
  clientsById,
  context
}: {
  commission: Commission
  clientsById: ReadonlyMap<string, Client>
  context: QueryContext
}) {
  const overdue = isCommissionOverdue(commission, context)
  const payment = paymentPresentation(commission)

  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_92px_128px_190px] items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
      data-testid="commission-row"
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{commission.title}</div>
        <div className="truncate text-xs text-muted-foreground">{clientNameOf(commission, clientsById)}</div>
      </div>

      <div>
        <Badge variant={STATUS_VARIANT[commission.status]}>{statusLabel(commission.status)}</Badge>
      </div>

      <div
        className={cn(
          'flex min-w-0 items-center gap-1.5 text-xs',
          overdue ? 'text-warning' : 'text-muted-foreground'
        )}
      >
        <span className="truncate">{formatDeadline(commission.deadline)}</span>
        {overdue ? (
          <span className="shrink-0 rounded bg-warning/15 px-1 py-0.5 text-[10px] leading-none">逾期</span>
        ) : null}
      </div>

      <div className="min-w-0">
        <div className={cn('text-xs font-medium', TONE_CLASS[payment.tone])}>{payment.label}</div>
        <div className="truncate text-[11px] text-muted-foreground">{payment.detail}</div>
      </div>
    </div>
  )
}
