import {
  timeEntrySchema,
  type CommissionStatus,
  type TaskStage,
  type TaskStatus,
  type TimeEntry,
  type TimeEntryView,
  type TimeListInput
} from '@shared/domain'
import type { AppDatabase } from '../database'

export interface NewTimeEntry {
  id: string
  taskId: string | null
  source: 'manual' | 'auto'
  status: 'running' | 'paused' | 'completed'
  startedAt: string
  endedAt?: string | null
  elapsedSeconds: number
  lastHeartbeatAt: string | null
  appKey: string | null
  note: string | null
  clockSkewSeconds?: number | null
}

export interface TaskContext {
  taskId: string
  taskStatus: TaskStatus
  taskArchivedAt: string | null
  commissionStatus: CommissionStatus
  commissionArchivedAt: string | null
}

export interface TimeEntriesRepository {
  get(id: string): TimeEntry | null
  getView(id: string): TimeEntryView | null
  findActiveManual(): TimeEntry | null
  findActiveAuto(): TimeEntry | null
  insert(input: NewTimeEntry): TimeEntry
  checkpoint(id: string, elapsedSeconds: number, lastHeartbeatAt: string, updatedAt: string): void
  setStatus(
    id: string,
    status: 'running' | 'paused',
    elapsedSeconds: number,
    lastHeartbeatAt: string,
    updatedAt: string,
    note?: string | null
  ): void
  finalize(input: {
    id: string
    endedAt: string
    elapsedSeconds: number
    lastHeartbeatAt: string | null
    clockSkewSeconds: number
    note: string | null
    updatedAt: string
  }): TimeEntry | null
  listViews(input: TimeListInput): TimeEntryView[]
  /** 已完成、未删除记录的原始行（用于统计聚合） */
  listForSummary(fromIso: string, toIso: string): TimeEntryView[]
  updateCompleted(
    id: string,
    patch: { taskId?: string | null; note?: string | null; startedAt?: string; endedAt?: string; elapsedSeconds?: number },
    updatedAt: string
  ): TimeEntry | null
  softDelete(id: string, now: string): TimeEntry | null
  markMerged(ids: readonly string[], targetId: string, now: string): void
  /** 已完成记录的累计秒数，按任务分组 */
  sumByTask(taskIds: readonly string[]): Map<string, number>
  taskContext(taskId: string): TaskContext | null
  transaction<T>(fn: () => T): T
}

const COLUMNS = [
  'e.id',
  'e.task_id AS taskId',
  'e.source',
  'e.status',
  'e.started_at AS startedAt',
  'e.ended_at AS endedAt',
  'e.elapsed_seconds AS elapsedSeconds',
  'e.last_heartbeat_at AS lastHeartbeatAt',
  'e.app_key AS appKey',
  'e.merged_into_id AS mergedIntoId',
  'e.note',
  'e.clock_skew_seconds AS clockSkewSeconds',
  'e.deleted_at AS deletedAt',
  'e.created_at AS createdAt',
  'e.updated_at AS updatedAt'
].join(', ')

const VIEW_COLUMNS = [
  COLUMNS,
  't.title AS taskTitle',
  't.stage AS taskStage',
  'c.id AS commissionId',
  'c.title AS commissionTitle',
  'cl.name AS clientName'
].join(', ')

const VIEW_JOINS = `
  FROM time_entries e
  LEFT JOIN tasks t ON t.id = e.task_id
  LEFT JOIN commissions c ON c.id = t.commission_id
  LEFT JOIN clients cl ON cl.id = c.client_id
`

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : String(value)
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : toText(value)
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : toNumber(value)
}

function rowToEntry(row: Record<string, unknown>): TimeEntry {
  return timeEntrySchema.parse({
    id: toText(row['id']),
    taskId: nullableText(row['taskId']),
    source: toText(row['source']),
    status: toText(row['status']),
    startedAt: toText(row['startedAt']),
    endedAt: nullableText(row['endedAt']),
    elapsedSeconds: toNumber(row['elapsedSeconds']),
    lastHeartbeatAt: nullableText(row['lastHeartbeatAt']),
    appKey: nullableText(row['appKey']),
    mergedIntoId: nullableText(row['mergedIntoId']),
    note: nullableText(row['note']),
    clockSkewSeconds: nullableNumber(row['clockSkewSeconds']),
    deletedAt: nullableText(row['deletedAt']),
    createdAt: toText(row['createdAt']),
    updatedAt: toText(row['updatedAt'])
  })
}

