import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createClientInputSchema, createCommissionInputSchema } from '@shared/domain'
import { createDatabaseService } from './service'

const createdDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'atelier-db-'))
  createdDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of createdDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  createdDirs.length = 0
})

describe('数据持久化', () => {
  it('关闭并重新打开数据库后，数据仍然存在（模拟关闭并重启软件）', () => {
    const dir = makeTempDir()
    const filePath = join(dir, 'atelier.db')

    // 第一次启动：建库、写数据
    const first = createDatabaseService(filePath)
    expect(first.migration.applied).toEqual([
      '001-initial',
      '002-deadline-and-payment',
      '003-tasks',
    '004-task-planned-date',
      '005-time-entries'
    ])

    const client = first.clients.create(createClientInputSchema.parse({ name: '重启测试客户' }))
    const commission = first.commissions.create(
      createCommissionInputSchema.parse({
        clientId: client.id,
        title: '重启测试委托',
        type: '插画',
        quoteAmountCents: 8800,
        deadline: {
          kind: 'datetime',
          at: '2026-12-31T10:00:00.000Z',
          timeZone: 'Asia/Shanghai'
        }
      })
    )
    first.commissions.update({ id: commission.id, paidAmountCents: 3000 })
    first.close()

    expect(existsSync(filePath)).toBe(true)

    // 第二次启动：不应重复迁移，数据应原样读回
    const second = createDatabaseService(filePath)
    expect(second.migration.applied).toEqual([])
    expect(second.migration.previouslyApplied).toEqual([
      '001-initial',
      '002-deadline-and-payment',
      '003-tasks',
    '004-task-planned-date',
      '005-time-entries'
    ])

    const clients = second.clients.list({ includeArchived: true })
    expect(clients.map((row) => row.id)).toEqual([client.id])

    const commissions = second.commissions.list({ includeArchived: true })
    expect(commissions).toHaveLength(1)
    const loaded = commissions[0]
    expect(loaded?.id).toBe(commission.id)
    expect(loaded?.quoteAmountCents).toBe(8800)
    expect(loaded?.paidAmountCents).toBe(3000)
    expect(loaded?.paymentStatus).toBe('partial')
    expect(loaded?.outstandingCents).toBe(5800)
    expect(loaded?.deadline).toEqual({
      kind: 'datetime',
      at: '2026-12-31T10:00:00.000Z',
      timeZone: 'Asia/Shanghai'
    })
    expect(loaded?.createdAt).toBe(commission.createdAt)

    second.close()
  })

  it('未报价与日期型截止在重启后保持原样（日期不做时区换算）', () => {
    const dir = makeTempDir()
    const filePath = join(dir, 'atelier.db')

    const first = createDatabaseService(filePath)
    const client = first.clients.create(createClientInputSchema.parse({ name: '客户' }))
    const commission = first.commissions.create(
      createCommissionInputSchema.parse({
        clientId: client.id,
        title: '日期截止且未报价',
        type: '插画',
        deadline: { kind: 'date', date: '2026-12-31' }
      })
    )
    first.close()

    const second = createDatabaseService(filePath)
    const loaded = second.commissions.get({ id: commission.id })
    expect(loaded?.quoteAmountCents).toBeNull()
    expect(loaded?.paymentStatus).toBe('unquoted')
    expect(loaded?.outstandingCents).toBeNull()
    expect(loaded?.deadline).toEqual({ kind: 'date', date: '2026-12-31' })
    second.close()
  })

  it('归档状态在重启后保持，历史记录没有被物理删除', () => {
    const dir = makeTempDir()
    const filePath = join(dir, 'atelier.db')

    const first = createDatabaseService(filePath)
    const client = first.clients.create(createClientInputSchema.parse({ name: '会归档的客户' }))
    const archived = first.clients.archive({ id: client.id })
    first.close()

    const second = createDatabaseService(filePath)
    const rows = second.clients.list({ includeArchived: true })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.archivedAt).toBe(archived?.archivedAt)
    expect(second.clients.list({ includeArchived: false })).toHaveLength(0)
    second.close()
  })
})
