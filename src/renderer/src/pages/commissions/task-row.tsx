import type { Task } from '@shared/domain'
import { TASK_STAGE_LABELS, TASK_STATUS_LABELS } from '@shared/tasks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatMinutes } from '@/lib/task-format'

interface TaskRowProps {
  task: Task
  busy: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onToggleDone: (task: Task) => void
  onStart: (task: Task) => void
  onEdit: (task: Task) => void
  onMoveUp: (task: Task) => void
  onMoveDown: (task: Task) => void
  onArchive: (task: Task) => void
  onRestore: (task: Task) => void
}

const ACTION_CLASS = 'h-6 px-2 text-[11px]'

export function TaskRow({
  task,
  busy,
  canMoveUp,
  canMoveDown,
  onToggleDone,
  onStart,
  onEdit,
  onMoveUp,
  onMoveDown,
  onArchive,
  onRestore
}: TaskRowProps) {
  const archived = task.archivedAt !== null
  const done = task.status === 'done'

  return (
    <div
      data-testid="task-row"
      className="flex flex-col gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/40"
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-1 size-3.5 accent-[var(--color-primary)]"
          checked={done}
          disabled={busy || archived}
          aria-label={done ? `将「${task.title}」标记为未完成` : `将「${task.title}」标记为已完成`}
          onChange={() => onToggleDone(task)}
        />
        <span className="min-w-0 flex-1 text-sm text-foreground">
          {task.title}
          {archived ? (
            <Badge variant="outline" className="ml-2 align-middle">
              已归档
            </Badge>
          ) : null}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {formatMinutes(task.estimatedMinutes)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 pl-6">
        <span className="text-[11px] text-muted-foreground">
          {TASK_STAGE_LABELS[task.stage]} · {TASK_STATUS_LABELS[task.status]}
        </span>

        {!archived && task.status === 'todo' ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={ACTION_CLASS}
            disabled={busy}
            onClick={() => onStart(task)}
          >
            开始
          </Button>
        ) : null}

        <span className="flex-1" />

        {archived ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={ACTION_CLASS}
            disabled={busy}
            onClick={() => onRestore(task)}
          >
            恢复
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={ACTION_CLASS}
              disabled={busy || !canMoveUp}
              aria-label={`上移「${task.title}」`}
              onClick={() => onMoveUp(task)}
            >
              上移
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={ACTION_CLASS}
              disabled={busy || !canMoveDown}
              aria-label={`下移「${task.title}」`}
              onClick={() => onMoveDown(task)}
            >
              下移
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={ACTION_CLASS}
              disabled={busy}
              onClick={() => onEdit(task)}
            >
              编辑
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={ACTION_CLASS}
              disabled={busy}
              onClick={() => onArchive(task)}
            >
              归档
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
