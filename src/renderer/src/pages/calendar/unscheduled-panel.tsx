import type { CalendarTask } from '@shared/domain'
import { TASK_STAGE_LABELS } from '@shared/tasks'
import { Badge } from '@/components/ui/badge'
import { formatMinutes } from '@/lib/task-format'

/** 右侧「未安排任务」：显示但不可在此排期（排期交互在 P3.3 接入）。 */
export function UnscheduledPanel({
  items,
  onOpen
}: {
  items: readonly CalendarTask[]
  onOpen: (item: CalendarTask) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="unscheduled-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">未安排任务</h2>
        <Badge variant="muted">{items.length}</Badge>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        未完成、未归档，且委托处于草稿或进行中。
      </p>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/70 px-3 py-6 text-center text-[11px] text-muted-foreground">
            没有未安排的任务
          </p>
        ) : null}

        {items.map((item) => (
          <button
            key={item.task.id}
            type="button"
            data-testid="unscheduled-item"
            onClick={() => onOpen(item)}
            className="flex flex-col gap-0.5 rounded-md border border-border/60 px-2 py-1.5 text-left transition-colors hover:bg-muted/40"
          >
            <span className="truncate text-xs font-medium text-foreground">{item.task.title}</span>
            <span className="truncate text-[10px] text-muted-foreground">
              {item.commission.title} · {item.clientName}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {TASK_STAGE_LABELS[item.task.stage]} · {formatMinutes(item.task.estimatedMinutes)}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
