import { describe, expect, it } from 'vitest'
import {
  attributeEntryToDays,
  mergeDaySlices,
  splitSegmentByLocalDay,
  type SegmentLike
} from './calendar-activity'

/** 汇总某天秒数，方便断言。 */
function totalOf(slices: ReturnType<typeof attributeEntryToDays>, date: string): number {
  return slices.filter((slice) => slice.date === date).reduce((sum, slice) => sum + slice.seconds, 0)
}

function sum(slices: ReturnType<typeof attributeEntryToDays>): number {
  return slices.reduce((acc, slice) => acc + slice.seconds, 0)
}

describe('splitSegmentByLocalDay：跨午夜拆分', () => {
  it('23:40 → 00:20 拆成两天各 20 分钟（用户需求中的例子）', () => {
    // Asia/Shanghai 2026-11-18 23:40 → 2026-11-19 00:20（40 分钟）
    const slices = splitSegmentByLocalDay(
      '2026-11-18T15:40:00.000Z',
      '2026-11-18T16:20:00.000Z',
      2400,
      'Asia/Shanghai'
    )

    expect(slices).toEqual([
      { date: '2026-11-18', seconds: 1200 },
      { date: '2026-11-19', seconds: 1200 }
    ])
  })

  it('不跨午夜时整天归属，不产生多余日期', () => {
    const slices = splitSegmentByLocalDay(
      '2026-11-18T02:00:00.000Z', // 10:00 本地
      '2026-11-18T03:30:00.000Z', // 11:30 本地
      5400,
      'Asia/Shanghai'
    )

    expect(slices).toEqual([{ date: '2026-11-18', seconds: 5400 }])
  })

  it('各日合计严格等于片段秒数（余数不丢失）', () => {
    // 100 秒跨午夜：23:59:00 → 次日 00:00:40 本地
    const slices = splitSegmentByLocalDay(
      '2026-11-18T15:59:00.000Z', // 23:59 本地
      '2026-11-18T16:00:40.000Z', // 次日 00:00:40 本地
      100,
      'Asia/Shanghai'
    )

    expect(sum(slices)).toBe(100)
    expect(totalOf(slices, '2026-11-18')).toBe(60)
    expect(totalOf(slices, '2026-11-19')).toBe(40)
  })

  it('跨越多个自然日时按天切分', () => {
    // 11-18 22:00 → 11-20 02:00 本地，共 28 小时
    const totalSeconds = 28 * 3600
    const slices = splitSegmentByLocalDay(
      '2026-11-18T14:00:00.000Z',
      '2026-11-19T18:00:00.000Z',
      totalSeconds,
      'Asia/Shanghai'
    )

    expect(slices.map((slice) => slice.date)).toEqual(['2026-11-18', '2026-11-19', '2026-11-20'])
    expect(sum(slices)).toBe(totalSeconds)
    expect(totalOf(slices, '2026-11-18')).toBe(2 * 3600)
    expect(totalOf(slices, '2026-11-19')).toBe(24 * 3600)
    expect(totalOf(slices, '2026-11-20')).toBe(2 * 3600)
  })

  it('秒数为 0 时不产生任何日期', () => {
    expect(
      splitSegmentByLocalDay('2026-11-18T15:00:00.000Z', '2026-11-18T16:00:00.000Z', 0, 'Asia/Shanghai')
    ).toEqual([])
  })

  it('时间戳异常时保守归到开始日，不丢工时', () => {
    const slices = splitSegmentByLocalDay('2026-11-18T15:00:00.000Z', 'not-a-date', 600, 'Asia/Shanghai')
    expect(slices).toEqual([{ date: '2026-11-18', seconds: 600 }])
  })
})

