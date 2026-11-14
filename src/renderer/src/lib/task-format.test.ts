import { describe, expect, it } from 'vitest'
import { makeTask } from '@/test-utils/fixtures'
import { computeTaskProgress, formatMinutes, sumEstimatedMinutes } from './task-format'

describe('任务工时与进度', () => {
  it('分钟格式化', () => {
    expect(formatMinutes(null)).toBe('未估')
    expect(formatMinutes(0)).toBe('0 分钟')
    expect(formatMinutes(30)).toBe('30 分钟')
    expect(formatMinutes(60)).toBe('1 小时')
    expect(formatMinutes(90)).toBe('1 小时 30 分')
  })

  it('统计忽略归档任务与未估工时', () => {
    const tasks = [
      makeTask({ id: '1', estimatedMinutes: 60, status: 'done' }),
      makeTask({ id: '2', estimatedMinutes: 30, status: 'todo' }),
      makeTask({ id: '3', estimatedMinutes: null, status: 'todo' }),
      makeTask({ id: '4', estimatedMinutes: 120, archivedAt: '2026-06-01T00:00:00.000Z' })
    ]

    expect(sumEstimatedMinutes(tasks)).toBe(90)
    expect(sumEstimatedMinutes(tasks, true)).toBe(30)

    const progress = computeTaskProgress(tasks)
    expect(progress).toEqual({ total: 3, done: 1, undoneMinutes: 30, totalMinutes: 90 })
  })

  it('没有任务时进度为零', () => {
    expect(computeTaskProgress([])).toEqual({
      total: 0,
      done: 0,
      undoneMinutes: 0,
      totalMinutes: 0
    })
  })
})
