import type { MouseEvent as ReactMouseEvent } from 'react'
import type { CalendarDayActivity, CalendarDeadline, CalendarTask } from '@shared/domain'
import { formatDuration } from '@shared/time-entries'
import { cn } from '@/lib/utils'
import { WEEKDAY_LABELS, formatDayNumber, isSameMonth, parseDateString } from '@/lib/calendar'
import { DeadlineBadge, TaskChip } from './calendar-chips'

interface ViewProps {
  dates: readonly string[]
  anchor: string
  today: string
  tasksByDate: ReadonlyMap<string, CalendarTask[]>
  deadlinesByDate: ReadonlyMap<string, CalendarDeadline[]>
  /** 每日实际创作摘要，键为 YYYY-MM-DD；没有记录的日期不在 Map 里 */
  activityByDate: ReadonlyMap<string, CalendarDayActivity>
  /** 当前选中的日期（右侧详情面板对应日期） */
  selectedDate: string | null
  onSelectDate: (date: string) => void
  onOpenTask: (item: CalendarTask) => void
}

/**
 * 当天实际创作摘要（紧凑两行）。
 *
 * 硬约束：没有工时记录时不渲染任何工时数字——不出现「0 小时」「0 分钟」。
 * 因此这里只在 `seconds > 0` 时输出时长，`taskCount > 0` 时输出推进数。
 */
function DayActivitySummary({ activity }: { activity: CalendarDayActivity | undefined }) {
  const hasSeconds = (activity?.seconds ?? 0) > 0
  const taskCount = activity?.taskCount ?? 0

  if (!hasSeconds && taskCount === 0) return null

  return (
    <div className="flex min-w-0 flex-col items-end leading-tight">
      {hasSeconds ? (
        <span
          data-testid="calendar-day-hours"
          title={`当天实际创作 ${formatDuration(activity?.seconds ?? 0)}`}
          className="max-w-full truncate text-[10px] font-medium tabular-nums text-primary"
        >
          {formatDuration(activity?.seconds ?? 0)}
        </span>
      ) : null}
      {taskCount > 0 ? (
        <span
          data-testid="calendar-day-tasks"
          className="max-w-full truncate text-[10px] tabular-nums text-muted-foreground"
        >
          推进 {taskCount} 项
        </span>
      ) : null}
    </div>
  )
}

/** 点击日期格空白处选中该日；点按钮（任务 chip、日期数字）时交给按钮自己的行为。 */
function isButtonTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button') !== null
}

function DayCell({
  date,
  anchor,
  today,
  tasksByDate,
  deadlinesByDate,
  activityByDate,
  selectedDate,
  onSelectDate,
  onOpenTask
}: ViewProps & { date: string }) {
  const tasks = tasksByDate.get(date) ?? []
  const deadlines = deadlinesByDate.get(date) ?? []
  const activity = activityByDate.get(date)
  const inMonth = isSameMonth(date, anchor)
  const isToday = date === today
  const isSelected = date === selectedDate
  const hasActivity = (activity?.seconds ?? 0) > 0 || (activity?.taskCount ?? 0) > 0

  function handleCellClick(event: ReactMouseEvent<HTMLDivElement>): void {
    if (isButtonTarget(event.target)) return
    onSelectDate(date)
  }

  return (
    <div
      data-testid="calendar-day"
      data-date={date}
      data-selected={isSelected ? 'true' : undefined}
      data-has-activity={hasActivity ? 'true' : undefined}
      onClick={handleCellClick}
      className={cn(
        'relative min-h-24 cursor-pointer border-r border-b border-border/60 p-1',
        inMonth ? 'bg-card' : 'bg-muted/20',
        isSelected && 'bg-primary/5 ring-1 ring-inset ring-primary/50'
      )}
    >
      {hasActivity ? (
        <span
          aria-hidden="true"
          data-testid="calendar-day-activity-mark"
          className="absolute inset-y-0 left-0 w-0.5 bg-primary/60"
        />
      ) : null}

      <div className="mb-1 flex items-start gap-1">
        <button
          type="button"
          data-testid="calendar-day-select"
          aria-label={`查看 ${date} 的创作记录`}
          aria-pressed={isSelected}
          onClick={() => onSelectDate(date)}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums transition-colors',
            isToday && 'bg-primary font-medium text-primary-foreground',
            !inMonth && !isToday && 'text-muted-foreground/60',
            isSelected && !isToday && 'bg-primary/15 font-medium text-primary'
          )}
        >
          {formatDayNumber(date)}
        </button>
        <span className="ml-auto min-w-0">
          <DayActivitySummary activity={activity} />
        </span>
      </div>

      <div className="flex max-h-24 flex-col gap-0.5 overflow-y-auto">
        {tasks.map((item) => (
          <TaskChip key={item.task.id} item={item} onOpen={onOpenTask} />
        ))}
        {deadlines.map((item) => (
          <DeadlineBadge key={`${item.commission.id}-${item.date}`} item={item} />
        ))}
      </div>
    </div>
  )
}

