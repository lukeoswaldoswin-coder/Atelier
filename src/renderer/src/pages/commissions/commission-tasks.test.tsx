import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Task } from '@shared/domain'
import { makeTask } from '@/test-utils/fixtures'
import { CommissionTasks } from './commission-tasks'

type ListMock = ReturnType<typeof vi.fn<(input: { includeArchived?: boolean }) => Promise<Task[]>>>

function installApi(list: ListMock, overrides: { create?: unknown; update?: unknown } = {}) {
  const create = overrides.create ?? vi.fn(async () => makeTask())
  const update = overrides.update ?? vi.fn(async () => makeTask())
  const reorder = vi.fn(async () => [])
  const archive = vi.fn(async () => makeTask({ archivedAt: '2026-06-01T00:00:00.000Z' }))
  const unarchive = vi.fn(async () => makeTask())

  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: {
      getAppInfo: vi.fn(),
      clients: {
        create: vi.fn(),
        list: vi.fn(async () => []),
        get: vi.fn(),
        update: vi.fn(),
        archive: vi.fn(),
        unarchive: vi.fn()
      },
      commissions: {
        create: vi.fn(),
        list: vi.fn(async () => []),
        get: vi.fn(),
        update: vi.fn(),
        archive: vi.fn(),
        unarchive: vi.fn()
      },
      tasks: {
        create,
        list,
        update,
        reorder,
        archive,
        unarchive
      }
    }
  })

  return { create, update, reorder, archive, unarchive }
}

