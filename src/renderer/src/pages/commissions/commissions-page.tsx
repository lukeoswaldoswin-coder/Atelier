import { cn } from '@/lib/utils'
import { useCommissionsUiStore, type CommissionsTab as CommissionsTabId } from '@/stores/commissions-ui-store'
import { ClientsTab } from './clients-tab'
import { CommissionsTab } from './commissions-tab'

function TabButton({
  active,
  onSelect,
  children
}: {
  active: boolean
  onSelect: () => void
  children: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm transition-colors',
        active
          ? 'bg-accent font-medium text-accent-foreground'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

/**
 * 委托管理页：委托 / 客户两个页签。
 * 页签状态放在 store 里，切换页面再回来不会丢失。
 */
export function CommissionsPage() {
  const tab = useCommissionsUiStore((state) => state.tab)
  const setTab = useCommissionsUiStore((state) => state.setTab)

  const tabs: Array<{ id: CommissionsTabId; label: string }> = [
    { id: 'commissions', label: '委托' },
    { id: 'clients', label: '客户' }
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div role="tablist" aria-label="委托管理视图" className="flex shrink-0 items-center gap-1">
        {tabs.map((item) => (
          <TabButton key={item.id} active={tab === item.id} onSelect={() => setTab(item.id)}>
            {item.label}
          </TabButton>
        ))}
      </div>

      {tab === 'commissions' ? <CommissionsTab /> : <ClientsTab />}
    </div>
  )
}
