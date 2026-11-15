import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
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

const unassignedAuto2 = makeEntry({
  id: '44444444-4444-4444-8444-444444444444',
  taskId: null,
  source: 'auto',
  startedAt: '2026-11-14T05:00:00.000Z',
  endedAt: '2026-11-14T05:05:00.000Z',
  seconds: 300,
  appKey: 'photoshop'
})

const assignedManual2 = makeEntry({
  id: '55555555-5555-4555-8555-555555555555',
  taskId: TASK.id,
  source: 'manual',
  startedAt: '2026-11-14T06:00:00.000Z',
  endedAt: '2026-11-14T06:10:00.000Z',
  seconds: 600
})

const allRows = [manualEntry, autoEntry, unassignedAuto2, assignedManual2]

function stubRect(el: Element, top: number, bottom: number, left = 0, right = 400): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top,
      bottom,
      left,
      right,
      width: right - left,
      height: bottom - top,
      x: left,
      y: top,
      toJSON: () => ({})
    })
  })
}

function stubRowRects(): void {
  const rows = screen.getAllByTestId('time-entry')
  stubRect(rows[0] as HTMLElement, 0, 40)
  stubRect(rows[1] as HTMLElement, 50, 90)
  stubRect(rows[2] as HTMLElement, 100, 140)
  stubRect(rows[3] as HTMLElement, 150, 190)
}

function checkboxes(): HTMLInputElement[] {
  return screen.getAllByLabelText('选择工时记录') as HTMLInputElement[]
}

function checkedIds(rows: TimeEntryView[]): string[] {
  const boxes = checkboxes()
  return rows.filter((_, index) => boxes[index]?.checked).map((row) => row.entry.id)
}