describe('splitSegmentByLocalDay：时区与夏令时', () => {
  it('按传入时区归属，而不是 UTC 日期', () => {
    // 2026-11-18T16:30Z：UTC 是 18 日，Asia/Shanghai(+8) 是 19 日 00:30
    const shanghai = splitSegmentByLocalDay(
      '2026-11-18T16:30:00.000Z',
      '2026-11-18T17:00:00.000Z',
      1800,
      'Asia/Shanghai'
    )
    expect(shanghai).toEqual([{ date: '2026-11-19', seconds: 1800 }])

    const utc = splitSegmentByLocalDay(
      '2026-11-18T16:30:00.000Z',
      '2026-11-18T17:00:00.000Z',
      1800,
      'UTC'
    )
    expect(utc).toEqual([{ date: '2026-11-18', seconds: 1800 }])
  })

  it('夏令时春季跳变当天不重复、不丢失工时', () => {
    // America/New_York 2026-03-08 02:00 → 03:00 不存在，当天只有 23 小时
    // 从 03-08 00:30 到 03-09 00:30 本地，实际经过 23 小时
    const slices = splitSegmentByLocalDay(
      '2026-03-08T05:30:00.000Z', // 00:30 EST
      '2026-03-09T04:30:00.000Z', // 00:30 EDT
      23 * 3600,
      'America/New_York'
    )

    expect(slices.map((slice) => slice.date)).toEqual(['2026-03-08', '2026-03-09'])
    expect(sum(slices)).toBe(23 * 3600)
    // 03-08 本地只有 23 小时，其中 00:30 起的 23 小时里 03-08 占 23h-0.5h=22.5h
    expect(totalOf(slices, '2026-03-08')).toBe(23 * 3600 - 1800)
    expect(totalOf(slices, '2026-03-09')).toBe(1800)
  })

  it('夏令时秋季回拨当天不重复计算', () => {
    // America/New_York 2026-11-01 有 25 小时（00:00 EDT → 次日 00:30 EST = 25.5 小时）
    const slices = splitSegmentByLocalDay(
      '2026-11-01T04:00:00.000Z', // 11-01 00:00 EDT
      '2026-11-02T05:30:00.000Z', // 11-02 00:30 EST
      25.5 * 3600,
      'America/New_York'
    )

    expect(slices.map((slice) => slice.date)).toEqual(['2026-11-01', '2026-11-02'])
    expect(sum(slices)).toBe(25.5 * 3600)
    // 11-01 这一整个本地日恰好 25 小时
    expect(totalOf(slices, '2026-11-01')).toBe(25 * 3600)
    expect(totalOf(slices, '2026-11-02')).toBe(1800)
  })
})

describe('attributeEntryToDays：多片段', () => {
  const entry = {
    startedAt: '2026-11-18T01:00:00.000Z', // 09:00 本地
    endedAt: '2026-11-18T09:00:00.000Z', // 17:00 本地
    elapsedSeconds: 5400 // 实际只画了 90 分钟
  }

  it('同一天多个片段正确合计', () => {
    const segments: SegmentLike[] = [
      { startedAt: '2026-11-18T01:00:00.000Z', endedAt: '2026-11-18T02:00:00.000Z', seconds: 3600 },
      { startedAt: '2026-11-18T05:00:00.000Z', endedAt: '2026-11-18T05:30:00.000Z', seconds: 1800 }
    ]

    const slices = attributeEntryToDays(entry, segments, 'Asia/Shanghai')
    expect(mergeDaySlices(slices).get('2026-11-18')).toBe(5400)
  })

  it('多个片段分布在不同日期时各自归属', () => {
    // 11-18 23:00 画 30 分钟，11-19 00:10 画 20 分钟
    const segments: SegmentLike[] = [
      { startedAt: '2026-11-18T15:00:00.000Z', endedAt: '2026-11-18T15:30:00.000Z', seconds: 1800 },
      { startedAt: '2026-11-18T16:10:00.000Z', endedAt: '2026-11-18T16:30:00.000Z', seconds: 1200 }
    ]

    const slices = attributeEntryToDays(
      {
        startedAt: '2026-11-18T15:00:00.000Z',
        endedAt: '2026-11-18T16:30:00.000Z',
        elapsedSeconds: 3000
      },
      segments,
      'Asia/Shanghai'
    )

    expect(totalOf(slices, '2026-11-18')).toBe(1800)
    expect(totalOf(slices, '2026-11-19')).toBe(1200)
    expect(sum(slices)).toBe(3000)
  })

  it('单个片段跨午夜时按实际时长拆分（不是整笔算到开始日）', () => {
    const crossEntry = {
      startedAt: '2026-11-18T15:40:00.000Z', // 23:40 本地
      endedAt: '2026-11-18T16:20:00.000Z', // 次日 00:20 本地
      elapsedSeconds: 2400
    }
    const segments: SegmentLike[] = [
      {
        startedAt: '2026-11-18T15:40:00.000Z',
        endedAt: '2026-11-18T16:20:00.000Z',
        seconds: 2400
      }
    ]

    const slices = attributeEntryToDays(crossEntry, segments, 'Asia/Shanghai')
    expect(totalOf(slices, '2026-11-18')).toBe(1200)
    expect(totalOf(slices, '2026-11-19')).toBe(1200)
  })

  it('片段未覆盖全部累计时，余量归到开始日（不丢工时）', () => {
    const segments: SegmentLike[] = [
      { startedAt: '2026-11-18T01:00:00.000Z', endedAt: '2026-11-18T01:30:00.000Z', seconds: 1800 }
    ]

    const slices = attributeEntryToDays(entry, segments, 'Asia/Shanghai')
    expect(sum(slices)).toBe(5400)
    expect(totalOf(slices, '2026-11-18')).toBe(5400)
  })
})

