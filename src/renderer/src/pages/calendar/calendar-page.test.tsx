import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  CalendarActivitySummaryOutput,
  CalendarDayDetailOutput,
  CalendarDeadline,
  CalendarTask,
  CalendarTasksOutput
} from '@shared/domain'
import { makeTask } from '@/test-utils/fixtures'
import { EMPTY_CALENDAR } from '@/data/calendar'
import { useCommissionsUiStore } from '@/stores/commissions-ui-store'
import { useNavigationStore } from '@/stores/navigation-store'
import { CalendarPage } from './calendar-page'

const COMMISSION = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: '猪猪熊熊讨薪大长篇',
  status: 'active' as const,
  priority: 3,
  deadline: { kind: 'date' as const, date: '2026-03-10' }
}

function taskItem(
  id: string,
  title: string,
  plannedDate: string | null,
  status: 'todo' | 'doing' | 'done' = 'todo'
): CalendarTask {
  return {
    task: makeTask({
      id,
      commissionId: COMMISSION.id,
      title,
      plannedDate,
      status,
      completedAt: status === 'done' ? '2026-03-02T00:00:00.000Z' : null
    }),
    commission: COMMISSION,
    clientName: '三狼'
  }
}

const DEADLINE: CalendarDeadline = {
  commission: COMMISSION,
  clientName: '三狼',
  date: '2026-03-10',
  deadline: { kind: 'date', date: '2026-03-10' }
}

function payload(overrides: Partial<CalendarTasksOutput> = {}): CalendarTasksOutput {
  return {
    scheduled: [taskItem('11111111-1111-4111-8111-111111111111', '构图草稿', '2026-03-02')],
    unscheduled: [],
    deadlines: [DEADLINE],
    ...overrides
  }
}

function installApi(
  tasks = vi.fn(async () => payload()),
  update = vi.fn(async () => null),
  options: {
    activity?: ReturnType<typeof vi.fn>
    dayDetail?: ReturnType<typeof vi.fn>
  } = {}
) {
  const activity = options.activity ?? vi.fn(async (): Promise<CalendarActivitySummaryOutput> => ({ days: [] }))
  const dayDetail =
    options.dayDetail ?? vi.fn(async (): Promise<CalendarDayDetailOutput> => emptyDayDetail('2026-03-02'))

  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: {
      calendar: { tasks, activity, dayDetail },
      tasks: { update, listAll: vi.fn(async () => []) },
      time: { list: vi.fn(async () => []), summary: vi.fn(async () => null) }
    }
  })
  return { tasks, update, activity, dayDetail }
}

/** 没有任何创作记录的一天。 */
function emptyDayDetail(date: string): CalendarDayDetailOutput {
  return {
    date,
    totalSeconds: 0,
    unassignedSeconds: 0,
    tasks: [],
    unassignedEntryIds: [],
    commissions: []
  }
}

const TASK_ID = '11111111-1111-4111-8111-111111111111'

/** 2026-03-02 有 1 小时 35 分实际创作、推进 2 项任务、涉及 1 个委托。 */
const ACTIVITY_SUMMARY: CalendarActivitySummaryOutput = {
  days: [
    {
      date: '2026-03-02',
      seconds: 5700,
      taskCount: 2,
      commissionCount: 1,
      unassignedSeconds: 0
    }
  ]
}

const DAY_DETAIL: CalendarDayDetailOutput = {
  date: '2026-03-02',
  totalSeconds: 5700,
  unassignedSeconds: 0,
  tasks: [
    {
      taskId: TASK_ID,
      taskTitle: '构图草稿',
      taskStatus: 'doing',
      taskStage: 'draft',
      commissionId: COMMISSION.id,
      commissionTitle: COMMISSION.title,
      clientName: '三狼',
      seconds: 3600,
      entryIds: ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee']
    },
    {
      taskId: '55555555-5555-4555-8555-555555555555',
      taskTitle: '背景铺色',
      taskStatus: 'todo',
      taskStage: 'color',
      commissionId: COMMISSION.id,
      commissionTitle: COMMISSION.title,
      clientName: '三狼',
      seconds: 2100,
      entryIds: ['ffffffff-ffff-4fff-8fff-ffffffffffff']
    }
  ],
  unassignedEntryIds: [],
  commissions: [
    { id: COMMISSION.id, title: COMMISSION.title, clientName: '三狼', seconds: 5700 }
  ]
}

