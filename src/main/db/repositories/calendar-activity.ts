/**
 * 每日创作工时聚合（P6.7）。
 *
 * 职责边界：
 * - 本文件只做「取数 + 聚合」，不做日期归属算法；
 *   把一个片段还原到自然日的规则全部在 @shared/calendar-activity 里，
 *   这样日历、工时记录页、任务汇总三处口径天然一致。
 * - 只读：不写任何表，也不改 time_entries 的既有语义。
 *
 * 三条硬约束：
 * 1. 只统计 `status='completed' AND deleted_at IS NULL AND merged_into_id IS NULL` 的记录。
 *    `merged_into_id` 非空的记录是被合并掉的原记录（已软删除），漏掉这个条件会重复计数。
 * 2. 区间边界用「本地自然日 00:00 对应的 UTC 瞬间」，与工时页 todayInZone 的口径一致；
 *    绝不直接用 UTC 日期字符串去比较，否则东八区凌晨 0–8 点的记录会算错日期。
 * 3. 活跃片段表可能还不存在（迁移 006 尚未执行），此时降级为「无片段」，
 *    按 calendar-activity 的老记录规则处理，不能让日历整页崩掉。
 */

import { attributeEntryToDays, type SegmentLike } from '@shared/calendar-activity'
import type {
  CalendarActivitySummaryInput,
  CalendarActivitySummaryOutput,
  CalendarDayActivity,
  CalendarDayCommissionActivity,
  CalendarDayDetailInput,
  CalendarDayDetailOutput,
  CalendarDayTaskActivity,
  TaskStage,
  TaskStatus
} from '@shared/domain'
import { resolveSystemTimeZone, zonedDateTimeToUtc } from '@shared/time'
import type { AppDatabase } from '../database'

/** 活跃片段表名（迁移 006 创建）。 */
const SEGMENTS_TABLE = 'time_entry_segments'

/**
 * SQLite 单条语句的变量上限（老版本是 999），
 * 62 天的区间可能涉及很多条记录，IN 列表必须分批，否则会报 too many SQL variables。
 */
const SEGMENT_ID_CHUNK = 400

/**
 * 本地日 00:00 的候选墙上时间。
 *
 * 某些时区在夏令时切换当天的本地 00:00 并不存在（例如时钟从 23:59 直接跳到 01:00），
 * 这时「当天第一个存在的时刻」才是真正的日界，因此按分钟顺序找到第一个可换算的时刻。
 */
const DAY_START_CANDIDATES = ['00:00', '00:30', '01:00', '01:30', '02:00', '02:30', '03:00']

const ENTRY_COLUMNS = [
  'e.id AS entryId',
  'e.task_id AS taskId',
  'e.started_at AS startedAt',
  'e.ended_at AS endedAt',
  'e.elapsed_seconds AS elapsedSeconds',
  't.title AS taskTitle',
  't.stage AS taskStage',
  't.status AS taskStatus',
  'c.id AS commissionId',
  'c.title AS commissionTitle',
  'cl.name AS clientName'
].join(', ')

/** 与 time-entries.ts 的 VIEW_JOINS 保持一致，避免两处取到的标题/客户名不同。 */
const ENTRY_JOINS = `
  FROM time_entries e
  LEFT JOIN tasks t ON t.id = e.task_id
  LEFT JOIN commissions c ON c.id = t.commission_id
  LEFT JOIN clients cl ON cl.id = c.client_id
`

/**
 * 参与统计的记录范围。
 *
 * - completed：只有结束的记录才有确定的工时；
 * - deleted_at IS NULL：已软删除的记录不算；
 * - merged_into_id IS NULL：被合并的原记录已经软删除，再加一次就是重复计数。
 */
const ENTRY_FILTER = `
  e.status = 'completed'
  AND e.deleted_at IS NULL
  AND e.merged_into_id IS NULL
`

/** 一条工时记录 + 它的任务/委托/客户上下文。 */
interface EntryRow {
  entryId: string
  taskId: string | null
  startedAt: string
  endedAt: string | null
  elapsedSeconds: number
  taskTitle: string | null
  taskStage: TaskStage | null
  taskStatus: TaskStatus | null
  commissionId: string | null
  commissionTitle: string | null
  clientName: string | null
}

/** 记录关联的任务信息；任务缺失（异常数据）时返回 null，按未关联处理。 */
interface TaskInfo {
  taskId: string
  taskTitle: string
  taskStatus: TaskStatus
  taskStage: TaskStage
  commissionId: string
  commissionTitle: string
  clientName: string
}

interface DayAccumulator {
  seconds: number
  unassignedSeconds: number
  taskIds: Set<string>
  commissionIds: Set<string>
}

export interface CalendarActivityRepository {
  /** 月视图摘要：只返回有工时的日期。 */
  summary(input: CalendarActivitySummaryInput): CalendarActivitySummaryOutput
  /** 单日详情：按任务聚合当天秒数，未关联任务的记录单独列出。 */
  dayDetail(input: CalendarDayDetailInput): CalendarDayDetailOutput
}

