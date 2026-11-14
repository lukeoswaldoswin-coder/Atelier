import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Client, Commission, Task } from '@shared/domain'
import { makeClient, makeCommission, makeTask } from '@/test-utils/fixtures'
import { useCommissionsUiStore } from '@/stores/commissions-ui-store'
import { CommissionsPage } from './commissions-page'

type ListMock<T> = ReturnType<typeof vi.fn<() => Promise<T[]>>>

interface ActionMocks {
  create?: ReturnType<typeof vi.fn>
  update?: ReturnType<typeof vi.fn>
  tasks?: {
    list?: ReturnType<typeof vi.fn>
    update?: ReturnType<typeof vi.fn>
  }
}

function installApi(commissionList: ListMock<Commission>, clientList: ListMock<Client>, actions: ActionMocks = {}) {
  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: {
      getAppInfo: vi.fn(),
      clients: {
        create: vi.fn(),
        list: clientList,
        get: vi.fn(),
        update: vi.fn(),
        archive: vi.fn(),
        unarchive: vi.fn()
      },
      commissions: {
        create: actions.create ?? vi.fn(),
        list: commissionList,
        get: vi.fn(),
        update: actions.update ?? vi.fn(),
        archive: vi.fn()
      },
      tasks: {
        create: vi.fn(),
        list: actions.tasks?.list ?? vi.fn(async () => []),
        update: actions.tasks?.update ?? vi.fn(),
        reorder: vi.fn(),
        archive: vi.fn(),
        unarchive: vi.fn()
      }
    }
  })
}

beforeEach(() => {
  useCommissionsUiStore.setState({
    tab: 'commissions',
    listScrollTop: 0,
    includeArchived: false
  })
})

afterEach(() => {
  // Radix Dialog 在卸载时会给 body 加 pointer-events: none，测试间显式复位避免串扰
  document.body.style.pointerEvents = ''
  Reflect.deleteProperty(window, 'atelier')
  vi.restoreAllMocks()
})

