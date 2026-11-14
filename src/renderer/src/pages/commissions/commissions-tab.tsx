import { useCallback, useMemo, useState, type UIEvent } from 'react'
import type { Commission } from '@shared/domain'
import { Plus } from 'lucide-react'
import { resolveSystemTimeZone, todayInZone } from '@shared/time'
import { Button } from '@/components/ui/button'
import { useClients } from '@/data/clients'
import { useCommissions } from '@/data/commissions'
import { applyCommissionQuery, type QueryContext } from '@/lib/commission-query'
import { useCommissionsUiStore } from '@/stores/commissions-ui-store'
import { CommissionSheet } from './commission-sheet'
import { CommissionsList } from './commission-list'

type EditorState = { mode: 'create' } | { mode: 'edit'; commission: Commission } | null

/**
 * 委托页签。
 *
 * 数据全部来自真实 IPC：
 * - commissions:list 读取委托；
 * - clients:list（包含已归档客户）用于解析客户名称，避免历史委托显示空白。
 *
 * 新建/编辑使用右侧 420px 面板；客户下拉只包含未归档客户。
 */
export function CommissionsTab() {
  const includeArchived = useCommissionsUiStore((state) => state.includeArchived)
  const query = useCommissionsUiStore((state) => state.query)
  const setListScrollTop = useCommissionsUiStore((state) => state.setListScrollTop)

  const commissions = useCommissions(includeArchived)
  const clients = useClients(true)

  const [editor, setEditor] = useState<EditorState>(null)

  const clientsById = useMemo(
    () => new Map(clients.rows.map((client) => [client.id, client])),
    [clients.rows]
  )

  // 新建委托时只能选择未归档客户
  const selectableClients = useMemo(
    () => clients.rows.filter((client) => client.archivedAt === null),
    [clients.rows]
  )

  const systemTimeZone = useMemo(() => resolveSystemTimeZone(), [])

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

  // 从别的页面/页签切回来时恢复滚动位置
  const restoreScroll = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollTop = useCommissionsUiStore.getState().listScrollTop
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" data-testid="commissions-summary">
          {summary}
        </p>

        <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
          <Plus className="size-4" aria-hidden="true" />
          新建委托
        </Button>
      </div>

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
          onSelect={(commission) => setEditor({ mode: 'edit', commission })}
        />
      </div>

      {editor ? (
        <CommissionSheet
          mode={editor.mode}
          commission={editor.mode === 'edit' ? editor.commission : null}
          clients={selectableClients}
          timeZone={systemTimeZone}
          onClose={() => setEditor(null)}
          onSaved={() => commissions.reload()}
        />
      ) : null}
    </div>
  )
}
