import { useCallback, useMemo, useState, type UIEvent } from 'react'
import type { Client } from '@shared/domain'
import { Plus, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { useClients } from '@/data/clients'
import { useCommissionsUiStore } from '@/stores/commissions-ui-store'
import { ClientSheet } from './client-sheet'

type SheetState = { mode: 'create' } | { mode: 'edit'; client: Client } | null

function ClientsSkeleton() {
  return (
    <div data-testid="clients-loading" aria-busy="true" aria-label="正在加载客户">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="border-b border-border/50 px-4 py-3">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="mt-1.5 h-2.5 w-24" />
        </div>
      ))}
    </div>
  )
}

/** 客户页签：列表、新建、编辑、归档 / 取消归档。 */
export function ClientsTab() {
  const clients = useClients(true)
  const includeArchived = useCommissionsUiStore((state) => state.clientsIncludeArchived)
  const setIncludeArchived = useCommissionsUiStore((state) => state.setClientsIncludeArchived)
  const setClientsScrollTop = useCommissionsUiStore((state) => state.setClientsScrollTop)

  const [sheet, setSheet] = useState<SheetState>(null)

  const visible = useMemo(
    () => clients.rows.filter((client) => includeArchived || client.archivedAt === null),
    [clients.rows, includeArchived]
  )
  const archivedCount = useMemo(
    () => clients.rows.filter((client) => client.archivedAt !== null).length,
    [clients.rows]
  )

  const summary =
    clients.status === 'loading'
      ? '正在读取客户…'
      : clients.status === 'error'
        ? '读取失败'
        : `共 ${visible.length} 个客户${
            includeArchived && archivedCount > 0 ? ` · 含 ${archivedCount} 个已归档` : ''
          }`

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      setClientsScrollTop(event.currentTarget.scrollTop)
    },
    [setClientsScrollTop]
  )

  const restoreScroll = useCallback((node: HTMLDivElement | null) => {
    if (node) node.scrollTop = useCommissionsUiStore.getState().clientsScrollTop
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" data-testid="clients-summary">
          {summary}
        </p>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="clients-show-archived"
              checked={includeArchived}
              onCheckedChange={setIncludeArchived}
            />
            <Label htmlFor="clients-show-archived" className="cursor-pointer">
              显示已归档
            </Label>
          </div>

          <Button size="sm" onClick={() => setSheet({ mode: 'create' })}>
            <Plus className="size-4" aria-hidden="true" />
            新建客户
          </Button>
        </div>
      </div>

      <div
        ref={restoreScroll}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="client-scroll"
      >
        {clients.status === 'loading' ? (
          <ClientsSkeleton />
        ) : clients.status === 'error' ? (
          <div
            role="alert"
            className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-12 text-center"
          >
            <p className="text-sm font-medium">无法读取客户列表</p>
            <p className="max-w-md break-words text-xs text-muted-foreground">
              {clients.error ?? '未知错误'}
            </p>
            <Button variant="outline" size="sm" onClick={() => clients.reload()}>
              重试
            </Button>
          </div>
        ) : clients.rows.length === 0 ? (
          <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-border/70 px-6 py-16 text-center">
            <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Users className="size-5" aria-hidden="true" />
            </span>
            <h2 className="text-sm font-medium">还没有客户</h2>
            <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
              创建客户后，就可以为 TA 建立委托。
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-border/70 px-6 py-12 text-center">
            <h2 className="text-sm font-medium">没有显示中的客户</h2>
            <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
              当前客户都已归档，打开上面的「显示已归档」即可查看。
            </p>
          </div>
        ) : (
          <div data-testid="client-list">
            <div className="border-b border-border/70 px-4 py-2 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
              客户
            </div>
            <div className="divide-y divide-border/50">
              {visible.map((client) => {
                const archived = client.archivedAt !== null
                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => setSheet({ mode: 'edit', client })}
                    className="flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
                    data-testid="client-row"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{client.name}</span>
                      {archived ? <Badge variant="outline">已归档</Badge> : null}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {client.contact && client.contact.length > 0 ? client.contact : '未填写联系方式'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {sheet ? (
        <ClientSheet
          mode={sheet.mode}
          client={sheet.mode === 'edit' ? sheet.client : null}
          onClose={() => setSheet(null)}
          onSaved={() => clients.reload()}
        />
      ) : null}
    </div>
  )
}
