import { beforeEach, describe, expect, it } from 'vitest'
import {
  createClientInputSchema,
  createCommissionInputSchema,
  updateCommissionInputSchema
} from '@shared/domain'
import { DataError } from '@shared/errors'
import { formatDateTimeInZone } from '@shared/time'
import { applyMigrations } from '../migrator'
import { isForeignKeysEnabled, openDatabase, type AppDatabase } from '../database'
import { createClientsRepository, type ClientsRepository } from './clients'
import { createCommissionsRepository, type CommissionsRepository } from './commissions'

function codeOf(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof DataError) return error.code
    throw error
  }
  throw new Error('预期抛错但没有抛出')
}

describe('委托仓储', () => {
  let db: AppDatabase
  let clients: ClientsRepository
  let repo: CommissionsRepository
  let clientId: string

  beforeEach(() => {
    db = openDatabase(':memory:')
    applyMigrations(db)
    clients = createClientsRepository(db)
    repo = createCommissionsRepository(db)
    clientId = clients.create(createClientInputSchema.parse({ name: '测试客户' })).id
  })

  it('外键约束已开启', () => {
    expect(isForeignKeysEnabled(db)).toBe(true)
  })

  it('新建委托：默认草稿、优先级 3、未报价、未收款', () => {
    const commission = repo.create(
      createCommissionInputSchema.parse({ clientId, title: '半身立绘', type: '插画' })
    )

    expect(commission.status).toBe('draft')
    expect(commission.priority).toBe(3)
    expect(commission.quoteAmountCents).toBeNull()
    expect(commission.paidAmountCents).toBe(0)
    expect(commission.paymentStatus).toBe('unquoted')
    expect(commission.outstandingCents).toBeNull()
    expect(commission.isSettled).toBe(false)
    expect(commission.deadline).toEqual({ kind: 'none' })
    expect(commission.archivedAt).toBeNull()
  })

  it('免费委托：报价 0 → not_required，已结清且未收金额为 0', () => {
    const commission = repo.create(
      createCommissionInputSchema.parse({ clientId, title: '送朋友', type: '插画', quoteAmountCents: 0 })
    )

    expect(commission.quoteAmountCents).toBe(0)
    expect(commission.paymentStatus).toBe('not_required')
    expect(commission.outstandingCents).toBe(0)
    expect(commission.isSettled).toBe(true)
  })

  it('正常报价：未付款，未收金额等于报价', () => {
    const commission = repo.create(
      createCommissionInputSchema.parse({
        clientId,
        title: '头像',
        type: '插画',
        quoteAmountCents: 12800
      })
    )

    expect(commission.paymentStatus).toBe('unpaid')
    expect(commission.outstandingCents).toBe(12800)
    expect(commission.isSettled).toBe(false)
  })

  it('截止时间：日期型只存日期，不存时间与时区', () => {
    const commission = repo.create(
      createCommissionInputSchema.parse({
        clientId,
        title: '日期截止',
        type: '插画',
        deadline: { kind: 'date', date: '2026-12-31' }
      })
    )

    expect(commission.deadline).toEqual({ kind: 'date', date: '2026-12-31' })

    const row = db
      .prepare(
        'SELECT deadline_kind AS kind, deadline_date AS d, deadline_at AS at, deadline_timezone AS tz FROM commissions WHERE id = ?'
      )
      .get(commission.id) as Record<string, unknown>
    expect(row).toEqual({ kind: 'date', d: '2026-12-31', at: null, tz: null })
  })

  it('截止时间：时刻型保留 UTC 瞬间与创建时区，按创建时区显示', () => {
    const commission = repo.create(
      createCommissionInputSchema.parse({
        clientId,
        title: '时刻截止',
        type: '插画',
        deadline: {
          kind: 'datetime',
          at: '2026-12-31T10:00:00.000Z',
          timeZone: 'Asia/Shanghai'
        }
      })
    )

    expect(commission.deadline).toEqual({
      kind: 'datetime',
      at: '2026-12-31T10:00:00.000Z',
      timeZone: 'Asia/Shanghai'
    })

    const deadline = commission.deadline
    if (deadline.kind === 'datetime') {
      expect(formatDateTimeInZone(deadline.at, deadline.timeZone)).toBe('2026-12-31 18:00')
    }
  })

  it('金额：契约拒绝小数与负数', () => {
    expect(() =>
      createCommissionInputSchema.parse({ clientId, title: 'x', type: 'y', quoteAmountCents: 12.5 })
    ).toThrow()
    expect(() =>
      createCommissionInputSchema.parse({ clientId, title: 'x', type: 'y', quoteAmountCents: -100 })
    ).toThrow()
  })

  it('数据库层也拒绝不一致的金额组合（绕过契约直接写）', () => {
    const commission = repo.create(
      createCommissionInputSchema.parse({ clientId, title: 'x', type: 'y', quoteAmountCents: 12800 })
    )

    // 已收金额超过报价
    expect(() =>
      db.prepare('UPDATE commissions SET paid_amount_cents = 99999 WHERE id = ?').run(commission.id)
    ).toThrow()

    // 状态与金额不符
    expect(() =>
      db.prepare("UPDATE commissions SET payment_status = 'paid' WHERE id = ?").run(commission.id)
    ).toThrow()

    // 日期型截止带上了时间或时区
    expect(() =>
      db
        .prepare(
          "UPDATE commissions SET deadline_kind = 'date', deadline_date = '2026-12-31', deadline_at = '2026-12-31T00:00:00.000Z' WHERE id = ?"
        )
        .run(commission.id)
    ).toThrow()

    // 不存在的日历日期
    expect(() =>
      db
        .prepare(
          "UPDATE commissions SET deadline_kind = 'date', deadline_date = '2026-02-30', deadline_at = NULL, deadline_timezone = NULL WHERE id = ?"
        )
        .run(commission.id)
    ).toThrow()
  })

  it('更新金额：部分付款、付清、超额拒绝', () => {
    const commission = repo.create(
      createCommissionInputSchema.parse({ clientId, title: 'x', type: 'y', quoteAmountCents: 10000 })
    )

    const partial = repo.update({ id: commission.id, paidAmountCents: 4000 })
    expect(partial?.paymentStatus).toBe('partial')
    expect(partial?.outstandingCents).toBe(6000)
    expect(partial?.isSettled).toBe(false)

    const paid = repo.update({ id: commission.id, paidAmountCents: 10000 })
    expect(paid?.paymentStatus).toBe('paid')
    expect(paid?.outstandingCents).toBe(0)
    expect(paid?.isSettled).toBe(true)

    expect(codeOf(() => repo.update({ id: commission.id, paidAmountCents: 10001 }))).toBe('OVERPAY')
  })

  it('更新金额：报价不能降到已收金额以下', () => {
    const commission = repo.create(
      createCommissionInputSchema.parse({ clientId, title: 'x', type: 'y', quoteAmountCents: 10000 })
    )
    repo.update({ id: commission.id, paidAmountCents: 8000 })

    expect(codeOf(() => repo.update({ id: commission.id, quoteAmountCents: 5000 }))).toBe(
      'QUOTE_BELOW_PAID'
    )

    // 先降到 8000（等于已收）是允许的
    const updated = repo.update({ id: commission.id, quoteAmountCents: 8000 })
    expect(updated?.paymentStatus).toBe('paid')
  })

  it('未报价与免费委托都不能登记收款', () => {
    const unquoted = repo.create(
      createCommissionInputSchema.parse({ clientId, title: '未报价', type: 'y' })
    )
    expect(codeOf(() => repo.update({ id: unquoted.id, paidAmountCents: 100 }))).toBe(
      'PAYMENT_REQUIRES_QUOTE'
    )

    const free = repo.create(
      createCommissionInputSchema.parse({ clientId, title: '免费', type: 'y', quoteAmountCents: 0 })
    )
    expect(codeOf(() => repo.update({ id: free.id, paidAmountCents: 100 }))).toBe(
      'PAYMENT_REQUIRES_QUOTE'
    )
  })

  it('先填报价再收款是允许的', () => {
    const commission = repo.create(createCommissionInputSchema.parse({ clientId, title: 'x', type: 'y' }))
    repo.update({ id: commission.id, quoteAmountCents: 5000 })
    const paid = repo.update({ id: commission.id, paidAmountCents: 2000 })
    expect(paid?.paymentStatus).toBe('partial')
  })

  it('更新截止时间：三种形态互相切换会正确清空其他列', () => {
    const commission = repo.create(
      createCommissionInputSchema.parse({
        clientId,
        title: 'x',
        type: 'y',
        deadline: { kind: 'datetime', at: '2026-12-31T10:00:00.000Z', timeZone: 'Asia/Shanghai' }
      })
    )

    const asDate = repo.update({ id: commission.id, deadline: { kind: 'date', date: '2026-06-30' } })
    expect(asDate?.deadline).toEqual({ kind: 'date', date: '2026-06-30' })

    const cleared = repo.update({ id: commission.id, deadline: { kind: 'none' } })
    expect(cleared?.deadline).toEqual({ kind: 'none' })

    const row = db
      .prepare('SELECT deadline_kind AS kind, deadline_date AS d, deadline_at AS at, deadline_timezone AS tz FROM commissions WHERE id = ?')
      .get(commission.id) as Record<string, unknown>
    expect(row).toEqual({ kind: 'none', d: null, at: null, tz: null })
  })

  it('列表支持按付款状态筛选，默认隐藏归档', () => {
    const unpaid = repo.create(
      createCommissionInputSchema.parse({ clientId, title: 'A', type: 'y', quoteAmountCents: 1000 })
    )
    repo.create(createCommissionInputSchema.parse({ clientId, title: 'B', type: 'y' }))
    const paid = repo.create(
      createCommissionInputSchema.parse({ clientId, title: 'C', type: 'y', quoteAmountCents: 1000 })
    )
    repo.update({ id: paid.id, paidAmountCents: 1000 })

    expect(repo.list({ includeArchived: false })).toHaveLength(3)
    expect(repo.list({ includeArchived: false, paymentStatus: 'paid' }).map((c) => c.title)).toEqual(['C'])
    expect(repo.list({ includeArchived: false, paymentStatus: 'unquoted' }).map((c) => c.title)).toEqual([
      'B'
    ])

    repo.archive({ id: unpaid.id })
    expect(repo.list({ includeArchived: false })).toHaveLength(2)
    expect(repo.list({ includeArchived: true })).toHaveLength(3)
  })

  it('渲染进程无法通过更新契约提交 paymentStatus', () => {
    expect(() =>
      updateCommissionInputSchema.parse({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        paymentStatus: 'paid'
      })
    ).toThrow()
    expect(() =>
      createCommissionInputSchema.parse({
        clientId,
        title: 'x',
        type: 'y',
        paymentStatus: 'paid'
      })
    ).toThrow()
  })

  it('有委托的客户不能被物理删除（保护历史记录）', () => {
    repo.create(createCommissionInputSchema.parse({ clientId, title: 'x', type: 'y' }))

    expect(() => db.prepare('DELETE FROM clients WHERE id = ?').run(clientId)).toThrow()
    expect(clients.get({ id: clientId })).not.toBeNull()
  })

  it('状态只能是约定的四种值（数据库层约束）', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO commissions (id, client_id, title, type, status, created_at, updated_at)
           VALUES ('33333333-3333-4333-8333-333333333333', ?, 'x', 'y', 'unknown', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
        )
        .run(clientId)
    ).toThrow()
  })
})
