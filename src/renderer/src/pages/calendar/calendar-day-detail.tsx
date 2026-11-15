import type {
  CalendarDayActivity,
  CalendarDayCommissionActivity,
  CalendarDayDetailOutput,
  CalendarDayTaskActivity,
  CalendarDeadline,
  CalendarTask
} from '@shared/domain'
import { TASK_STAGE_LABELS, TASK_STATUS_LABELS } from '@shared/tasks'
import { formatDuration } from '@shared/time-entries'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDayTitle } from '@/lib/calendar'
import { formatDeadlineDate, formatDeadlineDateTime } from '@/lib/format'
import { DeadlineBadge, TaskChip } from './calendar-chips'
import type { CalendarActivityStatus } from '@/data/calendar-activity'

const ACTION = 'h-6 px-1.5 text-[10px]'

/** 跳转到其他模块所需的回调。由日历页统一接线到 zustand store。 */
export interface DayDetailActions {
  /** 打开日历内的任务排期面板（原有行为） */
  onOpenTask: (item: CalendarTask) => void
  /** 跳到绘画任务页并定位该任务 */
  onFocusTask: (taskId: string) => void
  /** 跳到工时记录页并带上日期筛选 */
  onOpenTimeEntries: (options: { date: string; taskId?: string | null }) => void
  /** 跳到委托管理页并打开该委托详情 */
  onOpenCommission: (commissionId: string) => void
  onClose: () => void
}

interface CalendarDayDetailProps extends DayDetailActions {
  date: string
  status: CalendarActivityStatus
  detail: CalendarDayDetailOutput | null
  error: string | null
  /** 当天有工时记录时，日历页已经拿到的摘要（用于「涉及委托数」等快速指标） */
  summary: CalendarDayActivity | undefined
  /** 当天计划的任务（原有计划日期） */
  plannedTasks: readonly CalendarTask[]
  /** 当天到期的委托截止 */
  deadlines: readonly CalendarDeadline[]
}

