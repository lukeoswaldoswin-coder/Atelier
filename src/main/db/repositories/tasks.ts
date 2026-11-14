import { randomUUID } from 'node:crypto'
import {
  taskSchema,
  type ByIdInput,
  type CommissionStatus,
  type CreateTaskInput,
  type ListTasksInput,
  type ReorderTasksInput,
  type Task,
  type TaskStatus,
  type UpdateTaskInput
} from '@shared/domain'
import { DataError } from '@shared/errors'
import { TASK_STAGE_LABELS } from '@shared/tasks'
import type { AppDatabase } from '../database'

const STAGE_CASE = `CASE stage
  WHEN 'draft' THEN 0
  WHEN 'lineart' THEN 1
  WHEN 'color' THEN 2
  WHEN 'final' THEN 3
  ELSE 4 END`

const COLUMNS = [
  'id',
  'commission_id AS commissionId',
  'title',
  'description',
  'stage',
  'status',
  'estimated_minutes AS estimatedMinutes',
  'sort_order AS sortOrder',
  'completed_at AS completedAt',
  'created_at AS createdAt',
  'updated_at AS updatedAt',
  'archived_at AS archivedAt'
].join(', ')

export interface TasksRepository {
  list(input: ListTasksInput): Task[]
  create(input: CreateTaskInput): Task
  update(input: UpdateTaskInput): Task | null
  /** 只允许对「同一委托 + 同一阶段」的全部未归档任务做完整排序。 */
  reorder(input: ReorderTasksInput): Task[]
  archive(input: ByIdInput): Task | null
  unarchive(input: ByIdInput): Task | null
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : String(value)
}

function rowToTask(row: Record<string, unknown>): Task {
  return taskSchema.parse({
    id: toText(row['id']),
    commissionId: toText(row['commissionId']),
    title: toText(row['title']),
    description:
      row['description'] === null || row['description'] === undefined
        ? null
        : toText(row['description']),
    stage: toText(row['stage']),
    status: toText(row['status']),
    estimatedMinutes:
      row['estimatedMinutes'] === null || row['estimatedMinutes'] === undefined
        ? null
        : toNumber(row['estimatedMinutes']),
    sortOrder: toNumber(row['sortOrder']),
    completedAt:
      row['completedAt'] === null || row['completedAt'] === undefined
        ? null
        : toText(row['completedAt']),
    createdAt: toText(row['createdAt']),
    updatedAt: toText(row['updatedAt']),
    archivedAt:
      row['archivedAt'] === null || row['archivedAt'] === undefined
        ? null
        : toText(row['archivedAt'])
  })
}