beforeEach(() => {
  useNavigationStore.setState({
    active: 'dashboard',
    calendarDate: null,
    focusTaskId: null,
    timeFilter: null
  })
  useCommissionsUiStore.setState({ tab: 'commissions', selectedId: null })
})

afterEach(() => {
  document.body.style.pointerEvents = ''
  Reflect.deleteProperty(window, 'atelier')
  vi.restoreAllMocks()
})

function renderCalendar() {
  return render(<CalendarPage today="2026-03-15" initialDate="2026-03-15" />)
}

function findDayCell(date: string): HTMLElement | null {
  return (
    screen
      .getAllByTestId('calendar-day')
      .find((cell) => cell.getAttribute('data-date') === date) ?? null
  )
}

describe('日历页：月视图', () => {
  it('渲染 42 个日期格、任务与委托截止分开显示', async () => {
    installApi()
    renderCalendar()

    expect(await screen.findByTestId('calendar-title')).toHaveTextContent('2026 年 3 月')
    expect(screen.getAllByTestId('calendar-day')).toHaveLength(42)
    expect(screen.getByText('周一')).toBeInTheDocument()
    expect(screen.getByText('周日')).toBeInTheDocument()

    await waitFor(() => expect(screen.getByTestId('calendar-summary')).toHaveTextContent('1 个任务 · 1 个截止'))

    await waitFor(() => expect(findDayCell('2026-03-02')).not.toBeNull())
    const taskCell = findDayCell('2026-03-02') as HTMLElement
    expect(within(taskCell).getByText('构图草稿')).toBeInTheDocument()

    const deadlineCell = findDayCell('2026-03-10') as HTMLElement
    expect(within(deadlineCell).getByTestId('calendar-deadline')).toHaveTextContent('猪猪熊熊讨薪大长篇')
    expect(within(deadlineCell).queryByTestId('calendar-task')).not.toBeInTheDocument()
  })

  it('已完成任务保留计划日期并带完成标记', async () => {
    const done = taskItem('22222222-2222-4222-8222-222222222222', '已完成任务', '2026-03-03', 'done')
    installApi(vi.fn(async () => payload({ scheduled: [done] })))
    renderCalendar()

    await waitFor(() => expect(findDayCell('2026-03-03')).not.toBeNull())
    const cell = findDayCell('2026-03-03') as HTMLElement
    const chip = within(cell).getByTestId('calendar-task')
    expect(chip).toHaveAttribute('data-done', 'true')
    expect(chip).toHaveTextContent('已完成任务')
  })

  it('月份导航会按新的网格范围重新查询', async () => {
    const { tasks } = installApi()
    const user = userEvent.setup()
    renderCalendar()

    await waitFor(() => expect(tasks).toHaveBeenCalled())
    await user.click(screen.getByRole('button', { name: '下一月' }))

    expect(screen.getByTestId('calendar-title')).toHaveTextContent('2026 年 4 月')
    await waitFor(() =>
      expect(tasks).toHaveBeenLastCalledWith({ from: '2026-03-30', to: '2026-05-10' })
    )
  })
})

