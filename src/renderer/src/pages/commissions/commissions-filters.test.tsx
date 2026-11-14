import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Client, Commission } from '@shared/domain'
import { makeClient, makeCommission } from '@/test-utils/fixtures'
import { DEFAULT_COMMISSION_QUERY } from '@/lib/commission-query'
import { useCommissionsUiStore } from '@/stores/commissions-ui-store'
import { CommissionsPage } from './commissions-page'

const xia = makeClient({ id: '11111111-1111-4111-8111-111111111111', name: '小夏' })
const qing = makeClient({ id: '22222222-2222-4222-8222-222222222222', name: '阿青' })
const yu = makeClient({
  id: '33333333-3333-4333-8333-333333333333',
  name: '余温',
  archivedAt: '2026-06-01T00:00:00.000Z'
})

const ROW_A = makeCommission({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'A 半身立绘',
  clientId: xia.id,
  status: 'active',
  deadline: { kind: 'date', date: '2026-12-31' },
  quoteAmountCents: 128000,
  outstandingCents: 128000
})
const ROW_B = makeCommission({
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  title: 'B 头像',
  clientId: qing.id,
  status: 'draft'
})
const ROW_C = makeCommission({
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  title: 'C 老委托',
  clientId: yu.id,
  status: 'completed',
  archivedAt: '2026-06-02T00:00:00.000Z'
})

function installApi(rows: Commission[], clients: Client[]) {
  const commissionList = vi.fn(async (input?: { includeArchived?: boolean }) =>
    input?.includeArchived ? rows : rows.filter((row) => row.archivedAt === null)
  )

  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: {
      getAppInfo: vi.fn(),
      clients: {
        create: vi.fn(),
        list: vi.fn(async () => clients),
        get: vi.fn(),
        update: vi.fn(),
        archive: vi.fn(),
        unarchive: vi.fn()
      },
      commissions: {
        create: vi.fn(),
        list: commissionList,
        get: vi.fn(),
        update: vi.fn(),
        archive: vi.fn(),
        unarchive: vi.fn()
      }
    }
  })

  return { commissionList }
}

beforeEach(() => {
  useCommissionsUiStore.setState({
    tab: 'commissions',
    query: { ...DEFAULT_COMMISSION_QUERY },
    includeArchived: false,
    selectedId: null,
    activeId: null,
    listScrollTop: 0
  })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'atelier')
  vi.restoreAllMocks()
})