export function MonthView(props: ViewProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border" data-testid="calendar-month">
      <div className="grid grid-cols-7 border-b border-border/60 bg-muted/30">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="px-2 py-1.5 text-center text-[11px] text-muted-foreground">
            周{label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {props.dates.map((date) => (
          <DayCell key={date} {...props} date={date} />
        ))}
      </div>
    </div>
  )
}

export function WeekView(props: ViewProps) {
  return (
    <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-border" data-testid="calendar-week">
      {props.dates.map((date, index) => {
        const tasks = props.tasksByDate.get(date) ?? []
        const deadlines = props.deadlinesByDate.get(date) ?? []
        const activity = props.activityByDate.get(date)
        const isToday = date === props.today
        const isSelected = date === props.selectedDate
        const hasActivity = (activity?.seconds ?? 0) > 0 || (activity?.taskCount ?? 0) > 0
        const parts = parseDateString(date)

        return (
          <div
            key={date}
            data-testid="calendar-week-column"
            data-date={date}
            data-selected={isSelected ? 'true' : undefined}
            onClick={(event) => {
              if (isButtonTarget(event.target)) return
              props.onSelectDate(date)
            }}
            className={cn(
              'relative flex min-h-[380px] cursor-pointer flex-col border-r border-border/60 last:border-r-0',
              isSelected && 'bg-primary/5 ring-1 ring-inset ring-primary/50'
            )}
          >
            {hasActivity ? (
              <span
                aria-hidden="true"
                data-testid="calendar-day-activity-mark"
                className="absolute inset-y-0 left-0 w-0.5 bg-primary/60"
              />
            ) : null}

            <div
              className={cn(
                'flex items-start justify-between gap-1 border-b border-border/60 px-2 py-1.5',
                isToday && 'bg-primary/10'
              )}
            >
              <button
                type="button"
                data-testid="calendar-day-select"
                aria-label={`查看 ${date} 的创作记录`}
                aria-pressed={isSelected}
                onClick={() => props.onSelectDate(date)}
                className="flex flex-col items-start text-left"
              >
                <span className="text-[11px] text-muted-foreground">周{WEEKDAY_LABELS[index]}</span>
                <span
                  className={cn(
                    'text-[11px] tabular-nums',
                    isToday ? 'font-medium text-primary' : 'text-foreground'
                  )}
                >
                  {parts.month}/{parts.day}
                </span>
              </button>
              <DayActivitySummary activity={activity} />
            </div>

            <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-1">
              {tasks.map((item) => (
                <TaskChip key={item.task.id} item={item} onOpen={props.onOpenTask} />
              ))}
              {deadlines.map((item) => (
                <DeadlineBadge key={`${item.commission.id}-${item.date}`} item={item} />
              ))}
              {tasks.length === 0 && deadlines.length === 0 ? (
                <span className="px-1 py-2 text-[10px] text-muted-foreground/60">—</span>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
