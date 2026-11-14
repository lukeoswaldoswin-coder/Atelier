import { describe, expect, it } from 'vitest'
import { calendarDateOfDeadline } from './calendar-date'

describe('截止时间 → 日历日期', () => {
  it('仅日期原样返回，不做时区换算', () => {
    expect(calendarDateOfDeadline({ kind: 'date', date: '2026-03-10' })).toBe('2026-03-10')
  })

  it('无截止返回 null', () => {
    expect(calendarDateOfDeadline({ kind: 'none' })).toBeNull()
  })

  it('时刻型按创建时区取日期', () => {
    expect(
      calendarDateOfDeadline({
        kind: 'datetime',
        at: '2025-12-31T20:00:00.000Z',
        timeZone: 'Asia/Shanghai'
      })
    ).toBe('2026-01-01')

    expect(
      calendarDateOfDeadline({
        kind: 'datetime',
        at: '2026-03-05T10:00:00.000Z',
        timeZone: 'Asia/Shanghai'
      })
    ).toBe('2026-03-05')

    expect(
      calendarDateOfDeadline({
        kind: 'datetime',
        at: '2026-03-05T02:00:00.000Z',
        timeZone: 'America/New_York'
      })
    ).toBe('2026-03-04')
  })
})
