import { describe, expect, it } from 'vitest'
import { IpcChannel, ipcChannelNames, isIpcChannelName } from '@shared/channels'
import {
  centsSchema,
  createClientInputSchema,
  createCommissionInputSchema,
  deadlineSchema,
  updateCommissionInputSchema,
  utcIsoSchema,
  uuidSchema
} from '@shared/domain'
import { appInfoSchema, ipcContracts } from '@shared/contracts'

const validAppInfo = {
  name: 'atelier',
  version: '0.1.0',
  electron: '44.7.0',
  chrome: '152.0.0.0',
  node: '24.0.0',
  platform: 'win32',
  arch: 'x64',
  isDev: true
}

const validUuid = '3f2b8c4e-1a2b-4c5d-8e9f-0a1b2c3d4e5f'

describe('IPC 通道定义', () => {
  it('通道名唯一，且都带命名空间前缀', () => {
    expect(new Set(ipcChannelNames).size).toBe(ipcChannelNames.length)
    for (const name of ipcChannelNames) {
      expect(name).toMatch(/^[a-z-]+:[a-z-]+$/)
    }
  })

  it('isIpcChannelName 只接受已登记的通道', () => {
    expect(isIpcChannelName(IpcChannel.appGetInfo)).toBe(true)
    expect(isIpcChannelName(IpcChannel.clientsCreate)).toBe(true)
    expect(isIpcChannelName('app:unknown')).toBe(false)
  })

  it('契约表覆盖全部通道，没有漏登记的通道', () => {
    expect(Object.keys(ipcContracts).sort()).toEqual([...ipcChannelNames].sort())
  })
})

describe('AppInfo 契约', () => {
  it('接受完整合法的运行时信息', () => {
    expect(appInfoSchema.parse(validAppInfo)).toEqual(validAppInfo)
  })

  it('拒绝缺字段或类型错误的运行时信息', () => {
    const { chrome: _chrome, ...missing } = validAppInfo
    expect(() => appInfoSchema.parse(missing)).toThrow()
    expect(() => appInfoSchema.parse({ ...validAppInfo, isDev: 'yes' })).toThrow()
    expect(() => appInfoSchema.parse({ ...validAppInfo, version: '' })).toThrow()
  })

  it('无参数通道拒绝多余入参', () => {
    const noInput = ipcContracts[IpcChannel.appGetInfo].input
    expect(() => noInput.parse(undefined)).not.toThrow()
    expect(() => noInput.parse({ unexpected: true })).toThrow()
  })
})

describe('基础标量契约', () => {
  it('UUID 必须是标准格式', () => {
    expect(uuidSchema.parse(validUuid)).toBe(validUuid)
    expect(() => uuidSchema.parse('not-a-uuid')).toThrow()
    expect(() => uuidSchema.parse('3f2b8c4e-1a2b-9c5d-8e9f-0a1b2c3d4e5f')).toThrow()
  })

  it('时间必须是带 Z 的 UTC ISO 8601', () => {
    expect(utcIsoSchema.parse('2026-11-14T04:00:00.000Z')).toBe('2026-11-14T04:00:00.000Z')
    expect(() => utcIsoSchema.parse('2026-11-14T04:00:00+08:00')).toThrow()
    expect(() => utcIsoSchema.parse('2026-11-14 04:00:00')).toThrow()
    expect(() => utcIsoSchema.parse('2026-11-14T04:00:00Z')).toThrow()
  })

  it('金额必须是整数分，拒绝小数和负数', () => {
    expect(centsSchema.parse(0)).toBe(0)
    expect(centsSchema.parse(12800)).toBe(12800)
    expect(() => centsSchema.parse(12.5)).toThrow()
    expect(() => centsSchema.parse(-1)).toThrow()
  })
})

describe('客户输入契约', () => {
  it('名称会去掉首尾空格，纯空白被拒绝', () => {
    expect(createClientInputSchema.parse({ name: '  小夏  ' }).name).toBe('小夏')
    expect(() => createClientInputSchema.parse({ name: '   ' })).toThrow()
  })

  it('可选字段允许省略或为 null', () => {
    expect(createClientInputSchema.parse({ name: 'A' })).toEqual({ name: 'A' })
    expect(createClientInputSchema.parse({ name: 'A', contact: null }).contact).toBeNull()
  })
})

