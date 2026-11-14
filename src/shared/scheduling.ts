import { z } from 'zod'
import type {
  CalendarTask,
  Deadline,
  TaskStage,
  TaskStatus
} from './domain'
import { calendarDateOfDeadline } from './calendar-date'
import { taskStageRank } from './tasks'

/**
 * P5 简单辅助排期：纯算法、纯日期运算、输入快照。
 *
 * 重要约束：
 * - 算法不读取系统时间，todayISO 必须显式传入；
 * - 日期加减使用整数 civil-date 算法，不经过 UTC 时间戳；
 * - 不计算每日容量、时间窗口、工作日或任务依赖；
 * - 建议仅供参考，只有用户确认后才会写入计划日期。
 */

export const scheduleUrgencySchema = z.enum([
  'overdue',
  'due-soon',
  'this-week',
  'upcoming',
  'no-deadline',
  'later'
])
export type ScheduleUrgency = z.infer<typeof scheduleUrgencySchema>

/** 建议生成时依赖、采纳时必须保持一致的最小输入快照。 */
export const scheduleBasisSchema = z.strictObject({
  taskStatus: z.enum(['todo', 'doing', 'done']),
  estimatedMinutes: z.number().int().nonnegative().nullable(),
  commissionStatus: z.enum(['draft', 'active']),
  commissionPriority: z.number().int().min(1).max(5),
  deadlineFingerprint: z
    .string()
    .regex(
      /^(none|date:\d{4}-\d{2}-\d{2}|datetime:\d{4}-\d{2}-\d{2}T.+@.+)$/,
      '截止指纹格式无效'
    )
})
export type ScheduleBasis = z.infer<typeof scheduleBasisSchema>

export const scheduleApplyItemSchema = z.strictObject({
  taskId: z.string().regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    '必须是合法的 UUID'
  ),
  plannedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须是 YYYY-MM-DD'),
  basis: scheduleBasisSchema
})

export const scheduleApplyInputSchema = z
  .strictObject({
    items: z.array(scheduleApplyItemSchema).min(1, '至少选择一条建议').max(200, '一次最多采纳 200 条')
  })
  .superRefine((value, context) => {
    const seen = new Set<string>()
    for (const [index, item] of value.items.entries()) {
      if (seen.has(item.taskId)) {
        context.addIssue({
          code: 'custom',
          message: '同一任务不能重复提交',
          path: ['items', index, 'taskId']
        })
      }
      seen.add(item.taskId)
      if (!isCalendarDate(item.plannedDate)) {
        context.addIssue({
          code: 'custom',
          message: '计划日期不是真实日期',
          path: ['items', index, 'plannedDate']
        })
      }
    }
  })
export type ScheduleApplyInput = z.infer<typeof scheduleApplyInputSchema>

export const scheduleAppliedItemSchema = z.object({
  taskId: z.string().min(1),
  plannedDate: z.string().min(1)
})
export type ScheduleAppliedItem = z.infer<typeof scheduleAppliedItemSchema>

export const scheduleApplyOutputSchema = z.object({
  applied: z.array(scheduleAppliedItemSchema)
})
export type ScheduleApplyOutput = z.infer<typeof scheduleApplyOutputSchema>

export interface ScheduleSuggestion {
  taskId: string
  title: string
  commissionId: string
  commissionTitle: string
  clientName: string
  stage: TaskStage
  taskStatus: TaskStatus
  estimatedMinutes: number | null
  commissionPriority: number
  deadline: Deadline
  deadlineDate: string | null
  daysUntilDeadline: number | null
  overdueDays: number | null
  leadDays: number | null
  suggestedDate: string
  urgency: ScheduleUrgency
  basis: ScheduleBasis
}

export interface BuildScheduleSuggestionsInput {
  items: readonly CalendarTask[]
  /** 系统本地“今天”，由调用方通过 todayInZone 生成 */
  todayISO: string
}

export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  return day <= daysInMonth(year, month)
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function parseDate(value: string): { year: number; month: number; day: number } {
  if (!isCalendarDate(value)) throw new Error(`日期无效：${value}`)
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10))
  }
}

/** 纯整数 civil-date：1970-01-01 之前为负数，不经过 Date/UTC 时间戳。 */
function daysFromCivil(year: number, month: number, day: number): number {
  const adjustedYear = year - (month <= 2 ? 1 : 0)
  const era = Math.floor(adjustedYear / 400)
  const yearOfEra = adjustedYear - era * 400
  const monthIndex = month + (month > 2 ? -3 : 9)
  const dayOfYear = Math.floor((153 * monthIndex + 2) / 5) + day - 1
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + dayOfEra - 719468
}

function civilFromDays(daysSinceEpoch: number): { year: number; month: number; day: number } {
  const z = daysSinceEpoch + 719468
  const era = Math.floor(z / 146097)
  const dayOfEra = z - era * 146097
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365
  )
  const year = yearOfEra + era * 400
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1
  const month = monthPrime + (monthPrime < 10 ? 3 : -9)
  return { year: year + (month <= 2 ? 1 : 0), month, day }
}

function formatDate(parts: { year: number; month: number; day: number }): string {
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

/** 纯日历日期加减；不使用 UTC 时间戳。 */
export function addCalendarDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error('日期加减必须是整数天')
  const parts = parseDate(date)
  const total =
    daysFromCivil(parts.year, parts.month, parts.day) + days
  return formatDate(civilFromDays(total))
}