describe('日历页：周视图与未安排', () => {
  it('切换到周视图显示 7 天并查询对应范围', async () => {
    const { tasks } = installApi()
    const user = userEvent.setup()
    renderCalendar()

    await waitFor(() => expect(tasks).toHaveBeenCalled())
    await user.click(screen.getByRole('radio', { name: '周' }))

    expect(screen.getByTestId('calendar-week')).toBeInTheDocument()
    expect(screen.getAllByTestId('calendar-week-column')).toHaveLength(7)
    expect(screen.getByTestId('calendar-title')).toHaveTextContent('3 月 9 日 – 15 日')
    await waitFor(() =>
      expect(tasks).toHaveBeenLastCalledWith({ from: '2026-03-09', to: '2026-03-15' })
    )
  })

  it('未安排任务列表展示任务，点击打开详情', async () => {
    const unscheduled = taskItem('33333333-3333-4333-8333-333333333333', '还没排的任务', null)
    installApi(vi.fn(async () => payload({ scheduled: [], deadlines: [], unscheduled: [unscheduled] })))
    const user = userEvent.setup()
    renderCalendar()

    const item = await screen.findByTestId('unscheduled-item')
    expect(item).toHaveTextContent('还没排的任务')
    expect(screen.getByTestId('unscheduled-panel')).toHaveTextContent('未完成、未归档')

    await user.click(item)

    const sheet = await screen.findByTestId('sheet')
    expect(within(sheet).getByText('还没排的任务')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('计划日期')).toHaveValue('')

    await user.click(within(sheet).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByTestId('sheet')).not.toBeInTheDocument())
  })

  it('切换到排期建议页签并显示未安排任务的建议', async () => {
    const unscheduled = taskItem('33333333-3333-4333-8333-333333333333', '还没排的任务', null)
    installApi(
      vi.fn(async () => payload({ scheduled: [], deadlines: [], unscheduled: [unscheduled] }))
    )
    const user = userEvent.setup()
    renderCalendar()

    await user.click(await screen.findByRole('radio', { name: '排期建议' }))

    expect(screen.getByTestId('schedule-suggestions-panel')).toBeInTheDocument()
    expect(screen.getByTestId('schedule-suggestion')).toHaveTextContent('还没排的任务')
    expect(screen.getByTestId('schedule-suggestion')).toHaveTextContent('已逾期 5 天')
    expect(screen.queryByTestId('unscheduled-panel')).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: '未安排' }))
    expect(screen.getByTestId('unscheduled-panel')).toBeInTheDocument()
  })

  it('周视图在对应日期显示任务与截止，时刻型截止带创建时区时间', async () => {
    const item = taskItem('44444444-4444-4444-8444-444444444444', '周任务', '2026-03-11')
    const deadline: CalendarDeadline = {
      commission: {
        ...COMMISSION,
        deadline: { kind: 'datetime', at: '2026-03-10T10:00:00.000Z', timeZone: 'Asia/Shanghai' }
      },
      clientName: '三狼',
      date: '2026-03-10',
      deadline: { kind: 'datetime', at: '2026-03-10T10:00:00.000Z', timeZone: 'Asia/Shanghai' }
    }
    installApi(
      vi.fn(async () => payload({ scheduled: [item], deadlines: [deadline], unscheduled: [] }))
    )
    const user = userEvent.setup()
    renderCalendar()

    await user.click(screen.getByRole('radio', { name: '周' }))
    await waitFor(() => expect(screen.getAllByTestId('calendar-week-column')).toHaveLength(7))

    const column = (date: string) =>
      screen
        .getAllByTestId('calendar-week-column')
        .find((element) => element.getAttribute('data-date') === date) as HTMLElement

    await waitFor(() =>
      expect(within(column('2026-03-11')).queryByTestId('calendar-task')).not.toBeNull()
    )
    expect(within(column('2026-03-11')).getByTestId('calendar-task')).toHaveTextContent('周任务')

    const deadlineColumn = column('2026-03-10')
    expect(within(deadlineColumn).getByTestId('calendar-deadline')).toHaveTextContent('18:00')
    expect(within(deadlineColumn).queryByTestId('calendar-task')).toBeNull()
  })

  it('空数据时显示零计数与空状态', async () => {
    installApi(vi.fn(async () => EMPTY_CALENDAR))
    renderCalendar()

    await waitFor(() => expect(screen.getByTestId('calendar-summary')).toHaveTextContent('0 个任务 · 0 个截止'))
    expect(screen.getByText('没有未安排的任务')).toBeInTheDocument()
  })
})