describe('截止时间契约（三态）', () => {
  it('接受无截止、仅日期、精确时刻三种形态', () => {
    expect(deadlineSchema.parse({ kind: 'none' })).toEqual({ kind: 'none' })
    expect(deadlineSchema.parse({ kind: 'date', date: '2026-12-31' })).toEqual({
      kind: 'date',
      date: '2026-12-31'
    })
    expect(
      deadlineSchema.parse({
        kind: 'datetime',
        at: '2026-12-31T10:00:00.000Z',
        timeZone: 'Asia/Shanghai'
      })
    ).toEqual({ kind: 'datetime', at: '2026-12-31T10:00:00.000Z', timeZone: 'Asia/Shanghai' })
  })

  it('日期型拒绝不存在的日历日期', () => {
    expect(() => deadlineSchema.parse({ kind: 'date', date: '2026-02-30' })).toThrow()
    expect(() => deadlineSchema.parse({ kind: 'date', date: '2026-13-01' })).toThrow()
    expect(() => deadlineSchema.parse({ kind: 'date', date: '2026-12-31T00:00:00.000Z' })).toThrow()
  })

  it('时刻型要求 UTC 时间与合法 IANA 时区', () => {
    expect(() =>
      deadlineSchema.parse({ kind: 'datetime', at: '2026-12-31T10:00:00.000Z', timeZone: 'Mars/Base' })
    ).toThrow()
    expect(() =>
      deadlineSchema.parse({ kind: 'datetime', at: '2026-12-31 10:00', timeZone: 'Asia/Shanghai' })
    ).toThrow()
    expect(() => deadlineSchema.parse({ kind: 'datetime', at: '2026-12-31T10:00:00.000Z' })).toThrow()
  })

  it('拒绝未知字段（strict）', () => {
    expect(() => deadlineSchema.parse({ kind: 'none', date: '2026-12-31' })).toThrow()
    expect(() =>
      deadlineSchema.parse({
        kind: 'datetime',
        at: '2026-12-31T10:00:00.000Z',
        timeZone: 'Asia/Shanghai',
        extra: true
      })
    ).toThrow()
  })
})

describe('委托输入契约', () => {
  it('优先级默认 3；报价省略即未报价', () => {
    const parsed = createCommissionInputSchema.parse({
      clientId: validUuid,
      title: '半身立绘',
      type: '插画'
    })
    expect(parsed.priority).toBe(3)
    expect(parsed.quoteAmountCents).toBeUndefined()
  })

  it('报价可以显式 null（未报价）或 0（免费）', () => {
    expect(
      createCommissionInputSchema.parse({
        clientId: validUuid,
        title: 'x',
        type: 'y',
        quoteAmountCents: null
      }).quoteAmountCents
    ).toBeNull()
    expect(
      createCommissionInputSchema.parse({
        clientId: validUuid,
        title: 'x',
        type: 'y',
        quoteAmountCents: 0
      }).quoteAmountCents
    ).toBe(0)
  })

  it('优先级超出 1–5 会被拒绝', () => {
    expect(() =>
      createCommissionInputSchema.parse({ clientId: validUuid, title: 'x', type: 'y', priority: 0 })
    ).toThrow()
    expect(() =>
      createCommissionInputSchema.parse({ clientId: validUuid, title: 'x', type: 'y', priority: 6 })
    ).toThrow()
  })

  it('拒绝未知字段，尤其是渲染进程提交 paymentStatus', () => {
    expect(() =>
      createCommissionInputSchema.parse({
        clientId: validUuid,
        title: 'x',
        type: 'y',
        paymentStatus: 'paid'
      })
    ).toThrow()
    expect(() =>
      updateCommissionInputSchema.parse({ id: validUuid, paymentStatus: 'paid' })
    ).toThrow()
    expect(() =>
      updateCommissionInputSchema.parse({ id: validUuid, unknownField: 1 })
    ).toThrow()
  })
})
