import { describe, expect, it } from 'vitest'
import { createClientInputSchema } from '@shared/domain'
import { applyMigrations } from '../migrator'
import { openDatabase, type AppDatabase } from '../database'
import { createClientsRepository, type ClientsRepository } from './clients'

describe('客户仓储：归档与取消归档', () => {
  function setup(): { db: AppDatabase; repo: ClientsRepository } {
    const db = openDatabase(':memory:')
    applyMigrations(db)
    return { db, repo: createClientsRepository(db) }
  }

  it('取消归档后客户重新可见', () => {
    const { db, repo } = setup()
    const client = repo.create(createClientInputSchema.parse({ name: '小夏' }))
    repo.archive({ id: client.id })
    expect(repo.list({ includeArchived: false })).toHaveLength(0)

    const restored = repo.unarchive({ id: client.id })

    expect(restored?.archivedAt).toBeNull()
    expect(repo.list({ includeArchived: false }).map((row) => row.id)).toEqual([client.id])
    expect(repo.list({ includeArchived: true })).toHaveLength(1)
    db.close()
  })

  it('重复取消归档是幂等的，不刷新 updatedAt', () => {
    const { db, repo } = setup()
    const client = repo.create(createClientInputSchema.parse({ name: '阿青' }))

    const first = repo.unarchive({ id: client.id })
    expect(first?.archivedAt).toBeNull()
    const before = first?.updatedAt

    const second = repo.unarchive({ id: client.id })
    expect(second?.updatedAt).toBe(before)
    db.close()
  })

  it('取消归档不存在的客户返回 null', () => {
    const { db, repo } = setup()
    expect(repo.unarchive({ id: '00000000-0000-4000-8000-000000000000' })).toBeNull()
    db.close()
  })

  it('归档再取消归档后，历史委托依然能关联到该客户', () => {
    const { db, repo } = setup()
    const client = repo.create(createClientInputSchema.parse({ name: '历史客户' }))
    db.prepare(
      `INSERT INTO commissions (id, client_id, title, type, created_at, updated_at)
       VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ?, '历史委托', '插画', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run(client.id)

    repo.archive({ id: client.id })
    expect(repo.get({ id: client.id })?.archivedAt).not.toBeNull()

    repo.unarchive({ id: client.id })
    const commission = db
      .prepare('SELECT client_id AS clientId FROM commissions WHERE id = ?')
      .get('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') as { clientId: string }
    expect(commission.clientId).toBe(client.id)
    db.close()
  })
})
