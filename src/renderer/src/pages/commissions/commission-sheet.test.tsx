import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Commission } from '@shared/domain'
import { makeClient, makeCommission } from '@/test-utils/fixtures'
import { CommissionSheet } from './commission-sheet'

const client = makeClient({ id: '11111111-1111-4111-8111-111111111111', name: '小夏' })

type CreateMock = ReturnType<typeof vi.fn<(input: unknown) => Promise<Commission>>>
type UpdateMock = ReturnType<typeof vi.fn<(input: unknown) => Promise<Commission | null>>>

function installApi(options: { create?: CreateMock; update?: UpdateMock } = {}) {
  const create = options.create ?? vi.fn(async () => makeCommission())
  const update = options.update ?? vi.fn(async () => makeCommission())
  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: {
      getAppInfo: vi.fn(),
      clients: {
        create: vi.fn(),
        list: vi.fn(async () => [client]),
        get: vi.fn(),
        update: vi.fn(),
        archive: vi.fn(),
        unarchive: vi.fn()
      },
      commissions: {
        create,
        list: vi.fn(async () => []),
        get: vi.fn(),
        update,
        archive: vi.fn()
      }
    }
  })
  return { create, update }
}

function renderSheet(overrides: {
  mode?: 'create' | 'edit'
  commission?: Commission | null
} = {}) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(
    <CommissionSheet
      mode={overrides.mode ?? 'create'}
      commission={overrides.commission ?? null}
      clients={[client]}
      timeZone="Asia/Shanghai"
      onClose={onClose}
      onSaved={onSaved}
    />
  )
  return { onClose, onSaved }
}

afterEach(() => {
  Reflect.deleteProperty(window, 'atelier')
  vi.restoreAllMocks()
})

describe('委托表单：报价三态', () => {
  it('未报价：提交 quoteAmountCents = null', async () => {
    const { create } = installApi()
    const { onSaved } = renderSheet()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('客户 *'), client.id)
    await user.type(screen.getByLabelText('委托名称 *'), '半身立绘')
    await user.type(screen.getByLabelText('委托类型 *'), '插画')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({
      clientId: client.id,
      title: '半身立绘',
      type: '插画',
      priority: 3,
      deadline: { kind: 'none' },
      quoteAmountCents: null
    })
    expect(onSaved).toHaveBeenCalled()
  })

  it('免费：提交 quoteAmountCents = 0', async () => {
    const { create } = installApi()
    renderSheet()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('客户 *'), client.id)
    await user.type(screen.getByLabelText('委托名称 *'), '送朋友的画')
    await user.type(screen.getByLabelText('委托类型 *'), '插画')
    await user.click(screen.getByRole('radio', { name: '免费' }))
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ quoteAmountCents: 0 }))
  })

  it('指定金额：字符串解析为整数分，禁止浮点', async () => {
    const { create } = installApi()
    renderSheet()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('客户 *'), client.id)
    await user.type(screen.getByLabelText('委托名称 *'), '有报价')
    await user.type(screen.getByLabelText('委托类型 *'), '插画')
    await user.click(screen.getByRole('radio', { name: '指定金额' }))
    await user.type(screen.getByLabelText('报价金额（元）'), '1,200.5')
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ quoteAmountCents: 120050 }))
  })

  it('金额格式错误时阻止提交并提示', async () => {
    const { create } = installApi()
    renderSheet()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('客户 *'), client.id)
    await user.type(screen.getByLabelText('委托名称 *'), 'x')
    await user.type(screen.getByLabelText('委托类型 *'), 'y')
    await user.click(screen.getByRole('radio', { name: '指定金额' }))
    await user.type(screen.getByLabelText('报价金额（元）'), '12.345')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('金额最多保留两位小数')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('委托表单：截止时间三态', () => {
  it('仅日期：原样保存 YYYY-MM-DD，不做时区换算', async () => {
    const { create } = installApi()
    renderSheet()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('客户 *'), client.id)
    await user.type(screen.getByLabelText('委托名称 *'), '日期截止')
    await user.type(screen.getByLabelText('委托类型 *'), '插画')
    await user.click(screen.getByRole('radio', { name: '仅日期' }))
    fireEvent.change(screen.getByLabelText('截止日期'), { target: { value: '2026-12-31' } })
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ deadline: { kind: 'date', date: '2026-12-31' } })
    )
  })

  it('日期 + 时间：保存 UTC 瞬间与创建时区', async () => {
    const { create } = installApi()
    renderSheet()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('客户 *'), client.id)
    await user.type(screen.getByLabelText('委托名称 *'), '时刻截止')
    await user.type(screen.getByLabelText('委托类型 *'), '插画')
    await user.click(screen.getByRole('radio', { name: '日期 + 时间' }))
    fireEvent.change(screen.getByLabelText('截止日期'), { target: { value: '2026-12-31' } })
    fireEvent.change(screen.getByLabelText('截止时间'), { target: { value: '18:00' } })
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        deadline: {
          kind: 'datetime',
          at: '2026-12-31T10:00:00.000Z',
          timeZone: 'Asia/Shanghai'
        }
      })
    )
  })

  it('日期 + 时间缺少时间时阻止提交', async () => {
    const { create } = installApi()
    renderSheet()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('客户 *'), client.id)
    await user.type(screen.getByLabelText('委托名称 *'), 'x')
    await user.type(screen.getByLabelText('委托类型 *'), 'y')
    await user.click(screen.getByRole('radio', { name: '日期 + 时间' }))
    fireEvent.change(screen.getByLabelText('截止日期'), { target: { value: '2026-12-31' } })
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('请填写截止时间')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })
})

