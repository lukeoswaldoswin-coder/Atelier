import type { RefObject } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { ClientFilterOption } from '@/lib/commission-filter-options'
import type { CommissionQuery } from '@/lib/commission-query'

interface CommissionFiltersProps {
  query: CommissionQuery
  clientOptions: readonly ClientFilterOption[]
  searchInputRef: RefObject<HTMLInputElement | null>
  /** 查询是否被改动（含排序），用于控制「清除筛选」是否可用 */
  modified: boolean
  onChange: (patch: Partial<CommissionQuery>) => void
  onClear: () => void
}

const SELECT_CLASS =
  'h-8 rounded-md border border-input bg-transparent px-2 text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40'

/** 搜索与筛选工具栏。 */
export function CommissionFilters({
  query,
  clientOptions,
  searchInputRef,
  modified,
  onChange,
  onClear
}: CommissionFiltersProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <div className="relative w-64">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          ref={searchInputRef}
          value={query.text}
          onChange={(event) => onChange({ text: event.target.value })}
          onKeyDown={(event) => {
            // 输入法组合期间不响应 Esc，避免打断候选词
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Escape' && query.text.length > 0) {
              event.preventDefault()
              onChange({ text: '' })
            }
          }}
          placeholder="搜索委托名或客户名"
          aria-label="搜索委托或客户"
          className="h-8 pl-8 text-xs"
        />
      </div>

      <select
        aria-label="状态筛选"
        className={SELECT_CLASS}
        value={query.status}
        onChange={(event) => onChange({ status: event.target.value as CommissionQuery['status'] })}
      >
        <option value="all">全部状态</option>
        <option value="draft">草稿</option>
        <option value="active">进行中</option>
        <option value="completed">已完成</option>
        <option value="cancelled">已取消</option>
      </select>

      <select
        aria-label="付款筛选"
        className={SELECT_CLASS}
        value={query.payment}
        onChange={(event) => onChange({ payment: event.target.value as CommissionQuery['payment'] })}
      >
        <option value="all">全部付款</option>
        <option value="unsettled">未结清</option>
        <option value="paid">已付清</option>
        <option value="unquoted">未报价</option>
        <option value="free">免费</option>
      </select>

      <select
        aria-label="客户筛选"
        className={SELECT_CLASS}
        value={query.clientId}
        onChange={(event) => onChange({ clientId: event.target.value })}
      >
        <option value="all">全部客户</option>
        {clientOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        aria-label="排序方式"
        className={SELECT_CLASS}
        value={query.sort}
        onChange={(event) => onChange({ sort: event.target.value as CommissionQuery['sort'] })}
      >
        <option value="created-desc">按创建时间</option>
        <option value="deadline-asc">按截止时间</option>
        <option value="priority-asc">按优先级</option>
      </select>

      <Button
        type="button"
        size="sm"
        variant={query.overdueOnly ? 'default' : 'outline'}
        aria-pressed={query.overdueOnly}
        className="h-8 text-xs"
        onClick={() => onChange({ overdueOnly: !query.overdueOnly })}
      >
        仅逾期
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 text-xs"
        disabled={!modified}
        onClick={onClear}
      >
        清除筛选
      </Button>
    </div>
  )
}