export interface CalendarActivityOptions {
  /**
   * 归属与日界使用的 IANA 时区。
   * 缺省取系统时区（与工时记录页 todayInZone 口径一致）；测试可注入固定时区。
   */
  timeZone?: string
}

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : String(value)
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : toText(value)
}

function rowToEntry(row: Record<string, unknown>): EntryRow {
  return {
    entryId: toText(row['entryId']),
    taskId: nullableText(row['taskId']),
    startedAt: toText(row['startedAt']),
    endedAt: nullableText(row['endedAt']),
    elapsedSeconds: toNumber(row['elapsedSeconds']),
    taskTitle: nullableText(row['taskTitle']),
    taskStage: nullableText(row['taskStage']) as TaskStage | null,
    taskStatus: nullableText(row['taskStatus']) as TaskStatus | null,
    commissionId: nullableText(row['commissionId']),
    commissionTitle: nullableText(row['commissionTitle']),
    clientName: nullableText(row['clientName'])
  }
}

function taskInfoOf(entry: EntryRow): TaskInfo | null {
  if (
    entry.taskId === null ||
    entry.taskTitle === null ||
    entry.taskStage === null ||
    entry.taskStatus === null ||
    entry.commissionId === null ||
    entry.commissionTitle === null
  ) {
    return null
  }

  return {
    taskId: entry.taskId,
    taskTitle: entry.taskTitle,
    taskStatus: entry.taskStatus,
    taskStage: entry.taskStage,
    commissionId: entry.commissionId,
    commissionTitle: entry.commissionTitle,
    // 与 tasks.ts 的日历查询一致：没有客户时用占位名，不显示空字符串
    clientName: entry.clientName ?? '未知客户'
  }
}

/** 日历日期 + 天数，纯日历运算（不做时区换算）。 */
function addDays(date: string, days: number): string {
  const base = Date.parse(`${date}T00:00:00.000Z`)
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10)
}

/** 某个本地自然日 00:00 对应的 UTC 瞬间（ISO 文本）。 */
function startOfLocalDayUtc(date: string, timeZone: string): string {
  for (const time of DAY_START_CANDIDATES) {
    const conversion = zonedDateTimeToUtc({ date, time, timeZone })
    if (conversion.ok) return conversion.utc
  }
  // 兜底：极端的时区数据异常时宁可差几小时，也不能让整月视图抛错
  return `${date}T00:00:00.000Z`
}