/** 纯日历日期差值：to - from。 */
export function calendarDaysBetween(from: string, to: string): number {
  const start = parseDate(from)
  const end = parseDate(to)
  return daysFromCivil(end.year, end.month, end.day) - daysFromCivil(start.year, start.month, start.day)
}

/** 截止时间的确定性指纹，用于判断建议依据是否仍然一致。 */
export function deadlineFingerprint(deadline: Deadline): string {
  if (deadline.kind === 'none') return 'none'
  if (deadline.kind === 'date') return `date:${deadline.date}`
  return `datetime:${deadline.at}@${deadline.timeZone}`
}

export function leadDaysForEstimate(estimatedMinutes: number | null): number {
  if (estimatedMinutes === null) return 2
  if (estimatedMinutes <= 60) return 1
  if (estimatedMinutes <= 180) return 2
  if (estimatedMinutes <= 360) return 3
  if (estimatedMinutes <= 720) return 5
  return 7
}

function urgencyOf(daysUntil: number | null): ScheduleUrgency {
  if (daysUntil === null) return 'no-deadline'
  if (daysUntil < 0) return 'overdue'
  if (daysUntil <= 3) return 'due-soon'
  if (daysUntil <= 7) return 'this-week'
  if (daysUntil <= 30) return 'upcoming'
  return 'later'
}

const URGENCY_RANK: Record<ScheduleUrgency, number> = {
  overdue: 0,
  'due-soon': 1,
  'this-week': 2,
  upcoming: 3,
  'no-deadline': 4,
  later: 5
}

function isEligible(item: CalendarTask): boolean {
  return (
    item.task.plannedDate === null &&
    item.task.archivedAt === null &&
    item.task.status !== 'done' &&
    (item.commission.status === 'draft' || item.commission.status === 'active')
  )
}

/**
 * 生成排期建议。
 * 输入、排序与日期计算完全确定；同样的 items + todayISO 永远得到同样结果。
 */
export function buildScheduleSuggestions(input: BuildScheduleSuggestionsInput): ScheduleSuggestion[] {
  const { items, todayISO } = input
  if (!isCalendarDate(todayISO)) {
    throw new Error(`todayISO 必须是真实日历日期（YYYY-MM-DD）：${todayISO}`)
  }

  const suggestions: ScheduleSuggestion[] = []

  for (const item of items) {
    if (!isEligible(item)) continue

    const deadlineDate = calendarDateOfDeadline(item.commission.deadline)
    const daysUntil = deadlineDate === null ? null : calendarDaysBetween(todayISO, deadlineDate)
    const overdueDays = daysUntil === null ? null : daysUntil < 0 ? -daysUntil : 0
    const leadDays = leadDaysForEstimate(item.task.estimatedMinutes)

    let suggestedDate = todayISO
    if (deadlineDate !== null && daysUntil !== null && daysUntil >= 0) {
      const latestStart = addCalendarDays(deadlineDate, -leadDays)
      suggestedDate = latestStart < todayISO ? todayISO : latestStart
    }

    const commissionStatus =
      item.commission.status === 'draft' ? 'draft' : ('active' as const)

    suggestions.push({
      taskId: item.task.id,
      title: item.task.title,
      commissionId: item.commission.id,
      commissionTitle: item.commission.title,
      clientName: item.clientName,
      stage: item.task.stage,
      taskStatus: item.task.status,
      estimatedMinutes: item.task.estimatedMinutes,
      commissionPriority: item.commission.priority,
      deadline: item.commission.deadline,
      deadlineDate,
      daysUntilDeadline: daysUntil,
      overdueDays,
      leadDays: deadlineDate === null ? null : leadDays,
      suggestedDate,
      urgency: urgencyOf(daysUntil),
      basis: {
        taskStatus: item.task.status,
        estimatedMinutes: item.task.estimatedMinutes,
        commissionStatus,
        commissionPriority: item.commission.priority,
        deadlineFingerprint: deadlineFingerprint(item.commission.deadline)
      }
    })
  }

  const sortOrder = new Map(items.map((item) => [item.task.id, item.task.sortOrder]))

  suggestions.sort((a, b) => {
    const urgency = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]
    if (urgency !== 0) return urgency

    const deadlineA = a.deadlineDate ?? '9999-12-31'
    const deadlineB = b.deadlineDate ?? '9999-12-31'
    if (deadlineA !== deadlineB) return deadlineA < deadlineB ? -1 : 1

    if (a.commissionPriority !== b.commissionPriority) {
      return a.commissionPriority - b.commissionPriority
    }

    if (a.suggestedDate !== b.suggestedDate) {
      return a.suggestedDate < b.suggestedDate ? -1 : 1
    }

    const estimateA = a.estimatedMinutes ?? Number.POSITIVE_INFINITY
    const estimateB = b.estimatedMinutes ?? Number.POSITIVE_INFINITY
    if (estimateA !== estimateB) return estimateA - estimateB

    const stage = taskStageRank(a.stage) - taskStageRank(b.stage)
    if (stage !== 0) return stage

    const orderA = sortOrder.get(a.taskId) ?? 0
    const orderB = sortOrder.get(b.taskId) ?? 0
    if (orderA !== orderB) return orderA - orderB

    return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0
  })

  return suggestions
}
