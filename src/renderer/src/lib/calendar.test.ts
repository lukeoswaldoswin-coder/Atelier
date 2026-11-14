import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  daysInMonth,
  endOfMonth,
  formatMonthTitle,
  formatWeekTitle,
  isValidCalendarDate,
  isPastDate,
  isSameMonth,
  monthGrid,
  parseDateString,
  startOfMonth,
  startOfWeek,
  weekDates
} from './calendar'

describe('日历日期工具', () => {
  it('字符串解析与回写不发生时区漂移', () => {
    expect(parseDateString('2026-03-02')).toEqual({ year: 2026, month: 3, day: 2 })
    expect(addDays('2026-03-02', 0)).toBe('2026-03-02')
  })

  it('加天跨越月末、年末与闰日', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('加月时天数不足收敛到月末', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
  })

  it('月份边界', () => {
    expect(startOfMonth('2026-03-18')).toBe('2026-03-01')
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29')
    expect(isSameMonth('2026-03-01', '2026-03-31')).toBe(true)
    expect(isSameMonth('2026-03-01', '2026-04-01')).toBe(false)
  })

  it('周一为一周起始（周日应回到上一周的周一）', () => {
    expect(startOfWeek('2026-03-02')).toBe('2026-03-02') // 周一
    expect(startOfWeek('2026-03-08')).toBe('2026-03-02') // 周日
    expect(startOfWeek('2026-03-01')).toBe('2026-02-23') // 周日跨月
  })

  it('月视图为 42 天，覆盖整月', () => {
    const grid = monthGrid('2026-03-15')
    expect(grid).toHaveLength(42)
    expect(grid[0]).toBe('2026-02-23')
    expect(grid).toContain('2026-03-01')
    expect(grid).toContain('2026-03-31')
    expect(grid[41]).toBe('2026-04-05')
  })

  it('周视图为 7 天', () => {
    const week = weekDates('2026-03-04')
    expect(week).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08'
    ])
  })

  it('校验真实日历日期', () => {
    expect(isValidCalendarDate('2026-02-28')).toBe(true)
    expect(isValidCalendarDate('2024-02-29')).toBe(true)
    expect(isValidCalendarDate('2026-02-29')).toBe(false)
    expect(isValidCalendarDate('2026-02-30')).toBe(false)
    expect(isValidCalendarDate('2026-04-31')).toBe(false)
    expect(isValidCalendarDate('2026-13-01')).toBe(false)
    expect(isValidCalendarDate('2026-3-2')).toBe(false)
  })

  it('标题与过去日期', () => {
    expect(formatMonthTitle('2026-03-15')).toBe('2026 年 3 月')
    expect(formatWeekTitle('2026-03-02', '2026-03-08')).toBe('3 月 2 日 – 8 日')
    expect(formatWeekTitle('2026-02-23', '2026-03-01')).toBe('2 月 23 日 – 3 月 1 日')
    expect(isPastDate('2026-03-01', '2026-03-02')).toBe(true)
    expect(isPastDate('2026-03-02', '2026-03-02')).toBe(false)
    expect(daysInMonth(2024, 2)).toBe(29)
  })
})
