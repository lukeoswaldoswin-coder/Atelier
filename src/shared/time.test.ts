import { describe, expect, it } from 'vitest'
import {
  formatDateTimeInZone,
  isDateDeadlineOverdue,
  isRealDateString,
  isValidTimeZone,
  resolveSystemTimeZone,
  todayInZone,
  zonedDateTimeToUtc
} from './time'

describe('时区名校验', () => {
  it('接受合法的 IANA 时区', () => {
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('America/New_York')).toBe(true)
    expect(isValidTimeZone('UTC')).toBe(true)
  })

  it('拒绝非法或空的时区', () => {
    expect(isValidTimeZone('Not/AZone')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
    expect(isValidTimeZone('   ')).toBe(false)
    expect(isValidTimeZone(null)).toBe(false)
    expect(isValidTimeZone('x'.repeat(65))).toBe(false)
  })

  it('系统时区始终能解析出一个合法值', () => {
    expect(isValidTimeZone(resolveSystemTimeZone())).toBe(true)
  })
})

describe('真实日历日期校验', () => {
  it('接受真实日期', () => {
    expect(isRealDateString('2026-12-31')).toBe(true)
    expect(isRealDateString('2028-02-29')).toBe(true)
  })

  it('拒绝不存在的日期与错误格式', () => {
    expect(isRealDateString('2026-02-30')).toBe(false)
    expect(isRealDateString('2026-13-01')).toBe(false)
    expect(isRealDateString('2026-00-10')).toBe(false)
    expect(isRealDateString('2026-1-1')).toBe(false)
    expect(isRealDateString('2026-12-31T00:00:00.000Z')).toBe(false)
  })
})

describe('墙上时间 → UTC', () => {
  it('上海时间换算正确（无夏令时）', () => {
    expect(zonedDateTimeToUtc({ date: '2026-12-31', time: '18:00', timeZone: 'Asia/Shanghai' })).toEqual({
      ok: true,
      utc: '2026-12-31T10:00:00.000Z',
      ambiguous: false
    })
  })

  it('夏令时春季跳变的不存在时间被拒绝', () => {
    expect(
      zonedDateTimeToUtc({ date: '2026-03-08', time: '02:30', timeZone: 'America/New_York' })
    ).toEqual({ ok: false, reason: 'nonexistent-time' })
  })

  it('夏令时秋季回拨的重复时间取较早的一次并标记 ambiguous', () => {
    expect(
      zonedDateTimeToUtc({ date: '2026-11-01', time: '01:30', timeZone: 'America/New_York' })
    ).toEqual({ ok: true, utc: '2026-11-01T05:30:00.000Z', ambiguous: true })
  })

  it('同一时刻在不同时区都合法（上海没有夏令时问题）', () => {
    expect(
      zonedDateTimeToUtc({ date: '2026-03-08', time: '02:30', timeZone: 'Asia/Shanghai' })
    ).toEqual({ ok: true, utc: '2026-03-07T18:30:00.000Z', ambiguous: false })
  })

  it('非法日期、时间与时区都被拒绝', () => {
    expect(zonedDateTimeToUtc({ date: '2026-02-30', time: '10:00', timeZone: 'UTC' })).toEqual({
      ok: false,
      reason: 'invalid-date'
    })
    expect(zonedDateTimeToUtc({ date: '2026-12-01', time: '24:00', timeZone: 'UTC' })).toEqual({
      ok: false,
      reason: 'invalid-time'
    })
    expect(zonedDateTimeToUtc({ date: '2026-12-01', time: '10:00', timeZone: 'Mars/Base' })).toEqual({
      ok: false,
      reason: 'invalid-time-zone'
    })
  })
})

describe('按创建时区格式化与“今天”', () => {
  it('同一瞬间按创建时区显示，不随系统时区漂移', () => {
    const instant = '2026-12-31T10:00:00.000Z'
    expect(formatDateTimeInZone(instant, 'Asia/Shanghai')).toBe('2026-12-31 18:00')
    expect(formatDateTimeInZone(instant, 'UTC')).toBe('2026-12-31 10:00')
    expect(formatDateTimeInZone(instant, 'America/New_York')).toBe('2026-12-31 05:00')
  })

  it('指定时区下的“今天”跨午夜正确', () => {
    expect(todayInZone('Asia/Shanghai', new Date('2026-12-31T15:59:00.000Z'))).toBe('2026-12-31')
    expect(todayInZone('Asia/Shanghai', new Date('2026-12-31T16:30:00.000Z'))).toBe('2027-01-01')
  })
})

describe('日期型逾期判断', () => {
  it('当天不算逾期，次日起算逾期', () => {
    expect(isDateDeadlineOverdue('2026-12-31', '2026-12-31')).toBe(false)
    expect(isDateDeadlineOverdue('2026-12-31', '2027-01-01')).toBe(true)
    expect(isDateDeadlineOverdue('2026-12-31', '2026-12-30')).toBe(false)
  })
})
