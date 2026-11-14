import { beforeEach, describe, expect, it } from 'vitest'
import { createClientInputSchema } from '@shared/domain'
import { applyMigrations } from '../migrator'
import { openDatabase, type AppDatabase } from '../database'
import { createClientsRepository, type ClientsRepository } from './clients'

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

describe('客户仓储', () => {
  let db: AppDatabase
  let repo: ClientsRepository

  beforeEach(() => {
    db = openDatabase(':memory:')
    applyMigrations(db)
    repo = createClientsRepository(db)
  })

  it('创建客户：生成 UUID、UTC 时间，可选字段为空时存 null', () => {
    const client = repo.create(
      createClientInputSchema.parse({ name: '小夏' })
    )

    expect(client.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(client.name).toBe('小夏')
    expect(client.contact).toBeNull()
    expect(client.note).toBeNull()
    expect(client.archivedAt).toBeNull()
    expect(client.createdAt).toMatch(UTC_ISO)
    expect(client.updatedAt).toBe(client.createdAt)
  })

  it('读取与列表：按名称排序，默认隐藏已归档', () => {
    const b = repo.create(createClientInputSchema.parse({ name: 'B 客户' }))
    const a = repo.create(createClientInputSchema.parse({ name: 'A 客户' }))

    expect(repo.get({ id: a.id })?.name).toBe('A 客户')
    expect(repo.get({ id: '00000000-0000-4000-8000-000000000000' })).toBeNull()

    repo.archive({ id: b.id })

    expect(repo.list({ includeArchived: false }).map((c) => c.name)).toEqual(['A 客户'])
    expect(repo.list({ includeArchived: true }).map((c) => c.name)).toEqual(['A 客户', 'B 客户'])
  })

  it('更新：只改传入字段，并刷新 updatedAt', async () => {
    const client = repo.create(createClientInputSchema.parse({ name: '旧名字', contact: 'qq:123' }))

    await new Promise((resolve) => setTimeout(resolve, 5))
    const updated = repo.update({ id: client.id, name: '新名字', note: '加了备注' })

    expect(updated?.name).toBe('新名字')
    expect(updated?.contact).toBe('qq:123')
    expect(updated?.note).toBe('加了备注')
    if (!updated) throw new Error('更新应返回客户记录')
    expect(updated.updatedAt >= client.updatedAt).toBe(true)
  })

  it('更新不存在的客户返回 null（不抛错）', () => {
    expect(repo.update({ id: '00000000-0000-4000-8000-000000000000', name: 'x' })).toBeNull()
  })

  it('归档是软删除：记录仍在，可以继续读取，重复归档幂等', async () => {
    const client = repo.create(createClientInputSchema.parse({ name: '要归档的' }))

    const archived = repo.archive({ id: client.id })
    expect(archived?.archivedAt).not.toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 5))
    const again = repo.archive({ id: client.id })
    expect(again?.archivedAt).toBe(archived?.archivedAt)

    expect(repo.get({ id: client.id })).not.toBeNull()
    expect(repo.list({ includeArchived: false })).toHaveLength(0)
  })

  it('客户表拒绝空名称（数据库层约束）', () => {
    expect(() =>
      db
        .prepare(
          `INSERT INTO clients (id, name, contact, note, created_at, updated_at, archived_at)
           VALUES ('11111111-1111-4111-8111-111111111111', '   ', NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`
        )
        .run()
    ).toThrow()
  })
})