/** 分区标题：让「实际」和「计划」在视觉与语义上分开。 */
function SectionTitle({
  children,
  hint
}: {
  children: string
  hint?: string
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="text-xs font-semibold text-foreground">{children}</h3>
      {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

function StatItem({
  label,
  value,
  testId
}: {
  label: string
  value: string
  testId?: string
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md bg-muted/40 px-2 py-1.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span data-testid={testId} className="text-xs font-medium tabular-nums text-foreground">
        {value}
      </span>
    </div>
  )
}

function TaskActivityRow({
  item,
  date,
  onFocusTask,
  onOpenTimeEntries,
  onOpenCommission
}: {
  item: CalendarDayTaskActivity
  date: string
} & Pick<DayDetailActions, 'onFocusTask' | 'onOpenTimeEntries' | 'onOpenCommission'>) {
  return (
    <div
      data-testid="day-detail-task"
      data-task-id={item.taskId}
      className="flex flex-col gap-1 rounded-md border border-border/60 px-2 py-1.5"
    >
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {item.taskTitle}
        </span>
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-primary">
          {formatDuration(item.seconds)}
        </span>
      </div>
      <p className="truncate text-[10px] text-muted-foreground">
        {item.commissionTitle} · {item.clientName}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant={item.taskStatus === 'done' ? 'muted' : 'outline'}>
          {TASK_STATUS_LABELS[item.taskStatus]}
        </Badge>
        <Badge variant="muted">{TASK_STAGE_LABELS[item.taskStage]}</Badge>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={ACTION}
          onClick={() => onFocusTask(item.taskId)}
        >
          定位任务
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={ACTION}
          onClick={() => onOpenTimeEntries({ date, taskId: item.taskId })}
        >
          查看工时
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={ACTION}
          onClick={() => onOpenCommission(item.commissionId)}
        >
          查看委托
        </Button>
      </div>
    </div>
  )
}

function CommissionRow({
  item,
  onOpenCommission
}: {
  item: CalendarDayCommissionActivity
  onOpenCommission: (commissionId: string) => void
}) {
  return (
    <div
      data-testid="day-detail-commission"
      className="flex items-center gap-1.5 rounded-md bg-muted/30 px-2 py-1"
    >
      <span className="min-w-0 flex-1 truncate text-[11px] text-foreground">{item.title}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{item.clientName}</span>
      <span className="shrink-0 text-[10px] font-medium tabular-nums text-foreground">
        {formatDuration(item.seconds)}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={ACTION}
        onClick={() => onOpenCommission(item.id)}
      >
        打开
      </Button>
    </div>
  )
}

function deadlineText(item: CalendarDeadline): string {
  const deadline = item.deadline
  if (deadline.kind === 'none') return '未设置截止'
  if (deadline.kind === 'date') return `截止 ${formatDeadlineDate(deadline.date)}`
  return `截止 ${formatDeadlineDateTime(deadline.at, deadline.timeZone)}`
}

/**
 * 日历右侧「当天详情」。
 *
 * 结构（从上到下）：
 *   A 当天统计 —— 实际工时 / 推进任务数 / 涉及委托数 / 未关联任务工时
 *   B 当天创作记录（按任务） —— 实际发生
 *   C 未关联任务工时 —— 单独区域 + 工时记录页入口
 *   D 当天计划安排 —— 计划任务与委托截止，与实际创作严格分区
 *
 * 空状态一律只显示说明文字，不显示 0 小时 / 0 分钟之类的虚假数字。
 */
export function CalendarDayDetail({
  date,
  status,
  detail,
  error,
  summary,
  plannedTasks,
  deadlines,
  onOpenTask,
  onFocusTask,
  onOpenTimeEntries,
  onOpenCommission,
  onClose
}: CalendarDayDetailProps) {
  const tasks = detail?.tasks ?? []
  const commissions = detail?.commissions ?? []
  const totalSeconds = detail?.totalSeconds ?? 0
  const unassignedSeconds = detail?.unassignedSeconds ?? 0
  const unassignedEntryIds = detail?.unassignedEntryIds ?? []
  const hasActivity = totalSeconds > 0 || tasks.length > 0
  const hasPlan = plannedTasks.length > 0 || deadlines.length > 0

  return (
    <div
      data-testid="calendar-day-detail"
      data-date={date}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium" data-testid="day-detail-title">
            {formatDayTitle(date)}
          </h2>
          <p className="text-[10px] text-muted-foreground">实际创作与计划安排分开展示</p>
        </div>
        <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-[10px]" onClick={onClose}>
          关闭
        </Button>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive"
        >
          {error}
        </p>
      ) : null}

      {/* A 当天统计 */}
      <section className="flex flex-col gap-1.5" data-testid="day-detail-stats">
        <SectionTitle hint="实际">当天统计</SectionTitle>
        {status === 'loading' ? (
          <p className="text-[11px] text-muted-foreground">正在读取当天记录…</p>
        ) : hasActivity ? (
          <div className="grid grid-cols-2 gap-1.5">
            <StatItem
              label="实际工时"
              value={formatDuration(totalSeconds)}
              testId="day-detail-total"
            />
            <StatItem
              label="推进任务数"
              value={`${tasks.length} 项`}
              testId="day-detail-task-count"
            />
            <StatItem
              label="涉及委托数"
              value={`${commissions.length} 个`}
              testId="day-detail-commission-count"
            />
            {unassignedSeconds > 0 ? (
              <StatItem
                label="未关联任务工时"
                value={formatDuration(unassignedSeconds)}
                testId="day-detail-unassigned-seconds"
              />
            ) : (
              <StatItem label="未关联任务工时" value="无" testId="day-detail-unassigned-seconds" />
            )}
          </div>
        ) : (
          <p
            data-testid="day-detail-empty"
            className="rounded-md border border-dashed border-border/70 px-2 py-4 text-center text-[11px] text-muted-foreground"
          >
            这一天还没有实际创作记录。
          </p>
        )}
      </section>

      {/* B 当天创作记录（按任务） */}
      <section className="flex flex-col gap-1.5" data-testid="day-detail-actual">
        <SectionTitle hint="实际">当天创作记录</SectionTitle>
        {tasks.length === 0 ? (
          <p className="rounded-md border border-dashed border-border/70 px-2 py-3 text-center text-[10px] text-muted-foreground">
            没有关联到任务的工时。
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {tasks.map((item) => (
              <TaskActivityRow
                key={item.taskId}
                item={item}
                date={date}
                onFocusTask={onFocusTask}
                onOpenTimeEntries={onOpenTimeEntries}
                onOpenCommission={onOpenCommission}
              />
            ))}
          </div>
        )}

        {commissions.length > 0 ? (
          <div className="flex flex-col gap-1 pt-1">
            <span className="text-[10px] text-muted-foreground">涉及委托</span>
            {commissions.map((item) => (
              <CommissionRow key={item.id} item={item} onOpenCommission={onOpenCommission} />
            ))}
          </div>
        ) : null}
      </section>

      {/* C 未关联任务工时 */}
      <section className="flex flex-col gap-1.5" data-testid="day-detail-unassigned">
        <SectionTitle hint="实际">未关联任务工时</SectionTitle>
        {unassignedSeconds > 0 ? (
          <>
            <p className="text-[11px] text-warning">
              {formatDuration(unassignedSeconds)} 未关联到任何任务（{unassignedEntryIds.length} 条记录）。
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 self-start px-2 text-[11px]"
              onClick={() => onOpenTimeEntries({ date, taskId: null })}
            >
              去工时记录页归属
            </Button>
          </>
        ) : (
          <p className="text-[10px] text-muted-foreground">这一天没有未关联任务的工时。</p>
        )}
      </section>

      {/* D 当天计划安排 */}
      <section className="flex flex-col gap-1.5" data-testid="day-detail-plan">
        <SectionTitle hint="计划">当天计划安排</SectionTitle>
        {!hasPlan ? (
          <p className="rounded-md border border-dashed border-border/70 px-2 py-3 text-center text-[10px] text-muted-foreground">
            这一天没有计划任务，也没有委托截止。
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {plannedTasks.map((item) => (
              <div key={item.task.id} className="flex items-center gap-1">
                <span className="min-w-0 flex-1">
                  <TaskChip item={item} onOpen={onOpenTask} />
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={ACTION}
                  onClick={() => onFocusTask(item.task.id)}
                >
                  定位
                </Button>
              </div>
            ))}
            {deadlines.map((item) => (
              <div key={`${item.commission.id}-${item.date}`} className="flex flex-col gap-0.5">
                <DeadlineBadge item={item} />
                <span className="pl-4 text-[10px] text-muted-foreground">
                  {deadlineText(item)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {summary && summary.seconds > 0 ? (
        <p className="text-[10px] text-muted-foreground">
          本月网格统计：当天 {formatDuration(summary.seconds)}
          {summary.taskCount > 0 ? ` · 推进 ${summary.taskCount} 项` : ''}
        </p>
      ) : null}
    </div>
  )
}
