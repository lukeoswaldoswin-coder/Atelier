import type { CalendarDeadline, CalendarTask } from '@shared/domain'
import { cn } from '@/lib/utils'
import { WEEKDAY_LABELS, formatDayNumber, isSameMonth, parseDateString } from '@/lib/calendar'
import { DeadlineBadge, TaskChip } from './calendar-chips'

interface ViewProps {
  dates: readonly string[]
  anchor: string
  today: string
  tasksByDate: ReadonlyMap<string, CalendarTask[]>
  deadlinesByDate: ReadonlyMap<string, CalendarDeadline[]>
  onOpenTask: (item: CalendarTask) => void
}

function DayCell({
  date,
  anchor,
  today,
  tasksByDate,
  deadlinesByDate,
  onOpenTask
}: ViewProps & { date: string }) {
  const tasks = tasksByDate.get(date) ?? []
  const deadlines = deadlinesByDate.get(date) ?? []
  const inMonth = isSameMonth(date, anchor)
  const isToday = date === today

  return (
    <div
      data-testid="calendar-day"
      data-date={date}
      className={cn(
        'min-h-24 border-r border-b border-border/60 p-1',
        inMonth ? 'bg-card' : 'bg-muted/20'
      )}
    >
      <div className="mb-1 flex items-center">
        <span
          className={cn(
            'flex size-5 items-center justify-center rounded-full text-[11px] tabular-nums',
            isToday && 'bg-primary font-medium text-primary-foreground',
            !inMonth && !isToday && 'text-muted-foreground/60'
          )}
        >
          {formatDayNumber(date)}
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
        const isToday = date === props.today
        const parts = parseDateString(date)

        return (
          <div
            key={date}
            data-testid="calendar-week-column"
            data-date={date}
            className="flex min-h-[380px] flex-col border-r border-border/60 last:border-r-0"
          >
            <div
              className={cn(
                'flex items-center justify-between border-b border-border/60 px-2 py-1.5',
                isToday && 'bg-primary/10'
              )}
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
