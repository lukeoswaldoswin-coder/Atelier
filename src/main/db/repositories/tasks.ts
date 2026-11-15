import { randomUUID } from 'node:crypto'
import {
  taskSchema,
  type AssignableTask,
  type ByIdInput,
  type CalendarDeadline,
  type CalendarTask,
  type CalendarTasksInput,
  type CalendarTasksOutput,
  type CommissionStatus,
  type CreateTaskInput,
  type Deadline,
  type ListTasksInput,
  type ReorderTasksInput,
  type Task,
  type TaskStatus,
  type UpdateTaskInput,
  type WorkbenchInput,
  type WorkbenchOutput,
  type WorkbenchTask
} from '@shared/domain'
import { DataError } from '@shared/errors'
import { calendarDateOfDeadline } from '@shared/calendar-date'
import {
  deadlineFingerprint,
  type ScheduleApplyInput,
  type ScheduleAppliedItem
} from '@shared/scheduling'
import { TASK_STAGE_LABELS } from '@shared/tasks'
import type { AppDatabase } from '../database'

const STAGE_CASE = `CASE t.stage
  WHEN 'draft' THEN 0
  WHEN 'lineart' THEN 1
  WHEN 'color' THEN 2
  WHEN 'final' THEN 3
  ELSE 4 END`

const TASK_COLUMNS = [
  't.id',
  't.commission_id AS commissionId',
  't.title',
  't.description',
  't.stage',
  't.status',
  't.estimated_minutes AS estimatedMinutes',
  't.planned_date AS plannedDate',
  't.sort_order AS sortOrder',
  't.completed_at AS completedAt',
  't.created_at AS createdAt',
  't.updated_at AS updatedAt',
  't.archived_at AS archivedAt'
].join(', ')

const COMMISSION_COLUMNS = [
  'c.id AS commissionId',
  'c.title AS commissionTitle',
  'c.status AS commissionStatus',
  'c.priority AS commissionPriority',
  'c.deadline_kind AS commissionDeadlineKind',
  'c.deadline_date AS commissionDeadlineDate',
  'c.deadline_at AS commissionDeadlineAt',
  'c.deadline_timezone AS commissionDeadlineTimeZone',
  'cl.name AS clientName'
].join(', ')

const CALENDAR_JOINS = `
  FROM tasks t
  JOIN commissions c ON c.id = t.commission_id
  LEFT JOIN clients cl ON cl.id = c.client_id
`