describe('日历页：手动排期', () => {
  it('从未安排任务安排日期，保存后刷新并关闭面板', async () => {
    const unscheduled = taskItem('33333333-3333-4333-8333-333333333333', '待安排', null)
    const tasks = vi.fn(async () => payload({ scheduled: [], deadlines: [], unscheduled: [unscheduled] }))
    const { update } = installApi(tasks)
    const user = userEvent.setup()
    renderCalendar()

    await user.click(await screen.findByTestId('unscheduled-item'))
    fireEvent.change(screen.getByLabelText('计划日期'), { target: { value: '2026-03-05' } })
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        id: unscheduled.task.id,
        plannedDate: '2026-03-05'
      })
    )
    await waitFor(() => expect(screen.queryByTestId('sheet')).not.toBeInTheDocument())
    expect(tasks.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('修改已有计划日期', async () => {
    const item = taskItem('11111111-1111-4111-8111-111111111111', '构图草稿', '2026-03-02')
    const { update } = installApi(vi.fn(async () => payload({ scheduled: [item] })))
    const user = userEvent.setup()
    renderCalendar()

    await user.click(await screen.findByTestId('calendar-task'))
    const input = screen.getByLabelText('计划日期')
    expect(input).toHaveValue('2026-03-02')

    fireEvent.change(input, { target: { value: '2026-03-06' } })
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ id: item.task.id, plannedDate: '2026-03-06' })
    )
  })

  it('清除计划日期后从日历移除', async () => {
    const item = taskItem('11111111-1111-4111-8111-111111111111', '构图草稿', '2026-03-02')
    const { update } = installApi(vi.fn(async () => payload({ scheduled: [item] })))
    const user = userEvent.setup()
    renderCalendar()

    await user.click(await screen.findByTestId('calendar-task'))
    await user.click(screen.getByRole('button', { name: '清除计划' }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ id: item.task.id, plannedDate: null })
    )
  })

  it('查看委托会跳到委托详情', async () => {
    const item = taskItem('11111111-1111-4111-8111-111111111111', '构图草稿', '2026-03-02')
    installApi(vi.fn(async () => payload({ scheduled: [item] })))
    const user = userEvent.setup()
    renderCalendar()

    await user.click(await screen.findByTestId('calendar-task'))
    await user.click(screen.getByRole('button', { name: '查看委托' }))

    expect(useNavigationStore.getState().active).toBe('commissions')
    expect(useCommissionsUiStore.getState().selectedId).toBe(COMMISSION.id)
    await waitFor(() => expect(screen.queryByTestId('sheet')).not.toBeInTheDocument())
  })

  it('过去日期给出补录提示', async () => {
    const item = taskItem('11111111-1111-4111-8111-111111111111', '构图草稿', '2026-03-02')
    installApi(vi.fn(async () => payload({ scheduled: [item] })))
    const user = userEvent.setup()
    renderCalendar()

    await user.click(await screen.findByTestId('calendar-task'))
    expect(screen.getByText('这是过去日期，仅用于补录。')).toBeInTheDocument()
  })

  it('保存失败显示可读错误并保持面板打开', async () => {
    const item = taskItem('11111111-1111-4111-8111-111111111111', '构图草稿', '2026-03-02')
    const update = vi.fn(async () => {
      throw new Error("Error invoking remote method 'tasks:update': Error: 计划日期无效")
    })
    installApi(vi.fn(async () => payload({ scheduled: [item] })), update)
    const user = userEvent.setup()
    renderCalendar()

    await user.click(await screen.findByTestId('calendar-task'))
    fireEvent.change(screen.getByLabelText('计划日期'), { target: { value: '2026-03-06' } })
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('计划日期无效')).toBeInTheDocument()
    expect(screen.getByTestId('sheet')).toBeInTheDocument()
  })
})