describe('工时记录批量选择', () => {
  it('全选未分配只选中未分配记录', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    await user.click(screen.getByRole('button', { name: '全选未分配' }))

    expect(checkedIds(allRows)).toEqual([autoEntry.entry.id, unassignedAuto2.entry.id])
  })

  it('筛选未分配时全选当前查询结果，切回全部也不选中已归属记录', async () => {
    const unassignedOnly = [autoEntry, unassignedAuto2]
    const list = vi.fn(async (input: { filter: string }) =>
      input.filter === 'unassigned' ? unassignedOnly : allRows
    )
    installApi({ list })
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    await user.click(screen.getByRole('radio', { name: '未分配' }))
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'unassigned' }))
    )

    await user.click(screen.getByRole('button', { name: '全选未分配' }))
    expect(checkedIds(unassignedOnly)).toEqual([autoEntry.entry.id, unassignedAuto2.entry.id])

    await user.click(screen.getByRole('radio', { name: '全部' }))
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'all' }))
    )
    // 切回全部后仍是全选状态，先取消再重新全选
    await user.click(screen.getByRole('button', { name: '取消全选' }))
    expect(checkedIds(allRows)).toEqual([])
    await user.click(screen.getByRole('button', { name: '全选未分配' }))
    expect(checkedIds(allRows)).toEqual([autoEntry.entry.id, unassignedAuto2.entry.id])
  })

  it('没有未分配记录时全选按钮禁用', async () => {
    installApi({ list: vi.fn(async () => [manualEntry, assignedManual2]) })
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    expect(screen.getByRole('button', { name: '全选未分配' })).toBeDisabled()
  })

  it('全选后可以继续合并未分配记录', async () => {
    const merge = vi.fn(async () => autoEntry)
    installApi({ list: vi.fn(async () => allRows), merge })
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    await user.click(screen.getByRole('button', { name: '全选未分配' }))
    await user.click(screen.getByRole('button', { name: /合并/ }))

    await waitFor(() =>
      expect(merge).toHaveBeenCalledWith({ ids: [autoEntry.entry.id, unassignedAuto2.entry.id] })
    )
  })

  it('拖拽框选只选中相交的未分配记录，并与复选框状态一致', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    stubRowRects()

    const list = screen.getByTestId('time-list')
    fireEvent.pointerDown(list, { button: 0, clientX: 10, clientY: 45 })
    fireEvent.pointerMove(window, { clientX: 200, clientY: 95, buttons: 1 })

    expect(screen.getByTestId('marquee-box')).toBeInTheDocument()
    expect(checkedIds(allRows)).toEqual([autoEntry.entry.id])

    fireEvent.pointerUp(window, { clientX: 200, clientY: 95 })
    expect(screen.queryByTestId('marquee-box')).not.toBeInTheDocument()
    expect(checkedIds(allRows)).toEqual([autoEntry.entry.id])
  })

  it('框选不会选中已归属记录', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    stubRowRects()

    const list = screen.getByTestId('time-list')
    fireEvent.pointerDown(list, { button: 0, clientX: 10, clientY: 5 })
    fireEvent.pointerMove(window, { clientX: 200, clientY: 200, buttons: 1 })

    // 矩形覆盖全部 4 条，其中 2 条已归属，只有未分配的 2 条进入选择。
    expect(checkedIds(allRows)).toEqual([autoEntry.entry.id, unassignedAuto2.entry.id])

    fireEvent.pointerUp(window, { clientX: 200, clientY: 200 })
    expect(checkedIds(allRows)).toEqual([autoEntry.entry.id, unassignedAuto2.entry.id])
  })

  it('点击复选框、归属、编辑、删除按钮都不会启动框选', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    stubRowRects()

    const rows = screen.getAllByTestId('time-entry') as HTMLElement[]
    const targets = [
      within(rows[1] as HTMLElement).getByLabelText('选择工时记录'),
      within(rows[0] as HTMLElement).getByRole('button', { name: '编辑' }),
      within(rows[1] as HTMLElement).getByRole('button', { name: '归属' }),
      within(rows[0] as HTMLElement).getByRole('button', { name: '删除' })
    ]

    for (const target of targets) {
      fireEvent.pointerDown(target, { button: 0, clientX: 10, clientY: 5 })
      fireEvent.pointerMove(window, { clientX: 200, clientY: 200, buttons: 1 })
      expect(screen.queryByTestId('marquee-box')).not.toBeInTheDocument()
      fireEvent.pointerUp(window, { clientX: 200, clientY: 200 })
    }

    // 复选框本身的点击行为保持不变。
    await user.click(within(rows[1] as HTMLElement).getByLabelText('选择工时记录'))
    expect(checkedIds(allRows)).toEqual([autoEntry.entry.id])
  })

  it('框选结果可以直接用于批量合并', async () => {
    const merge = vi.fn(async () => autoEntry)
    installApi({ list: vi.fn(async () => allRows), merge })
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    stubRowRects()

    const list = screen.getByTestId('time-list')
    fireEvent.pointerDown(list, { button: 0, clientX: 10, clientY: 45 })
    fireEvent.pointerMove(window, { clientX: 200, clientY: 140, buttons: 1 })
    fireEvent.pointerUp(window, { clientX: 200, clientY: 140 })

    await user.click(screen.getByRole('button', { name: /合并/ }))
    await waitFor(() =>
      expect(merge).toHaveBeenCalledWith({ ids: [autoEntry.entry.id, unassignedAuto2.entry.id] })
    )
  })

  it('轻微拖动不产生框选，不改变选择', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    stubRowRects()

    const list = screen.getByTestId('time-list')
    fireEvent.pointerDown(list, { button: 0, clientX: 10, clientY: 45 })
    fireEvent.pointerMove(window, { clientX: 12, clientY: 46, buttons: 1 })
    expect(screen.queryByTestId('marquee-box')).not.toBeInTheDocument()
    fireEvent.pointerUp(window, { clientX: 12, clientY: 46 })

    expect(checkedIds(allRows)).toEqual([])
  })

  it('鼠标在窗口外松开时框选正常结束', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    stubRowRects()

    const list = screen.getByTestId('time-list')
    fireEvent.pointerDown(list, { button: 0, clientX: 10, clientY: 5 })
    fireEvent.pointerMove(window, { clientX: 200, clientY: 60, buttons: 1 })
    expect(screen.getByTestId('marquee-box')).toBeInTheDocument()

    // 窗口外松开：后续 pointermove 的 buttons 为 0，据此收尾。
    fireEvent.pointerMove(window, { clientX: 200, clientY: 60, buttons: 0 })
    expect(screen.queryByTestId('marquee-box')).not.toBeInTheDocument()
    expect(checkedIds(allRows)).toEqual([autoEntry.entry.id])
  })

  it('从时间文字上按下并拖动可以启动框选', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    stubRowRects()

    const rows = screen.getAllByTestId('time-entry') as HTMLElement[]
    // 时间文字（如 "09:00 – 09:05"）所在的 span
    const timeText = within(rows[0] as HTMLElement).getByText(/\d{2}:\d{2}/)
    fireEvent.pointerDown(timeText, { button: 0, clientX: 10, clientY: 5 })
    fireEvent.pointerMove(window, { clientX: 200, clientY: 60, buttons: 1 })

    expect(screen.getByTestId('marquee-box')).toBeInTheDocument()
    fireEvent.pointerUp(window, { clientX: 200, clientY: 60 })
    expect(checkedIds(allRows)).toEqual([autoEntry.entry.id])
  })

  it('从工时长度文字上按下并拖动可以启动框选', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    stubRowRects()

    const rows = screen.getAllByTestId('time-entry') as HTMLElement[]
    // 工时长度文字（如 "10 分钟"）
    const durationText = within(rows[0] as HTMLElement).getByText(/^\d+ 分钟$/)
    fireEvent.pointerDown(durationText, { button: 0, clientX: 10, clientY: 5 })
    fireEvent.pointerMove(window, { clientX: 200, clientY: 60, buttons: 1 })

    expect(screen.getByTestId('marquee-box')).toBeInTheDocument()
    fireEvent.pointerUp(window, { clientX: 200, clientY: 60 })
    expect(checkedIds(allRows)).toEqual([autoEntry.entry.id])
  })

  it('从记录卡片内的普通文本按下并拖动可以启动框选', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    stubRowRects()

    const rows = screen.getAllByTestId('time-entry') as HTMLElement[]
    const noteText = within(rows[1] as HTMLElement).getAllByText('未分配')[0] as HTMLElement
    fireEvent.pointerDown(noteText, { button: 0, clientX: 10, clientY: 55 })
    fireEvent.pointerMove(window, { clientX: 200, clientY: 100, buttons: 1 })

    expect(screen.getByTestId('marquee-box')).toBeInTheDocument()
    fireEvent.pointerUp(window, { clientX: 200, clientY: 100 })
    expect(checkedIds(allRows)).toEqual([autoEntry.entry.id, unassignedAuto2.entry.id])
  })

  it('列表区域禁用文本选择，避免拖拽时选中文字', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    expect(screen.getByTestId('time-list').className).toContain('select-none')
  })

  it('全选按钮第一次点击全选，第二次点击取消全部选择', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')

    // 状态 A：显示「全选未分配」
    await user.click(screen.getByRole('button', { name: '全选未分配' }))
    expect(checkedIds(allRows)).toEqual([autoEntry.entry.id, unassignedAuto2.entry.id])

    // 状态 B：已全部选中，按钮变「取消全选」
    await user.click(screen.getByRole('button', { name: '取消全选' }))
    expect(checkedIds(allRows)).toEqual([])
    expect(screen.getByRole('button', { name: '全选未分配' })).toBeInTheDocument()
  })

  it('部分选中时按钮仍显示「全选未分配」', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    const boxes = checkboxes()
    await user.click(boxes[1] as HTMLElement)

    expect(screen.getByRole('button', { name: '全选未分配' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '取消全选' })).not.toBeInTheDocument()
  })

  it('已归属记录不参与全选判定，按钮状态只看未分配记录', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    // 手动勾上一条已归属记录，未分配仍未全选
    const rows = screen.getAllByTestId('time-entry') as HTMLElement[]
    await user.click(within(rows[0] as HTMLElement).getByLabelText('选择工时记录'))
    expect(screen.getByRole('button', { name: '全选未分配' })).toBeInTheDocument()
  })

  it('切换筛选后按钮状态按当前结果重新计算', async () => {
    const unassignedOnly = [autoEntry, unassignedAuto2]
    const list = vi.fn(async (input: { filter: string }) =>
      input.filter === 'unassigned' ? unassignedOnly : allRows
    )
    installApi({ list })
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    await user.click(screen.getByRole('button', { name: '全选未分配' }))
    expect(screen.getByRole('button', { name: '取消全选' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: '未分配' }))
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'unassigned' }))
    )
    // 当前筛选结果仍全部选中
    expect(screen.getByRole('button', { name: '取消全选' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '取消全选' }))
    expect(checkedIds(unassignedOnly)).toEqual([])
    expect(screen.getByRole('button', { name: '全选未分配' })).toBeInTheDocument()
  })

  it('切换日期范围后按钮状态正确', async () => {
    let empty = false
    const list = vi.fn(async () => (empty ? [] : allRows))
    installApi({ list })
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    await user.click(screen.getByRole('button', { name: '全选未分配' }))
    expect(screen.getByRole('button', { name: '取消全选' })).toBeInTheDocument()

    empty = true
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-11-15' } })
    await waitFor(() => expect(screen.getByRole('button', { name: '全选未分配' })).toBeDisabled())
  })

  it('取消全选会清空全部选择，包括手动勾选的已归属记录', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    const user = userEvent.setup()
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    await user.click(screen.getByRole('button', { name: '全选未分配' }))
    // 再手动勾上一条已归属记录
    const rows = screen.getAllByTestId('time-entry') as HTMLElement[]
    await user.click(within(rows[0] as HTMLElement).getByLabelText('选择工时记录'))
    expect(checkedIds(allRows)).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: '取消全选' }))
    expect(checkedIds(allRows)).toEqual([])
  })

  it('全选按钮使用主色调样式，尺寸大于次要按钮', async () => {
    installApi({ list: vi.fn(async () => allRows) })
    render(<TimePage today="2026-11-14" />)

    await screen.findAllByTestId('time-entry')
    const selectAll = screen.getByRole('button', { name: '全选未分配' })
    expect(selectAll.className).toContain('bg-primary')
    expect(selectAll.className).toContain('h-9')
    expect(selectAll.className).not.toContain('border border-input')
  })
})
