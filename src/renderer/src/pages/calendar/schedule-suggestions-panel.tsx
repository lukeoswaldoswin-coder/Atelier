import { useEffect, useMemo, useState } from 'react'
import type { CalendarTask } from '@shared/domain'
import {
  buildScheduleSuggestions,
  type ScheduleSuggestion,
  type ScheduleUrgency
} from '@shared/scheduling'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { applySchedule } from '@/data/schedule-actions'
import { formatIpcError } from '@/lib/ipc-error'
import { formatMinutes } from '@/lib/task-format'

interface ScheduleSuggestionsPanelProps {
  items: readonly CalendarTask[]
  /** 由日历页用 todayInZone 生成的本地今天，算法不自行读取系统时间 */
  today: string
  onOpen: (item: CalendarTask) => void
  onApplied: () => void
}

function urgencyText(suggestion: ScheduleSuggestion): string {
  if (suggestion.overdueDays !== null && suggestion.overdueDays > 0) {
    return `已逾期 ${suggestion.overdueDays} 天`
  }
  if (suggestion.daysUntilDeadline === null) return '无截止日期'
  if (suggestion.daysUntilDeadline === 0) return '今天截止'
  if (suggestion.daysUntilDeadline <= 3) return `还剩 ${suggestion.daysUntilDeadline} 天`
  if (suggestion.urgency === 'this-week') return '本周截止'
  return `距截止 ${suggestion.daysUntilDeadline} 天`
}

function urgencyVariant(
  urgency: ScheduleUrgency
): 'warning' | 'success' | 'muted' | 'outline' {
  if (urgency === 'overdue') return 'warning'
  if (urgency === 'due-soon') return 'warning'
  if (urgency === 'this-week') return 'outline'
  return 'muted'
}

/**
 * 排期建议面板。
 * 建议完全由日历未安排任务计算；只有用户勾选并点击采纳后才写入计划日期。
 */
export function ScheduleSuggestionsPanel({
  items,
  today,
  onOpen,
  onApplied
}: ScheduleSuggestionsPanelProps) {
  const suggestions = useMemo(
    () => buildScheduleSuggestions({ items, todayISO: today }),
    [items, today]
  )

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dateEdits, setDateEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const suggestionKey = suggestions.map((item) => `${item.taskId}:${item.suggestedDate}`).join('|')

  useEffect(() => {
    setSelected((previous) => {
      const next = new Set([...previous].filter((id) => suggestions.some((item) => item.taskId === id)))
      return next.size === previous.size ? previous : next
    })
    setDateEdits((previous) => {
      const next: Record<string, string> = {}
      for (const suggestion of suggestions) {
        const value = previous[suggestion.taskId]
        if (value !== undefined) next[suggestion.taskId] = value
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestionKey])

  const allSelected = suggestions.length > 0 && suggestions.every((item) => selected.has(item.taskId))
  const selectedSuggestions = suggestions.filter((item) => selected.has(item.taskId))
  const itemByTaskId = useMemo(() => new Map(items.map((item) => [item.task.id, item])), [items])

  function toggle(taskId: string): void {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(taskId)) next.delete(taskId)
      else next.add(taskId)
      return next
    })
  }

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(suggestions.map((item) => item.taskId)))
  }

  function dateOf(suggestion: ScheduleSuggestion): string {
    return dateEdits[suggestion.taskId] ?? suggestion.suggestedDate
  }

  async function applySelected(): Promise<void> {
    if (selectedSuggestions.length === 0) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const result = await applySchedule({
        items: selectedSuggestions.map((suggestion) => ({
          taskId: suggestion.taskId,
          plannedDate: dateOf(suggestion),
          basis: suggestion.basis
        }))
      })
      setSelected(new Set())
      setSuccess(`已安排 ${result.applied.length} 个任务`)
      onApplied()
    } catch (caught) {
      setError(formatIpcError(caught))
      setSelected(new Set())
      // 数据可能已变化：立即重新读取建议，避免继续使用旧快照
      onApplied()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="schedule-suggestions-panel">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">排期建议</h2>
          <p className="text-[10px] text-muted-foreground">按截止、优先级与预计工时排序</p>
        </div>
        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            aria-label="全选建议"
            checked={allSelected}
            disabled={suggestions.length === 0 || busy}
            onChange={toggleAll}
          />
          全选
        </label>
      </div>

      <p className="rounded-md bg-muted/40 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
        建议只按截止、优先级与预计工时计算，未做每日容量安排；只有点击采纳后才会写入计划日期。
      </p>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
          {error}
        </p>
      ) : null}

      {success ? (
        <p role="status" className="rounded-md border border-success/30 bg-success/5 px-2 py-1.5 text-[11px] text-success">
          {success}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {suggestions.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-[11px] text-muted-foreground">
            没有需要安排的任务。
          </p>
        ) : null}

        {suggestions.map((suggestion, index) => {
          const source = itemByTaskId.get(suggestion.taskId)
          const checked = selected.has(suggestion.taskId)
          return (
            <div
              key={suggestion.taskId}
              data-testid="schedule-suggestion"
              data-task-id={suggestion.taskId}
              className="flex flex-col gap-1 rounded-md border border-border/60 px-2 py-1.5"
            >
              <div className="flex items-start gap-1.5">
                <input
                  type="checkbox"
                  className="mt-0.5 size-3.5"
                  aria-label={`选择建议 ${suggestion.title}`}
                  checked={checked}
                  disabled={busy}
                  onChange={() => toggle(suggestion.taskId)}
                />
                <span className="mt-0.5 w-4 shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-medium text-foreground">
                      {suggestion.title}
                    </span>
                    <Badge variant={urgencyVariant(suggestion.urgency)}>
                      {urgencyText(suggestion)}
                    </Badge>
                  </div>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {suggestion.commissionTitle} · {suggestion.clientName}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 pl-5">
                <Input
                  type="date"
                  aria-label={`建议日期 ${suggestion.title}`}
                  value={dateOf(suggestion)}
                  disabled={busy}
                  onChange={(event) =>
                    setDateEdits((previous) => ({
                      ...previous,
                      [suggestion.taskId]: event.target.value
                    }))
                  }
                  className="h-7 w-32 text-[11px]"
                />
                <span className="text-[10px] text-muted-foreground">
                  P{suggestion.commissionPriority}
                  {suggestion.estimatedMinutes !== null
                    ? ` · ${formatMinutes(suggestion.estimatedMinutes)}`
                    : ' · 未估工时'}
                  {suggestion.deadlineDate ? ` · 截止 ${suggestion.deadlineDate}` : ''}
                </span>
                <span className="flex-1" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-[10px]"
                  disabled={busy || !source}
                  onClick={() => source && onOpen(source)}
                >
                  调整
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <span className="text-[10px] text-muted-foreground">
          {selectedSuggestions.length > 0
            ? `已选 ${selectedSuggestions.length} 条`
            : '勾选后确认'}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={busy || selectedSuggestions.length === 0}
          onClick={() => void applySelected()}
        >
          {busy ? '采纳中…' : `采纳选中${selectedSuggestions.length > 0 ? `（${selectedSuggestions.length}）` : ''}`}
        </Button>
      </div>
    </div>
  )
}
