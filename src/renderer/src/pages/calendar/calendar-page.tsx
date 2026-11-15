import { useCallback, useMemo, useState } from 'react'
import type { CalendarDeadline, CalendarTask } from '@shared/domain'
import { resolveSystemTimeZone, todayInZone } from '@shared/time'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { useCalendarActivity, useCalendarDayDetail } from '@/data/calendar-activity'
import { useCalendarTasks } from '@/data/calendar'
import {
  addDays,
  addMonths,
  formatMonthTitle,
  formatWeekTitle,
  monthGrid,
  weekDates
} from '@/lib/calendar'
import { useCommissionsUiStore } from '@/stores/commissions-ui-store'
import { useNavigationStore } from '@/stores/navigation-store'
import { CalendarDayDetail } from './calendar-day-detail'
import { MonthView, WeekView } from './calendar-views'
import { ScheduleSuggestionsPanel } from './schedule-suggestions-panel'
import { TaskScheduleSheet } from './task-schedule-sheet'
import { UnscheduledPanel } from './unscheduled-panel'

type ViewMode = 'month' | 'week'
type SideTab = 'unscheduled' | 'suggestions'
/** 右侧栏当前内容：原有「未安排 / 排期建议」，或选中日期后的当天详情。 */
type SidePane = 'panel' | 'detail'

const VIEW_OPTIONS = [
  { value: 'month' as const, label: '月' },
  { value: 'week' as const, label: '周' }
]

const SIDE_OPTIONS = [
  { value: 'unscheduled' as const, label: '未安排' },
  { value: 'suggestions' as const, label: '排期建议' }
]

interface CalendarPageProps {
  /** 测试或演示用：固定“今天” */
  today?: string
  /** 测试或演示用：初始锚点日期 */
  initialDate?: string
}

export function CalendarPage({ today: todayProp, initialDate }: CalendarPageProps = {}) {
  const today = useMemo(() => todayProp ?? todayInZone(resolveSystemTimeZone()), [todayProp])

  // 选中日期放在 navigation store：跳到任务/工时/委托再回来时仍然保留
  const storedDate = useNavigationStore((state) => state.calendarDate)
  const setCalendarDate = useNavigationStore((state) => state.setCalendarDate)
  const focusTask = useNavigationStore((state) => state.focusTask)
  const openTimeEntries = useNavigationStore((state) => state.openTimeEntries)
  const setActive = useNavigationStore((state) => state.setActive)

  const [anchor, setAnchor] = useState(initialDate ?? storedDate ?? today)
  const [view, setView] = useState<ViewMode>('month')
  const [sideTab, setSideTab] = useState<SideTab>('unscheduled')
  const [pane, setPane] = useState<SidePane>(storedDate ? 'detail' : 'panel')
  const [selected, setSelected] = useState<CalendarTask | null>(null)

  const selectedDate = storedDate

  const dates = useMemo(
    () => (view === 'month' ? monthGrid(anchor) : weekDates(anchor)),
    [view, anchor]
  )
  const from = dates[0] as string
  const to = dates[dates.length - 1] as string
  const calendar = useCalendarTasks(from, to)
  // 月视图一次请求整个网格区间，绝不为每个日期格子单独发 IPC
  const activity = useCalendarActivity(from, to)
  const dayDetail = useCalendarDayDetail(selectedDate)

  const activityByDate = useMemo(() => {
    const map = new Map<string, (typeof activity.days)[number]>()
    for (const day of activity.days) map.set(day.date, day)
    return map
  }, [activity.days])

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

  const selectDate = useCallback(
    (date: string) => {
      setCalendarDate(date)
      setPane('detail')
    },
    [setCalendarDate]
  )

  const closeDetail = useCallback(() => {
    setCalendarDate(null)
    setPane('panel')
  }, [setCalendarDate])

  const goTasks = useCallback(
    (taskId: string) => {
      focusTask(taskId)
      setActive('tasks')
    },
    [focusTask, setActive]
  )

  const goTime = useCallback(
    (options: { date: string; taskId?: string | null }) => {
      openTimeEntries({ from: options.date, to: options.date, taskId: options.taskId ?? null })
      setActive('time')
    },
    [openTimeEntries, setActive]
  )

  const goCommission = useCallback(
    (commissionId: string) => {
      const commissions = useCommissionsUiStore.getState()
      commissions.setTab('commissions')
      commissions.setSelectedId(commissionId)
      setActive('commissions')
    },
    [setActive]
  )

  const title = view === 'month' ? formatMonthTitle(anchor) : formatWeekTitle(from, to)
  const unit = view === 'month' ? '月' : '周'
  const summaryText =
    activity.status === 'loading' && activity.days.length === 0
      ? '正在读取创作记录…'
      : activity.days.length > 0
        ? `${calendar.data.scheduled.length} 个任务 · ${calendar.data.deadlines.length} 个截止 · ${activity.days.length} 天有创作记录`
        : `${calendar.data.scheduled.length} 个任务 · ${calendar.data.deadlines.length} 个截止`

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
            {calendar.status === 'loading' ? '正在读取日历…' : summaryText}
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

      {activity.status === 'error' ? (
        <div
          role="alert"
          data-testid="calendar-activity-error"
          className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          <span className="min-w-0 break-words">{activity.error ?? '创作记录读取失败'}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => activity.reload()}>
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
              activityByDate={activityByDate}
              selectedDate={selectedDate}
              onSelectDate={selectDate}
              onOpenTask={setSelected}
            />
          ) : (
            <WeekView
              dates={dates}
              anchor={anchor}
              today={today}
              tasksByDate={tasksByDate}
              deadlinesByDate={deadlinesByDate}
              activityByDate={activityByDate}
              selectedDate={selectedDate}
              onSelectDate={selectDate}
              onOpenTask={setSelected}
            />
          )}
        </div>

        <aside className="flex w-80 shrink-0 flex-col gap-2">
          {pane === 'detail' && selectedDate ? (
            <CalendarDayDetail
              date={selectedDate}
              status={dayDetail.status}
              detail={dayDetail.detail}
              error={dayDetail.error}
              summary={activityByDate.get(selectedDate)}
              plannedTasks={tasksByDate.get(selectedDate) ?? []}
              deadlines={deadlinesByDate.get(selectedDate) ?? []}
              onOpenTask={setSelected}
              onFocusTask={goTasks}
              onOpenTimeEntries={goTime}
              onOpenCommission={goCommission}
              onClose={closeDetail}
            />
          ) : (
            <>
              <Segmented
                ariaLabel="日历侧栏"
                value={sideTab}
                options={SIDE_OPTIONS}
                onChange={(next) => setSideTab(next)}
              />
              {sideTab === 'unscheduled' ? (
                <UnscheduledPanel items={calendar.data.unscheduled} onOpen={setSelected} />
              ) : (
                <ScheduleSuggestionsPanel
                  items={calendar.data.unscheduled}
                  today={today}
                  onOpen={setSelected}
                  onApplied={() => calendar.reload()}
                />
              )}
            </>
          )}
        </aside>
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