function createCalendarActivityRepository(
  db: AppDatabase,
  options: CalendarActivityOptions = {}
): CalendarActivityRepository {
  const resolveZone = (): string => options.timeZone ?? resolveSystemTimeZone()

  /** 片段表是否存在（迁移 006 可能还没跑）。 */
  function hasSegmentsTable(): boolean {
    const row = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(SEGMENTS_TABLE)
    return Boolean(row)
  }

  /**
   * 取这些记录的活跃片段。
   *
   * 表不存在或读取失败时返回空映射：调用方会按「无片段」的老记录规则归属，
   * 结果是「不精确但不会错」，比整页报错好得多。
   */
  function querySegments(entryIds: readonly string[]): Map<string, SegmentLike[]> {
    const byEntry = new Map<string, SegmentLike[]>()
    if (entryIds.length === 0) return byEntry
    if (!hasSegmentsTable()) return byEntry

    try {
      for (let start = 0; start < entryIds.length; start += SEGMENT_ID_CHUNK) {
        const chunk = entryIds.slice(start, start + SEGMENT_ID_CHUNK)
        const placeholders = chunk.map(() => '?').join(', ')
        const rows = db
          .prepare(
            `SELECT entry_id AS entryId, started_at AS startedAt,
                    ended_at AS endedAt, seconds
               FROM ${SEGMENTS_TABLE}
              WHERE entry_id IN (${placeholders})
              ORDER BY started_at`
          )
          .all(...chunk) as Array<Record<string, unknown>>

        for (const row of rows) {
          const entryId = toText(row['entryId'])
          const list = byEntry.get(entryId) ?? []
          list.push({
            startedAt: toText(row['startedAt']),
            endedAt: toText(row['endedAt']),
            seconds: toNumber(row['seconds'])
          })
          byEntry.set(entryId, list)
        }
      }
    } catch (error) {
      console.warn(`[atelier] 读取活跃片段失败，按无片段降级: ${String(error)}`)
      return new Map()
    }

    return byEntry
  }

  /**
   * 一次查出区间内所有参与统计的工时记录。
   *
   * 用「墙钟区间与查询区间有交集」而不是「started_at 落在区间内」：
   * 23:40 开始、次日 00:20 结束的记录，在次日那天的统计里同样要出现。
   */
  function queryEntries(fromIso: string, toIso: string): EntryRow[] {
    const sql = `SELECT ${ENTRY_COLUMNS} ${ENTRY_JOINS}
                  WHERE ${ENTRY_FILTER}
                    AND e.started_at < @to
                    AND (e.ended_at IS NULL OR e.ended_at > @from)
                  ORDER BY e.started_at, e.id`
    return (db.prepare(sql).all({ from: fromIso, to: toIso }) as Array<Record<string, unknown>>).map(
      rowToEntry
    )
  }

  /** 把一条记录拆到自然日，并只保留 [from, to] 内的日期。 */
  function entryDaySlices(
    entry: EntryRow,
    segments: readonly SegmentLike[],
    timeZone: string,
    from: string,
    to: string
  ): Array<{ date: string; seconds: number }> {
    const slices = attributeEntryToDays(
      {
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        elapsedSeconds: entry.elapsedSeconds
      },
      segments,
      timeZone
    )

    return slices.filter((slice) => slice.seconds > 0 && slice.date >= from && slice.date <= to)
  }

  function summary(input: CalendarActivitySummaryInput): CalendarActivitySummaryOutput {
    const timeZone = resolveZone()
    const fromIso = startOfLocalDayUtc(input.from, timeZone)
    const toIso = startOfLocalDayUtc(addDays(input.to, 1), timeZone)

    const entries = queryEntries(fromIso, toIso)
    const segments = querySegments(entries.map((entry) => entry.entryId))

    const perDay = new Map<string, DayAccumulator>()

    for (const entry of entries) {
      const task = taskInfoOf(entry)
      const slices = entryDaySlices(
        entry,
        segments.get(entry.entryId) ?? [],
        timeZone,
        input.from,
        input.to
      )

      for (const slice of slices) {
        const day = perDay.get(slice.date) ?? {
          seconds: 0,
          unassignedSeconds: 0,
          taskIds: new Set<string>(),
          commissionIds: new Set<string>()
        }

        day.seconds += slice.seconds
        if (task) {
          day.taskIds.add(task.taskId)
          day.commissionIds.add(task.commissionId)
        } else {
          // 未关联任务的工时单独统计，不计入任何任务/委托
          day.unassignedSeconds += slice.seconds
        }

        perDay.set(slice.date, day)
      }
    }

    const days: CalendarDayActivity[] = [...perDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, day]) => ({
        date,
        seconds: day.seconds,
        taskCount: day.taskIds.size,
        commissionCount: day.commissionIds.size,
        unassignedSeconds: day.unassignedSeconds
      }))

    return { days }
  }

  function dayDetail(input: CalendarDayDetailInput): CalendarDayDetailOutput {
    const timeZone = resolveZone()
    const fromIso = startOfLocalDayUtc(input.date, timeZone)
    const toIso = startOfLocalDayUtc(addDays(input.date, 1), timeZone)

    const entries = queryEntries(fromIso, toIso)
    const segments = querySegments(entries.map((entry) => entry.entryId))

    const byTask = new Map<string, CalendarDayTaskActivity>()
    const byCommission = new Map<string, CalendarDayCommissionActivity>()
    const unassignedEntryIds: string[] = []

    let totalSeconds = 0
    let unassignedSeconds = 0

    for (const entry of entries) {
      const slices = entryDaySlices(entry, segments.get(entry.entryId) ?? [], timeZone, input.date, input.date)
      // 同一条记录同一天可能有多个片段：先按记录合计，再累加到任务
      const daySeconds = slices.reduce((sum, slice) => sum + slice.seconds, 0)
      if (daySeconds <= 0) continue

      totalSeconds += daySeconds
      const task = taskInfoOf(entry)

      if (!task) {
        unassignedSeconds += daySeconds
        unassignedEntryIds.push(entry.entryId)
        continue
      }

      const taskItem = byTask.get(task.taskId) ?? {
        taskId: task.taskId,
        taskTitle: task.taskTitle,
        taskStatus: task.taskStatus,
        taskStage: task.taskStage,
        commissionId: task.commissionId,
        commissionTitle: task.commissionTitle,
        clientName: task.clientName,
        seconds: 0,
        entryIds: [] as string[]
      }
      taskItem.seconds += daySeconds
      taskItem.entryIds.push(entry.entryId)
      byTask.set(task.taskId, taskItem)

      const commissionItem = byCommission.get(task.commissionId) ?? {
        id: task.commissionId,
        title: task.commissionTitle,
        clientName: task.clientName,
        seconds: 0
      }
      commissionItem.seconds += daySeconds
      byCommission.set(task.commissionId, commissionItem)
    }

    const tasks = [...byTask.values()].sort(
      (a, b) => b.seconds - a.seconds || a.taskTitle.localeCompare(b.taskTitle, 'zh-Hans-CN')
    )
    const commissions = [...byCommission.values()].sort(
      (a, b) => b.seconds - a.seconds || a.title.localeCompare(b.title, 'zh-Hans-CN')
    )

    return {
      date: input.date,
      totalSeconds,
      unassignedSeconds,
      tasks,
      unassignedEntryIds,
      commissions
    }
  }

  return { summary, dayDetail }
}

export { createCalendarActivityRepository }
