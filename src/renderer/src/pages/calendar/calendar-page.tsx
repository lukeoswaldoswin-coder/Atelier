import { useMemo, useState } from 'react'
import type { CalendarDeadline, CalendarTask } from '@shared/domain'
import { resolveSystemTimeZone, todayInZone } from '@shared/time'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { useCalendarTasks } from '@/data/calendar'
import { addDays, addMonths, formatMonthTitle, formatWeekTitle, monthGrid, weekDates } from '@/lib/calendar'
import { MonthView, WeekView } from './calendar-views'
import { TaskScheduleSheet } from './task-schedule-sheet'
import { UnscheduledPanel } from './unscheduled-panel'

type ViewMode = 'month' | 'week'

const VIEW_OPTIONS = [
  { value: 'month' as const, label: '月' },
  { value: 'week' as const, label: '周' }
]

interface CalendarPageProps {
  /** 测试或演示用：固定“今天” */
  today?: string
  /** 测试或演示用：初始锚点日期 */
  initialDate?: string
}

export function CalendarPage({ today: todayProp, initialDate }: CalendarPageProps = {}) {
  const today = useMemo(() => todayProp ?? todayInZone(resolveSystemTimeZone()), [todayProp])
  const [anchor, setAnchor] = useState(initialDate ?? today)
  const [view, setView] = useState<ViewMode>('month')
  const [selected, setSelected] = useState<CalendarTask | null>(null)

  const dates = useMemo(
    () => (view === 'month' ? monthGrid(anchor) : weekDates(anchor)),
    [view, anchor]
  )
  const from = dates[0] as string
  const to = dates[dates.length - 1] as string
  const calendar = useCalendarTasks(from, to)

  const tasksByDate = useMemo(() => {
    const map = new Map<string, CalendarTask[]>()
    for (const item of calendar.data.scheduled) {
      if (!item.task.plannedDate) continue
      const list = map.get(item.task.plannedDate) ?? []
      list.push(item)
      map.set(item.task.plannedDate, list)
    }
    return map
  }, [calendar.data.scheduled])

  const deadlinesByDate = useMemo(() => {
    const map = new Map<string, CalendarDeadline[]>()
    for (const item of calendar.data.deadlines) {
      const list = map.get(item.date) ?? []
      list.push(item)
      map.set(item.date, list)
    }
    return map
  }, [calendar.data.deadlines])

  const title = view === 'month' ? formatMonthTitle(anchor) : formatWeekTitle(from, to)
  const unit = view === 'month' ? '月' : '周'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAnchor(view === 'month' ? addMonths(anchor, -1) : addDays(anchor, -7))}
          >
            上一{unit}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAnchor(today)}>
            今天
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAnchor(view === 'month' ? addMonths(anchor, 1) : addDays(anchor, 7))}
          >
            下一{unit}
          </Button>
          <h2 className="ml-2 text-sm font-medium" data-testid="calendar-title">
            {title}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <p className="text-[11px] text-muted-foreground" data-testid="calendar-summary">
            {calendar.status === 'loading'
              ? '正在读取日历…'
              : `${calendar.data.scheduled.length} 个任务 · ${calendar.data.deadlines.length} 个截止`}
          </p>
          <Segmented
            ariaLabel="日历视图"
            value={view}
            options={VIEW_OPTIONS}
            onChange={(next) => setView(next)}
          />
        </div>
      </div>

      {calendar.status === 'error' ? (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <span className="min-w-0 break-words">{calendar.error ?? '日历读取失败'}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => calendar.reload()}>
            重试
          </Button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-w-0 flex-1 overflow-auto">
          {view === 'month' ? (
            <MonthView
              dates={dates}
              anchor={anchor}
              today={today}
              tasksByDate={tasksByDate}
              deadlinesByDate={deadlinesByDate}
              onOpenTask={setSelected}
            />
          ) : (
            <WeekView
              dates={dates}
              anchor={anchor}
              today={today}
              tasksByDate={tasksByDate}
              deadlinesByDate={deadlinesByDate}
              onOpenTask={setSelected}
            />
          )}
        </div>

        <UnscheduledPanel items={calendar.data.unscheduled} onOpen={setSelected} />
      </div>

      {selected ? (
        <TaskScheduleSheet
          key={selected.task.id}
          item={selected}
          today={today}
          onClose={() => setSelected(null)}
          onSaved={() => calendar.reload()}
        />
      ) : null}
    </div>
  )
}
