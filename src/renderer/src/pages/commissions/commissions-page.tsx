import { useCallback, useMemo, type UIEvent } from 'react'
import { resolveSystemTimeZone, todayInZone } from '@shared/time'
import { useClients } from '@/data/clients'
import { useCommissions } from '@/data/commissions'
import { applyCommissionQuery, type QueryContext } from '@/lib/commission-query'
import { useCommissionsUiStore } from '@/stores/commissions-ui-store'
import { CommissionsList } from './commission-list'

/**
 * 委托管理页（P1.2.1：只读列表与空状态）。
 *
 * 数据全部来自真实 IPC：
 * - commissions:list 读取委托；
 * - clients:list（包含已归档客户）用于解析客户名称，避免历史委托显示空白。
 */
export function CommissionsPage() {
  const includeArchived = useCommissionsUiStore((state) => state.includeArchived)
  const query = useCommissionsUiStore((state) => state.query)
  const setListScrollTop = useCommissionsUiStore((state) => state.setListScrollTop)

  const commissions = useCommissions(includeArchived)
  const clients = useClients(true)

  const clientsById = useMemo(
    () => new Map(clients.rows.map((client) => [client.id, client])),
    [clients.rows]
  )

  // 当前时间只在数据变化时取一次，传给纯函数；渲染过程中不产生新的时间依赖
  const context = useMemo<QueryContext>(
    () => ({
      nowMs: Date.now(),
      todayISO: todayInZone(resolveSystemTimeZone())
    }),
    [commissions.rows]
  )

  const rows = useMemo(
    () => applyCommissionQuery(commissions.rows, clientsById, query, context),
    [commissions.rows, clientsById, query, context]
  )

  const status =
    commissions.status === 'error' || clients.status === 'error'
      ? 'error'
      : commissions.status === 'loading' || clients.status === 'loading'
        ? 'loading'
        : 'ready'

  const error = commissions.error ?? clients.error

  const reload = useCallback(() => {
    commissions.reload()
    clients.reload()
  }, [commissions, clients])

  const unsettledCount = rows.filter(
    (commission) => commission.paymentStatus === 'unpaid' || commission.paymentStatus === 'partial'
  ).length

  const summary =
    status === 'loading'
      ? '正在读取委托…'
      : status === 'error'
        ? '读取失败'
        : `共 ${rows.length} 个委托${unsettledCount > 0 ? ` · ${unsettledCount} 个未结清` : ''}`

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      setListScrollTop(event.currentTarget.scrollTop)
    },
    [setListScrollTop]
  )

  // 从别的页面切回来时恢复滚动位置
  const restoreScroll = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollTop = useCommissionsUiStore.getState().listScrollTop
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <p className="shrink-0 text-xs text-muted-foreground" data-testid="commissions-summary">
        {summary}
      </p>

      <div
        ref={restoreScroll}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="commission-scroll"
      >
        <CommissionsList
          status={status}
          error={error}
          rows={rows}
          totalCount={commissions.rows.length}
          clientsById={clientsById}
          context={context}
          onRetry={reload}
        />
      </div>
    </div>
  )
}
