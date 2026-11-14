import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import type { Commission } from '@shared/domain'
import { Plus } from 'lucide-react'
import { resolveSystemTimeZone, todayInZone } from '@shared/time'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useClients } from '@/data/clients'
import { useCommissions } from '@/data/commissions'
import { buildClientFilterOptions } from '@/lib/commission-filter-options'
import {
  DEFAULT_COMMISSION_QUERY,
  applyCommissionQuery,
  hasActiveCommissionFilters,
  isCommissionQueryModified,
  type QueryContext
} from '@/lib/commission-query'
import { useCommissionKeyboard } from '@/lib/use-commission-keyboard'
import { useCommissionsUiStore } from '@/stores/commissions-ui-store'
import { CommissionDetail } from './commission-detail'
import { CommissionFilters } from './commission-filters'
import { CommissionSheet } from './commission-sheet'
import { CommissionsList } from './commission-list'

type EditorState = { mode: 'create' } | { mode: 'edit'; commission: Commission } | null

/**
 * 委托页签。
 *
 * - 点击行打开详情，详情里再进入编辑；
 * - 顶部工具栏提供搜索、状态/付款/客户筛选、排序与「仅逾期」；
 * - 客户筛选选项来自当前归档范围内被引用的客户（含已归档，带标注），
 *   与「新建委托下拉只列未归档客户」是两套独立规则；
 * - 计数口径：N = 归档范围内总数，M = 应用筛选后的数量。
 */
export function CommissionsTab() {
  const includeArchived = useCommissionsUiStore((state) => state.includeArchived)
  const setIncludeArchived = useCommissionsUiStore((state) => state.setIncludeArchived)
  const selectedId = useCommissionsUiStore((state) => state.selectedId)
  const setSelectedId = useCommissionsUiStore((state) => state.setSelectedId)
  const activeId = useCommissionsUiStore((state) => state.activeId)
  const setActiveId = useCommissionsUiStore((state) => state.setActiveId)
  const query = useCommissionsUiStore((state) => state.query)
  const setQuery = useCommissionsUiStore((state) => state.setQuery)
  const setListScrollTop = useCommissionsUiStore((state) => state.setListScrollTop)

  const commissions = useCommissions(includeArchived)
  const clients = useClients(true)

  const [editor, setEditor] = useState<EditorState>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const clientsById = useMemo(
    () => new Map(clients.rows.map((client) => [client.id, client])),
    [clients.rows]
  )

  // 新建委托时只能选择未归档客户（与筛选器规则独立）
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

  // 归档范围已经由 useCommissions(includeArchived) 处理，这里不再二次过滤
  const rows = useMemo(
    () =>
      applyCommissionQuery(
        commissions.rows,
        clientsById,
        { ...query, includeArchived: true },
        context
      ),
    [commissions.rows, clientsById, query, context]
  )

  // 客户筛选选项：归档范围内被引用到的客户，已归档的保留并标注
  const clientOptions = useMemo(
    () => buildClientFilterOptions(commissions.rows, clientsById),
    [commissions.rows, clientsById]
  )

  const selected = useMemo(
    () => commissions.rows.find((commission) => commission.id === selectedId) ?? null,
    [commissions.rows, selectedId]
  )

  // 已选客户在当前范围内已无委托时，才复位为「全部」
  useEffect(() => {
    if (commissions.status !== 'ready') return
    if (query.clientId === 'all') return
    if (!clientOptions.some((option) => option.id === query.clientId)) {
      setQuery({ clientId: 'all' })
    }
  }, [commissions.status, clientOptions, query.clientId, setQuery])

  // 筛选导致高亮行不可见时清除高亮
  useEffect(() => {
    if (commissions.status !== 'ready') return
    if (activeId && !rows.some((row) => row.id === activeId)) {
      setActiveId(null)
    }
  }, [activeId, rows, commissions.status, setActiveId])

  // 筛选导致当前详情不可见时，关闭详情
  useEffect(() => {
    if (commissions.status !== 'ready') return
    if (selectedId && !rows.some((row) => row.id === selectedId)) {
      setSelectedId(null)
    }
  }, [selectedId, rows, commissions.status, setSelectedId])

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

  const clearFilters = useCallback(() => {
    setQuery({ ...DEFAULT_COMMISSION_QUERY })
  }, [setQuery])

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus()
  }, [])

  const openDetail = useCallback(
    (id: string) => {
      setActiveId(id)
      setSelectedId(id)
    },
    [setActiveId, setSelectedId]
  )

  const panelsOpen = selected !== null || editor !== null

  const { handleListKeyDown } = useCommissionKeyboard({
    enabled: !panelsOpen,
    rows,
    activeId,
    onActivate: setActiveId,
    onOpen: openDetail,
    onFocusSearch: focusSearch
  })

  const scopeTotal = commissions.rows.length
  const filteredCount = rows.length
  const activeFilters = hasActiveCommissionFilters(query)
  const unsettledCount = rows.filter(
    (commission) => commission.paymentStatus === 'unpaid' || commission.paymentStatus === 'partial'
  ).length

  const unsettledText = unsettledCount > 0 ? ` · ${unsettledCount} 个未结清` : ''
  const summary =
    status === 'loading'
      ? '正在读取委托…'
      : status === 'error'
        ? '读取失败'
        : activeFilters
          ? `筛选后 ${filteredCount} / 共 ${scopeTotal}${unsettledText}`
          : `共 ${scopeTotal} 个委托${unsettledText}`

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
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {status === 'error' ? null : (
        <CommissionFilters
          query={query}
          clientOptions={clientOptions}
          searchInputRef={searchInputRef}
          modified={isCommissionQueryModified(query)}
          onChange={setQuery}
          onClear={clearFilters}
        />
      )}

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
          scopeTotal={scopeTotal}
          clientsById={clientsById}
          context={context}
          activeId={activeId}
          onRetry={reload}
          onSelect={(commission) => openDetail(commission.id)}
          onClearFilters={clearFilters}
          onKeyDown={handleListKeyDown}
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
