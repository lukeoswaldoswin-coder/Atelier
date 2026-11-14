import type { Client, Commission } from '@shared/domain'
import type { LoadStatus } from '@/data/load-state'
import type { QueryContext } from '@/lib/commission-query'
import {
  CommissionEmptyState,
  CommissionErrorState,
  CommissionNoResultsState,
  CommissionSkeletonList
} from './commission-empty'
import { CommissionRow } from './commission-row'

const GRID = 'grid grid-cols-[minmax(0,1fr)_92px_128px_190px] items-center gap-3'

interface CommissionsListProps {
  status: LoadStatus
  error: string | null
  rows: readonly Commission[]
  /** 数据库中的委托总数（用于区分“完全没有数据”和“筛选后为空”） */
  totalCount: number
  clientsById: ReadonlyMap<string, Client>
  context: QueryContext
  onRetry: () => void
  onSelect: (commission: Commission) => void
}

export function CommissionsList({
  status,
  error,
  rows,
  totalCount,
  clientsById,
  context,
  onRetry,
  onSelect
}: CommissionsListProps) {
  if (status === 'loading') return <CommissionSkeletonList />
  if (status === 'error') return <CommissionErrorState message={error ?? '未知错误'} onRetry={onRetry} />
  if (totalCount === 0) return <CommissionEmptyState />
  if (rows.length === 0) return <CommissionNoResultsState />

  return (
    <div data-testid="commission-list">
      <div
        className={`${GRID} border-b border-border/70 px-4 py-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase`}
      >
        <span>委托</span>
        <span>状态</span>
        <span>截止</span>
        <span>付款</span>
      </div>
      <div className="divide-y divide-border/50">
        {rows.map((commission) => (
          <CommissionRow
            key={commission.id}
            commission={commission}
            clientsById={clientsById}
            context={context}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}
