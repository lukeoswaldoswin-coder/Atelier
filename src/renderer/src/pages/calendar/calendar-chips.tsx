import type { CalendarDeadline, CalendarTask, TaskStage } from '@shared/domain'
import { TASK_STAGE_LABELS } from '@shared/tasks'
import { formatDateTimeInZone } from '@shared/time'
import { Check, Flag } from 'lucide-react'
import { cn } from '@/lib/utils'

const STAGE_DOT: Record<TaskStage, string> = {
  draft: 'bg-muted-foreground',
  lineart: 'bg-primary',
  color: 'bg-warning',
  final: 'bg-success',
  other: 'bg-foreground/40'
}

export function TaskChip({
  item,
  onOpen
}: {
  item: CalendarTask
  onOpen: (item: CalendarTask) => void
}) {
  const done = item.task.status === 'done'

  return (
    <button
      type="button"
      data-testid="calendar-task"
      data-done={done ? 'true' : undefined}
      onClick={() => onOpen(item)}
      title={`${item.commission.title} · ${TASK_STAGE_LABELS[item.task.stage]}${
        done ? ' · 已完成' : ''
      }`}
      className={cn(
        'flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] transition-colors hover:bg-muted',
        done ? 'text-muted-foreground/70 line-through' : 'text-foreground'
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', STAGE_DOT[item.task.stage])} />
      <span className="truncate">{item.task.title}</span>
      {done ? <Check className="ml-auto size-3 shrink-0" aria-hidden="true" /> : null}
    </button>
  )
}

export function DeadlineBadge({ item }: { item: CalendarDeadline }) {
  const time =
    item.deadline.kind === 'datetime'
      ? formatDateTimeInZone(item.deadline.at, item.deadline.timeZone).slice(11, 16)
      : null

  return (
    <div
      data-testid="calendar-deadline"
      title={`${item.commission.title} · 委托截止`}
      className="flex items-center gap-1 rounded bg-warning/10 px-1 py-0.5 text-[11px] text-warning"
    >
      <Flag className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.commission.title}</span>
      {time ? <span className="shrink-0 tabular-nums">{time}</span> : null}
    </div>
  )
}
