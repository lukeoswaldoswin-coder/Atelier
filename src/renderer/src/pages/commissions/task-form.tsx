import { useState } from 'react'
import type { Task, TaskStage, TaskStatus } from '@shared/domain'
import { MAX_ESTIMATED_MINUTES } from '@shared/domain'
import { TASK_STAGES, TASK_STAGE_LABELS, TASK_STATUS_LABELS } from '@shared/tasks'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface TaskFormValues {
  title: string
  stage: TaskStage
  status?: TaskStatus
  estimatedMinutes: number | null
  description: string | null
}

interface TaskFormProps {
  mode: 'create' | 'edit'
  task?: Task
  submitting: boolean
  error: string | null
  onSubmit: (values: TaskFormValues) => void
  onCancel: () => void
}

/** 行内任务表单：新建或编辑。 */
export function TaskForm({ mode, task, submitting, error, onSubmit, onCancel }: TaskFormProps) {
  const [title, setTitle] = useState(task?.title ?? '')
  const [stage, setStage] = useState<TaskStage>(task?.stage ?? 'draft')
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'todo')
  const [estimateText, setEstimateText] = useState(
    task?.estimatedMinutes === null || task?.estimatedMinutes === undefined
      ? ''
      : String(task.estimatedMinutes)
  )
  const [description, setDescription] = useState(task?.description ?? '')
  const [localError, setLocalError] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const dirty =
    title !== (task?.title ?? '') ||
    stage !== (task?.stage ?? 'draft') ||
    status !== (task?.status ?? 'todo') ||
    estimateText !==
      (task?.estimatedMinutes === null || task?.estimatedMinutes === undefined
        ? ''
        : String(task.estimatedMinutes)) ||
    description !== (task?.description ?? '')

  function requestCancel() {
    if (dirty) {
      setConfirmDiscard(true)
      return
    }
    onCancel()
  }

  function submit() {
    const trimmedTitle = title.trim()
    if (trimmedTitle.length === 0) {
      setLocalError('请填写任务标题')
      return
    }

    const trimmedEstimate = estimateText.trim()
    let estimatedMinutes: number | null = null
    if (trimmedEstimate.length > 0) {
      if (!/^\d+$/.test(trimmedEstimate)) {
        setLocalError('预计工时必须是整数分钟')
        return
      }
      estimatedMinutes = Number(trimmedEstimate)
      if (estimatedMinutes > MAX_ESTIMATED_MINUTES) {
        setLocalError('预计工时不能超过 30 天')
        return
      }
    }

    setLocalError(null)
    onSubmit({
      title: trimmedTitle,
      stage,
      ...(mode === 'edit' ? { status } : {}),
      estimatedMinutes,
      description: description.trim().length > 0 ? description.trim() : null
    })
  }

  return (
    <>
      <div
        className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 p-3"
        data-testid="task-form"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-title">任务标题 *</Label>
          <Input
            id="task-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="例如：线稿清理"
            maxLength={200}
            autoFocus
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="task-stage">阶段</Label>
            <select
              id="task-stage"
              value={stage}
              onChange={(event) => setStage(event.target.value as TaskStage)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {TASK_STAGES.map((item) => (
                <option key={item} value={item}>
                  {TASK_STAGE_LABELS[item]}
                </option>
              ))}
            </select>
          </div>

          {mode === 'edit' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-status">状态</Label>
              <select
                id="task-status"
                value={status}
                onChange={(event) => setStatus(event.target.value as TaskStatus)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                {(['todo', 'doing', 'done'] as const).map((item) => (
                  <option key={item} value={item}>
                    {TASK_STATUS_LABELS[item]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-estimate">预计工时（分钟）</Label>
          <Input
            id="task-estimate"
            value={estimateText}
            onChange={(event) => setEstimateText(event.target.value)}
            inputMode="numeric"
            placeholder="留空表示未估"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="task-description">备注</Label>
          <Textarea
            id="task-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            placeholder="可选"
          />
        </div>

        {localError ?? error ? (
          <p role="alert" className="text-xs text-destructive">
            {localError ?? error}
          </p>
        ) : null}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={requestCancel} disabled={submitting}>
            取消
          </Button>
          <Button type="button" size="sm" onClick={submit} disabled={submitting}>
            {submitting ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDiscard}
        title="放弃未保存的任务修改？"
        description="关闭这张任务表单后，已填写的内容会丢失。"
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false)
          onCancel()
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  )
}
