import { describe, expect, it } from 'vitest'
import type { Client } from '@shared/domain'
import {
  DEFAULT_COMMISSION_QUERY,
  applyCommissionQuery,
  hasActiveCommissionFilters,
  isCommissionQueryModified,
  isCommissionOverdue,
  type CommissionQuery,
  type QueryContext
} from './commission-query'
import { makeClient, makeCommission } from '@/test-utils/fixtures'

const clientA = makeClient({ id: '11111111-1111-4111-8111-111111111111', name: '小夏' })
const clientB = makeClient({ id: '22222222-2222-4222-8222-222222222222', name: '阿青' })
const clientsById = new Map<string, Client>([
  [clientA.id, clientA],
  [clientB.id, clientB]
])

/** 固定时间的上下文，保证逾期筛选可重复验证 */
const context: QueryContext = {
  nowMs: Date.parse('2026-12-31T10:00:00.000Z'),
  todayISO: '2026-12-31'
}

function query(patch: Partial<CommissionQuery> = {}): CommissionQuery {
  return { ...DEFAULT_COMMISSION_QUERY, ...patch }
}

describe('委托查询：归档与搜索', () => {
  it('默认隐藏已归档', () => {
    const rows = [
      makeCommission({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '在办' }),
      makeCommission({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        title: '已归档',
        archivedAt: '2026-06-01T00:00:00.000Z'
      })
    ]

    expect(applyCommissionQuery(rows, clientsById, query(), context).map((row) => row.title)).toEqual([
      '在办'
    ])
    expect(
      applyCommissionQuery(rows, clientsById, query({ includeArchived: true }), context).map(
        (row) => row.title
      )
    ).toEqual(['在办', '已归档'])
  })

  it('按委托名与客户名搜索，忽略大小写与首尾空格', () => {
    const rows = [
      makeCommission({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'Half Body', clientId: clientA.id }),
      makeCommission({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: '头像', clientId: clientB.id })
    ]

    expect(
      applyCommissionQuery(rows, clientsById, query({ text: 'half' }), context).map((row) => row.title)
    ).toEqual(['Half Body'])
    expect(
      applyCommissionQuery(rows, clientsById, query({ text: '阿青' }), context).map((row) => row.title)
    ).toEqual(['头像'])
    expect(applyCommissionQuery(rows, clientsById, query({ text: '  不存在  ' }), context)).toEqual([])
  })
})

describe('委托查询：筛选', () => {
  const rows = [
    makeCommission({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '草稿', status: 'draft' }),
    makeCommission({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: '进行', status: 'active' }),
    makeCommission({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: '完成', status: 'completed' })
  ]

  it('按状态筛选', () => {
    expect(
      applyCommissionQuery(rows, clientsById, query({ status: 'active' }), context).map(
        (row) => row.title
      )
    ).toEqual(['进行'])
  })

  it('按付款状态筛选（未结清包含未付款与部分付款）', () => {
    const paymentRows = [
      makeCommission({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        title: '未付款',
        paymentStatus: 'unpaid',
        outstandingCents: 100
      }),
      makeCommission({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        title: '部分',
        paymentStatus: 'partial',
        paidAmountCents: 50,
        outstandingCents: 50
      }),
      makeCommission({
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        title: '已付清',
        paymentStatus: 'paid',
        paidAmountCents: 100,
        outstandingCents: 0,
        isSettled: true
      }),
      makeCommission({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        title: '未报价',
        quoteAmountCents: null,
        paymentStatus: 'unquoted',
        outstandingCents: null
      }),
      makeCommission({
        id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        title: '免费',
        quoteAmountCents: 0,
        paymentStatus: 'not_required',
        outstandingCents: 0,
        isSettled: true
      })
    ]

    const titles = (patch: Partial<CommissionQuery>) =>
      applyCommissionQuery(paymentRows, clientsById, query(patch), context).map((row) => row.title)

    expect(titles({ payment: 'unsettled' })).toEqual(['未付款', '部分'])
    expect(titles({ payment: 'paid' })).toEqual(['已付清'])
    expect(titles({ payment: 'unquoted' })).toEqual(['未报价'])
    expect(titles({ payment: 'free' })).toEqual(['免费'])
  })

  it('按客户筛选', () => {
    const mixed = [
      makeCommission({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: 'A 的委托', clientId: clientA.id }),
      makeCommission({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'B 的委托', clientId: clientB.id })
    ]
    expect(
      applyCommissionQuery(mixed, clientsById, query({ clientId: clientB.id }), context).map(
        (row) => row.title
      )
    ).toEqual(['B 的委托'])
  })
})

