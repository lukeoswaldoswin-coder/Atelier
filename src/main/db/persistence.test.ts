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
    expect(first.migration.applied).toEqual(['001-initial'])

    const client = first.clients.create(createClientInputSchema.parse({ name: '重启测试客户' }))
    const commission = first.commissions.create(
      createCommissionInputSchema.parse({
        clientId: client.id,
        title: '重启测试委托',
        type: '插画',
        quoteAmountCents: 8800,
        deadlineAt: '2026-12-31T15:59:00.000Z'
      })
    )
    first.close()

    expect(existsSync(filePath)).toBe(true)

    // 第二次启动：不应重复迁移，数据应原样读回
    const second = createDatabaseService(filePath)
    expect(second.migration.applied).toEqual([])
    expect(second.migration.previouslyApplied).toEqual(['001-initial'])

    const clients = second.clients.list({ includeArchived: true })
    expect(clients.map((row) => row.id)).toEqual([client.id])

    const commissions = second.commissions.list({ includeArchived: true })
    expect(commissions).toHaveLength(1)
    expect(commissions[0]?.id).toBe(commission.id)
    expect(commissions[0]?.quoteAmountCents).toBe(8800)
    expect(commissions[0]?.deadlineAt).toBe('2026-12-31T15:59:00.000Z')
    expect(commissions[0]?.createdAt).toBe(commission.createdAt)

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
