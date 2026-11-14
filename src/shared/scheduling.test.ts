import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CalendarTask, CommissionStatus, Deadline, TaskStage, TaskStatus } from './domain'
import {
  addCalendarDays,
  buildScheduleSuggestions,
  calendarDaysBetween,
  deadlineFingerprint,
  leadDaysForEstimate
} from './scheduling'

const TODAY = '2026-11-14'
const TASK_ID = '11111111-1111-4111-8111-111111111111'
const COMMISSION_ID = '22222222-2222-4222-8222-222222222222'

interface ItemOptions {
  id?: string
  title?: string
  taskStatus?: TaskStatus
  estimatedMinutes?: number | null
  plannedDate?: string | null
  archivedAt?: string | null
  stage?: TaskStage
  sortOrder?: number
  priority?: number
  commissionStatus?: CommissionStatus
  deadline?: Deadline
}

function makeItem(options: ItemOptions = {}): CalendarTask {
  const id = options.id ?? TASK_ID
  return {
    task: {
      id,
      commissionId: COMMISSION_ID,
      title: options.title ?? '构图草稿',
      description: null,
      stage: options.stage ?? 'draft',
      status: options.taskStatus ?? 'todo',
      estimatedMinutes: options.estimatedMinutes === undefined ? 90 : options.estimatedMinutes,
      plannedDate: options.plannedDate === undefined ? null : options.plannedDate,
      sortOrder: options.sortOrder ?? 0,
      completedAt: options.taskStatus === 'done' ? '2026-11-01T00:00:00.000Z' : null,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      archivedAt: options.archivedAt === undefined ? null : options.archivedAt
    },
    commission: {
      id: COMMISSION_ID,
      title: '猪猪熊熊讨薪大长篇',
      status: options.commissionStatus ?? 'active',
      priority: options.priority ?? 3,
      deadline: options.deadline ?? { kind: 'date', date: '2026-11-20' }
    },
    clientName: '三狼'
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('纯日期工具', () => {
  it('跨月、跨年与闰年正确', () => {
    expect(addCalendarDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addCalendarDays('2023-02-28', 1)).toBe('2023-03-01')
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addCalendarDays('2026-01-01', -1)).toBe('2025-12-31')
    expect(addCalendarDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('日期差值包含正负与跨年', () => {
    expect(calendarDaysBetween('2026-11-14', '2026-11-20')).toBe(6)
    expect(calendarDaysBetween('2026-11-20', '2026-11-14')).toBe(-6)
    expect(calendarDaysBetween('2026-12-31', '2027-01-01')).toBe(1)
    expect(calendarDaysBetween('2024-02-28', '2024-03-01')).toBe(2)
  })

  it('拒绝非法日期', () => {
    expect(() => addCalendarDays('2026-02-30', 1)).toThrow()
    expect(() => calendarDaysBetween('2026-02-30', '2026-03-01')).toThrow()
  })
})

describe('截止指纹', () => {
  it('三态指纹互不相同且稳定', () => {
    expect(deadlineFingerprint({ kind: 'none' })).toBe('none')
    expect(deadlineFingerprint({ kind: 'date', date: '2026-11-20' })).toBe('date:2026-11-20')
    expect(
      deadlineFingerprint({
        kind: 'datetime',
        at: '2026-11-20T15:00:00.000Z',
        timeZone: 'Asia/Shanghai'
      })
    ).toBe('datetime:2026-11-20T15:00:00.000Z@Asia/Shanghai')
  })
})

describe('建议提前量', () => {
  it.each([
    [null, 2],
    [0, 1],
    [60, 1],
    [61, 2],
    [180, 2],
    [181, 3],
    [360, 3],
    [361, 5],
    [720, 5],
    [721, 7]
  ])('预计 %s 分钟 → 提前 %s 天', (minutes, expected) => {
    expect(leadDaysForEstimate(minutes)).toBe(expected)
  })
})

describe('排期建议', () => {
  it('按截止与预计工时得到建议日期与理由字段', () => {
    const suggestions = buildScheduleSuggestions({
      items: [makeItem({ estimatedMinutes: 90 })],
      todayISO: TODAY
    })

    expect(suggestions).toHaveLength(1)
    const suggestion = suggestions[0]!
    expect(suggestion.suggestedDate).toBe('2026-11-18')
    expect(suggestion.deadlineDate).toBe('2026-11-20')
    expect(suggestion.daysUntilDeadline).toBe(6)
    expect(suggestion.overdueDays).toBe(0)
    expect(suggestion.leadDays).toBe(2)
    expect(suggestion.urgency).toBe('this-week')
    expect(suggestion.basis).toEqual({
      taskStatus: 'todo',
      estimatedMinutes: 90,
      commissionStatus: 'active',
      commissionPriority: 3,
      deadlineFingerprint: 'date:2026-11-20'
    })
  })

  it('逾期任务建议今天开始，并给出逾期天数', () => {
    const [suggestion] = buildScheduleSuggestions({
      items: [makeItem({ deadline: { kind: 'date', date: '2026-11-10' }, priority: 2 })],
      todayISO: TODAY
    })

    expect(suggestion?.suggestedDate).toBe(TODAY)
    expect(suggestion?.daysUntilDeadline).toBe(-4)
    expect(suggestion?.overdueDays).toBe(4)
    expect(suggestion?.urgency).toBe('overdue')
  })

  it('无截止任务建议今天，且 leadDays 为空', () => {
    const [suggestion] = buildScheduleSuggestions({
      items: [makeItem({ deadline: { kind: 'none' } })],
      todayISO: TODAY
    })

    expect(suggestion?.suggestedDate).toBe(TODAY)
    expect(suggestion?.deadlineDate).toBeNull()
    expect(suggestion?.leadDays).toBeNull()
    expect(suggestion?.urgency).toBe('no-deadline')
    expect(suggestion?.basis.deadlineFingerprint).toBe('none')
  })

  it('建议日期不早于今天', () => {
    const [suggestion] = buildScheduleSuggestions({
      items: [
        makeItem({
          deadline: { kind: 'date', date: '2026-11-15' },
          estimatedMinutes: 600
        })
      ],
      todayISO: TODAY
    })

    expect(suggestion?.suggestedDate).toBe(TODAY)
  })

  it('时刻型截止按作者时区取日期', () => {
    const shanghai = buildScheduleSuggestions({
      items: [
        makeItem({
          deadline: {
            kind: 'datetime',
            at: '2026-11-20T15:00:00.000Z',
            timeZone: 'Asia/Shanghai'
          }
        })
      ],
      todayISO: TODAY
    })[0]

    expect(shanghai?.deadlineDate).toBe('2026-11-20')
    expect(shanghai?.suggestedDate).toBe('2026-11-18')

    const kiritimati = buildScheduleSuggestions({
      items: [
        makeItem({
          deadline: {
            kind: 'datetime',
            at: '2026-11-20T15:00:00.000Z',
            timeZone: 'Pacific/Kiritimati'
          }
        })
      ],
      todayISO: TODAY
    })[0]

    expect(kiritimati?.deadlineDate).toBe('2026-11-21')
  })

  it('仅纳入未安排、未完成、未归档、委托草稿/进行中的任务', () => {
    const suggestions = buildScheduleSuggestions({
      items: [
        makeItem({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', taskStatus: 'todo' }),
        makeItem({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', taskStatus: 'done' }),
        makeItem({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', plannedDate: '2026-11-18' }),
        makeItem({
          id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          archivedAt: '2026-11-01T00:00:00.000Z'
        }),
        makeItem({
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          commissionStatus: 'completed'
        }),
        makeItem({
          id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
          commissionStatus: 'draft'
        })
      ],
      todayISO: TODAY
    })

    expect(suggestions.map((item) => item.taskId)).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'ffffffff-ffff-4fff-8fff-ffffffffffff'
    ])
  })

  it('按紧急度、截止、优先级、建议日期、预计工时、阶段与排序稳定排列', () => {
    const overdue = makeItem({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      deadline: { kind: 'date', date: '2026-11-10' },
      priority: 4
    })
    const dueSoon = makeItem({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      deadline: { kind: 'date', date: '2026-11-16' },
      priority: 2
    })
    const thisWeekHighPriority = makeItem({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      deadline: { kind: 'date', date: '2026-11-21' },
      priority: 1
    })
    const noDeadline = makeItem({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      deadline: { kind: 'none' },
      priority: 1
    })
    const later = makeItem({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      deadline: { kind: 'date', date: '2027-01-20' },
      priority: 1
    })

    const order = buildScheduleSuggestions({
      items: [later, noDeadline, thisWeekHighPriority, dueSoon, overdue],
      todayISO: TODAY
    }).map((item) => item.taskId)

    expect(order).toEqual([
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    ])
  })

  it('输入顺序不同但结果顺序一致', () => {
    const a = makeItem({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', priority: 3 })
    const b = makeItem({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      priority: 1,
      deadline: { kind: 'date', date: '2026-11-19' }
    })

    const first = buildScheduleSuggestions({ items: [a, b], todayISO: TODAY })
    const second = buildScheduleSuggestions({ items: [b, a], todayISO: TODAY })

    expect(first.map((item) => item.taskId)).toEqual(second.map((item) => item.taskId))
  })

  it('不读取系统时钟', () => {
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('算法不应读取系统时钟')
    })

    expect(() =>
      buildScheduleSuggestions({ items: [makeItem()], todayISO: TODAY })
    ).not.toThrow()
  })

  it('todayISO 非法时明确报错', () => {
    expect(() =>
      buildScheduleSuggestions({ items: [makeItem()], todayISO: '2026-02-30' })
    ).toThrow(/todayISO/)
  })
})