describe('委托查询：逾期（固定时间）', () => {
  it('日期型按日历日期比较，当天不算逾期', () => {
    const deadline = { kind: 'date' as const, date: '2026-12-31' }
    expect(isCommissionOverdue(makeCommission({ deadline }), context)).toBe(false)
    expect(
      isCommissionOverdue(makeCommission({ deadline }), { ...context, todayISO: '2027-01-01' })
    ).toBe(true)
  })

  it('时刻型按瞬间比较', () => {
    const deadline = {
      kind: 'datetime' as const,
      at: '2026-12-31T10:00:00.000Z',
      timeZone: 'Asia/Shanghai'
    }
    expect(isCommissionOverdue(makeCommission({ deadline }), context)).toBe(false)
    expect(
      isCommissionOverdue(makeCommission({ deadline }), {
        ...context,
        nowMs: Date.parse('2026-12-31T10:00:01.000Z')
      })
    ).toBe(true)
  })

  it('没有截止时间不算逾期，并可只筛出逾期项', () => {
    const deadline = { kind: 'date' as const, date: '2026-01-01' }
    const rows = [
      makeCommission({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '逾期', deadline }),
      makeCommission({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: '无截止' })
    ]

    expect(applyCommissionQuery(rows, clientsById, query({ overdueOnly: true }), context).map((r) => r.title)).toEqual([
      '逾期'
    ])
  })
})

describe('委托查询：排序', () => {
  const rows = [
    makeCommission({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: '中间',
      priority: 3,
      createdAt: '2026-02-01T00:00:00.000Z',
      deadline: { kind: 'date', date: '2026-03-01' }
    }),
    makeCommission({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      title: '最早创建',
      priority: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      deadline: { kind: 'none' }
    }),
    makeCommission({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      title: '最晚创建',
      priority: 5,
      createdAt: '2026-03-01T00:00:00.000Z',
      deadline: { kind: 'datetime', at: '2026-02-01T10:00:00.000Z', timeZone: 'Asia/Shanghai' }
    })
  ]

  const titles = (sort: CommissionQuery['sort']) =>
    applyCommissionQuery(rows, clientsById, query({ sort }), context).map((row) => row.title)

  it('默认按创建时间倒序', () => {
    expect(titles('created-desc')).toEqual(['最晚创建', '中间', '最早创建'])
  })

  it('按截止时间升序，无截止排最后', () => {
    expect(titles('deadline-asc')).toEqual(['最晚创建', '中间', '最早创建'])
  })

  it('按优先级升序', () => {
    expect(titles('priority-asc')).toEqual(['最早创建', '中间', '最晚创建'])
  })

  it('不修改传入数组', () => {
    const original = rows.map((row) => row.id)
    applyCommissionQuery(rows, clientsById, query({ sort: 'priority-asc' }), context)
    expect(rows.map((row) => row.id)).toEqual(original)
  })
})