export interface TasksRepository {
  list(input: ListTasksInput): Task[]
  create(input: CreateTaskInput): Task
  update(input: UpdateTaskInput): Task | null
  /** 只允许对「同一委托 + 同一阶段」的全部未归档任务做完整排序。 */
  reorder(input: ReorderTasksInput): Task[]
  archive(input: ByIdInput): Task | null
  unarchive(input: ByIdInput): Task | null
  /** 全部任务（含归档），用于工时归属选择 */
  listAll(): AssignableTask[]
  /**
   * 绘画任务工作台：跨所有委托聚合任务。
   * 默认排除归档任务、已完成任务，以及归档/已取消委托下的任务。
   */
  workbench(input: WorkbenchInput): WorkbenchOutput
  /**
   * 采纳排期建议：只写 planned_date。
   * 事务内校验资格与建议快照；任一项不通过则整批回滚。
   */
  applyPlannedDates(input: ScheduleApplyInput): ScheduleAppliedItem[]
  /** 日历范围查询：已安排任务、未安排任务、范围内的委托截止。 */
  calendar(input: CalendarTasksInput): CalendarTasksOutput
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
    plannedDate:
      row['plannedDate'] === null || row['plannedDate'] === undefined
        ? null
        : toText(row['plannedDate']),
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
    const row = db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks t WHERE t.id = ?`).get(id) as
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
    const where = ['t.commission_id = @commissionId']
    if (!input.includeArchived) where.push('t.archived_at IS NULL')

    const sql = `SELECT ${TASK_COLUMNS} FROM tasks t
                  WHERE ${where.join(' AND ')}
                  ORDER BY ${STAGE_CASE}, t.sort_order, t.created_at, t.id`
    return (db.prepare(sql).all({ commissionId: input.commissionId }) as Array<Record<string, unknown>>).map(
      rowToTask
    )
  }

  function commissionFromRow(row: Record<string, unknown>) {
    let deadline: Deadline
    if (row['commissionDeadlineKind'] === 'date') {
      deadline = { kind: 'date', date: toText(row['commissionDeadlineDate']) }
    } else if (row['commissionDeadlineKind'] === 'datetime') {
      deadline = {
        kind: 'datetime',
        at: toText(row['commissionDeadlineAt']),
        timeZone: toText(row['commissionDeadlineTimeZone'])
      }
    } else {
      deadline = { kind: 'none' }
    }

    return {
      id: toText(row['commissionId']),
      title: toText(row['commissionTitle']),
      status: toText(row['commissionStatus']) as CommissionStatus,
      priority: toNumber(row['commissionPriority']),
      deadline
    }
  }

  function rowToCalendarTask(row: Record<string, unknown>): CalendarTask {
    return {
      task: rowToTask(row),
      commission: commissionFromRow(row),
      clientName: row['clientName'] === null || row['clientName'] === undefined ? '未知客户' : toText(row['clientName'])
    }
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
             estimated_minutes, planned_date, sort_order, completed_at,
             created_at, updated_at, archived_at
           ) VALUES (
             @id, @commissionId, @title, @description, @stage, 'todo',
             @estimatedMinutes, @plannedDate, @sortOrder, NULL,
             @createdAt, @updatedAt, NULL
           )`
        ).run({
          id,
          commissionId: input.commissionId,
          title: input.title,
          description: input.description ?? null,
          stage: input.stage,
          estimatedMinutes: input.estimatedMinutes ?? null,
          plannedDate: input.plannedDate ?? null,
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
        // 部分更新语义：undefined 保持、null 清除、日期更新
        if (input.plannedDate !== undefined) {
          fields.push('planned_date = @plannedDate')
          params['plannedDate'] = input.plannedDate
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
      return db.transaction((): Task[] => {        const currentIds = (
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
    },

    listAll(): AssignableTask[] {
      const rows = db
        .prepare(
          `SELECT t.id, t.title, c.id AS commissionId, c.title AS commissionTitle,
                  cl.name AS clientName, t.status, t.archived_at AS archivedAt
             FROM tasks t
             JOIN commissions c ON c.id = t.commission_id
             LEFT JOIN clients cl ON cl.id = c.client_id
            ORDER BY c.title COLLATE NOCASE, ${STAGE_CASE}, t.sort_order, t.id`
        )
        .all() as Array<Record<string, unknown>>

      return rows.map((row) => ({
        id: toText(row['id']),
        title: toText(row['title']),
        commissionId: toText(row['commissionId']),
        commissionTitle: toText(row['commissionTitle']),
        clientName:
          row['clientName'] === null || row['clientName'] === undefined
            ? '未知客户'
            : toText(row['clientName']),
        status: toText(row['status']) as TaskStatus,
        archivedAt:
          row['archivedAt'] === null || row['archivedAt'] === undefined
            ? null
            : toText(row['archivedAt'])
      }))
    },

    applyPlannedDates(input: ScheduleApplyInput): ScheduleAppliedItem[] {
      return db.transaction((): ScheduleAppliedItem[] => {
        const now = new Date().toISOString()
        const applied: ScheduleAppliedItem[] = []

        for (const item of input.items) {
          const row = db
            .prepare(
              `SELECT ${TASK_COLUMNS}, ${COMMISSION_COLUMNS},
                      c.archived_at AS commissionArchivedAt
                 ${CALENDAR_JOINS}
                WHERE t.id = @id`
            )
            .get({ id: item.taskId }) as Record<string, unknown> | undefined

          if (!row) {
            throw new DataError('SCHEDULE_CONFLICT', '任务不存在，请刷新建议后重试')
          }

          const task = rowToTask(row)
          const commission = commissionFromRow(row)

          // 先比对建议依据（不含计划日期）：关键数据变化即视为过期
          const stale =
            task.status !== item.basis.taskStatus ||
            task.estimatedMinutes !== item.basis.estimatedMinutes ||
            commission.status !== item.basis.commissionStatus ||
            commission.priority !== item.basis.commissionPriority ||
            deadlineFingerprint(commission.deadline) !== item.basis.deadlineFingerprint

          if (stale) {
            throw new DataError(
              'SCHEDULE_STALE',
              `「${task.title}」的建议依据已变化（任务状态、预计工时、委托优先级或截止），已拒绝写入，请刷新建议后重试`
            )
          }

          // 再校验当前是否仍可安排；计划日期变化只算冲突，不算建议过期
          if (task.archivedAt !== null) {
            throw new DataError('SCHEDULE_CONFLICT', `「${task.title}」已归档，无法安排`)
          }
          if (task.status === 'done') {
            throw new DataError('SCHEDULE_CONFLICT', `「${task.title}」已完成，无需安排`)
          }
          if (task.plannedDate !== null) {
            throw new DataError(
              'SCHEDULE_CONFLICT',
              `「${task.title}」已经有计划日期，请刷新建议后重试`
            )
          }
          if (row['commissionArchivedAt'] !== null && row['commissionArchivedAt'] !== undefined) {
            throw new DataError('SCHEDULE_CONFLICT', `「${task.title}」的委托已归档，无法安排`)
          }
          if (commission.status !== 'draft' && commission.status !== 'active') {
            throw new DataError(
              'SCHEDULE_CONFLICT',
              `「${task.title}」的委托不在进行中或草稿状态，无法安排`
            )
          }

          const result = db
            .prepare(
              `UPDATE tasks
                  SET planned_date = @plannedDate, updated_at = @now
                WHERE id = @id AND planned_date IS NULL`
            )
            .run({ id: item.taskId, plannedDate: item.plannedDate, now })

          if (result.changes !== 1) {
            throw new DataError(
              'SCHEDULE_CONFLICT',
              `「${task.title}」已经有计划日期，请刷新建议后重试`
            )
          }

          applied.push({ taskId: item.taskId, plannedDate: item.plannedDate })
        }

        return applied
      })()
    },

    /**
     * 工作台聚合查询。
     *
     * 复用现有 tasks / commissions / clients 与既有状态规则：
     * - 默认不显示已归档任务；
     * - 已归档、已取消的委托不进入待处理列表；
     * - 已完成任务单独一组返回，由界面折叠展示，不占用主区域；
     * - 不引入第二套任务状态。
     */
    workbench(input: WorkbenchInput): WorkbenchOutput {
      const where = ['t.archived_at IS NULL', "c.status <> 'cancelled'", 'c.archived_at IS NULL']
      if (input.includeArchived) {
        // 显式要求时放开归档过滤（保留查看能力）
        where.length = 0
        where.push("c.status <> 'cancelled'")
      }
      if (!input.includeDone) where.push("t.status <> 'done'")

      const sql = `SELECT ${TASK_COLUMNS}, ${COMMISSION_COLUMNS},
                          c.archived_at AS commissionArchivedAt,
                          COALESCE((
                            SELECT SUM(e.elapsed_seconds) FROM time_entries e
                             WHERE e.task_id = t.id AND e.deleted_at IS NULL
                               AND e.merged_into_id IS NULL AND e.status = 'completed'
                          ), 0) AS actualSeconds
                     ${CALENDAR_JOINS}
                    WHERE ${where.join(' AND ')}
                    ORDER BY
                      CASE c.deadline_kind
                        WHEN 'date' THEN c.deadline_date
                        WHEN 'datetime' THEN substr(c.deadline_at, 1, 10)
                        ELSE NULL END IS NULL,
                      CASE c.deadline_kind
                        WHEN 'date' THEN c.deadline_date
                        WHEN 'datetime' THEN substr(c.deadline_at, 1, 10)
                        ELSE NULL END,
                      ${STAGE_CASE}, t.sort_order, t.created_at, t.id`

      const rows = db.prepare(sql).all() as Array<Record<string, unknown>>

      const pending: WorkbenchTask[] = []
      const done: WorkbenchTask[] = []

      for (const row of rows) {
        const task = rowToTask(row)
        const item: WorkbenchTask = {
          task,
          commission: {
            id: toText(row['commissionId']),
            title: toText(row['commissionTitle']),
            status: toText(row['commissionStatus']) as CommissionStatus,
            archivedAt:
              row['commissionArchivedAt'] === null || row['commissionArchivedAt'] === undefined
                ? null
                : toText(row['commissionArchivedAt'])
          },
          clientName:
            row['clientName'] === null || row['clientName'] === undefined
              ? '未知客户'
              : toText(row['clientName']),
          actualSeconds: toNumber(row['actualSeconds'])
        }

        if (task.status === 'done') done.push(item)
        else pending.push(item)
      }

      return { pending, done }
    },

    calendar(input: CalendarTasksInput): CalendarTasksOutput {
      const scheduledRows = db
        .prepare(
          `SELECT ${TASK_COLUMNS}, ${COMMISSION_COLUMNS}
             ${CALENDAR_JOINS}
            WHERE t.archived_at IS NULL
              AND c.archived_at IS NULL
              AND c.status <> 'cancelled'
              AND t.planned_date BETWEEN @from AND @to
            ORDER BY t.planned_date, ${STAGE_CASE}, t.sort_order, t.created_at, t.id`
        )
        .all({ from: input.from, to: input.to }) as Array<Record<string, unknown>>

      // 未安排：未完成、未归档任务；委托仅草稿/进行中（已完成委托不进此列表）
      const unscheduledRows = db
        .prepare(
          `SELECT ${TASK_COLUMNS}, ${COMMISSION_COLUMNS}
             ${CALENDAR_JOINS}
            WHERE t.planned_date IS NULL
              AND t.archived_at IS NULL
              AND t.status <> 'done'
              AND c.archived_at IS NULL
              AND c.status IN ('draft', 'active')
            ORDER BY
              CASE c.deadline_kind
                WHEN 'date' THEN c.deadline_date
                WHEN 'datetime' THEN substr(c.deadline_at, 1, 10)
                ELSE NULL END IS NULL,
              CASE c.deadline_kind
                WHEN 'date' THEN c.deadline_date
                WHEN 'datetime' THEN substr(c.deadline_at, 1, 10)
                ELSE NULL END,
              ${STAGE_CASE}, t.sort_order, t.created_at, t.id`
        )
        .all() as Array<Record<string, unknown>>

      // 范围内的委托截止（与任务计划日期相互独立）
      const deadlineRows = db
        .prepare(
          `SELECT ${COMMISSION_COLUMNS}
             FROM commissions c
             LEFT JOIN clients cl ON cl.id = c.client_id
            WHERE c.archived_at IS NULL
              AND c.status <> 'cancelled'
              AND c.deadline_kind <> 'none'`
        )
        .all() as Array<Record<string, unknown>>

      const deadlines: CalendarDeadline[] = []
      for (const row of deadlineRows) {
        const commission = commissionFromRow(row)
        const date = calendarDateOfDeadline(commission.deadline)
        if (!date || date < input.from || date > input.to) continue
        deadlines.push({
          commission,
          clientName:
            row['clientName'] === null || row['clientName'] === undefined
              ? '未知客户'
              : toText(row['clientName']),
          date,
          deadline: commission.deadline
        })
      }
      deadlines.sort(
        (a, b) => a.date.localeCompare(b.date) || a.commission.title.localeCompare(b.commission.title, 'zh-Hans-CN')
      )

      return {
        scheduled: scheduledRows.map(rowToCalendarTask),
        unscheduled: unscheduledRows.map(rowToCalendarTask),
        deadlines
      }
    }
  }
}
