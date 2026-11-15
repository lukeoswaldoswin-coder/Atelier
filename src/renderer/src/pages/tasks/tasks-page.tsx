import { useMemo, useState } from 'react'
import type { WorkbenchTask } from '@shared/domain'
import { TASK_STAGE_LABELS, TASK_STATUS_LABELS } from '@shared/tasks'
import { formatClock, formatDuration } from '@shared/time-entries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Segmented } from '@/components/ui/segmented'
import { updateTask } from '@/data/task-actions'
import { useLiveTaskSession } from '@/data/time-polling'
import { useWorkbench } from '@/data/workbench'
import { formatIpcError } from '@/lib/ipc-error'
import { formatMinutes } from '@/lib/task-format'
import { cn } from '@/lib/utils'
import { useNavigationStore } from '@/stores/navigation-store'
import { useTimeStore } from '@/stores/time-store'

const FILTER_OPTIONS = [
  { value: 'pending' as const, label: '待处理' },
  { value: 'all' as const, label: '全部' }
]

type Filter = 'pending' | 'all'

/** 当前计时任务卡片。没有会话时显示空状态，绝不展示虚假数字。 */
function CurrentSessionCard({ onStopped }: { onStopped: () => void }) {
  const status = useTimeStore((state) => state.status)
  const busy = useTimeStore((state) => state.busy)
  const pauseTask = useTimeStore((state) => state.pauseTask)
  const resumeTask = useTimeStore((state) => state.resumeTask)
  const stopTask = useTimeStore((state) => state.stopTask)
  const { accumulated, session, accumulating } = useLiveTaskSession()
  const setActive = useNavigationStore((store) => store.setActive)

  const taskSession = status?.taskSession ?? null
  const error = useTimeStore((state) => state.error)

  if (!taskSession) {
    return (
      <Card data-testid="current-session-empty">
        <CardHeader>
          <CardTitle>当前计时任务</CardTitle>
          <CardDescription>还没有正在计时的任务</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="rounded-lg border border-dashed border-border/70 px-4 py-6 text-center text-xs text-muted-foreground">
            从下方选择一个绘画任务开始计时。
            <br />
            只有绘画软件处于活跃状态的时间才会计入实际工时。
          </p>
        </CardContent>
      </Card>
    )
  }

  const paused = taskSession.state === 'paused'
  const stateText = paused
    ? '手动暂停：用户已暂停本次计时'
    : accumulating
      ? '正在累计：绘画软件活跃中'
      : '暂停累计：当前未检测到绘画软件活动'

  const task = taskSession.entry.task
  const commission = taskSession.entry.commission

  return (
    <Card data-testid="current-session" className="border-primary/40">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{task?.title ?? '未知任务'}</CardTitle>
          <Badge variant={paused ? 'muted' : accumulating ? 'default' : 'outline'}>
            {paused ? '已暂停' : accumulating ? '累计中' : '等待绘画软件'}
          </Badge>
        </div>
        <CardDescription>
          {commission?.title ?? '未知委托'} · {commission?.clientName ?? '未知客户'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="text-[11px] text-muted-foreground">实际累计工时</p>
            <p className="text-2xl font-semibold tabular-nums" data-testid="session-accumulated">
              {formatClock(accumulated)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">会话持续时间</p>
            <p className="text-sm tabular-nums text-muted-foreground" data-testid="session-elapsed">
              {formatClock(session)}
            </p>
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground" data-testid="session-state">
          {stateText}
          {taskSession.activeAppKey ? ` · ${taskSession.activeAppKey}` : ''}
        </p>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {paused ? (
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => void resumeTask()}
            >
              继续计时
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void pauseTask()}
            >
              暂停
            </Button>
          )}
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={busy}
            onClick={() => {
              void stopTask().then(onStopped)
            }}
          >
            结束计时
          </Button>
          {commission ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setActive('commissions')}
            >
              打开委托
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

const ROW_ACTION = 'h-7 px-2 text-[11px]'

function TaskRow({
  item,
  isCurrent,
  disabled,
  onStart,
  onToggleDone
}: {
  item: WorkbenchTask
  isCurrent: boolean
  disabled: boolean
  onStart: (item: WorkbenchTask) => void
  onToggleDone: (item: WorkbenchTask) => void
}) {
  const { task, commission, clientName, actualSeconds } = item
  const done = task.status === 'done'
  const setActive = useNavigationStore((store) => store.setActive)

  return (
    <div
      data-testid="workbench-task"
      data-task-id={task.id}
      className={cn(
        'flex flex-col gap-1 rounded-md border border-border/60 px-3 py-2',
        isCurrent && 'border-primary/50 bg-primary/5'
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('text-sm text-foreground', done && 'line-through opacity-60')}>
          {task.title}
        </span>
        <Badge variant="outline">{TASK_STAGE_LABELS[task.stage]}</Badge>
        <Badge variant={done ? 'muted' : task.status === 'doing' ? 'default' : 'outline'}>
          {TASK_STATUS_LABELS[task.status]}
        </Badge>
        {task.plannedDate ? (
          <span className="text-[10px] text-muted-foreground">计划 {task.plannedDate}</span>
        ) : null}
      </div>

      <p className="truncate text-[11px] text-muted-foreground">
        {commission.title} · {clientName}
      </p>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>预计 {formatMinutes(task.estimatedMinutes)}</span>
        {actualSeconds > 0 ? <span>· 实际 {formatDuration(actualSeconds)}</span> : null}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1">
        {!done ? (
          <Button
            type="button"
            variant={isCurrent ? 'outline' : 'default'}
            size="sm"
            className={ROW_ACTION}
            disabled={disabled || isCurrent}
            onClick={() => onStart(item)}
          >
            {isCurrent ? '计时中' : '开始计时'}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={ROW_ACTION}
          disabled={disabled}
          onClick={() => onToggleDone(item)}
        >
          {done ? '恢复为未完成' : '标记完成'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={ROW_ACTION}
          onClick={() => setActive('commissions')}
        >
          查看委托
        </Button>
      </div>
    </div>
  )
}

/**
 * 绘画任务工作台（P6.6）。
 *
 * 布局：标题 → 当前计时任务卡片 → 待处理任务列表。
 * 任务数据全部来自现有 tasks / commissions / clients，不引入第二套状态。
 */
export function TasksPage() {
  const [filter, setFilter] = useState<Filter>('pending')
  const [includeDone, setIncludeDone] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [switchTarget, setSwitchTarget] = useState<WorkbenchTask | null>(null)
  const [completeTarget, setCompleteTarget] = useState<WorkbenchTask | null>(null)

  const workbench = useWorkbench({ includeDone: true, includeArchived: false })
  const status = useTimeStore((store) => store.status)
  const timerBusy = useTimeStore((store) => store.busy)
  const startTask = useTimeStore((store) => store.startTask)
  const stopTask = useTimeStore((store) => store.stopTask)

  const currentTaskId = status?.taskSession?.taskId ?? null

  const pending = workbench.data?.pending ?? []
  const done = useMemo(() => workbench.data?.done ?? [], [workbench.data])

  const visible = filter === 'pending' ? pending : [...pending, ...done]

  function beginStart(item: WorkbenchTask): void {
    setActionError(null)
    if (currentTaskId !== null && currentTaskId !== item.task.id) {
      setSwitchTarget(item)
      return
    }
    void startTask(item.task.id)
  }

  async function confirmSwitch(): Promise<void> {
    const target = switchTarget
    setSwitchTarget(null)
    if (!target) return
    // 先结算当前任务，再启动新任务：由主进程在事务里保证顺序
    await startTask(target.task.id, true)
    workbench.reload()
  }

  async function toggleDone(item: WorkbenchTask): Promise<void> {
    setBusyId(item.task.id)
    setActionError(null)
    try {
      await updateTask({
        id: item.task.id,
        status: item.task.status === 'done' ? 'todo' : 'done'
      })
      workbench.reload()
    } catch (caught) {
      setActionError(formatIpcError(caught))
    } finally {
      setBusyId(null)
    }
  }

  function requestToggleDone(item: WorkbenchTask): void {
    // 正在计时的任务不能直接标记完成，先提示结束计时
    if (item.task.id === currentTaskId && item.task.status !== 'done') {
      setCompleteTarget(item)
      return
    }
    void toggleDone(item)
  }

  async function confirmComplete(): Promise<void> {
    const target = completeTarget
    setCompleteTarget(null)
    if (!target) return
    await stopTask()
    await toggleDone(target)
  }

  const interactionsDisabled = timerBusy || busyId !== null

  return (
    <div className="flex flex-col gap-4" data-testid="tasks-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">绘画任务</h1>
          <p className="text-xs text-muted-foreground">集中管理创作任务，直接开始计时。</p>
        </div>
        <Segmented ariaLabel="任务筛选" value={filter} options={FILTER_OPTIONS} onChange={setFilter} />
      </div>

      <CurrentSessionCard onStopped={workbench.reload} />

      {actionError ? (
        <p role="alert" className="text-xs text-destructive">
          {actionError}
        </p>
      ) : null}

      {workbench.error ? (
        <p role="alert" className="text-xs text-destructive">
          {workbench.error}
        </p>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            待处理任务
            <span className="ml-2 text-[11px] font-normal text-muted-foreground">
              {pending.length} 个
            </span>
          </h2>
        </div>

        {workbench.loading && visible.length === 0 ? (
          <p className="text-xs text-muted-foreground">正在读取任务…</p>
        ) : null}

        {!workbench.loading && visible.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center text-xs text-muted-foreground">
            还没有待处理的绘画任务。可以在「委托管理」里为委托添加任务。
          </p>
        ) : null}

        {visible.map((item) => (
          <TaskRow
            key={item.task.id}
            item={item}
            isCurrent={item.task.id === currentTaskId}
            disabled={interactionsDisabled}
            onStart={beginStart}
            onToggleDone={requestToggleDone}
          />
        ))}
      </section>

      {done.length > 0 ? (
        <section className="flex flex-col gap-2">
          <button
            type="button"
            className="flex items-center gap-2 self-start text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setIncludeDone((value) => !value)}
          >
            {includeDone ? '▾' : '▸'} 已完成任务（{done.length}）
          </button>
          {includeDone
            ? done.map((item) => (
                <TaskRow
                  key={item.task.id}
                  item={item}
                  isCurrent={item.task.id === currentTaskId}
                  disabled={interactionsDisabled}
                  onStart={beginStart}
                  onToggleDone={requestToggleDone}
                />
              ))
            : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={switchTarget !== null}
        title="当前任务仍在计时"
        description={`「${switchTarget?.task.title ?? ''}」还不能开始，请先结束当前任务的计时。是否结束当前任务并开始新任务？`}
        confirmLabel="结束并开始"
        busy={timerBusy}
        onConfirm={() => void confirmSwitch()}
        onCancel={() => setSwitchTarget(null)}
      />

      <ConfirmDialog
        open={completeTarget !== null}
        title="任务正在计时"
        description="这个任务正在计时。需要先结束计时并保存工时，然后才能标记完成。"
        confirmLabel="结束计时并完成"
        busy={timerBusy}
        onConfirm={() => void confirmComplete()}
        onCancel={() => setCompleteTarget(null)}
      />
    </div>
  )
}
