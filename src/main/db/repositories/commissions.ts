import { randomUUID } from 'node:crypto'
import {
  commissionSchema,
  type ByIdInput,
  type Commission,
  type CommissionStatus,
  type CreateCommissionInput,
  type ListCommissionsInput,
  type UpdateCommissionInput
} from '@shared/domain'
import { DataError } from '@shared/errors'
import type { AppDatabase } from '../database'

const COLUMNS = [
  'id',
  'client_id AS clientId',
  'title',
  'description',
  'type',
  'status',
  'priority',
  'deadline_at AS deadlineAt',
  'quote_amount_cents AS quoteAmountCents',
  'paid_amount_cents AS paidAmountCents',
  'payment_status AS paymentStatus',
  'created_at AS createdAt',
  'updated_at AS updatedAt',
  'archived_at AS archivedAt'
].join(', ')

export interface CommissionsRepository {
  create(input: CreateCommissionInput): Commission
  list(input: ListCommissionsInput): Commission[]
  get(input: ByIdInput): Commission | null
  update(input: UpdateCommissionInput): Commission | null
  archive(input: ByIdInput): Commission | null
}

/** 委托仓储：只做 SQL 与映射，不依赖 Electron。 */
export function createCommissionsRepository(db: AppDatabase): CommissionsRepository {
  function getById(id: string): Commission | null {
    const row = db.prepare(`SELECT ${COLUMNS} FROM commissions WHERE id = ?`).get(id)
    return row ? commissionSchema.parse(row) : null
  }

  function assertClientUsable(clientId: string): void {
    const client = db.prepare('SELECT archived_at AS archivedAt FROM clients WHERE id = ?').get(clientId) as
      | { archivedAt: string | null }
      | undefined

    if (!client) throw new DataError('CLIENT_NOT_FOUND', '客户不存在，无法创建委托')
    if (client.archivedAt) throw new DataError('CLIENT_ARCHIVED', '客户已归档，不能为其新增委托')
  }

  return {
    create(input: CreateCommissionInput): Commission {
      assertClientUsable(input.clientId)

      const id = randomUUID()
      const now = new Date().toISOString()

      db.prepare(
        `INSERT INTO commissions (
           id, client_id, title, description, type, status, priority, deadline_at,
           quote_amount_cents, paid_amount_cents, payment_status, created_at, updated_at, archived_at
         ) VALUES (
           @id, @clientId, @title, @description, @type, @status, @priority, @deadlineAt,
           @quoteAmountCents, 0, 'unpaid', @createdAt, @updatedAt, NULL
         )`
      ).run({
        id,
        clientId: input.clientId,
        title: input.title,
        description: input.description ?? null,
        type: input.type,
        status: 'draft',
        priority: input.priority,
        deadlineAt: input.deadlineAt ?? null,
        quoteAmountCents: input.quoteAmountCents,
        createdAt: now,
        updatedAt: now
      })

      const created = getById(id)
      if (!created) throw new Error('委托创建后无法读回记录')
      return created
    },

    list(input: ListCommissionsInput): Commission[] {
      const where: string[] = []
      const params: Record<string, unknown> = {}

      if (!input.includeArchived) where.push('archived_at IS NULL')
      if (input.clientId) {
        where.push('client_id = @clientId')
        params['clientId'] = input.clientId
      }
      if (input.status) {
        where.push('status = @status')
        params['status'] = input.status
      }

      const sql = `SELECT ${COLUMNS} FROM commissions${
        where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
      } ORDER BY datetime(created_at) DESC, id`

      return (db.prepare(sql).all(params) as unknown[]).map((row) => commissionSchema.parse(row))
    },

    get(input: ByIdInput): Commission | null {
      return getById(input.id)
    },

    update(input: UpdateCommissionInput): Commission | null {
      const existing = getById(input.id)
      if (!existing) return null

      const fields: string[] = []
      const params: Record<string, unknown> = {
        id: input.id,
        updatedAt: new Date().toISOString()
      }

      if (input.title !== undefined) {
        fields.push('title = @title')
        params['title'] = input.title
      }
      if (input.description !== undefined) {
        fields.push('description = @description')
        params['description'] = input.description ?? null
      }
      if (input.type !== undefined) {
        fields.push('type = @type')
        params['type'] = input.type
      }
      if (input.priority !== undefined) {
        fields.push('priority = @priority')
        params['priority'] = input.priority
      }
      if (input.deadlineAt !== undefined) {
        fields.push('deadline_at = @deadlineAt')
        params['deadlineAt'] = input.deadlineAt ?? null
      }
      if (input.quoteAmountCents !== undefined) {
        fields.push('quote_amount_cents = @quoteAmountCents')
        params['quoteAmountCents'] = input.quoteAmountCents
      }
      if (input.paidAmountCents !== undefined) {
        fields.push('paid_amount_cents = @paidAmountCents')
        params['paidAmountCents'] = input.paidAmountCents
      }
      if (input.paymentStatus !== undefined) {
        fields.push('payment_status = @paymentStatus')
        params['paymentStatus'] = input.paymentStatus
      }
      if (input.status !== undefined) {
        fields.push('status = @status')
        params['status'] = input.status
      }

      if (fields.length === 0) return existing

      db.prepare(`UPDATE commissions SET ${fields.join(', ')}, updated_at = @updatedAt WHERE id = @id`).run(params)
      return getById(input.id)
    },

    archive(input: ByIdInput): Commission | null {
      const existing = getById(input.id)
      if (!existing) return null
      if (existing.archivedAt) return existing

      const now = new Date().toISOString()
      db.prepare('UPDATE commissions SET archived_at = @now, updated_at = @now WHERE id = @id').run({
        id: input.id,
        now
      })
      return getById(input.id)
    }
  }
}

/** 供测试与后续排期使用：按状态筛选时的合法值集合。 */
export const COMMISSION_STATUSES: readonly CommissionStatus[] = [
  'draft',
  'active',
  'completed',
  'cancelled'
]
