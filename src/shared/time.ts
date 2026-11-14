/**
 * 时区与日期工具。
 *
 * 设计约束（P1.1.5）：
 * - 「日期型」截止时间（YYYY-MM-DD）是纯日历概念，**绝不做时区转换**；
 * - 「时刻型」截止时间存 UTC 瞬间 + 创建时使用的 IANA 时区，显示时按创建时区还原；
 * - 本地墙上时间 → UTC 的换算只允许在本文件实现，其他地方一律调用这里；
 * - 必须显式处理夏令时（DST）：不存在的时间要拒绝，重复的时间取较早的一次。
 */

const zoneCache = new Map<string, boolean>()

/** 校验 IANA 时区名是否被当前运行时支持。 */
export function isValidTimeZone(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const name = value.trim()
  if (name.length === 0 || name.length > 64) return false

  const cached = zoneCache.get(name)
  if (cached !== undefined) return cached

  let valid = true
  try {
    // 非法时区会在这里抛出 RangeError
    new Intl.DateTimeFormat('en-US', { timeZone: name })
  } catch {
    valid = false
  }
  zoneCache.set(name, valid)
  return valid
}

/** 取系统时区；取不到时退回 UTC，保证程序不会因此崩溃。 */
export function resolveSystemTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isValidTimeZone(zone) ? zone : 'UTC'
  } catch {
    return 'UTC'
  }
}

/** 校验 YYYY-MM-DD 是真实存在的日历日期（例如 2026-02-30 不是）。 */
export function isRealDateString(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false

  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  )
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function zonedParts(instantMs: number, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })

  const parts = formatter.formatToParts(new Date(instantMs))
  const read = (type: string): number => {
    const found = parts.find((part) => part.type === type)
    return found ? Number(found.value) : Number.NaN
  }

  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second')
  }
}

/** 该瞬间在指定时区的 UTC 偏移（毫秒）。 */
function offsetMs(instantMs: number, timeZone: string): number {
  const parts = zonedParts(instantMs, timeZone)
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const flooredToSecond = Math.floor(instantMs / 1000) * 1000
  return asUtc - flooredToSecond
}

export interface WallClockInput {
  /** YYYY-MM-DD */
  date: string
  /** HH:mm */
  time: string
  /** IANA 时区 */
  timeZone: string
}

export type ZonedConversion =
  | { ok: true; utc: string; ambiguous: boolean }
  | { ok: false; reason: 'invalid-date' | 'invalid-time' | 'invalid-time-zone' | 'nonexistent-time' }

/**
 * 把「某时区的墙上时间」换算成 UTC 瞬间。
 *
 * DST 处理：
 * - 春季跳变造成的不存在时间（如 America/New_York 2026-03-08 02:30）→ 返回 nonexistent-time；
 * - 秋季回拨造成的重复时间（如 2026-11-01 01:30）→ 取较早的一次，并标记 ambiguous。
 */
export function zonedDateTimeToUtc(input: WallClockInput): ZonedConversion {
  if (!isRealDateString(input.date)) return { ok: false, reason: 'invalid-date' }
  if (!/^\d{2}:\d{2}$/.test(input.time)) return { ok: false, reason: 'invalid-time' }
  if (!isValidTimeZone(input.timeZone)) return { ok: false, reason: 'invalid-time-zone' }

  const [year, month, day] = input.date.split('-').map(Number) as [number, number, number]
  const [hour, minute] = input.time.split(':').map(Number) as [number, number]
  if (hour > 23 || minute > 59) return { ok: false, reason: 'invalid-time' }

  const wallMs = Date.UTC(year, month - 1, day, hour, minute, 0)

  // 收集候选偏移：取墙上时间前后各 36 小时处的时区偏移，覆盖 DST 边界两侧
  const candidates = new Set<number>()
  for (const probe of [wallMs - 36 * 3600 * 1000, wallMs, wallMs + 36 * 3600 * 1000]) {
    candidates.add(offsetMs(probe, input.timeZone))
  }

  const valid: number[] = []
  for (const offset of candidates) {
    const utcMs = wallMs - offset
    const parts = zonedParts(utcMs, input.timeZone)
    if (
      parts.year === year &&
      parts.month === month &&
      parts.day === day &&
      parts.hour === hour &&
      parts.minute === minute
    ) {
      valid.push(utcMs)
    }
  }

  if (valid.length === 0) return { ok: false, reason: 'nonexistent-time' }

  valid.sort((a, b) => a - b)
  return {
    ok: true,
    utc: new Date(valid[0] as number).toISOString(),
    ambiguous: valid.length > 1
  }
}

/** 按指定时区格式化瞬间，输出 `YYYY-MM-DD HH:mm`。 */
export function formatDateTimeInZone(instant: string | number | Date, timeZone: string): string {
  const ms =
    typeof instant === 'string'
      ? Date.parse(instant)
      : instant instanceof Date
        ? instant.getTime()
        : instant

  const parts = zonedParts(ms, timeZone)
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`
}

/** 指定时区下的“今天”，输出 `YYYY-MM-DD`。 */
export function todayInZone(timeZone: string, now: number | Date = Date.now()): string {
  const ms = now instanceof Date ? now.getTime() : now
  const parts = zonedParts(ms, timeZone)
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`
}

/**
 * 日期型截止是否已逾期。
 * 基准是「当前系统本地日期」（P6 引入工作时区设置后改为工作时区），
 * 不把日期转成时间、也不写入任何 23:59。
 */
export function isDateDeadlineOverdue(
  deadlineDate: string,
  today: string = todayInZone(resolveSystemTimeZone())
): boolean {
  return today > deadlineDate
}