describe('委托筛选与计数', () => {
  it('搜索匹配委托名与客户名，计数口径为「筛选后 M / 共 N」', async () => {
    installApi([ROW_A, ROW_B], [xia, qing])
    const user = userEvent.setup()
    render(<CommissionsPage />)

    await screen.findByText('A 半身立绘')
    expect(screen.getByTestId('commissions-summary')).toHaveTextContent('共 2 个委托')

    await user.type(screen.getByLabelText('搜索委托或客户'), '阿青')

    await waitFor(() => expect(screen.queryByText('A 半身立绘')).not.toBeInTheDocument())
    expect(screen.getByText('B 头像')).toBeInTheDocument()
    expect(screen.getByTestId('commissions-summary')).toHaveTextContent('筛选后 1 / 共 2')
  })

  it('状态筛选生效，清除筛选后恢复并保留「显示已归档」', async () => {
    installApi([ROW_A, ROW_B], [xia, qing])
    const user = userEvent.setup()
    render(<CommissionsPage />)

    await screen.findByText('A 半身立绘')
    await user.selectOptions(screen.getByLabelText('状态筛选'), 'active')

    await waitFor(() => expect(screen.queryByText('B 头像')).not.toBeInTheDocument())
    expect(screen.getByTestId('commissions-summary')).toHaveTextContent('筛选后 1 / 共 2')

    await user.click(screen.getByRole('button', { name: '清除筛选' }))

    expect(await screen.findByText('B 头像')).toBeInTheDocument()
    expect(screen.getByTestId('commissions-summary')).toHaveTextContent('共 2 个委托')
    expect(screen.getByLabelText('状态筛选')).toHaveValue('all')
  })

  it('客户筛选包含归档范围内被引用的归档客户，并带标注', async () => {
    installApi([ROW_A, ROW_B, ROW_C], [xia, qing, yu])
    const user = userEvent.setup()
    render(<CommissionsPage />)

    await screen.findByText('A 半身立绘')
    await user.click(screen.getByRole('switch'))
    await screen.findByText('C 老委托')

    const select = screen.getByLabelText('客户筛选')
    expect(within(select).getByRole('option', { name: '余温（已归档）' })).toBeInTheDocument()

    await user.selectOptions(select, yu.id)
    await waitFor(() => expect(screen.queryByText('A 半身立绘')).not.toBeInTheDocument())
    expect(screen.getByText('C 老委托')).toBeInTheDocument()
    expect(screen.getByTestId('commissions-summary')).toHaveTextContent('筛选后 1 / 共 3')
  })

  it('已选归档客户只要仍被引用，就不会被重置为「全部」', async () => {
    useCommissionsUiStore.setState({
      includeArchived: true,
      query: { ...DEFAULT_COMMISSION_QUERY, clientId: yu.id }
    })
    installApi([ROW_A, ROW_B, ROW_C], [xia, qing, yu])

    render(<CommissionsPage />)

    await screen.findByText('C 老委托')
    await waitFor(() => expect(useCommissionsUiStore.getState().query.clientId).toBe(yu.id))
    expect(screen.getByLabelText('客户筛选')).toHaveValue(yu.id)
  })

  it('筛选导致选中项不可见时，清除选中并关闭详情', async () => {
    useCommissionsUiStore.setState({
      selectedId: ROW_A.id,
      query: { ...DEFAULT_COMMISSION_QUERY, status: 'draft' }
    })
    installApi([ROW_A, ROW_B], [xia, qing])

    render(<CommissionsPage />)

    await screen.findByText('B 头像')
    await waitFor(() => expect(useCommissionsUiStore.getState().selectedId).toBeNull())
    expect(screen.queryByTestId('sheet')).not.toBeInTheDocument()
  })
})

describe('委托列表键盘', () => {
  it('↓ 移动高亮、Enter 打开详情', async () => {
    installApi([ROW_A, ROW_B], [xia, qing])
    render(<CommissionsPage />)

    await screen.findByText('A 半身立绘')
    const list = screen.getByRole('group', { name: '委托列表' })

    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(useCommissionsUiStore.getState().activeId).toBe(ROW_A.id)

    fireEvent.keyDown(list, { key: 'ArrowDown' })
    expect(useCommissionsUiStore.getState().activeId).toBe(ROW_B.id)

    fireEvent.keyDown(list, { key: 'Enter' })
    expect(await screen.findByTestId('sheet')).toBeInTheDocument()
  })

  it('输入框内不拦截方向键；Ctrl+K 聚焦搜索', async () => {
    installApi([ROW_A, ROW_B], [xia, qing])
    render(<CommissionsPage />)

    await screen.findByText('A 半身立绘')
    const search = screen.getByLabelText('搜索委托或客户')

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(document.activeElement).toBe(search)

    const before = useCommissionsUiStore.getState().activeId
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(useCommissionsUiStore.getState().activeId).toBe(before)
  })

  it('输入法组合输入期间不处理方向键', async () => {
    installApi([ROW_A, ROW_B], [xia, qing])
    render(<CommissionsPage />)

    await screen.findByText('A 半身立绘')
    const list = screen.getByRole('group', { name: '委托列表' })

    fireEvent.keyDown(list, { key: 'ArrowDown' })
    const afterFirst = useCommissionsUiStore.getState().activeId

    list.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, isComposing: true })
    )
    expect(useCommissionsUiStore.getState().activeId).toBe(afterFirst)
  })
})
