/**
 * 日历日期工具：全部使用 `YYYY-MM-DD` 字符串 + UTC 运算，
 * 不经过本地时区，避免跨时区/夏令时导致的日期漂移。
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface DateParts {
  year: number
  month: number
  day: number
}

export function parseDateString(value: string): DateParts {
  const [year, month, day] = value.split('-').map(Number)
  return { year: year as number, month: month as number, day: day as number }
}

export function formatDateString(parts: DateParts): string {
  const year = String(parts.year).padStart(4, '0')
  const month = String(parts.month).padStart(2, '0')
  const day = String(parts.day).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toUtc(parts: DateParts): Date {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
}

function fromUtc(date: Date): string {
  return formatDateString({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  })
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function isValidParts(parts: DateParts): boolean {
  return (
    parts.month >= 1 &&
    parts.month <= 12 &&
    parts.day >= 1 &&
    parts.day <= daysInMonth(parts.year, parts.month)
  )
}

export function addDays(date: string, days: number): string {
  const parts = parseDateString(date)
  return fromUtc(new Date(toUtc(parts).getTime() + days * MS_PER_DAY))
}

/** 加/减月份；目标月天数不足时收敛到月末（1/31 + 1 月 → 2/28 或 2/29）。 */
export function addMonths(date: string, months: number): string {
  const parts = parseDateString(date)
  const total = parts.year * 12 + (parts.month - 1) + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const day = Math.min(parts.day, daysInMonth(year, month))
  return formatDateString({ year, month, day })
}

export function startOfMonth(date: string): string {
  const parts = parseDateString(date)
  return formatDateString({ year: parts.year, month: parts.month, day: 1 })
}

export function endOfMonth(date: string): string {
  const parts = parseDateString(date)
  return formatDateString({
    year: parts.year,
    month: parts.month,
    day: daysInMonth(parts.year, parts.month)
  })
}

/** 周一为一周起始。 */
export function startOfWeek(date: string): string {
  const parts = parseDateString(date)
  const weekday = toUtc(parts).getUTCDay()
  const offset = (weekday + 6) % 7
  return addDays(date, -offset)
}

/** 月视图 6×7 网格：从所在周的周一开始，共 42 天。 */
export function monthGrid(date: string): string[] {
  const first = startOfWeek(startOfMonth(date))
  return Array.from({ length: 42 }, (_, index) => addDays(first, index))
}

/** 周视图 7 天：周一到周日。 */
export function weekDates(date: string): string[] {
  const first = startOfWeek(date)
  return Array.from({ length: 7 }, (_, index) => addDays(first, index))
}

export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7)
}

export function formatMonthTitle(date: string): string {
  const parts = parseDateString(date)
  return `${parts.year} 年 ${parts.month} 月`
}

export function formatDayNumber(date: string): number {
  return parseDateString(date).day
}

/** 详情面板标题：`2026 年 3 月 2 日 周一`。 */
export function formatDayTitle(date: string): string {
  const parts = parseDateString(date)
  const weekday = toUtc(parts).getUTCDay()
  const label = WEEKDAY_LABELS[(weekday + 6) % 7] ?? ''
  return `${parts.year} 年 ${parts.month} 月 ${parts.day} 日 周${label}`
}

export function isPastDate(date: string, today: string): boolean {
  return date < today
}

export function isValidCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return isValidParts(parseDateString(value))
}

export const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const

/** 周视图标题：3月2日 – 3月8日。 */
export function formatWeekTitle(from: string, to: string): string {
  const start = parseDateString(from)
  const end = parseDateString(to)
  if (start.month === end.month) {
    return `${start.month} 月 ${start.day} 日 – ${end.day} 日`
  }
  return `${start.month} 月 ${start.day} 日 – ${end.month} 月 ${end.day} 日`
}