describe('日历页：错误处理', () => {
  it('读取失败显示可读错误并可重试', async () => {
    const tasks = vi
      .fn<() => Promise<CalendarTasksOutput>>()
      .mockRejectedValueOnce(new Error('Error invoking remote method: 日历查询失败'))
      .mockResolvedValueOnce(payload())
    installApi(tasks)
    const user = userEvent.setup()
    renderCalendar()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('日历查询失败')

    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('构图草稿')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('日历页：每日创作摘要', () => {
  it('有工时记录的日期显示实际工时与推进任务数', async () => {
    installApi(undefined, undefined, {
      activity: vi.fn(async () => ACTIVITY_SUMMARY),
      dayDetail: vi.fn(async () => DAY_DETAIL)
    })
    renderCalendar()

    const cell = await waitFor(() => {
      const found = findDayCell('2026-03-02')
      expect(found).not.toBeNull()
      return found as HTMLElement
    })

    await waitFor(() =>
      expect(within(cell).getByTestId('calendar-day-hours')).toHaveTextContent('1 小时 35 分')
    )
    expect(within(cell).getByTestId('calendar-day-tasks')).toHaveTextContent('推进 2 项')
    expect(within(cell).getByTestId('calendar-day-activity-mark')).toBeInTheDocument()
    expect(cell).toHaveAttribute('data-has-activity', 'true')
  })

  it('无工时记录的日期不显示任何工时数字', async () => {
    installApi(undefined, undefined, { activity: vi.fn(async () => ACTIVITY_SUMMARY) })
    renderCalendar()

    await waitFor(() => expect(findDayCell('2026-03-02')).not.toBeNull())
    // 2026-03-05 没有任何创作记录
    const blank = findDayCell('2026-03-05') as HTMLElement
    expect(within(blank).queryByTestId('calendar-day-hours')).not.toBeInTheDocument()
    expect(within(blank).queryByTestId('calendar-day-tasks')).not.toBeInTheDocument()
    expect(within(blank).queryByTestId('calendar-day-activity-mark')).not.toBeInTheDocument()
    expect(blank).not.toHaveAttribute('data-has-activity')
    // 绝不能出现「0 小时」「0 分钟」「0 秒」这类假数字
    expect(blank).not.toHaveTextContent(/0 小时|0 分钟|0 秒/)
  })

  it('月视图只发一次区间请求，不为每个日期格单独发 IPC', async () => {
    const { activity } = installApi(undefined, undefined, {
      activity: vi.fn(async () => ACTIVITY_SUMMARY)
    })
    renderCalendar()

    await waitFor(() => expect(activity).toHaveBeenCalled())
    await waitFor(() => expect(findDayCell('2026-03-02')).not.toBeNull())

    expect(activity).toHaveBeenCalledTimes(1)
    expect(activity).toHaveBeenCalledWith({ from: '2026-02-23', to: '2026-04-05' })
  })

  it('创作记录读取失败不影响日历既有功能，并可重试', async () => {
    const activity = vi
      .fn<() => Promise<CalendarActivitySummaryOutput>>()
      .mockRejectedValueOnce(new Error('Error invoking remote method: 工时聚合失败'))
      .mockResolvedValueOnce(ACTIVITY_SUMMARY)
    installApi(undefined, undefined, { activity })
    const user = userEvent.setup()
    renderCalendar()

    expect(await screen.findByTestId('calendar-activity-error')).toHaveTextContent('工时聚合失败')
    // 日历本体仍然可用
    expect(findDayCell('2026-03-02')).not.toBeNull()

    await user.click(within(screen.getByTestId('calendar-activity-error')).getByRole('button', { name: '重试' }))

    await waitFor(() =>
      expect(screen.queryByTestId('calendar-activity-error')).not.toBeInTheDocument()
    )
  })
})

describe('日历页：当天详情面板', () => {
  it('点击日期出现详情面板并显示当天任务', async () => {
    const { dayDetail } = installApi(undefined, undefined, {
      activity: vi.fn(async () => ACTIVITY_SUMMARY),
      dayDetail: vi.fn(async () => DAY_DETAIL)
    })
    const user = userEvent.setup()
    renderCalendar()

    await waitFor(() => expect(findDayCell('2026-03-02')).not.toBeNull())
    await user.click(within(findDayCell('2026-03-02') as HTMLElement).getByTestId('calendar-day-select'))

    const panel = await screen.findByTestId('calendar-day-detail')
    expect(panel).toHaveAttribute('data-date', '2026-03-02')
    await waitFor(() => expect(dayDetail).toHaveBeenCalledWith({ date: '2026-03-02' }))

    // A 当天统计
    await waitFor(() =>
      expect(screen.getByTestId('day-detail-total')).toHaveTextContent('1 小时 35 分')
    )
    expect(screen.getByTestId('day-detail-task-count')).toHaveTextContent('2 项')
    expect(screen.getByTestId('day-detail-commission-count')).toHaveTextContent('1 个')

    // B 当天创作记录（按任务）
    const rows = screen.getAllByTestId('day-detail-task')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('构图草稿')
    expect(rows[0]).toHaveTextContent('猪猪熊熊讨薪大长篇')
    expect(rows[0]).toHaveTextContent('三狼')
    expect(rows[0]).toHaveTextContent('1 小时')
    expect(rows[0]).toHaveTextContent('进行中')

    // D 当天计划安排与实际创作分区展示
    expect(screen.getByTestId('day-detail-plan')).toBeInTheDocument()
    expect(screen.getByTestId('day-detail-actual')).toBeInTheDocument()
    expect(within(screen.getByTestId('day-detail-plan')).getByTestId('calendar-task')).toHaveTextContent(
      '构图草稿'
    )
  })

  it('没有创作记录的日期不显示虚假工时数字', async () => {
    installApi(undefined, undefined, {
      activity: vi.fn(async () => ({ days: [] })),
      dayDetail: vi.fn(async () => emptyDayDetail('2026-03-05'))
    })
    const user = userEvent.setup()
    renderCalendar()

    await waitFor(() => expect(findDayCell('2026-03-05')).not.toBeNull())
    await user.click(within(findDayCell('2026-03-05') as HTMLElement).getByTestId('calendar-day-select'))

    await screen.findByTestId('calendar-day-detail')
    await waitFor(() =>
      expect(screen.getByTestId('day-detail-empty')).toHaveTextContent('这一天还没有实际创作记录')
    )
    // 统计区不得出现 0 小时 / 0 分钟
    expect(screen.queryByTestId('day-detail-total')).not.toBeInTheDocument()
    expect(screen.getByTestId('day-detail-stats')).not.toHaveTextContent(/0 小时|0 分钟|0 秒/)
    expect(screen.getByTestId('day-detail-unassigned')).not.toHaveTextContent(/0 小时|0 分钟/)
  })

  it('未关联任务工时单独成区并可跳到工时记录页', async () => {
    installApi(undefined, undefined, {
      activity: vi.fn(async () => ({
        days: [
          {
            date: '2026-03-02',
            seconds: 5700,
            taskCount: 2,
            commissionCount: 1,
            unassignedSeconds: 900
          }
        ]
      })),
      dayDetail: vi.fn(async () => ({
        ...DAY_DETAIL,
        unassignedSeconds: 900,
        unassignedEntryIds: ['99999999-9999-4999-8999-999999999999']
      }))
    })
    const user = userEvent.setup()
    renderCalendar()

    await waitFor(() => expect(findDayCell('2026-03-02')).not.toBeNull())
    await user.click(within(findDayCell('2026-03-02') as HTMLElement).getByTestId('calendar-day-select'))

    const unassigned = await screen.findByTestId('day-detail-unassigned')
    await waitFor(() => expect(unassigned).toHaveTextContent('15 分钟'))
    expect(unassigned).toHaveTextContent('1 条记录')

    await user.click(within(unassigned).getByRole('button', { name: '去工时记录页归属' }))

    expect(useNavigationStore.getState().active).toBe('time')
    expect(useNavigationStore.getState().timeFilter).toEqual({
      from: '2026-03-02',
      to: '2026-03-02',
      taskId: null
    })
  })
})

describe('日历页：跨模块跳转', () => {
  async function openDetail() {
    const user = userEvent.setup()
    const api = installApi(undefined, undefined, {
      activity: vi.fn(async () => ACTIVITY_SUMMARY),
      dayDetail: vi.fn(async () => DAY_DETAIL)
    })
    renderCalendar()

    await waitFor(() => expect(findDayCell('2026-03-02')).not.toBeNull())
    await user.click(within(findDayCell('2026-03-02') as HTMLElement).getByTestId('calendar-day-select'))
    await screen.findByTestId('calendar-day-detail')
    return { user, api }
  }

  it('点击任务跳转到绘画任务页并定位该任务', async () => {
    const { user } = await openDetail()

    const row = screen.getAllByTestId('day-detail-task')[0] as HTMLElement
    await user.click(within(row).getByRole('button', { name: '定位任务' }))

    expect(useNavigationStore.getState().active).toBe('tasks')
    expect(useNavigationStore.getState().focusTaskId).toBe(TASK_ID)
    // 选中日期保留，回到日历时仍在同一天
    expect(useNavigationStore.getState().calendarDate).toBe('2026-03-02')
  })

  it('点击工时跳转到工时记录页并带上当天日期与任务筛选', async () => {
    const { user } = await openDetail()

    const row = screen.getAllByTestId('day-detail-task')[0] as HTMLElement
    await user.click(within(row).getByRole('button', { name: '查看工时' }))

    expect(useNavigationStore.getState().active).toBe('time')
    expect(useNavigationStore.getState().timeFilter).toEqual({
      from: '2026-03-02',
      to: '2026-03-02',
      taskId: TASK_ID
    })
  })

  it('点击委托跳转到委托管理页并打开该委托详情', async () => {
    const { user } = await openDetail()

    const row = screen.getAllByTestId('day-detail-task')[0] as HTMLElement
    await user.click(within(row).getByRole('button', { name: '查看委托' }))

    expect(useNavigationStore.getState().active).toBe('commissions')
    expect(useCommissionsUiStore.getState().tab).toBe('commissions')
    expect(useCommissionsUiStore.getState().selectedId).toBe(COMMISSION.id)
    expect(useNavigationStore.getState().calendarDate).toBe('2026-03-02')
  })

  it('关闭详情面板后回到未安排面板，且不残留选中日期', async () => {
    const { user } = await openDetail()

    await user.click(within(screen.getByTestId('calendar-day-detail')).getByRole('button', { name: '关闭' }))

    await waitFor(() =>
      expect(screen.queryByTestId('calendar-day-detail')).not.toBeInTheDocument()
    )
    expect(screen.getByTestId('unscheduled-panel')).toBeInTheDocument()
    expect(useNavigationStore.getState().calendarDate).toBeNull()
  })
})
