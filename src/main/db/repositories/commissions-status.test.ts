import { beforeEach, describe, expect, it } from 'vitest'
import { createClientInputSchema, createCommissionInputSchema } from '@shared/domain'
import { DataError } from '@shared/errors'
import { applyMigrations } from '../migrator'
import { openDatabase, type AppDatabase } from '../database'
import { createClientsRepository } from './clients'
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

describe('委托状态流转与归档', () => {
  let db: AppDatabase
  let repo: CommissionsRepository
  let commissionId: string

  beforeEach(() => {
    db = openDatabase(':memory:')
    applyMigrations(db)
    const clientId = createClientsRepository(db).create(
      createClientInputSchema.parse({ name: '客户' })
    ).id
    repo = createCommissionsRepository(db)
    commissionId = repo.create(
      createCommissionInputSchema.parse({ clientId, title: '委托', type: '插画', quoteAmountCents: 10000 })
    ).id
  })

  it('草稿 → 进行中 → 已完成，再重新打开', () => {
    expect(repo.update({ id: commissionId, status: 'active' })?.status).toBe('active')
    expect(repo.update({ id: commissionId, status: 'completed' })?.status).toBe('completed')
    expect(repo.update({ id: commissionId, status: 'active' })?.status).toBe('active')
  })

  it('取消后可以恢复为草稿', () => {
    expect(repo.update({ id: commissionId, status: 'cancelled' })?.status).toBe('cancelled')
    expect(repo.update({ id: commissionId, status: 'draft' })?.status).toBe('draft')
  })

  it('拒绝跳步：草稿不能直接变已完成，取消后不能直接变进行中', () => {
    expect(codeOf(() => repo.update({ id: commissionId, status: 'completed' }))).toBe(
      'INVALID_STATUS_TRANSITION'
    )

    repo.update({ id: commissionId, status: 'cancelled' })
    expect(codeOf(() => repo.update({ id: commissionId, status: 'active' }))).toBe(
      'INVALID_STATUS_TRANSITION'
    )
  })

  it('非法流转会整体回滚，其他字段也不会被改动', () => {
    expect(() =>
      repo.update({ id: commissionId, status: 'completed', title: '不该保存的标题' })
    ).toThrowError(/不能从/)

    const row = repo.get({ id: commissionId })
    expect(row?.status).toBe('draft')
    expect(row?.title).toBe('委托')
  })

  it('归档：默认列表隐藏，数据仍在', () => {
    repo.archive({ id: commissionId })

    expect(repo.list({ includeArchived: false })).toHaveLength(0)
    expect(repo.list({ includeArchived: true })).toHaveLength(1)
    expect(repo.get({ id: commissionId })).not.toBeNull()
  })

  it('取消归档：恢复可见，重复调用幂等', () => {
    repo.archive({ id: commissionId })
    const restored = repo.unarchive({ id: commissionId })
    expect(restored?.archivedAt).toBeNull()
    expect(repo.list({ includeArchived: false })).toHaveLength(1)

    const before = restored?.updatedAt
    expect(repo.unarchive({ id: commissionId })?.updatedAt).toBe(before)
  })

  it('取消归档不存在的委托返回 null', () => {
    expect(repo.unarchive({ id: '00000000-0000-4000-8000-000000000000' })).toBeNull()
  })

  it('归档不删除历史数据：金额与客户关联都保留', () => {
    repo.update({ id: commissionId, paidAmountCents: 4000 })
    repo.archive({ id: commissionId })

    const archived = repo.list({ includeArchived: true })[0]
    expect(archived?.quoteAmountCents).toBe(10000)
    expect(archived?.paidAmountCents).toBe(4000)
    expect(archived?.paymentStatus).toBe('partial')
    expect(archived?.clientId).toBeTruthy()
  })
})
