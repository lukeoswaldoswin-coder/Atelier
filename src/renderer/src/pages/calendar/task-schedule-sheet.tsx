import { useState } from 'react'
import type { CalendarTask } from '@shared/domain'
import { TASK_STAGE_LABELS, TASK_STATUS_LABELS } from '@shared/tasks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { updateTask } from '@/data/task-actions'
import { isPastDate } from '@/lib/calendar'
import { formatDeadlineDate, formatDeadlineDateTime } from '@/lib/format'
import { formatIpcError } from '@/lib/ipc-error'
import { formatMinutes } from '@/lib/task-format'
import { useCommissionsUiStore } from '@/stores/commissions-ui-store'
import { useNavigationStore } from '@/stores/navigation-store'

interface TaskScheduleSheetProps {
  item: CalendarTask
  today: string
  onClose: () => void
  onSaved: () => void
}

/**
 * 日历中的任务详情与排期面板。
 * 只修改计划日期；不改变委托截止、不改变任务完成状态。
 */
export function TaskScheduleSheet({ item, today, onClose, onSaved }: TaskScheduleSheetProps) {
  const [plannedDate, setPlannedDate] = useState(item.task.plannedDate ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setActive = useNavigationStore((state) => state.setActive)
  const setSelectedId = useCommissionsUiStore((state) => state.setSelectedId)
  const setTab = useCommissionsUiStore((state) => state.setTab)

  const original = item.task.plannedDate ?? ''
  const dirty = plannedDate !== original

  const deadline = item.commission.deadline
  const deadlineText =
    deadline.kind === 'none'
      ? '未设置'
      : deadline.kind === 'date'
        ? formatDeadlineDate(deadline.date)
        : formatDeadlineDateTime(deadline.at, deadline.timeZone)

  async function persist(next: string | null): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await updateTask({ id: item.task.id, plannedDate: next })
      onSaved()
      onClose()
    } catch (caught) {
      setError(formatIpcError(caught))
    } finally {
      setSaving(false)
    }
  }

  function viewCommission(): void {
    setTab('commissions')
    setSelectedId(item.commission.id)
    setActive('commissions')
    onClose()
  }

  return (
    <Sheet
      title={item.task.title}
      description={`${item.commission.title} · ${item.clientName}`}
      onRequestClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={viewCommission}>
            查看委托
          </Button>
          <div className="flex items-center gap-2">
            {original ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => void persist(null)}
              >
                清除计划
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
              关闭
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={saving || !dirty}
              onClick={() => void persist(plannedDate === '' ? null : plannedDate)}
            >
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted-foreground">委托</dt>
          <dd className="text-foreground">
            {item.commission.title}
            {item.commission.status === 'completed' ? '（已完成）' : ''}
          </dd>

          <dt className="text-muted-foreground">客户</dt>
          <dd className="text-foreground">{item.clientName}</dd>

          <dt className="text-muted-foreground">阶段</dt>
          <dd className="text-foreground">{TASK_STAGE_LABELS[item.task.stage]}</dd>

          <dt className="text-muted-foreground">状态</dt>
          <dd className="text-foreground">{TASK_STATUS_LABELS[item.task.status]}</dd>

          <dt className="text-muted-foreground">预计工时</dt>
          <dd className="text-foreground">{formatMinutes(item.task.estimatedMinutes)}</dd>
        </dl>

        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
          <Label htmlFor="planned-date">计划日期</Label>
          <Input
            id="planned-date"
            type="date"
            aria-label="计划日期"
            value={plannedDate}
            onChange={(event) => setPlannedDate(event.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            {plannedDate === ''
              ? '留空表示未安排；保存后进入未安排列表。'
              : isPastDate(plannedDate, today)
                ? '这是过去日期，仅用于补录。'
                : '计划日期只影响日历，不改变委托截止。'}
          </p>
          <p className="text-[11px] text-muted-foreground">委托截止：{deadlineText}</p>
        </div>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
