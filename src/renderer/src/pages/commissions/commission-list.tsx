import { useEffect, useRef, type KeyboardEvent } from 'react'
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
  /** 归档范围内的委托总数（应用其它筛选之前） */
  scopeTotal: number
  clientsById: ReadonlyMap<string, Client>
  context: QueryContext
  activeId: string | null
  onRetry: () => void
  onSelect: (commission: Commission) => void
  onClearFilters: () => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
}

export function CommissionsList({
  status,
  error,
  rows,
  scopeTotal,
  clientsById,
  context,
  activeId,
  onRetry,
  onSelect,
  onClearFilters,
  onKeyDown
}: CommissionsListProps) {
  const listRef = useRef<HTMLDivElement>(null)

  // 键盘移动选中项时，把它滚动到可视区域
  useEffect(() => {
    const node = listRef.current?.querySelector('[data-selected="true"]')
    if (node instanceof HTMLElement) {
      try {
        node.scrollIntoView({ block: 'nearest' })
      } catch {
        // jsdom 等环境未实现 scrollIntoView，忽略即可
      }
    }
  }, [activeId, rows])

  if (status === 'loading') return <CommissionSkeletonList />
  if (status === 'error') return <CommissionErrorState message={error ?? '未知错误'} onRetry={onRetry} />
  if (scopeTotal === 0) return <CommissionEmptyState />
  if (rows.length === 0) return <CommissionNoResultsState onClearFilters={onClearFilters} />

  return (
    <div
      ref={listRef}
      data-testid="commission-list"
      role="group"
      aria-label="委托列表"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
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
            selected={commission.id === activeId}
          />
        ))}
      </div>
    </div>
  )
}
