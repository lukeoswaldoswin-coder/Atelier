import { describe, expect, it } from 'vitest'
import { dayRangeIso, weekRangeIso } from './time-range'

describe('本地日期 → UTC 区间', () => {
  it('单日区间按系统时区换算', () => {
    expect(dayRangeIso('2026-03-02', 'Asia/Shanghai')).toEqual({
      from: '2026-03-01T16:00:00.000Z',
      to: '2026-03-02T16:00:00.000Z'
    })
  })

  it('周区间为周一到下周一（右开）', () => {
    expect(weekRangeIso('2026-03-04', 'Asia/Shanghai')).toEqual({
      from: '2026-03-01T16:00:00.000Z',
      to: '2026-03-08T16:00:00.000Z'
    })
  })

  it('跨月与跨年也能正确换算', () => {
    expect(dayRangeIso('2026-12-31', 'Asia/Shanghai')).toEqual({
      from: '2026-12-30T16:00:00.000Z',
      to: '2026-12-31T16:00:00.000Z'
    })
  })
})