function rowToView(row: Record<string, unknown>): TimeEntryView {
  const taskId = nullableText(row['taskId'])
  const taskTitle = nullableText(row['taskTitle'])
  const commissionId = nullableText(row['commissionId'])
  const commissionTitle = nullableText(row['commissionTitle'])
  const clientName = nullableText(row['clientName'])

  return {
    entry: rowToEntry(row),
    task:
      taskId && taskTitle
        ? { id: taskId, title: taskTitle, stage: toText(row['taskStage']) as TaskStage }
        : null,
    commission:
      commissionId && commissionTitle
        ? { id: commissionId, title: commissionTitle, clientName: clientName ?? '未知客户' }
        : null
  }
}

export function createTimeEntriesRepository(db: AppDatabase): TimeEntriesRepository {
  function get(id: string): TimeEntry | null {
    const row = db.prepare(`SELECT ${COLUMNS} FROM time_entries e WHERE e.id = ?`).get(id) as
      | Record<string, unknown>
      | undefined
    return row ? rowToEntry(row) : null
  }

  function findActive(source: 'manual' | 'auto'): TimeEntry | null {
    const row = db
      .prepare(
        `SELECT ${COLUMNS} FROM time_entries e
          WHERE e.source = ? AND e.deleted_at IS NULL
            AND e.status IN ('running', 'paused')
          ORDER BY e.started_at DESC LIMIT 1`
      )
      .get(source) as Record<string, unknown> | undefined
    return row ? rowToEntry(row) : null
  }

  function queryViews(input: TimeListInput): TimeEntryView[] {
    const where = [
      "e.deleted_at IS NULL",
      "e.status = 'completed'",
      'e.started_at >= @from',
      'e.started_at < @to'
    ]
    const params: Record<string, unknown> = { from: input.from, to: input.to }

    if (input.filter === 'unassigned') where.push('e.task_id IS NULL')
    if (input.taskId) {
      where.push('e.task_id = @taskId')
      params['taskId'] = input.taskId
    }
    if (input.commissionId) {
      where.push('c.id = @commissionId')
      params['commissionId'] = input.commissionId
    }

    const sql = `SELECT ${VIEW_COLUMNS} ${VIEW_JOINS} WHERE ${where.join(' AND ')}
                  ORDER BY e.started_at DESC, e.id DESC`
    return (db.prepare(sql).all(params) as Array<Record<string, unknown>>).map(rowToView)
  }

  return {
    get,
    getView(id: string): TimeEntryView | null {
      const row = db
        .prepare(`SELECT ${VIEW_COLUMNS} ${VIEW_JOINS} WHERE e.id = ?`)
        .get(id) as Record<string, unknown> | undefined
      return row ? rowToView(row) : null
    },
    findActiveManual: () => findActive('manual'),
    findActiveAuto: () => findActive('auto'),

    insert(input: NewTimeEntry): TimeEntry {
      const now = input.lastHeartbeatAt ?? input.startedAt
      db.prepare(
        `INSERT INTO time_entries (
           id, task_id, source, status, started_at, ended_at, elapsed_seconds,
           last_heartbeat_at, app_key, merged_into_id, note, clock_skew_seconds,
           deleted_at, created_at, updated_at
         ) VALUES (
           @id, @taskId, @source, @status, @startedAt, @endedAt, @elapsedSeconds,
           @lastHeartbeatAt, @appKey, NULL, @note, @clockSkewSeconds, NULL, @createdAt, @updatedAt
         )`
      ).run({
        ...input,
        endedAt: input.endedAt ?? null,
        clockSkewSeconds: input.clockSkewSeconds ?? null,
        createdAt: now,
        updatedAt: now
      })
      const created = get(input.id)
      if (!created) throw new Error('工时记录创建后无法读回')
      return created
    },

    checkpoint(id, elapsedSeconds, lastHeartbeatAt, updatedAt): void {
      db.prepare(
        `UPDATE time_entries
            SET elapsed_seconds = @elapsedSeconds, last_heartbeat_at = @lastHeartbeatAt,
                updated_at = @updatedAt
          WHERE id = @id AND status <> 'completed'`
      ).run({ id, elapsedSeconds, lastHeartbeatAt, updatedAt })
    },

    setStatus(id, status, elapsedSeconds, lastHeartbeatAt, updatedAt, note): void {
      db.prepare(
        `UPDATE time_entries
            SET status = @status, elapsed_seconds = @elapsedSeconds,
                last_heartbeat_at = @lastHeartbeatAt, updated_at = @updatedAt,
                note = COALESCE(@note, note)
          WHERE id = @id AND status <> 'completed'`
      ).run({ id, status, elapsedSeconds, lastHeartbeatAt, updatedAt, note: note ?? null })
    },

    finalize(input): TimeEntry | null {
      db.prepare(
        `UPDATE time_entries
            SET status = 'completed', ended_at = @endedAt, elapsed_seconds = @elapsedSeconds,
                last_heartbeat_at = @lastHeartbeatAt, clock_skew_seconds = @clockSkewSeconds,
                note = COALESCE(@note, note), updated_at = @updatedAt
          WHERE id = @id AND status <> 'completed'`
      ).run({
        id: input.id,
        endedAt: input.endedAt,
        elapsedSeconds: input.elapsedSeconds,
        lastHeartbeatAt: input.lastHeartbeatAt,
        clockSkewSeconds: input.clockSkewSeconds,
        note: input.note,
        updatedAt: input.updatedAt
      })
      return get(input.id)
    },

    listViews(input): TimeEntryView[] {
      return queryViews(input)
    },

    listForSummary(fromIso, toIso): TimeEntryView[] {
      return queryViews({ from: fromIso, to: toIso, filter: 'all' })
    },

    updateCompleted(id, patch, updatedAt): TimeEntry | null {
      const current = get(id)
      if (!current) return null
      if (current.status !== 'completed' || current.deletedAt !== null) {
        throw new Error('只能修改已完成的工时记录')
      }

      const nextStarted = patch.startedAt ?? current.startedAt
      const nextEnded = patch.endedAt ?? current.endedAt
      if (!nextEnded) throw new Error('记录缺少结束时间')
      if (Date.parse(nextEnded) < Date.parse(nextStarted)) {
        throw new Error('结束时间不能早于开始时间')
      }

      const elapsed =
        patch.startedAt !== undefined || patch.endedAt !== undefined
          ? Math.max(0, Math.round((Date.parse(nextEnded) - Date.parse(nextStarted)) / 1000))
          : current.elapsedSeconds

      db.prepare(
        `UPDATE time_entries
            SET task_id = @taskId, note = @note, started_at = @startedAt, ended_at = @endedAt,
                elapsed_seconds = @elapsedSeconds, clock_skew_seconds = 0, updated_at = @updatedAt
          WHERE id = @id`
      ).run({
        id,
        taskId: patch.taskId === undefined ? current.taskId : patch.taskId,
        note: patch.note === undefined ? current.note : patch.note,
        startedAt: nextStarted,
        endedAt: nextEnded,
        elapsedSeconds: elapsed,
        updatedAt
      })
      return get(id)
    },

    softDelete(id, now): TimeEntry | null {
      db.prepare('UPDATE time_entries SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, id)
      return get(id)
    },

    markMerged(ids, targetId, now): void {
      const statement = db.prepare(
        'UPDATE time_entries SET merged_into_id = @targetId, deleted_at = @now, updated_at = @now WHERE id = @id'
      )
      for (const id of ids) statement.run({ id, targetId, now })
    },

    sumByTask(taskIds): Map<string, number> {
      if (taskIds.length === 0) return new Map()
      const placeholders = taskIds.map(() => '?').join(', ')
      const rows = db
        .prepare(
          `SELECT task_id AS taskId, COALESCE(SUM(elapsed_seconds), 0) AS seconds
             FROM time_entries
            WHERE deleted_at IS NULL AND status = 'completed' AND task_id IN (${placeholders})
            GROUP BY task_id`
        )
        .all(...taskIds) as Array<{ taskId: string; seconds: number }>

      return new Map(rows.map((row) => [row.taskId, row.seconds]))
    },

    taskContext(taskId): TaskContext | null {
      const row = db
        .prepare(
          `SELECT t.status AS taskStatus, t.archived_at AS taskArchivedAt,
                  c.status AS commissionStatus, c.archived_at AS commissionArchivedAt
             FROM tasks t JOIN commissions c ON c.id = t.commission_id
            WHERE t.id = ?`
        )
        .get(taskId) as
        | {
            taskStatus: string
            taskArchivedAt: string | null
            commissionStatus: string
            commissionArchivedAt: string | null
          }
        | undefined

      if (!row) return null
      return {
        taskId,
        taskStatus: row.taskStatus as TaskStatus,
        taskArchivedAt: row.taskArchivedAt,
        commissionStatus: row.commissionStatus as CommissionStatus,
        commissionArchivedAt: row.commissionArchivedAt
      }
    },

    transaction<T>(fn: () => T): T {
      return db.transaction(fn)()
    }
  }
}
