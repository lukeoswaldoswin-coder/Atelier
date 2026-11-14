import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CalendarTask, Deadline } from '@shared/domain'
import type { ScheduleApplyInput } from '@shared/scheduling'
import { ScheduleSuggestionsPanel } from './schedule-suggestions-panel'

const TODAY = '2026-11-14'

function makeItem(
  id: string,
  title: string,
  options: {
    estimatedMinutes?: number | null
    priority?: number
    deadline?: Deadline
    sortOrder?: number
  } = {}
): CalendarTask {
  return {
    task: {
      id,
      commissionId: '22222222-2222-4222-8222-222222222222',
      title,
      description: null,
      stage: 'draft',
      status: 'todo',
      estimatedMinutes:
        options.estimatedMinutes === undefined ? 90 : options.estimatedMinutes,
      plannedDate: null,
      sortOrder: options.sortOrder ?? 0,
      completedAt: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      archivedAt: null
    },
    commission: {
      id: '22222222-2222-4222-8222-222222222222',
      title: '猪猪熊熊讨薪大长篇',
      status: 'active',
      priority: options.priority ?? 3,
      deadline: options.deadline ?? { kind: 'date', date: '2026-11-20' }
    },
    clientName: '三狼'
  }
}

const ITEM_A = makeItem('11111111-1111-4111-8111-111111111111', '构图草稿')
const ITEM_B = makeItem('33333333-3333-4333-8333-333333333333', '上色', {
  priority: 2,
  estimatedMinutes: 180,
  deadline: { kind: 'date', date: '2026-11-16' },
  sortOrder: 1
})

function installApply(result = [{ taskId: ITEM_A.task.id, plannedDate: '2026-11-18' }]) {
  const apply = vi.fn(async (_input: ScheduleApplyInput) => ({ applied: result }))
  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: { schedule: { apply } }
  })
  return apply
}

afterEach(() => {
  Reflect.deleteProperty(window, 'atelier')
  document.body.style.pointerEvents = ''
  vi.restoreAllMocks()
})

describe('排期建议面板', () => {
  it('按顺序展示建议、紧急标签与理由，未勾选时不可采纳', () => {
    render(
      <ScheduleSuggestionsPanel
        items={[ITEM_A, ITEM_B]}
        today={TODAY}
        onOpen={vi.fn()}
        onApplied={vi.fn()}
      />
    )

    const items = screen.getAllByTestId('schedule-suggestion')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('上色')
    expect(items[1]).toHaveTextContent('构图草稿')
    expect(items[0]).toHaveTextContent('还剩 2 天')
    expect(items[1]).toHaveTextContent('本周截止')
    expect(screen.getByRole('button', { name: /采纳选中/ })).toBeDisabled()
  })

  it('勾选并修改日期后提交 taskId、日期与快照', async () => {
    const apply = installApply()
    const onApplied = vi.fn()
    const user = userEvent.setup()
    render(
      <ScheduleSuggestionsPanel
        items={[ITEM_A]}
        today={TODAY}
        onOpen={vi.fn()}
        onApplied={onApplied}
      />
    )

    await user.click(screen.getByLabelText('选择建议 构图草稿'))
    const dateInput = screen.getByLabelText('建议日期 构图草稿')
    expect(dateInput).toHaveValue('2026-11-18')

    await user.clear(dateInput)
    await user.type(dateInput, '2026-11-19')
    await user.click(screen.getByRole('button', { name: /采纳选中/ }))

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
    expect(apply.mock.calls[0]?.[0]).toEqual({
      items: [
        {
          taskId: ITEM_A.task.id,
          plannedDate: '2026-11-19',
          basis: {
            taskStatus: 'todo',
            estimatedMinutes: 90,
            commissionStatus: 'active',
            commissionPriority: 3,
            deadlineFingerprint: 'date:2026-11-20'
          }
        }
      ]
    })
    expect(await screen.findByRole('status')).toHaveTextContent('已安排 1 个任务')
    expect(onApplied).toHaveBeenCalledTimes(1)
  })

  it('全选后一次提交全部建议', async () => {
    const apply = installApply([
      { taskId: ITEM_A.task.id, plannedDate: '2026-11-18' },
      { taskId: ITEM_B.task.id, plannedDate: '2026-11-14' }
    ])
    const user = userEvent.setup()
    render(
      <ScheduleSuggestionsPanel
        items={[ITEM_A, ITEM_B]}
        today={TODAY}
        onOpen={vi.fn()}
        onApplied={vi.fn()}
      />
    )

    await user.click(screen.getByLabelText('全选建议'))
    expect(screen.getByRole('button', { name: /采纳选中（2）/ })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /采纳选中（2）/ }))

    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1))
    const payload = apply.mock.calls[0]?.[0]
    expect(payload?.items).toHaveLength(2)
    expect(await screen.findByRole('status')).toHaveTextContent('已安排 2 个任务')
  })

  it('过期建议被拒绝时展示错误、清空选择并刷新', async () => {
    const apply = vi.fn(async () => {
      throw new Error(
        "Error invoking remote method 'schedule:apply': Error: 「构图草稿」的建议依据已变化，已拒绝写入，请刷新建议后重试"
      )
    })
    Object.defineProperty(window, 'atelier', {
      configurable: true,
      value: { schedule: { apply } }
    })
    const onApplied = vi.fn()
    const user = userEvent.setup()
    render(
      <ScheduleSuggestionsPanel
        items={[ITEM_A]}
        today={TODAY}
        onOpen={vi.fn()}
        onApplied={onApplied}
      />
    )

    await user.click(screen.getByLabelText('选择建议 构图草稿'))
    await user.click(screen.getByRole('button', { name: /采纳选中/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('建议依据已变化')
    expect(onApplied).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('选择建议 构图草稿')).not.toBeChecked()
  })

  it('打开调整入口', async () => {
    const onOpen = vi.fn()
    const user = userEvent.setup()
    render(
      <ScheduleSuggestionsPanel
        items={[ITEM_A]}
        today={TODAY}
        onOpen={onOpen}
        onApplied={vi.fn()}
      />
    )

    await user.click(within(screen.getByTestId('schedule-suggestion')).getByRole('button', { name: '调整' }))
    expect(onOpen).toHaveBeenCalledWith(ITEM_A)
  })

  it('没有可建议任务时显示空状态', () => {
    render(
      <ScheduleSuggestionsPanel
        items={[]}
        today={TODAY}
        onOpen={vi.fn()}
        onApplied={vi.fn()}
      />
    )

    expect(screen.getByText('没有需要安排的任务。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /采纳选中/ })).toBeDisabled()
  })
})
