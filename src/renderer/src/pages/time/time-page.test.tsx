import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AssignableTask, TimeEntryView, TimeSummaryOutput } from '@shared/domain'
import { useTimeStore } from '@/stores/time-store'
import { TimePage } from './time-page'

const TASK: AssignableTask = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: '构图草稿',
  commissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  commissionTitle: '委托',
  clientName: '客户',
  status: 'todo',
  archivedAt: null
}

function makeEntry(overrides: {
  id: string
  taskId: string | null
  source: 'manual' | 'auto'
  startedAt: string
  endedAt: string
  seconds: number
  appKey?: string | null
}): TimeEntryView {
  return {
    entry: {
      id: overrides.id,
      taskId: overrides.taskId,
      source: overrides.source,
      status: 'completed',
      startedAt: overrides.startedAt,
      endedAt: overrides.endedAt,
      elapsedSeconds: overrides.seconds,
      lastHeartbeatAt: overrides.endedAt,
      appKey: overrides.appKey ?? null,
      mergedIntoId: null,
      note: null,
      clockSkewSeconds: 0,
      deletedAt: null,
      createdAt: overrides.startedAt,
      updatedAt: overrides.endedAt
    },
    task: overrides.taskId
      ? { id: TASK.id, title: TASK.title, stage: 'draft' }
      : null,
    commission: overrides.taskId
      ? { id: TASK.commissionId, title: TASK.commissionTitle, clientName: TASK.clientName }
      : null
  }
}

const manualEntry = makeEntry({
  id: '11111111-1111-4111-8111-111111111111',
  taskId: TASK.id,
  source: 'manual',
  startedAt: '2026-11-14T02:00:00.000Z',
  endedAt: '2026-11-14T02:10:00.000Z',
  seconds: 600
})

const autoEntry = makeEntry({
  id: '22222222-2222-4222-8222-222222222222',
  taskId: null,
  source: 'auto',
  startedAt: '2026-11-14T03:00:00.000Z',
  endedAt: '2026-11-14T03:05:00.000Z',
  seconds: 300,
  appKey: 'photoshop'
})

const SUMMARY: TimeSummaryOutput = {
  totalSeconds: 900,
  unassignedSeconds: 300,
  byDay: [{ date: '2026-11-14', seconds: 900 }],
  byTask: []
}

function installApi(overrides: {
  list?: ReturnType<typeof vi.fn>
  update?: ReturnType<typeof vi.fn>
  remove?: ReturnType<typeof vi.fn>
  merge?: ReturnType<typeof vi.fn>
} = {}) {
  const list = overrides.list ?? vi.fn(async () => [manualEntry, autoEntry])
  const summary = vi.fn(async () => SUMMARY)
  const update = overrides.update ?? vi.fn(async () => manualEntry)
  const assign = vi.fn(async () => manualEntry)
  const remove = overrides.remove ?? vi.fn(async () => true)
  const merge = overrides.merge ?? vi.fn(async () => manualEntry)

  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: {
      time: { list, summary, update, assign, remove, merge },
      tasks: { listAll: vi.fn(async () => [TASK]) }
    }
  })

  return { list, summary, update, remove, merge }
}

beforeEach(() => {
  useTimeStore.setState({ actionVersion: 0, status: null })
})

afterEach(() => {
  document.body.style.pointerEvents = ''
  Reflect.deleteProperty(window, 'atelier')
  vi.restoreAllMocks()
})

describe('工时记录页', () => {
  it('按天展示记录、来源与未分配提示', async () => {
    installApi()
    render(<TimePage today="2026-11-14" />)

    expect(await screen.findByText(/构图草稿/)).toBeInTheDocument()
    expect(screen.getAllByText('未分配').length).toBeGreaterThan(0)
    expect(screen.getByTestId('time-total')).toHaveTextContent('实际 15 分钟')
    expect(screen.getByTestId('unassigned-total')).toHaveTextContent('有 5 分钟')
    expect(screen.getAllByTestId('time-entry')).toHaveLength(2)
  })

  it('筛选未分配会重新查询', async () => {
    const { list } = installApi()
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    await screen.findByText(/构图草稿/)
    await user.click(screen.getByRole('radio', { name: '未分配' }))

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'unassigned' }))
    )
  })

  it('未分配记录可以归属到任务', async () => {
    const { update } = installApi()
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByText('未分配')
    const autoRow = screen.getAllByTestId('time-entry')[1] as HTMLElement
    await user.click(within(autoRow).getByRole('button', { name: '归属' }))

    const sheet = await screen.findByTestId('sheet')
    await user.selectOptions(within(sheet).getByLabelText('归属任务'), TASK.id)
    await user.click(within(sheet).getByRole('button', { name: '保存' }))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ id: autoEntry.entry.id, taskId: TASK.id })
      )
    )
  })

  it('删除记录需要确认并调用软删除', async () => {
    const { remove } = installApi()
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    const firstRow = (await screen.findAllByTestId('time-entry'))[0] as HTMLElement
    await user.click(within(firstRow).getByRole('button', { name: '删除' }))

    const dialog = await screen.findByTestId('confirm-dialog')
    await user.click(within(dialog).getByRole('button', { name: '删除' }))

    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ id: manualEntry.entry.id })
    )
  })

  it('合并同任务同来源的记录', async () => {
    const second = makeEntry({
      id: '33333333-3333-4333-8333-333333333333',
      taskId: TASK.id,
      source: 'manual',
      startedAt: '2026-11-14T04:00:00.000Z',
      endedAt: '2026-11-14T04:10:00.000Z',
      seconds: 600
    })
    const { merge } = installApi({ list: vi.fn(async () => [manualEntry, second]) })
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    const checkboxes = await screen.findAllByLabelText('选择工时记录')
    await user.click(checkboxes[0] as HTMLElement)
    await user.click(checkboxes[1] as HTMLElement)
    await user.click(screen.getByRole('button', { name: /合并/ }))

    await waitFor(() =>
      expect(merge).toHaveBeenCalledWith({
        ids: [manualEntry.entry.id, second.entry.id]
      })
    )
  })

  it('读取失败显示错误', async () => {
    installApi({
      list: vi.fn(async () => {
        throw new Error("Error invoking remote method 'time:list': Error: 工时读取失败")
      })
    })
    render(<TimePage today="2026-11-14" />)

    expect(await screen.findByText('工时读取失败')).toBeInTheDocument()
  })
})
