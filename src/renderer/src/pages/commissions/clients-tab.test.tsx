import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Client } from '@shared/domain'
import { makeClient } from '@/test-utils/fixtures'
import { useCommissionsUiStore } from '@/stores/commissions-ui-store'
import { ClientsTab } from './clients-tab'

interface ApiMock {
  create: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
  archive: ReturnType<typeof vi.fn>
  unarchive: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

function installApi(clients: ApiMock) {
  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: {
      getAppInfo: vi.fn(),
      clients: { get: vi.fn(), ...clients },
      commissions: {
        create: vi.fn(),
        list: vi.fn(async () => []),
        get: vi.fn(),
        update: vi.fn(),
        archive: vi.fn()
      }
    }
  })
}

function clientsApi(rows: Client[]): ApiMock {
  return {
    create: vi.fn(async () => makeClient()),
    list: vi.fn(async () => rows),
    update: vi.fn(async () => makeClient()),
    archive: vi.fn(async () => makeClient({ archivedAt: '2026-06-01T00:00:00.000Z' })),
    unarchive: vi.fn(async () => makeClient({ archivedAt: null }))
  }
}

beforeEach(() => {
  useCommissionsUiStore.setState({
    tab: 'clients',
    clientsIncludeArchived: false,
    clientsScrollTop: 0
  })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'atelier')
  vi.restoreAllMocks()
})

describe('客户页签', () => {
  it('显示客户名与联系方式，默认隐藏已归档', async () => {
    const active = makeClient({ id: '11111111-1111-4111-8111-111111111111', name: '小夏', contact: 'wx:xia' })
    const archived = makeClient({
      id: '22222222-2222-4222-8222-222222222222',
      name: '已归档客户',
      archivedAt: '2026-06-01T00:00:00.000Z'
    })
    installApi(clientsApi([active, archived]))

    render(<ClientsTab />)

    expect(await screen.findByText('小夏')).toBeInTheDocument()
    expect(screen.getByText('wx:xia')).toBeInTheDocument()
    expect(screen.queryByText('已归档客户')).not.toBeInTheDocument()
    expect(screen.getByTestId('clients-summary')).toHaveTextContent('共 1 个客户')
  })

  it('打开「显示已归档」后能看到归档客户及其标记', async () => {
    const active = makeClient({ id: '11111111-1111-4111-8111-111111111111', name: '小夏' })
    const archived = makeClient({
      id: '22222222-2222-4222-8222-222222222222',
      name: '已归档客户',
      archivedAt: '2026-06-01T00:00:00.000Z'
    })
    installApi(clientsApi([active, archived]))

    const user = userEvent.setup()
    render(<ClientsTab />)
    await screen.findByText('小夏')

    await user.click(screen.getByRole('switch'))

    expect(await screen.findByText('已归档客户')).toBeInTheDocument()
    expect(screen.getByText('已归档')).toBeInTheDocument()
    expect(screen.getByTestId('clients-summary')).toHaveTextContent('含 1 个已归档')
  })

  it('新建客户：填写名称保存后调用 IPC 并刷新列表', async () => {
    const api = clientsApi([])
    installApi(api)

    const user = userEvent.setup()
    render(<ClientsTab />)

    expect(await screen.findByText('还没有客户')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '新建客户' }))
    const sheet = await screen.findByTestId('sheet')

    await user.type(within(sheet).getByLabelText('客户名称 *'), '新客户')
    await user.click(within(sheet).getByRole('button', { name: '保存' }))

    await waitFor(() => {
      expect(api.create).toHaveBeenCalledTimes(1)
    })
    expect(api.create).toHaveBeenCalledWith({ name: '新客户', contact: null, note: null })
    expect(api.list.mock.calls.length).toBeGreaterThanOrEqual(2)
    await waitFor(() => {
      expect(screen.queryByTestId('sheet')).not.toBeInTheDocument()
    })
  })

  it('有未保存修改时关闭面板会先确认，选择继续编辑则不关闭', async () => {
    const client = makeClient({ name: '小夏' })
    const api = clientsApi([client])
    installApi(api)

    const user = userEvent.setup()
    render(<ClientsTab />)

    await user.click(await screen.findByTestId('client-row'))
    const sheet = await screen.findByTestId('sheet')

    const nameInput = within(sheet).getByLabelText('客户名称 *')
    await user.clear(nameInput)
    await user.type(nameInput, '改过的名字')

    await user.click(within(sheet).getByRole('button', { name: '取消' }))

    const dialog = await screen.findByTestId('confirm-dialog')
    expect(within(dialog).getByText('放弃未保存的修改？')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '继续编辑' }))

    await waitFor(() => {
      expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByTestId('sheet')).toBeInTheDocument()
    expect(api.update).not.toHaveBeenCalled()
  })

  it('确认放弃修改后面板关闭，且不写数据库', async () => {
    const client = makeClient({ name: '小夏' })
    const api = clientsApi([client])
    installApi(api)

    const user = userEvent.setup()
    render(<ClientsTab />)

    await user.click(await screen.findByTestId('client-row'))
    const sheet = await screen.findByTestId('sheet')
    await user.type(within(sheet).getByLabelText('客户名称 *'), '补充')

    await user.click(within(sheet).getByRole('button', { name: '取消' }))
    const dialog = await screen.findByTestId('confirm-dialog')
    await user.click(within(dialog).getByRole('button', { name: '放弃修改' }))

    await waitFor(() => {
      expect(screen.queryByTestId('sheet')).not.toBeInTheDocument()
    })
    expect(api.update).not.toHaveBeenCalled()
  })

  it('归档客户需要确认，确认后调用 IPC 并刷新', async () => {
    const client = makeClient({ name: '小夏' })
    const api = clientsApi([client])
    installApi(api)

    const user = userEvent.setup()
    render(<ClientsTab />)

    await user.click(await screen.findByTestId('client-row'))
    const sheet = await screen.findByTestId('sheet')

    await user.click(within(sheet).getByRole('button', { name: '归档客户' }))
    const dialog = await screen.findByTestId('confirm-dialog')
    expect(within(dialog).getByText('归档这个客户？')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '归档' }))

    await waitFor(() => {
      expect(api.archive).toHaveBeenCalledWith({ id: client.id })
    })
    await waitFor(() => {
      expect(screen.queryByTestId('sheet')).not.toBeInTheDocument()
    })
  })

  it('已归档客户可以取消归档', async () => {
    const archived = makeClient({
      id: '22222222-2222-4222-8222-222222222222',
      name: '归档客户',
      archivedAt: '2026-06-01T00:00:00.000Z'
    })
    const api = clientsApi([archived])
    installApi(api)

    const user = userEvent.setup()
    render(<ClientsTab />)
    await screen.findByTestId('clients-summary')

    await user.click(screen.getByRole('switch'))
    await user.click(await screen.findByTestId('client-row'))

    const sheet = await screen.findByTestId('sheet')
    await user.click(within(sheet).getByRole('button', { name: '取消归档' }))

    const dialog = await screen.findByTestId('confirm-dialog')
    await user.click(within(dialog).getByRole('button', { name: '取消归档' }))

    await waitFor(() => {
      expect(api.unarchive).toHaveBeenCalledWith({ id: archived.id })
    })
  })
})
