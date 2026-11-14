import { randomUUID } from 'node:crypto'
import {
  commissionSchema,
  type ByIdInput,
  type Commission,
  type CommissionStatus,
  type CreateCommissionInput,
  type Deadline,
  type ListCommissionsInput,
  type PaymentStatus,
  type UpdateCommissionInput
} from '@shared/domain'
import { DataError } from '@shared/errors'
import {
  COMMISSION_STATUS_LABELS,
  canTransitionCommissionStatus
} from '@shared/status'
import {
  assertAmountConsistency,
  derivePaymentStatus,
  isSettledStatus,
  outstandingCentsOf
} from '@shared/payment'
import type { AppDatabase } from '../database'

const COLUMNS = [
  'id',
  'client_id AS clientId',
  'title',
  'description',
  'type',
  'status',
  'priority',
  'deadline_kind AS deadlineKind',
  'deadline_date AS deadlineDate',
  'deadline_at AS deadlineAt',
  'deadline_timezone AS deadlineTimeZone',
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
  /** 取消归档：恢复为正常委托。幂等。 */
  unarchive(input: ByIdInput): Commission | null
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

function toNullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : toNumber(value)
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : String(value)
}

/** 把数据库行映射成对外契约对象（含派生的付款字段）。 */
function rowToCommission(row: Record<string, unknown>): Commission {
  const quote = toNullableNumber(row['quoteAmountCents'])
  const paid = toNumber(row['paidAmountCents'])
  const status = toText(row['paymentStatus']) as PaymentStatus

  let deadline: Deadline
  if (row['deadlineKind'] === 'date') {
    deadline = { kind: 'date', date: toText(row['deadlineDate']) }
  } else if (row['deadlineKind'] === 'datetime') {
    deadline = {
      kind: 'datetime',
      at: toText(row['deadlineAt']),
      timeZone: toText(row['deadlineTimeZone'])
    }
  } else {
    deadline = { kind: 'none' }
  }

  return commissionSchema.parse({
    id: toText(row['id']),
    clientId: toText(row['clientId']),
    title: toText(row['title']),
    description: row['description'] === null || row['description'] === undefined ? null : toText(row['description']),
    type: toText(row['type']),
    status: toText(row['status']),
    priority: toNumber(row['priority']),
    deadline,
    quoteAmountCents: quote,
    paidAmountCents: paid,
    paymentStatus: status,
    outstandingCents: outstandingCentsOf(quote, paid),
    isSettled: isSettledStatus(status),
    createdAt: toText(row['createdAt']),
    updatedAt: toText(row['updatedAt']),
    archivedAt: row['archivedAt'] === null || row['archivedAt'] === undefined ? null : toText(row['archivedAt'])
  })
}

/** 截止时间三态 → 四个列值。 */
function deadlineColumns(deadline: Deadline): {
  kind: string
  date: string | null
  at: string | null
  timeZone: string | null
} {
  if (deadline.kind === 'date') {
    return { kind: 'date', date: deadline.date, at: null, timeZone: null }
  }
  if (deadline.kind === 'datetime') {
    return { kind: 'datetime', date: null, at: deadline.at, timeZone: deadline.timeZone }
  }
  return { kind: 'none', date: null, at: null, timeZone: null }
}