describe('委托查询：组合条件', () => {
  it('搜索 + 状态 + 付款 + 客户可同时生效', () => {
    const rows = [
      makeCommission({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        title: '小夏头像',
        clientId: clientA.id,
        status: 'active',
        paymentStatus: 'partial',
        paidAmountCents: 100,
        outstandingCents: 100
      }),
      makeCommission({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        title: '小夏立绘',
        clientId: clientA.id,
        status: 'completed',
        paymentStatus: 'partial',
        paidAmountCents: 100,
        outstandingCents: 100
      })
    ]

    const result = applyCommissionQuery(
      rows,
      clientsById,
      query({ text: '小夏', status: 'active', payment: 'unsettled', clientId: clientA.id }),
      context
    )
    expect(result.map((row) => row.title)).toEqual(['小夏头像'])
  })
})

describe('委托查询：排序稳定性', () => {
  const contextFixed = { nowMs: Date.parse('2026-12-31T10:00:00.000Z'), todayISO: '2026-12-31' }

  function row(overrides = {}) {
    return makeCommission({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'x',
      createdAt: '2026-01-01T00:00:00.000Z',
      deadline: { kind: 'none' },
      priority: 3,
      ...overrides
    })
  }

  it('截止时间相同：按创建时间倒序，创建时间也相同则按 id 升序', () => {
    const rows = [
      row({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', createdAt: '2026-01-01T00:00:00.000Z', deadline: { kind: 'date', date: '2026-12-31' } }),
      row({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', createdAt: '2026-01-01T00:00:00.000Z', deadline: { kind: 'date', date: '2026-12-31' } }),
      row({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', createdAt: '2026-02-01T00:00:00.000Z', deadline: { kind: 'date', date: '2026-12-31' } })
    ]

    const result = applyCommissionQuery(rows, clientsById, query({ sort: 'deadline-asc' }), contextFixed)
    expect(result.map((r) => r.id)).toEqual([
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    ])
  })

  it('优先级相同：按创建时间倒序，再按 id 升序', () => {
    const rows = [
      row({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', createdAt: '2026-01-01T00:00:00.000Z', priority: 2 }),
      row({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', createdAt: '2026-01-01T00:00:00.000Z', priority: 2 }),
      row({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', createdAt: '2026-03-01T00:00:00.000Z', priority: 2 })
    ]

    const result = applyCommissionQuery(rows, clientsById, query({ sort: 'priority-asc' }), contextFixed)
    expect(result.map((r) => r.id)).toEqual([
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    ])
  })

  it('无截止的委托始终排在最后', () => {
    const rows = [
      row({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', deadline: { kind: 'none' } }),
      row({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', deadline: { kind: 'date', date: '2026-12-31' } }),
      row({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', deadline: { kind: 'none' } })
    ]

    const result = applyCommissionQuery(rows, clientsById, query({ sort: 'deadline-asc' }), contextFixed)
    expect(result[0]?.id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  })

  it('同样的输入连续两次得到完全相同的顺序', () => {
    const rows = [
      row({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      row({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
      row({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' })
    ]
    const first = applyCommissionQuery(rows, clientsById, query({ sort: 'priority-asc' }), contextFixed)
    const second = applyCommissionQuery(rows, clientsById, query({ sort: 'priority-asc' }), contextFixed)
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id))
  })
})

describe('查询状态判断', () => {
  it('识别是否设置了会减少结果的筛选', () => {
    expect(hasActiveCommissionFilters(query())).toBe(false)
    expect(hasActiveCommissionFilters(query({ text: 'x' }))).toBe(true)
    expect(hasActiveCommissionFilters(query({ status: 'active' }))).toBe(true)
    expect(hasActiveCommissionFilters(query({ payment: 'unsettled' }))).toBe(true)
    expect(hasActiveCommissionFilters(query({ clientId: 'some-id' }))).toBe(true)
    expect(hasActiveCommissionFilters(query({ overdueOnly: true }))).toBe(true)
  })

  it('排序不算筛选，但算“查询被改动”', () => {
    expect(hasActiveCommissionFilters(query({ sort: 'deadline-asc' }))).toBe(false)
    expect(isCommissionQueryModified(query({ sort: 'deadline-asc' }))).toBe(true)
    expect(isCommissionQueryModified(query())).toBe(false)
  })
})
