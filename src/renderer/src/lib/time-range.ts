import { zonedDateTimeToUtc } from '@shared/time'
import { addDays, startOfWeek } from './calendar'

export interface IsoRange {
  from: string
  to: string
}

function startOfDateIso(date: string, timeZone: string): string {
  const conversion = zonedDateTimeToUtc({ date, time: '00:00', timeZone })
  if (!conversion.ok) throw new Error(`日期无效：${date}`)
  return conversion.utc
}

/** 本地日历日 [date, date+1) 对应的 UTC 区间。 */
export function dayRangeIso(date: string, timeZone: string): IsoRange {
  return {
    from: startOfDateIso(date, timeZone),
    to: startOfDateIso(addDays(date, 1), timeZone)
  }
}

/** 本周（周一至周日）的 UTC 区间，右开。 */
export function weekRangeIso(today: string, timeZone: string): IsoRange {
  const start = startOfWeek(today)
  return {
    from: startOfDateIso(start, timeZone),
    to: startOfDateIso(addDays(start, 7), timeZone)
  }
}
