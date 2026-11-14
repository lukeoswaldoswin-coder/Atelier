import { beforeEach, describe, expect, it } from 'vitest'
import { createClientInputSchema, createCommissionInputSchema } from '@shared/domain'
import { DataError } from '@shared/errors'
import { applyMigrations } from '../migrator'
import { isForeignKeysEnabled, openDatabase, type AppDatabase } from '../database'
import { createClientsRepository, type ClientsRepository } from './clients'
import { createCommissionsRepository, type CommissionsRepository } from './commissions'

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

  it('创建委托：默认值正确（草稿 / 优先级 3 / 金额 0 / 未付款）', () => {
    const commission = repo.create(
      createCommissionInputSchema.parse({ clientId, title: '半身立绘', type: '插画' })
    )

    expect(commission.status).toBe('draft')
    expect(commission.priority).toBe(3)
    expect(commission.quoteAmountCents).toBe(0)
    expect(commission.paidAmountCents).toBe(0)
    expect(commission.paymentStatus).toBe('unpaid')
    expect(commission.deadlineAt).toBeNull()
    expect(commission.description).toBeNull()
    expect(commission.archivedAt).toBeNull()
  })

  it('金额按整数分保存，带小数的金额被契约拦下', () => {
    const commission = repo.create(
      createCommissionInputSchema.parse({
        clientId,
        title: '头像',
        type: '插画',
        quoteAmountCents: 12800
      })
    )
    expect(commission.quoteAmountCents).toBe(12800)

    expect(() => createCommissionInputSchema.parse({ clientId, title: 'x', type: 'y', quoteAmountCents: 12.5 })).toThrow()
    expect(() => createCommissionInputSchema.parse({ clientId, title: 'x', type: 'y', quoteAmountCents: -100 })).toThrow()
  })

  it('数据库层也拒绝小数金额（即使绕过契约直接写）', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO commissions (id, client_id, title, type, quote_amount_cents, created_at, updated_at)
           VALUES ('22222222-2222-4222-8222-222222222222', ?, 'x', 'y', 12.5, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
        )
        .run(clientId)
    ).toThrow()
  })

  it('客户不存在或已归档时拒绝创建，并给出可读错误', () => {
    expect(() =>
      repo.create(
        createCommissionInputSchema.parse({
          clientId: '00000000-0000-4000-8000-000000000000',
          title: 'x',
          type: 'y'
        })
      )
    ).toThrowError(DataError)

    clients.archive({ id: clientId })

    expect(() =>
      repo.create(createCommissionInputSchema.parse({ clientId, title: 'x', type: 'y' }))
    ).toThrowError(/已归档/)
  })

  it('列表支持按客户、状态筛选，默认隐藏已归档', () => {
    const first = repo.create(createCommissionInputSchema.parse({ clientId, title: 'A', type: '插画' }))
    const second = repo.create(createCommissionInputSchema.parse({ clientId, title: 'B', type: '漫画' }))
    repo.update({ id: first.id, status: 'active' })

    expect(repo.list({ includeArchived: false })).toHaveLength(2)
    expect(repo.list({ includeArchived: false, status: 'active' }).map((c) => c.title)).toEqual(['A'])
    expect(repo.list({ includeArchived: false, status: 'draft' }).map((c) => c.title)).toEqual(['B'])

    repo.archive({ id: second.id })
    expect(repo.list({ includeArchived: false })).toHaveLength(1)
    expect(repo.list({ includeArchived: true })).toHaveLength(2)
  })

  it('更新金额与状态，并刷新 updatedAt', async () => {
    const commission = repo.create(
      createCommissionInputSchema.parse({ clientId, title: '全身', type: '插画' })
    )

    await new Promise((resolve) => setTimeout(resolve, 5))
    const updated = repo.update({
      id: commission.id,
      status: 'active',
      paidAmountCents: 5000,
      paymentStatus: 'partial',
      deadlineAt: '2026-12-01T00:00:00.000Z'
    })

    expect(updated?.status).toBe('active')
    expect(updated?.paidAmountCents).toBe(5000)
    expect(updated?.paymentStatus).toBe('partial')
    expect(updated?.deadlineAt).toBe('2026-12-01T00:00:00.000Z')
    if (!updated) throw new Error('更新应返回委托记录')
    expect(updated.updatedAt >= commission.updatedAt).toBe(true)
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
