import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Commission } from '@shared/domain'
import { makeCommission } from '@/test-utils/fixtures'
import { CommissionDetail } from './commission-detail'

type UpdateMock = ReturnType<typeof vi.fn<(input: unknown) => Promise<Commission | null>>>

function installApi(overrides: { update?: UpdateMock } = {}) {
  const update = overrides.update ?? vi.fn(async () => makeCommission())
  const archive = vi.fn(async () => makeCommission({ archivedAt: '2026-06-01T00:00:00.000Z' }))
  const unarchive = vi.fn(async () => makeCommission({ archivedAt: null }))

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
        update,
        archive,
        unarchive
      }
    }
  })

  return { update, archive, unarchive }
}

const baseCommission = makeCommission({
  title: '半身立绘',
  type: '插画',
  priority: 2,
  description: '需要柔光，参考图已发',
  status: 'active',
  quoteAmountCents: 256000,
  paidAmountCents: 100000,
  paymentStatus: 'partial',
  outstandingCents: 156000,
  deadline: { kind: 'date', date: '2026-12-31' }
})

function renderDetail(
  commission: Commission = baseCommission,
  handlers: { onClose?: () => void; onEdit?: () => void; onChanged?: () => void; onArchived?: () => void } = {}
) {
  const onClose = handlers.onClose ?? vi.fn()
  const onEdit = handlers.onEdit ?? vi.fn()
  const onChanged = handlers.onChanged ?? vi.fn()
  const onArchived = handlers.onArchived ?? vi.fn()
  render(
    <CommissionDetail
      commission={commission}
      clientName="小夏"
      onClose={onClose}
      onEdit={onEdit}
      onChanged={onChanged}
      onArchived={onArchived}
    />
  )
  return { onClose, onEdit, onChanged, onArchived }
}

afterEach(() => {
  Reflect.deleteProperty(window, 'atelier')
  vi.restoreAllMocks()
})

describe('委托详情：展示', () => {
  it('展示基本信息、金额、付款状态与结清情况', () => {
    installApi()
    renderDetail()

    const sheet = screen.getByTestId('sheet')
    expect(within(sheet).getByText('半身立绘')).toBeInTheDocument()
    expect(within(sheet).getAllByText('小夏').length).toBeGreaterThan(0)
    expect(within(sheet).getByText('进行中')).toBeInTheDocument()
    expect(within(sheet).getByText('部分付款')).toBeInTheDocument()

    expect(within(sheet).getByText('¥2,560.00')).toBeInTheDocument()
    expect(within(sheet).getByText('¥1,000.00')).toBeInTheDocument()
    expect(within(sheet).getByText('¥1,560.00')).toBeInTheDocument()
    expect(within(sheet).getByText('未结清')).toBeInTheDocument()

    expect(within(sheet).getByText('2026-12-31')).toBeInTheDocument()
    expect(within(sheet).getByText('插画')).toBeInTheDocument()
    expect(within(sheet).getByText('需要柔光，参考图已发')).toBeInTheDocument()
  })

  it('时刻型截止按创建时区显示并标注时区', () => {
    installApi()
    renderDetail(
      makeCommission({
        deadline: { kind: 'datetime', at: '2026-12-31T10:00:00.000Z', timeZone: 'Asia/Shanghai' }
      })
    )

    const sheet = screen.getByTestId('sheet')
    expect(within(sheet).getByText('2026-12-31 18:00')).toBeInTheDocument()
    expect(within(sheet).getByText(/创建时区 Asia\/Shanghai/)).toBeInTheDocument()
  })
})

describe('委托详情：付款登记', () => {
  it('登记已收金额后调用 update 并刷新', async () => {
    const { update } = installApi()
    const { onChanged } = renderDetail()

    const user = userEvent.setup()
    const input = screen.getByLabelText('已收金额（元）')
    await user.clear(input)
    await user.type(input, '2000.00')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith({ id: baseCommission.id, paidAmountCents: 200000 })
    expect(onChanged).toHaveBeenCalled()
  })

  it('超额收款被拒绝并提示', async () => {
    const { update } = installApi()
    renderDetail()

    const user = userEvent.setup()
    const input = screen.getByLabelText('已收金额（元）')
    await user.clear(input)
    await user.type(input, '3000.00')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('已收金额不能超过报价金额')).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
  })

  it('未报价的委托不能登记收款', () => {
    installApi()
    renderDetail(
      makeCommission({
        quoteAmountCents: null,
        paymentStatus: 'unquoted',
        outstandingCents: null
      })
    )

    expect(screen.getByText('未报价的委托不能登记收款，请先填写报价。')).toBeInTheDocument()
    expect(screen.queryByLabelText('已收金额（元）')).not.toBeInTheDocument()
  })

  it('未保存的收款修改在关闭时会先确认', async () => {
    installApi()
    const { onClose } = renderDetail()

    const user = userEvent.setup()
    const input = screen.getByLabelText('已收金额（元）')
    await user.clear(input)
    await user.type(input, '1200.00')

    await user.click(screen.getByRole('button', { name: '关闭' }))
    const dialog = await screen.findByTestId('confirm-dialog')
    await user.click(within(dialog).getByRole('button', { name: '放弃修改' }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

describe('委托详情：状态与归档', () => {
  it('按状态机给出可执行的下一步操作', async () => {
    const { update } = installApi()
    const { onChanged } = renderDetail(makeCommission({ status: 'draft' }))

    const user = userEvent.setup()
    expect(screen.getByRole('button', { name: '开始进行' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '取消委托' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '标记完成' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '开始进行' }))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: baseCommission.id, status: 'active' }))
    expect(onChanged).toHaveBeenCalled()
  })

  it('归档需要确认，确认后调用 IPC 并关闭详情', async () => {
    const { archive } = installApi()
    const { onArchived } = renderDetail()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '归档委托' }))

    const dialog = await screen.findByTestId('confirm-dialog')
    expect(within(dialog).getByText('归档这个委托？')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '归档' }))

    await waitFor(() => expect(archive).toHaveBeenCalledWith({ id: baseCommission.id }))
    expect(onArchived).toHaveBeenCalled()
  })

  it('已归档的委托可以取消归档', async () => {
    const { unarchive } = installApi()
    const { onArchived } = renderDetail(
      makeCommission({ archivedAt: '2026-06-01T00:00:00.000Z' })
    )

    const user = userEvent.setup()
    expect(screen.getByText('已归档')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '取消归档' }))

    const dialog = await screen.findByTestId('confirm-dialog')
    expect(within(dialog).getByText('取消归档这个委托？')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '取消归档' }))

    await waitFor(() => expect(unarchive).toHaveBeenCalledWith({ id: baseCommission.id }))
    expect(onArchived).toHaveBeenCalled()
  })

  it('编辑按钮把控制权交回上层', async () => {
    installApi()
    const { onEdit } = renderDetail()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '编辑' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})