/** 委托仓储：只做 SQL 与映射，不依赖 Electron。 */
export function createTasksRepository(db: AppDatabase): TasksRepository {
  function getById(id: string): Task | null {
    const row = db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined
    return row ? rowToTask(row) : null
  }

  function assertCommissionExists(commissionId: string): void {
    const row = db.prepare('SELECT 1 AS ok FROM commissions WHERE id = ?').get(commissionId)
    if (!row) throw new DataError('COMMISSION_NOT_FOUND', '委托不存在，无法操作任务')
  }

  function nextSortOrder(commissionId: string, stage: string): number {
    const row = db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next
           FROM tasks WHERE commission_id = ? AND stage = ? AND archived_at IS NULL`
      )
      .get(commissionId, stage) as { next: number }
    return row.next
  }

  function taskCounts(commissionId: string): { total: number; done: number } {
    return db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done
           FROM tasks WHERE commission_id = ? AND archived_at IS NULL`
      )
      .get(commissionId) as { total: number; done: number }
  }

  /**
   * 任务变化后统一维护委托状态。
   *
   * 规则（P2 产品决策）：
   * - 只有「明确把任务标记完成」这一操作，能在所有未归档任务都完成时自动完成委托；
   *   归档任务本身**不会**导致委托自动完成；
   * - 已完成委托一旦存在未完成任务（新增 / 恢复 / 重新打开），自动回到进行中；
   * - 已归档、已取消、草稿的委托不参与自动联动。
   */
  function reconcileCommission(
    commissionId: string,
    now: string,
    trigger: 'task-completed' | 'task-changed'
  ): void {
    const commission = db
      .prepare('SELECT status, archived_at AS archivedAt FROM commissions WHERE id = ?')
      .get(commissionId) as { status: CommissionStatus; archivedAt: string | null } | undefined
    if (!commission) return
    if (commission.archivedAt) return

    const counts = taskCounts(commissionId)
    if (counts.total === 0) return

    if (
      commission.status === 'active' &&
      trigger === 'task-completed' &&
      counts.done === counts.total
    ) {
      db.prepare(
        `UPDATE commissions SET status = 'completed', completed_at = @now, updated_at = @now
          WHERE id = @id`
      ).run({ id: commissionId, now })
      return
    }

    if (commission.status === 'completed' && counts.done < counts.total) {
      db.prepare(
        `UPDATE commissions SET status = 'active', completed_at = NULL, updated_at = @now
          WHERE id = @id`
      ).run({ id: commissionId, now })
    }
  }

  function listTasks(input: ListTasksInput): Task[] {
    const where = ['commission_id = @commissionId']
    if (!input.includeArchived) where.push('archived_at IS NULL')

    const sql = `SELECT ${COLUMNS} FROM tasks
                  WHERE ${where.join(' AND ')}
                  ORDER BY ${STAGE_CASE}, sort_order, created_at, id`
    return (db.prepare(sql).all({ commissionId: input.commissionId }) as Array<Record<string, unknown>>).map(
      rowToTask
    )
  }

  return {
    list(input: ListTasksInput): Task[] {
      return listTasks(input)
    },

    create(input: CreateTaskInput): Task {
      assertCommissionExists(input.commissionId)

      const now = new Date().toISOString()
      const id = randomUUID()
      const sortOrder = nextSortOrder(input.commissionId, input.stage)

      return db.transaction((): Task => {
        db.prepare(
          `INSERT INTO tasks (
             id, commission_id, title, description, stage, status,
             estimated_minutes, sort_order, completed_at, created_at, updated_at, archived_at
           ) VALUES (
             @id, @commissionId, @title, @description, @stage, 'todo',
             @estimatedMinutes, @sortOrder, NULL, @createdAt, @updatedAt, NULL
           )`
        ).run({
          id,
          commissionId: input.commissionId,
          title: input.title,
          description: input.description ?? null,
          stage: input.stage,
          estimatedMinutes: input.estimatedMinutes ?? null,
          sortOrder,
          createdAt: now,
          updatedAt: now
        })

        reconcileCommission(input.commissionId, now, 'task-changed')

        const created = getById(id)
        if (!created) throw new Error('任务创建后无法读回记录')
        return created
      })()
    },

    update(input: UpdateTaskInput): Task | null {
      return db.transaction((): Task | null => {
        const current = getById(input.id)
        if (!current) return null

        const now = new Date().toISOString()
        const nextStatus: TaskStatus = input.status ?? current.status
        const completing = input.status === 'done' && current.status !== 'done'
        const completedAt = nextStatus === 'done' ? (current.completedAt ?? now) : null

        const fields: string[] = []
        const params: Record<string, unknown> = { id: input.id, updatedAt: now }

        if (input.title !== undefined) {
          fields.push('title = @title')
          params['title'] = input.title
        }
        if (input.description !== undefined) {
          fields.push('description = @description')
          params['description'] = input.description ?? null
        }
        if (input.stage !== undefined) {
          fields.push('stage = @stage')
          params['stage'] = input.stage
        }
        if (input.estimatedMinutes !== undefined) {
          fields.push('estimated_minutes = @estimatedMinutes')
          params['estimatedMinutes'] = input.estimatedMinutes
        }
        if (input.status !== undefined) {
          fields.push('status = @status', 'completed_at = @completedAt')
          params['status'] = input.status
          params['completedAt'] = completedAt
        }

        if (fields.length === 0) return current

        db.prepare(`UPDATE tasks SET ${fields.join(', ')}, updated_at = @updatedAt WHERE id = @id`).run(
          params
        )

        reconcileCommission(current.commissionId, now, completing ? 'task-completed' : 'task-changed')

        return getById(input.id)
      })()
    },

    reorder(input: ReorderTasksInput): Task[] {
      return db.transaction((): Task[] => {
        const currentIds = (
          db
            .prepare(
              `SELECT id FROM tasks
                WHERE commission_id = ? AND stage = ? AND archived_at IS NULL`
            )
            .all(input.commissionId, input.stage) as Array<{ id: string }>
        ).map((row) => row.id)

        const currentSet = new Set(currentIds)
        const orderedSet = new Set(input.orderedIds)
        const sameSet =
          currentSet.size === orderedSet.size && input.orderedIds.every((id) => currentSet.has(id))

        if (!sameSet) {
          throw new DataError(
            'TASK_ORDER_MISMATCH',
            `排序列表必须包含「${TASK_STAGE_LABELS[input.stage]}」阶段的全部任务，请刷新后重试`
          )
        }

        const update = db.prepare(
          'UPDATE tasks SET sort_order = @sortOrder, updated_at = @updatedAt WHERE id = @id'
        )
        const now = new Date().toISOString()

        input.orderedIds.forEach((id, index) => {
          update.run({ id, sortOrder: index, updatedAt: now })
        })

        return listTasks({ commissionId: input.commissionId, includeArchived: false })
      })()
    },

    archive(input: ByIdInput): Task | null {
      return db.transaction((): Task | null => {
        const current = getById(input.id)
        if (!current) return null
        if (current.archivedAt) return current

        const now = new Date().toISOString()
        db.prepare('UPDATE tasks SET archived_at = @now, updated_at = @now WHERE id = @id').run({
          id: input.id,
          now
        })

        // 归档不会让委托自动完成（产品决策 1）
        reconcileCommission(current.commissionId, now, 'task-changed')

        return getById(input.id)
      })()
    },

    unarchive(input: ByIdInput): Task | null {
      return db.transaction((): Task | null => {
        const current = getById(input.id)
        if (!current) return null
        if (current.archivedAt === null) return current

        const now = new Date().toISOString()
        const sortOrder = nextSortOrder(current.commissionId, current.stage)
        db.prepare(
          `UPDATE tasks SET archived_at = NULL, sort_order = @sortOrder, updated_at = @now
            WHERE id = @id`
        ).run({ id: input.id, sortOrder, now })

        // 恢复未完成任务会让已完成的委托回到进行中（产品决策 3）
        reconcileCommission(current.commissionId, now, 'task-changed')

        return getById(input.id)
      })()
    }
  }
}
