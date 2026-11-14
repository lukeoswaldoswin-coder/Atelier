import { useMemo, useState } from 'react'
import type { Task } from '@shared/domain'
import { TASK_STAGES, TASK_STAGE_LABELS } from '@shared/tasks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  archiveTask,
  createTask,
  reorderTasks,
  unarchiveTask,
  updateTask
} from '@/data/task-actions'
import { useTasks } from '@/data/tasks'
import { formatIpcError } from '@/lib/ipc-error'
import { computeTaskProgress, formatMinutes } from '@/lib/task-format'
import { TaskForm, type TaskFormValues } from './task-form'
import { TaskRow } from './task-row'

type FormState = { mode: 'create' } | { mode: 'edit'; task: Task } | null

interface CommissionTasksProps {
  commissionId: string
  /** 任务变化可能影响委托状态与任务计数，通知上层刷新 */
  onChanged: () => void
}

export function CommissionTasks({ commissionId, onChanged }: CommissionTasksProps) {
  const [includeArchived, setIncludeArchived] = useState(false)
  const tasks = useTasks(commissionId, includeArchived)

  const [form, setForm] = useState<FormState>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Task | null>(null)

  const groups = useMemo(
    () =>
      TASK_STAGES.map((stage) => ({
        stage,
        tasks: tasks.rows.filter((task) => task.stage === stage)
      })).filter((group) => group.tasks.length > 0),
    [tasks.rows]
  )

  const progress = computeTaskProgress(tasks.rows)
  const interactionsDisabled = form !== null || busyId !== null

  const progressText =
    progress.total === 0
      ? '还没有任务'
      : `${progress.done}/${progress.total} 已完成 · 预计 ${formatMinutes(progress.totalMinutes)}${
          progress.undoneMinutes > 0 ? `（未完成 ${formatMinutes(progress.undoneMinutes)}）` : ''
        }`

  async function refresh(): Promise<void> {
    tasks.reload()
    onChanged()
  }

  async function submitForm(values: TaskFormValues): Promise<void> {
    setSaving(true)
    setFormError(null)
    try {
      if (form?.mode === 'create') {
        await createTask({
          commissionId,
          title: values.title,
          stage: values.stage,
          estimatedMinutes: values.estimatedMinutes,
          description: values.description
        })
      } else if (form?.mode === 'edit') {
        await updateTask({
          id: form.task.id,
          title: values.title,
          stage: values.stage,
          status: values.status,
          estimatedMinutes: values.estimatedMinutes,
          description: values.description
        })
      }
      setForm(null)
      await refresh()
    } catch (error) {
      setFormError(formatIpcError(error))
    } finally {
      setSaving(false)
    }
  }

  async function runAction(id: string, action: () => Promise<unknown>): Promise<void> {
    setBusyId(id)
    setActionError(null)
    try {
      await action()
      await refresh()
    } catch (error) {
      setActionError(formatIpcError(error))
    } finally {
      setBusyId(null)
    }
  }

  function toggleDone(task: Task): void {
    void runAction(task.id, () =>
      updateTask({ id: task.id, status: task.status === 'done' ? 'todo' : 'done' })
    )
  }

  function startTask(task: Task): void {
    void runAction(task.id, () => updateTask({ id: task.id, status: 'doing' }))
  }

  function move(task: Task, direction: -1 | 1): void {
    const stageTasks = tasks.rows.filter(
      (row) => row.stage === task.stage && row.archivedAt === null
    )
    const index = stageTasks.findIndex((row) => row.id === task.id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= stageTasks.length) return

    const ordered = [...stageTasks]
    const [moved] = ordered.splice(index, 1)
    ordered.splice(target, 0, moved as Task)

    void runAction(task.id, () =>
      reorderTasks({
        commissionId,
        stage: task.stage,
        orderedIds: ordered.map((row) => row.id)
      })
    )
  }

  return (
    <section className="flex flex-col gap-2 border-t border-border/60 pt-4" data-testid="commission-tasks">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">绘画任务</h3>
        <div className="flex items-center gap-2">
          <Switch
            id="tasks-show-archived"
            checked={includeArchived}
            onCheckedChange={setIncludeArchived}
          />
          <Label htmlFor="tasks-show-archived" className="cursor-pointer text-[11px]">
            显示已归档
          </Label>
          <Button
            type="button"
            size="sm"
            className="h-7 px-2 text-[11px]"
            disabled={form !== null}
            onClick={() => {
              setFormError(null)
              setForm({ mode: 'create' })
            }}
          >
            添加任务
          </Button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground" data-testid="tasks-progress">
        {tasks.status === 'loading' ? '正在读取任务…' : progressText}
      </p>

      {tasks.status === 'error' ? (
        <div role="alert" className="flex items-center justify-between gap-2 text-xs text-destructive">
          <span className="min-w-0 break-words">{tasks.error ?? '任务读取失败'}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => tasks.reload()}>
            重试
          </Button>
        </div>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-xs text-destructive">
          {actionError}
        </p>
      ) : null}

      {form ? (
        <TaskForm
          mode={form.mode}
          task={form.mode === 'edit' ? form.task : undefined}
          submitting={saving}
          error={formError}
          onSubmit={(values) => void submitForm(values)}
          onCancel={() => {
            setForm(null)
            setFormError(null)
          }}
        />
      ) : null}

      {tasks.status === 'ready' && tasks.rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-[11px] text-muted-foreground">
          还没有任务。添加「草稿、线稿、上色、完稿」等任务后，可以逐个推进。
        </p>
      ) : null}

      {groups.map((group) => {
        const doneCount = group.tasks.filter((task) => task.status === 'done' && task.archivedAt === null).length
        const activeCount = group.tasks.filter((task) => task.archivedAt === null).length

        return (
          <div key={group.stage} className="flex flex-col gap-1" data-testid={`task-group-${group.stage}`}>
            <div className="flex items-center gap-2 px-2">
              <span className="text-[11px] font-medium text-foreground">
                {TASK_STAGE_LABELS[group.stage]}
              </span>
              <Badge variant="muted" className="text-[10px]">
                {doneCount}/{activeCount}
              </Badge>
            </div>

            {group.tasks.map((task) => {
              const stageTasks = tasks.rows.filter(
                (row) => row.stage === task.stage && row.archivedAt === null
              )
              const index = stageTasks.findIndex((row) => row.id === task.id)
              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  busy={busyId === task.id || interactionsDisabled}
                  canMoveUp={index > 0}
                  canMoveDown={index >= 0 && index < stageTasks.length - 1}
                  onToggleDone={toggleDone}
                  onStart={startTask}
                  onEdit={(target) => {
                    setFormError(null)
                    setForm({ mode: 'edit', task: target })
                  }}
                  onMoveUp={(target) => move(target, -1)}
                  onMoveDown={(target) => move(target, 1)}
                  onArchive={(target) => setArchiveTarget(target)}
                  onRestore={(target) => void runAction(target.id, () => unarchiveTask(target.id))}
                />
              )
            })}
          </div>
        )
      })}

      <ConfirmDialog
        open={archiveTarget !== null}
        title="归档这个任务？"
        description="归档不会删除记录，只是不计入进度；可以随时在「显示已归档」里恢复。"
        confirmLabel="归档"
        busy={busyId !== null}
        onConfirm={() => {
          const target = archiveTarget
          setArchiveTarget(null)
          if (target) void runAction(target.id, () => archiveTask(target.id))
        }}
        onCancel={() => setArchiveTarget(null)}
      />
    </section>
  )
}
