import type { CalendarTask } from '@shared/domain'
import { TASK_STAGE_LABELS, TASK_STATUS_LABELS } from '@shared/tasks'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { formatMinutes } from '@/lib/task-format'

interface TaskDetailSheetProps {
  item: CalendarTask | null
  onClose: () => void
}

/** 日历中的任务详情（P3.2 只读；P3.3 接入日期编辑）。 */
export function TaskDetailSheet({ item, onClose }: TaskDetailSheetProps) {
  if (!item) return null

  return (
    <Sheet
      title={item.task.title}
      description={`${item.commission.title} · ${item.clientName}`}
      onRequestClose={onClose}
      footer={
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      }
    >
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

        <dt className="text-muted-foreground">计划日期</dt>
        <dd className="text-foreground">{item.task.plannedDate ?? '未安排'}</dd>
      </dl>
    </Sheet>
  )
}