function renderTasks(onChanged = vi.fn()) {
  render(<CommissionTasks commissionId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" onChanged={onChanged} />)
  return { onChanged }
}

afterEach(() => {
  Reflect.deleteProperty(window, 'atelier')
  vi.restoreAllMocks()
})

const draftDone = makeTask({
  id: '11111111-1111-4111-8111-111111111111',
  title: '构图草稿',
  stage: 'draft',
  status: 'done',
  estimatedMinutes: 60,
  completedAt: '2026-01-02T00:00:00.000Z'
})
const lineTodo = makeTask({
  id: '22222222-2222-4222-8222-222222222222',
  title: '线稿清理',
  stage: 'lineart',
  status: 'todo',
  estimatedMinutes: 30,
  sortOrder: 1
})

describe('委托详情：绘画任务', () => {
  it('按阶段分组展示，并给出进度与预计工时', async () => {
    const list = vi.fn(async () => [draftDone, lineTodo]) as unknown as ListMock
    installApi(list)
    renderTasks()

    expect(await screen.findByTestId('task-group-draft')).toBeInTheDocument()
    expect(screen.getByTestId('task-group-lineart')).toBeInTheDocument()
    expect(screen.getByTestId('task-group-draft')).toHaveTextContent('1/1')
    expect(screen.getByTestId('task-group-lineart')).toHaveTextContent('0/1')
    expect(screen.getByTestId('tasks-progress')).toHaveTextContent(
      '1/2 已完成 · 预计 1 小时 30 分（未完成 30 分钟）'
    )
    expect(screen.getByText('构图草稿')).toBeInTheDocument()
    expect(screen.getByText('线稿清理')).toBeInTheDocument()
  })

  it('新建任务：填写标题、阶段与预计工时后提交', async () => {
    const list = vi.fn(async () => []) as unknown as ListMock
    const { create } = installApi(list)
    const onChanged = vi.fn()
    renderTasks(onChanged)

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '添加任务' }))

    await user.type(screen.getByLabelText('任务标题 *'), '新任务')
    await user.selectOptions(screen.getByLabelText('阶段'), 'lineart')
    await user.type(screen.getByLabelText('预计工时（分钟）'), '45')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({
      commissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: '新任务',
      stage: 'lineart',
      estimatedMinutes: 45,
      description: null
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it('标题为空时阻止提交', async () => {
    const list = vi.fn(async () => []) as unknown as ListMock
    const { create } = installApi(list)
    renderTasks()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '添加任务' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('请填写任务标题')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('编辑任务：预填并提交更新', async () => {
    const list = vi.fn(async () => [lineTodo]) as unknown as ListMock
    const { update } = installApi(list)
    renderTasks()

    const user = userEvent.setup()
    await screen.findByText('线稿清理')
    await user.click(screen.getByRole('button', { name: '编辑' }))

    const title = screen.getByLabelText('任务标题 *')
    expect(title).toHaveValue('线稿清理')
    expect(screen.getByLabelText('预计工时（分钟）')).toHaveValue('30')

    await user.clear(title)
    await user.type(title, '线稿清理（改）')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith({
      id: lineTodo.id,
      title: '线稿清理（改）',
      stage: 'lineart',
      status: 'todo',
      estimatedMinutes: 30,
      description: null
    })
  })

  it('勾选完成会提交 done 状态并通知上层刷新', async () => {
    const list = vi.fn(async () => [lineTodo]) as unknown as ListMock
    const { update } = installApi(list)
    const onChanged = vi.fn()
    renderTasks(onChanged)

    const user = userEvent.setup()
    await screen.findByText('线稿清理')
    await user.click(screen.getByLabelText('将「线稿清理」标记为已完成'))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({ id: lineTodo.id, status: 'done' })
    )
    expect(onChanged).toHaveBeenCalled()
  })

  it('归档任务需要确认，确认后调用 IPC', async () => {
    const list = vi.fn(async () => [lineTodo]) as unknown as ListMock
    const { archive } = installApi(list)
    const onChanged = vi.fn()
    renderTasks(onChanged)

    const user = userEvent.setup()
    await screen.findByText('线稿清理')
    await user.click(screen.getByRole('button', { name: '归档' }))

    const dialog = await screen.findByTestId('confirm-dialog')
    expect(within(dialog).getByText('归档这个任务？')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '归档' }))

    await waitFor(() => expect(archive).toHaveBeenCalledWith({ id: lineTodo.id }))
    expect(onChanged).toHaveBeenCalled()
  })

  it('打开「显示已归档」后可以恢复任务', async () => {
    const archived = makeTask({
      id: '33333333-3333-4333-8333-333333333333',
      title: '旧任务',
      archivedAt: '2026-06-01T00:00:00.000Z'
    })
    const list = vi.fn(async (input: { includeArchived?: boolean }) =>
      input?.includeArchived ? [lineTodo, archived] : [lineTodo]
    ) as unknown as ListMock
    const { unarchive } = installApi(list)
    renderTasks()

    const user = userEvent.setup()
    await screen.findByText('线稿清理')
    await user.click(screen.getByRole('switch'))

    expect(await screen.findByText('旧任务')).toBeInTheDocument()
    expect(list).toHaveBeenCalledWith({
      commissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      includeArchived: true
    })

    await user.click(screen.getByRole('button', { name: '恢复' }))
    await waitFor(() => expect(unarchive).toHaveBeenCalledWith({ id: archived.id }))
  })

  it('服务端错误会显示在表单里且不关闭表单', async () => {
    const list = vi.fn(async () => []) as unknown as ListMock
    const create = vi.fn(async () => {
      throw new Error("Error invoking remote method 'tasks:create': Error: 委托不存在，无法操作任务")
    })
    installApi(list, { create })
    renderTasks()

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '添加任务' }))
    await user.type(screen.getByLabelText('任务标题 *'), 'x')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('委托不存在，无法操作任务')).toBeInTheDocument()
    expect(screen.getByTestId('task-form')).toBeInTheDocument()
  })

  it('任务表单有未保存修改时，取消会先确认', async () => {
    const list = vi.fn(async () => [lineTodo]) as unknown as ListMock
    installApi(list)
    renderTasks()

    const user = userEvent.setup()
    await screen.findByText('线稿清理')
    await user.click(screen.getByRole('button', { name: '编辑' }))
    await user.type(screen.getByLabelText('任务标题 *'), '（改）')

    await user.click(screen.getByRole('button', { name: '取消' }))
    const dialog = await screen.findByTestId('confirm-dialog')
    await user.click(within(dialog).getByRole('button', { name: '继续编辑' }))
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('task-form')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '取消' }))
    const again = await screen.findByTestId('confirm-dialog')
    await user.click(within(again).getByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.queryByTestId('task-form')).not.toBeInTheDocument())
  })

  it('上移/下移提交当前阶段的完整排序', async () => {
    const first = makeTask({ id: '44444444-4444-4444-8444-444444444444', title: '第一', sortOrder: 0 })
    const second = makeTask({ id: '55555555-5555-4555-8555-555555555555', title: '第二', sortOrder: 1 })
    const list = vi.fn(async () => [first, second]) as unknown as ListMock
    const { reorder } = installApi(list)
    renderTasks()

    const user = userEvent.setup()
    await screen.findByText('第一')
    await user.click(screen.getByRole('button', { name: '下移「第一」' }))

    await waitFor(() => expect(reorder).toHaveBeenCalledTimes(1))
    expect(reorder).toHaveBeenCalledWith({
      commissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      stage: 'draft',
      orderedIds: [second.id, first.id]
    })
  })
})