describe('委托表单：校验与错误', () => {
  it('未选择客户时阻止提交', async () => {
    const { create } = installApi()
    renderSheet()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('委托名称 *'), 'x')
    await user.type(screen.getByLabelText('委托类型 *'), 'y')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('请选择客户')).toBeInTheDocument()
    expect(create).not.toHaveBeenCalled()
  })

  it('服务端业务错误会显示在客户字段上', async () => {
    const create = vi.fn(async () => {
      throw new Error(
        "Error invoking remote method 'commissions:create': Error: 客户已归档，不能为其新增委托"
      )
    })
    installApi({ create })
    renderSheet()

    const user = userEvent.setup()
    await user.selectOptions(screen.getByLabelText('客户 *'), client.id)
    await user.type(screen.getByLabelText('委托名称 *'), 'x')
    await user.type(screen.getByLabelText('委托类型 *'), 'y')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('客户已归档，不能为其新增委托')).toBeInTheDocument()
    expect(screen.getByTestId('sheet')).toBeInTheDocument()
  })
})

describe('委托表单：未保存修改确认', () => {
  it('取消时先确认；继续编辑保持打开，放弃修改才关闭', async () => {
    const { create } = installApi()
    const { onClose } = renderSheet()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('委托名称 *'), '改了一半')

    await user.click(screen.getByRole('button', { name: '取消' }))
    const dialog = await screen.findByTestId('confirm-dialog')
    expect(within(dialog).getByText('放弃未保存的修改？')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '继续编辑' }))
    await waitFor(() => expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('sheet')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '取消' }))
    const dialogAgain = await screen.findByTestId('confirm-dialog')
    await user.click(within(dialogAgain).getByRole('button', { name: '放弃修改' }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(create).not.toHaveBeenCalled()
  })
})

describe('委托表单：编辑模式', () => {
  it('预填现有数据，客户只读，保存调用 update', async () => {
    const existing = makeCommission({
      title: '旧标题',
      type: '插画',
      quoteAmountCents: 120000,
      paymentStatus: 'unpaid',
      outstandingCents: 120000,
      deadline: { kind: 'date', date: '2026-12-31' }
    })
    const { update } = installApi()
    renderSheet({ mode: 'edit', commission: existing })

    expect(screen.getByText('小夏')).toBeInTheDocument()
    expect(screen.queryByLabelText('客户 *')).not.toBeInTheDocument()
    expect(screen.getByLabelText('委托名称 *')).toHaveValue('旧标题')
    expect(screen.getByLabelText('报价金额（元）')).toHaveValue('1200.00')
    expect(screen.getByLabelText('截止日期')).toHaveValue('2026-12-31')

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith({
      id: existing.id,
      title: '旧标题',
      type: '插画',
      deadline: { kind: 'date', date: '2026-12-31' },
      quoteAmountCents: 120000
    })
  })
})
