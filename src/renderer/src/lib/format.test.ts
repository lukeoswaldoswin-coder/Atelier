import { describe, expect, it } from 'vitest'
import {
  clientNameOf,
  formatDeadline,
  formatDeadlineDate,
  formatDeadlineDateTime,
  formatDeadlineDateTimeCompact,
  formatYuanFromCents,
  paymentPresentation,
  statusLabel
} from './format'
import { makeClient, makeCommission } from '@/test-utils/fixtures'

describe('金额格式化', () => {
  it('统一人民币格式，千分位与两位小数', () => {
    expect(formatYuanFromCents(0)).toBe('¥0.00')
    expect(formatYuanFromCents(5)).toBe('¥0.05')
    expect(formatYuanFromCents(50)).toBe('¥0.50')
    expect(formatYuanFromCents(1200)).toBe('¥12.00')
    expect(formatYuanFromCents(120000)).toBe('¥1,200.00')
    expect(formatYuanFromCents(123456789)).toBe('¥1,234,567.89')
  })

  it('负数保留符号', () => {
    expect(formatYuanFromCents(-120000)).toBe('-¥1,200.00')
  })
})

describe('截止时间格式化', () => {
  it('日期型原样输出，与任何时区无关', () => {
    // 函数签名里没有时区参数：日历日期在结构上就不可能被换算
    expect(formatDeadlineDate('2026-12-31')).toBe('2026-12-31')
    expect(formatDeadline({ kind: 'date', date: '2026-12-31' })).toBe('2026-12-31')
  })

  it('时刻型按创建时区显示，不同时区得到不同结果', () => {
    const at = '2026-12-31T10:00:00.000Z'
    expect(formatDeadlineDateTime(at, 'Asia/Shanghai')).toBe('2026-12-31 18:00')
    expect(formatDeadlineDateTime(at, 'UTC')).toBe('2026-12-31 10:00')
    expect(formatDeadlineDateTimeCompact(at, 'Asia/Shanghai')).toBe('12-31 18:00')
  })

  it('时刻型显示不随“查看者时区”变化（只看创建时区）', () => {
    // 同一条数据，无论当前系统时区是什么，输出都只由 authorTimeZone 决定
    const at = '2026-12-31T10:00:00.000Z'
    const asShanghai = formatDeadlineDateTime(at, 'Asia/Shanghai')
    const asNewYork = formatDeadlineDateTime(at, 'America/New_York')
    expect(asShanghai).toBe('2026-12-31 18:00')
    expect(asNewYork).toBe('2026-12-31 05:00')
  })

  it('未设置截止显示破折号', () => {
    expect(formatDeadline({ kind: 'none' })).toBe('—')
  })
})

describe('状态与付款展示', () => {
  it('委托状态文案', () => {
    expect(statusLabel('draft')).toBe('草稿')
    expect(statusLabel('active')).toBe('进行中')
    expect(statusLabel('completed')).toBe('已完成')
    expect(statusLabel('cancelled')).toBe('已取消')
  })

  it('五种付款状态区分清晰', () => {
    const unquoted = paymentPresentation(
      makeCommission({ quoteAmountCents: null, paymentStatus: 'unquoted', outstandingCents: null })
    )
    expect(unquoted).toEqual({ label: '未报价', detail: '—', tone: 'muted' })

    const free = paymentPresentation(
      makeCommission({
        quoteAmountCents: 0,
        paidAmountCents: 0,
        paymentStatus: 'not_required',
        outstandingCents: 0,
        isSettled: true
      })
    )
    expect(free).toEqual({ label: '免费', detail: '¥0.00', tone: 'muted' })

    const unpaid = paymentPresentation(
      makeCommission({ paidAmountCents: 0, paymentStatus: 'unpaid', outstandingCents: 120000 })
    )
    expect(unpaid).toEqual({ label: '未付款', detail: '未收 ¥1,200.00', tone: 'warning' })

    const partial = paymentPresentation(
      makeCommission({ paidAmountCents: 40000, paymentStatus: 'partial', outstandingCents: 80000 })
    )
    expect(partial).toEqual({
      label: '部分付款',
      detail: '已收 ¥400.00 · 未收 ¥800.00',
      tone: 'primary'
    })

    const paid = paymentPresentation(
      makeCommission({
        paidAmountCents: 120000,
        paymentStatus: 'paid',
        outstandingCents: 0,
        isSettled: true
      })
    )
    expect(paid).toEqual({ label: '已付清', detail: '¥1,200.00', tone: 'success' })
  })
})

describe('客户名称解析', () => {
  it('已归档客户仍然能显示名称', () => {
    const archivedClient = makeClient({ archivedAt: '2026-06-01T00:00:00.000Z' })
    const clientsById = new Map([[archivedClient.id, archivedClient]])
    const commission = makeCommission()

    expect(clientNameOf(commission, clientsById)).toBe('客户甲')
  })

  it('数据异常时给出可读占位，而不是空白', () => {
    expect(clientNameOf(makeCommission(), new Map())).toBe('未知客户')
  })
})