describe('委托列表页', () => {
  it('展示真实数据：委托名为主、客户名为次，金额与付款状态正确', async () => {
    const client = makeClient({ name: '小夏' })
    const commission = makeCommission({
      title: '半身立绘',
      clientId: client.id,
      status: 'active',
      deadline: { kind: 'date', date: '2026-12-31' },
      quoteAmountCents: 120000,
      paidAmountCents: 40000,
      paymentStatus: 'partial',
      outstandingCents: 80000
    })
    installApi(vi.fn(async () => [commission]), vi.fn(async () => [client]))

    render(<CommissionsPage />)

    expect(await screen.findByText('半身立绘')).toBeInTheDocument()
    const row = screen.getByTestId('commission-row')
    expect(within(row).getByText('小夏')).toBeInTheDocument()
    expect(within(row).getByText('进行中')).toBeInTheDocument()
    expect(within(row).getByText('2026-12-31')).toBeInTheDocument()
    expect(within(row).getByText('部分付款')).toBeInTheDocument()
    expect(within(row).getByText('已收 ¥400.00 · 未收 ¥800.00')).toBeInTheDocument()
    expect(screen.getByTestId('commissions-summary')).toHaveTextContent('共 1 个委托 · 1 个未结清')
  })

  it('空数据库显示空状态，不显示任何示例数据', async () => {
    installApi(vi.fn(async () => []), vi.fn(async () => []))

    render(<CommissionsPage />)

    expect(await screen.findByText('还没有委托')).toBeInTheDocument()
    expect(screen.getByTestId('commissions-summary')).toHaveTextContent('共 0 个委托')
    expect(screen.queryByTestId('commission-row')).not.toBeInTheDocument()
  })

  it('加载中显示骨架，而不是空状态', async () => {
    installApi(
      vi.fn(() => new Promise<Commission[]>(() => undefined)),
      vi.fn(() => new Promise<Client[]>(() => undefined))
    )

    render(<CommissionsPage />)

    expect(await screen.findByTestId('commission-loading')).toBeInTheDocument()
    expect(screen.queryByText('还没有委托')).not.toBeInTheDocument()
  })

  it('IPC 失败时显示真实错误，并可重试成功', async () => {
    const client = makeClient({ name: '小夏' })
    const commission = makeCommission({ title: '重试成功', clientId: client.id })
    const commissionList = vi
      .fn<() => Promise<Commission[]>>()
      .mockRejectedValueOnce(new Error('Error invoking remote method: 数据库不可用'))
      .mockResolvedValueOnce([commission])

    installApi(commissionList, vi.fn(async () => [client]))

    render(<CommissionsPage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('无法读取委托列表')
    expect(alert).toHaveTextContent('数据库不可用')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '重试' }))

    expect(await screen.findByText('重试成功')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('客户已归档时，历史委托仍显示客户名称', async () => {
    const client = makeClient({
      name: '已归档客户',
      archivedAt: '2026-06-01T00:00:00.000Z'
    })
    installApi(
      vi.fn(async () => [makeCommission({ title: '历史委托', clientId: client.id })]),
      vi.fn(async () => [client])
    )

    render(<CommissionsPage />)

    expect(await screen.findByText('历史委托')).toBeInTheDocument()
    expect(screen.getByText('已归档客户')).toBeInTheDocument()
    expect(screen.queryByText('未知客户')).not.toBeInTheDocument()
  })

  it('客户数据读取失败时整体报错，而不是把客户名显示为未知', async () => {
    installApi(
      vi.fn(async () => [makeCommission({ title: '委托' })]),
      vi.fn(async () => {
        throw new Error('客户查询失败')
      })
    )

    render(<CommissionsPage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('客户查询失败')
    expect(screen.queryByText('未知客户')).not.toBeInTheDocument()
  })

  it('新建委托成功后列表即时更新', async () => {
    const client = makeClient({ name: '小夏' })
    const created = makeCommission({ title: '新委托', clientId: client.id })
    const commissionList = vi
      .fn<() => Promise<Commission[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([created])
    const create = vi.fn(async () => created)

    installApi(commissionList, vi.fn(async () => [client]), { create })

    const user = userEvent.setup()
    render(<CommissionsPage />)

    await screen.findByText('还没有委托')
    await user.click(screen.getByRole('button', { name: '新建委托' }))

    const sheet = await screen.findByTestId('sheet')
    await user.selectOptions(within(sheet).getByLabelText('客户 *'), client.id)
    await user.type(within(sheet).getByLabelText('委托名称 *'), '新委托')
    await user.type(within(sheet).getByLabelText('委托类型 *'), '插画')
    await user.click(within(sheet).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('新委托')).toBeInTheDocument()
  })

  it('新建委托的客户下拉不包含已归档客户', async () => {
    const active = makeClient({ name: '小夏' })
    const archived = makeClient({
      id: '22222222-2222-4222-8222-222222222222',
      name: '已归档客户',
      archivedAt: '2026-06-01T00:00:00.000Z'
    })

    installApi(vi.fn(async () => []), vi.fn(async () => [active, archived]))

    const user = userEvent.setup()
    render(<CommissionsPage />)

    await screen.findByText('还没有委托')
    await user.click(screen.getByRole('button', { name: '新建委托' }))

    const select = await screen.findByLabelText('客户 *')
    expect(within(select).getByRole('option', { name: '小夏' })).toBeInTheDocument()
    expect(within(select).queryByRole('option', { name: '已归档客户' })).not.toBeInTheDocument()
  })

  it('列表行显示任务进度，没有任务时不显示', async () => {
    const client = makeClient({ name: '小夏' })
    const withTasks = makeCommission({
      title: '有进度',
      clientId: client.id,
      taskCount: 2,
      doneTaskCount: 1
    })
    const withoutTasks = makeCommission({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      title: '无进度',
      clientId: client.id,
      taskCount: 0,
      doneTaskCount: 0
    })
    installApi(vi.fn(async () => [withTasks, withoutTasks]), vi.fn(async () => [client]))

    render(<CommissionsPage />)

    const rows = await screen.findAllByTestId('commission-row')
    expect(rows[0]).toHaveTextContent('任务 1/2')
    expect(rows[1]).not.toHaveTextContent('· 任务')
  })

  it('完成最后一个任务后，详情状态自动更新为已完成', async () => {
    const client = makeClient({ name: '小夏' })
    let current = makeCommission({
      title: '联动委托',
      clientId: client.id,
      status: 'active',
      quoteAmountCents: null,
      paymentStatus: 'unquoted',
      outstandingCents: null,
      taskCount: 1,
      doneTaskCount: 0
    })
    const task: Task = makeTask({
      id: '11111111-1111-4111-8111-111111111111',
      commissionId: current.id,
      title: '唯一任务',
      status: 'todo'
    })

    const commissionList = vi.fn(async () => [current])
    const tasksList = vi.fn(async () => [{ ...task }])
    const tasksUpdate = vi.fn(async (input: Record<string, unknown>) => {
      if (input['status'] === 'done') {
        current = {
          ...current,
          status: 'completed',
          completedAt: '2026-11-14T06:00:00.000Z',
          doneTaskCount: 1
        }
        task.status = 'done'
        task.completedAt = '2026-11-14T06:00:00.000Z'
      }
      return task
    })

    installApi(commissionList, vi.fn(async () => [client]), {
      tasks: { list: tasksList, update: tasksUpdate }
    })

    const user = userEvent.setup()
    render(<CommissionsPage />)

    await user.click(await screen.findByTestId('commission-row'))
    const detail = await screen.findByTestId('sheet')
    expect(within(detail).getByText('进行中')).toBeInTheDocument()

    await user.click(await within(detail).findByLabelText('将「唯一任务」标记为已完成'))

    await waitFor(() => {
      expect(within(screen.getByTestId('sheet')).getByText('已完成')).toBeInTheDocument()
    })
    expect(within(screen.getByTestId('sheet')).getByText('完成')).toBeInTheDocument()

    // 关闭详情，避免 Radix 的 body 锁定影响后续测试
    await user.click(within(screen.getByTestId('sheet')).getByRole('button', { name: '关闭' }))
    await waitFor(() => expect(screen.queryByTestId('sheet')).not.toBeInTheDocument())
  })

  it('点击委托行打开详情，编辑保存后详情即时更新', async () => {
    const client = makeClient({ name: '小夏' })
    let current = makeCommission({
      title: '旧标题',
      clientId: client.id,
      status: 'active',
      quoteAmountCents: 128000,
      outstandingCents: 128000
    })
    const commissionList = vi.fn(async () => [current])
    const update = vi.fn(async (patch: Record<string, unknown>) => {
      current = { ...current, ...patch } as Commission
      return current
    })

    installApi(commissionList, vi.fn(async () => [client]), { update })

    const user = userEvent.setup()
    render(<CommissionsPage />)

    await user.click(await screen.findByTestId('commission-row'))

    const detail = await screen.findByTestId('sheet')
    expect(within(detail).getByText('旧标题')).toBeInTheDocument()
    expect(within(detail).getByText('未付款')).toBeInTheDocument()

    await user.click(within(detail).getByRole('button', { name: '编辑' }))

    const editor = await screen.findByTestId('sheet')
    const titleInput = within(editor).getByLabelText('委托名称 *')
    await user.clear(titleInput)
    await user.type(titleInput, '新标题')
    await user.click(within(editor).getByRole('button', { name: '保存' }))

    await waitFor(() => expect(update).toHaveBeenCalled())

    await waitFor(() => {
      const sheet = screen.getByTestId('sheet')
      expect(within(sheet).getByText('新标题')).toBeInTheDocument()
    })
  })
})
