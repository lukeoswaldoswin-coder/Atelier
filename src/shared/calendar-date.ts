import type { Deadline } from './domain'
import { formatDateTimeInZone } from './time'

/**
 * 截止时间对应的「日历日期」（YYYY-MM-DD）。
 *
 * - 仅日期：原样返回，不做时区换算；
 * - 精确时刻：按创建时区换算成作者视角的日期；
 * - 无截止：null。
 */
export function calendarDateOfDeadline(deadline: Deadline): string | null {
  if (deadline.kind === 'none') return null
  if (deadline.kind === 'date') return deadline.date
  return formatDateTimeInZone(deadline.at, deadline.timeZone).slice(0, 10)
}
