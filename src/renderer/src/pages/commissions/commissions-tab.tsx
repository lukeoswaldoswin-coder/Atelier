import { useCallback, useEffect, useMemo, useState, type UIEvent } from 'react'
import type { Commission } from '@shared/domain'
import { Plus } from 'lucide-react'
import { resolveSystemTimeZone, todayInZone } from '@shared/time'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useClients } from '@/data/clients'
import { useCommissions } from '@/data/commissions'
import { applyCommissionQuery, type QueryContext } from '@/lib/commission-query'
import { useCommissionsUiStore } from '@/stores/commissions-ui-store'
import { CommissionDetail } from './commission-detail'
import { CommissionSheet } from './commission-sheet'
import { CommissionsList } from './commission-list'

type EditorState = { mode: 'create' } | { mode: 'edit'; commission: Commission } | null

/**
 * 委托页签。
 *
 * - 点击行打开详情（P1.2.4），详情里再进入编辑；
 * - 详情内容由列表数据推导，编辑/付款/状态变更后刷新列表即可即时更新；
 * - 「显示已归档」控制是否包含归档委托；
 * - 客户下拉只包含未归档客户。
 */
export function CommissionsTab() {
  const includeArchived = useCommissionsUiStore((state) => state.includeArchived)
  const setIncludeArchived = useCommissionsUiStore((state) => state.setIncludeArchived)
  const selectedId = useCommissionsUiStore((state) => state.selectedId)
  const setSelectedId = useCommissionsUiStore((state) => state.setSelectedId)
  const query = useCommissionsUiStore((state) => state.query)
  const setListScrollTop = useCommissionsUiStore((state) => state.setListScrollTop)

  const commissions = useCommissions(includeArchived)
  const clients = useClients(true)

  const [editor, setEditor] = useState<EditorState>(null)

  const clientsById = useMemo(
    () => new Map(clients.rows.map((client) => [client.id, client])),
    [clients.rows]
  )

  const selectableClients = useMemo(
    () => clients.rows.filter((client) => client.archivedAt === null),
    [clients.rows]
  )

  const systemTimeZone = useMemo(() => resolveSystemTimeZone(), [])

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

  const selected = useMemo(
    () => commissions.rows.find((commission) => commission.id === selectedId) ?? null,
    [commissions.rows, selectedId]
  )

  // 选中的委托被归档隐藏（例如关闭「显示已归档」）时，关闭详情
  useEffect(() => {
    if (selectedId && commissions.status === 'ready' && selected === null) {
      setSelectedId(null)
    }
  }, [selectedId, selected, commissions.status, setSelectedId])

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

  const restoreScroll = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollTop = useCommissionsUiStore.getState().listScrollTop
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" data-testid="commissions-summary">
          {summary}
        </p>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="commissions-show-archived"
              checked={includeArchived}
              onCheckedChange={setIncludeArchived}
            />
            <Label htmlFor="commissions-show-archived" className="cursor-pointer">
              显示已归档
            </Label>
          </div>

          <Button size="sm" onClick={() => setEditor({ mode: 'create' })}>
            <Plus className="size-4" aria-hidden="true" />
            新建委托
          </Button>
        </div>
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
          onSelect={(commission) => setSelectedId(commission.id)}
        />
      </div>

      {selected && editor === null ? (
        <CommissionDetail
          commission={selected}
          clientName={clientsById.get(selected.clientId)?.name ?? '未知客户'}
          onClose={() => setSelectedId(null)}
          onEdit={() => setEditor({ mode: 'edit', commission: selected })}
          onChanged={() => commissions.reload()}
          onArchived={() => setSelectedId(null)}
        />
      ) : null}

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