/** 委托仓储：只做 SQL 与映射，不依赖 Electron。 */
export function createCommissionsRepository(db: AppDatabase): CommissionsRepository {
  function getById(id: string): Commission | null {
    const row = db.prepare(`SELECT ${COLUMNS} FROM commissions WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined
    return row ? rowToCommission(row) : null
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

      // 新建时尚未收款：金额组合必须是「未报价 / 免费 / 待付款」之一
      const quote = input.quoteAmountCents ?? null
      assertAmountConsistency(quote, 0)
      const paymentStatus = derivePaymentStatus(quote, 0)
      const deadline = deadlineColumns(input.deadline ?? { kind: 'none' })

      const id = randomUUID()
      const now = new Date().toISOString()

      db.prepare(
        `INSERT INTO commissions (
           id, client_id, title, description, type, status, priority,
           deadline_kind, deadline_date, deadline_at, deadline_timezone,
           quote_amount_cents, paid_amount_cents, payment_status,
           created_at, updated_at, archived_at
         ) VALUES (
           @id, @clientId, @title, @description, @type, 'draft', @priority,
           @deadlineKind, @deadlineDate, @deadlineAt, @deadlineTimeZone,
           @quoteAmountCents, 0, @paymentStatus,
           @createdAt, @updatedAt, NULL
         )`
      ).run({
        id,
        clientId: input.clientId,
        title: input.title,
        description: input.description ?? null,
        type: input.type,
        priority: input.priority,
        deadlineKind: deadline.kind,
        deadlineDate: deadline.date,
        deadlineAt: deadline.at,
        deadlineTimeZone: deadline.timeZone,
        quoteAmountCents: quote,
        paymentStatus,
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
      if (input.paymentStatus) {
        where.push('payment_status = @paymentStatus')
        params['paymentStatus'] = input.paymentStatus
      }

      const sql = `SELECT ${COLUMNS} FROM commissions${
        where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
      } ORDER BY datetime(created_at) DESC, id`

      return (db.prepare(sql).all(params) as Array<Record<string, unknown>>).map(rowToCommission)
    },

    get(input: ByIdInput): Commission | null {
      return getById(input.id)
    },

    update(input: UpdateCommissionInput): Commission | null {
      // 读-改-写放在同一个事务里，避免金额与状态出现中间态
      const run = db.transaction((patch: UpdateCommissionInput): Commission | null => {
        const current = db.prepare(`SELECT ${COLUMNS} FROM commissions WHERE id = ?`).get(patch.id) as
          | Record<string, unknown>
          | undefined
        if (!current) return null

        const currentQuote = toNullableNumber(current['quoteAmountCents'])
        const currentPaid = toNumber(current['paidAmountCents'])
        const currentStatus = toText(current['status']) as CommissionStatus

        // 状态流转必须符合约定，不允许跳步或回退到不存在的关系
        if (patch.status !== undefined && !canTransitionCommissionStatus(currentStatus, patch.status)) {
          throw new DataError(
            'INVALID_STATUS_TRANSITION',
            `不能从「${COMMISSION_STATUS_LABELS[currentStatus]}」直接变更为「${COMMISSION_STATUS_LABELS[patch.status]}」`
          )
        }

        const nextQuote = patch.quoteAmountCents === undefined ? currentQuote : patch.quoteAmountCents
        const nextPaid = patch.paidAmountCents === undefined ? currentPaid : patch.paidAmountCents

        assertAmountConsistency(nextQuote, nextPaid, {
          quoteChanged: patch.quoteAmountCents !== undefined
        })
        const paymentStatus = derivePaymentStatus(nextQuote, nextPaid)

        const fields: string[] = []
        const params: Record<string, unknown> = { id: patch.id, updatedAt: new Date().toISOString() }

        if (patch.title !== undefined) {
          fields.push('title = @title')
          params['title'] = patch.title
        }
        if (patch.description !== undefined) {
          fields.push('description = @description')
          params['description'] = patch.description ?? null
        }
        if (patch.type !== undefined) {
          fields.push('type = @type')
          params['type'] = patch.type
        }
        if (patch.priority !== undefined) {
          fields.push('priority = @priority')
          params['priority'] = patch.priority
        }
        if (patch.status !== undefined) {
          fields.push('status = @status')
          params['status'] = patch.status
        }
        if (patch.deadline !== undefined) {
          const deadline = deadlineColumns(patch.deadline)
          fields.push(
            'deadline_kind = @deadlineKind',
            'deadline_date = @deadlineDate',
            'deadline_at = @deadlineAt',
            'deadline_timezone = @deadlineTimeZone'
          )
          params['deadlineKind'] = deadline.kind
          params['deadlineDate'] = deadline.date
          params['deadlineAt'] = deadline.at
          params['deadlineTimeZone'] = deadline.timeZone
        }
        if (patch.quoteAmountCents !== undefined) {
          fields.push('quote_amount_cents = @quoteAmountCents')
          params['quoteAmountCents'] = patch.quoteAmountCents
        }
        if (patch.paidAmountCents !== undefined) {
          fields.push('paid_amount_cents = @paidAmountCents')
          params['paidAmountCents'] = patch.paidAmountCents
        }
        // 付款状态永远由金额推导，不接受外部传入
        if (patch.quoteAmountCents !== undefined || patch.paidAmountCents !== undefined) {
          fields.push('payment_status = @paymentStatus')
          params['paymentStatus'] = paymentStatus
        }

        if (fields.length === 0) return rowToCommission(current)

        db.prepare(`UPDATE commissions SET ${fields.join(', ')}, updated_at = @updatedAt WHERE id = @id`).run(
          params
        )
        return getById(patch.id)
      })

      return run(input)
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
    },

    unarchive(input: ByIdInput): Commission | null {
      const existing = getById(input.id)
      if (!existing) return null
      // 未归档时直接返回，避免无意义地刷新 updated_at
      if (existing.archivedAt === null) return existing

      const now = new Date().toISOString()
      db.prepare('UPDATE commissions SET archived_at = NULL, updated_at = @now WHERE id = @id').run({
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
