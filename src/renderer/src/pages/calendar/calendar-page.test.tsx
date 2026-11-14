import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CalendarDeadline, CalendarTask, CalendarTasksOutput } from '@shared/domain'
import { makeTask } from '@/test-utils/fixtures'
import { EMPTY_CALENDAR } from '@/data/calendar'
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

function installApi(tasks = vi.fn(async () => payload())) {
  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: {
      calendar: { tasks }
    }
  })
  return { tasks }
}

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
    expect(within(sheet).getByText('未安排')).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByTestId('sheet')).not.toBeInTheDocument())
  })

  it('空数据时显示零计数与空状态', async () => {
    installApi(vi.fn(async () => EMPTY_CALENDAR))
    renderCalendar()

    await waitFor(() => expect(screen.getByTestId('calendar-summary')).toHaveTextContent('0 个任务 · 0 个截止'))
    expect(screen.getByText('没有未安排的任务')).toBeInTheDocument()
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