describe('attributeEntryToDays：老记录（无片段）', () => {
  it('连续记录（墙钟≈累计）按墙钟占比跨午夜拆分', () => {
    // 23:38 → 00:06，墙钟 1680 秒，累计 1649 秒，差值 31 秒在容差内
    const slices = attributeEntryToDays(
      {
        startedAt: '2026-11-14T15:38:00.000Z',
        endedAt: '2026-11-14T16:06:00.000Z',
        elapsedSeconds: 1649
      },
      [],
      'Asia/Shanghai'
    )

    expect(slices.map((slice) => slice.date)).toEqual(['2026-11-14', '2026-11-15'])
    expect(sum(slices)).toBe(1649)
    expect(totalOf(slices, '2026-11-14')).toBeGreaterThan(0)
    expect(totalOf(slices, '2026-11-15')).toBeGreaterThan(0)
  })

  it('不连续记录（中间有暂停）不伪造分布，整笔归到开始日', () => {
    // 墙钟 8 小时，实际只画 90 分钟 → 活跃时间位置不可知
    const slices = attributeEntryToDays(
      {
        startedAt: '2026-11-18T01:00:00.000Z',
        endedAt: '2026-11-18T09:00:00.000Z',
        elapsedSeconds: 5400
      },
      [],
      'Asia/Shanghai'
    )

    expect(slices).toEqual([{ date: '2026-11-18', seconds: 5400 }])
  })

  it('跨午夜但不连续的老记录不拆分（避免伪造精确分布）', () => {
    const slices = attributeEntryToDays(
      {
        startedAt: '2026-11-18T14:00:00.000Z', // 22:00 本地
        endedAt: '2026-11-19T18:00:00.000Z', // 次日 02:00 本地
        elapsedSeconds: 1800 // 只画了 30 分钟
      },
      [],
      'Asia/Shanghai'
    )

    expect(slices).toEqual([{ date: '2026-11-18', seconds: 1800 }])
  })

  it('没有结束时间时整笔归到开始日', () => {
    const slices = attributeEntryToDays(
      { startedAt: '2026-11-18T01:00:00.000Z', endedAt: null, elapsedSeconds: 600 },
      [],
      'Asia/Shanghai'
    )
    expect(slices).toEqual([{ date: '2026-11-18', seconds: 600 }])
  })

  it('秒数为 0 的记录不产生日期', () => {
    expect(
      attributeEntryToDays(
        { startedAt: '2026-11-18T01:00:00.000Z', endedAt: '2026-11-18T02:00:00.000Z', elapsedSeconds: 0 },
        [],
        'Asia/Shanghai'
      )
    ).toEqual([])
  })
})

describe('mergeDaySlices', () => {
  it('同一天求和并丢弃 0 值', () => {
    const merged = mergeDaySlices([
      { date: '2026-11-18', seconds: 100 },
      { date: '2026-11-18', seconds: 200 },
      { date: '2026-11-19', seconds: 0 },
      { date: '2026-11-20', seconds: 50 }
    ])

    expect(merged.get('2026-11-18')).toBe(300)
    expect(merged.has('2026-11-19')).toBe(false)
    expect(merged.get('2026-11-20')).toBe(50)
    expect(merged.size).toBe(2)
  })
})
