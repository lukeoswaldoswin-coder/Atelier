import { randomUUID } from 'node:crypto'
import {
  clientSchema,
  type ByIdInput,
  type Client,
  type CreateClientInput,
  type ListClientsInput,
  type UpdateClientInput
} from '@shared/domain'
import type { AppDatabase } from '../database'

const COLUMNS =
  'id, name, contact, note, created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt'

export interface ClientsRepository {
  create(input: CreateClientInput): Client
  list(input: ListClientsInput): Client[]
  get(input: ByIdInput): Client | null
  update(input: UpdateClientInput): Client | null
  /** 归档（软删除）：保留记录，只是从默认列表隐藏。 */
  archive(input: ByIdInput): Client | null
  /** 取消归档：恢复为正常客户。幂等。 */
  unarchive(input: ByIdInput): Client | null
}

/**
 * 客户仓储。
 * 只负责 SQL 与行↔领域对象映射，不含任何 Electron / IPC / 界面逻辑；
 * 每一条返回值都经过 Zod 校验，保证跨进程传输的数据形状符合契约。
 */
export function createClientsRepository(db: AppDatabase): ClientsRepository {
  function getById(id: string): Client | null {
    const row = db.prepare(`SELECT ${COLUMNS} FROM clients WHERE id = ?`).get(id)
    return row ? clientSchema.parse(row) : null
  }

  return {
    create(input: CreateClientInput): Client {
      const id = randomUUID()
      const now = new Date().toISOString()

      db.prepare(
        `INSERT INTO clients (id, name, contact, note, created_at, updated_at, archived_at)
         VALUES (@id, @name, @contact, @note, @createdAt, @updatedAt, NULL)`
      ).run({
        id,
        name: input.name,
        contact: input.contact ?? null,
        note: input.note ?? null,
        createdAt: now,
        updatedAt: now
      })

      const created = getById(id)
      if (!created) throw new Error('客户创建后无法读回记录')
      return created
    },

    list(input: ListClientsInput): Client[] {
      const sql = input.includeArchived
        ? `SELECT ${COLUMNS} FROM clients ORDER BY name COLLATE NOCASE, created_at`
        : `SELECT ${COLUMNS} FROM clients WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE, created_at`

      return (db.prepare(sql).all() as unknown[]).map((row) => clientSchema.parse(row))
    },

    get(input: ByIdInput): Client | null {
      return getById(input.id)
    },

    update(input: UpdateClientInput): Client | null {
      const existing = getById(input.id)
      if (!existing) return null

      const fields: string[] = []
      const params: Record<string, unknown> = {
        id: input.id,
        updatedAt: new Date().toISOString()
      }

      if (input.name !== undefined) {
        fields.push('name = @name')
        params['name'] = input.name
      }
      if (input.contact !== undefined) {
        fields.push('contact = @contact')
        params['contact'] = input.contact ?? null
      }
      if (input.note !== undefined) {
        fields.push('note = @note')
        params['note'] = input.note ?? null
      }

      if (fields.length === 0) return existing

      db.prepare(`UPDATE clients SET ${fields.join(', ')}, updated_at = @updatedAt WHERE id = @id`).run(params)
      return getById(input.id)
    },

    archive(input: ByIdInput): Client | null {
      const existing = getById(input.id)
      if (!existing) return null
      // 重复归档是幂等的，不改变首次归档时间
      if (existing.archivedAt) return existing

      const now = new Date().toISOString()
      db.prepare('UPDATE clients SET archived_at = @now, updated_at = @now WHERE id = @id').run({
        id: input.id,
        now
      })
      return getById(input.id)
    },

    unarchive(input: ByIdInput): Client | null {
      const existing = getById(input.id)
      if (!existing) return null
      // 未归档时直接返回，避免无意义地刷新 updated_at
      if (existing.archivedAt === null) return existing

      const now = new Date().toISOString()
      db.prepare('UPDATE clients SET archived_at = NULL, updated_at = @now WHERE id = @id').run({
        id: input.id,
        now
      })
      return getById(input.id)
    }
  }
}
