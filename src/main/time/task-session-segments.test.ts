import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createClientInputSchema,
  createCommissionInputSchema,
  createTaskInputSchema
} from '@shared/domain'
import { attributeEntryToDays, mergeDaySlices } from '@shared/calendar-activity'
import { openDatabase, type AppDatabase } from '../db/database'
import { applyMigrations } from '../db/migrator'
import { createClientsRepository } from '../db/repositories/clients'
import { createCommissionsRepository } from '../db/repositories/commissions'
import { createSettingsRepository } from '../db/repositories/settings'
import { createTasksRepository, type TasksRepository } from '../db/repositories/tasks'
import {
  createTimeEntriesRepository,
  type TimeEntriesRepository
} from '../db/repositories/time-entries'
import { createActivityMonitor, type ActivityMonitor } from '../activity/activity-monitor'
import type { ActivityProbe, ActivitySample } from '../activity/win32-probe'
import { createTimeService, type TimeClock, type TimeService } from './time-service'

class FakeClock implements TimeClock {
  wall: number
  mono = 1000

  constructor(wallIso: string) {
    this.wall = Date.parse(wallIso)
  }

  wallMs(): number {
    return this.wall
  }

  monotonicMs(): number {
    return this.mono
  }

  advance(seconds: number): void {
    this.wall += seconds * 1000
    this.mono += seconds * 1000
  }
}

class FakeProbe implements ActivityProbe {
  sampleValue: ActivitySample = { processName: null, idleMs: 0 }

  sample(): ActivitySample {
    return this.sampleValue
  }

  dispose(): void {
    // noop
  }
}

/**
 * 活跃片段落库（P6.7 数据基础）。
 *
 * 走真实链路：真实 SQLite + 真实仓储 + 真实 TimeService + 真实活动监测，
 * 只替换原生探测和时钟。重点验证「跨午夜两段正确落库」「暂停期间不产生片段」
 * 「片段合计 == elapsed_seconds」。
 */
describe('任务会话活跃片段', () => {
  let db: AppDatabase
  let repo: TimeEntriesRepository
  let tasks: TasksRepository
  let timeService: TimeService
  let monitor: ActivityMonitor
  let clock: FakeClock
  let probe: FakeProbe
  let taskId: string

  /** 本地时间 2026-11-16 23:40（Asia/Shanghai = UTC+8）→ 跨午夜前 20 分钟 */
  const BEFORE_MIDNIGHT = '2026-11-16T15:40:00.000Z'

  beforeEach(() => {
    db = openDatabase(':memory:')
    applyMigrations(db)

    const clients = createClientsRepository(db)
    const client = clients.create(createClientInputSchema.parse({ name: '客户甲' }))
    const commissions = createCommissionsRepository(db)
    const commission = commissions.create(
      createCommissionInputSchema.parse({
        clientId: client.id,
        title: '半身立绘',
        type: '插画',
        quoteAmountCents: 10000
      })
    )
    commissions.update({ id: commission.id, status: 'active' })

    tasks = createTasksRepository(db)
    taskId = tasks.create(
      createTaskInputSchema.parse({ commissionId: commission.id, title: '线稿', stage: 'lineart' })
    ).id

    repo = createTimeEntriesRepository(db)
    clock = new FakeClock(BEFORE_MIDNIGHT)
    timeService = createTimeService(repo, { clock, timeZone: 'Asia/Shanghai' })
    probe = new FakeProbe()

    monitor = createActivityMonitor({
      timeEntries: repo,
      settings: createSettingsRepository(db),
      timeService,
      createProbe: () => probe,
      platform: 'win32',
      monotonicMs: () => clock.mono,
      wallMs: () => clock.wall
    })
  })

  afterEach(() => {
    monitor.stop()
    db.close()
  })

  /**
   * 按 5 秒步长推进，避免触发监测的 5 秒中断保护。
   * 先采样再推进时间，与真实节奏一致。
   */
  function advance(seconds: number): void {
    for (let elapsed = 0; elapsed < seconds; elapsed += 5) {
      monitor.tick()
      clock.advance(5)
    }
  }

  function completedEntries(): ReturnType<TimeService['list']> {
    return timeService.list({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-01T00:00:00.000Z',
      filter: 'all'
    })
  }

  function onlyEntryId(): string {
    const rows = completedEntries()
    expect(rows).toHaveLength(1)
    const id = rows[0]?.entry.id
    if (!id) throw new Error('没有已完成记录')
    return id
  }

  function totalSegmentSeconds(entryId: string): number {
    return repo.listSegments(entryId).reduce((total, segment) => total + segment.seconds, 0)
  }

  it('跨午夜的两段活跃时间各自正确落库', () => {
    timeService.startTaskSession(taskId, false)

    // 23:40 开始画，画 25 分钟 → 00:05（跨过本地午夜）
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(25 * 60)

    // 00:05 - 00:20 切到浏览器：不累计
    probe.sampleValue = { processName: 'chrome.exe', idleMs: 0 }
    monitor.tick()
    advance(15 * 60)

    // 00:20 回来再画 10 分钟
    probe.sampleValue = { processName: 'krita.exe', idleMs: 0 }
    monitor.tick()
    advance(10 * 60)

    timeService.stopTaskSession()

    const entryId = onlyEntryId()
    const segments = repo.listSegments(entryId)
    expect(segments).toHaveLength(2)

    // 第一段：本地 23:40 → 00:05，1500 秒
    const first = segments[0]
    expect(first?.seconds).toBe(25 * 60)
    expect(first?.startedAt).toBe('2026-11-16T15:40:00.000Z')
    expect(first?.endedAt).toBe('2026-11-16T16:05:00.000Z')

    // 第二段：本地 00:20 → 00:30，600 秒
    const second = segments[1]
    expect(second?.seconds).toBe(10 * 60)
    expect(Date.parse(second?.startedAt as string)).toBeGreaterThan(
      Date.parse(first?.endedAt as string)
    )

    // 片段合计等于权威总时长
    expect(totalSegmentSeconds(entryId)).toBe(35 * 60)
    expect(completedEntries()[0]?.entry.elapsedSeconds).toBe(35 * 60)
  })

  it('跨午夜片段按本地自然日归属到两天', () => {
    timeService.startTaskSession(taskId, false)

    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    // 23:40 → 00:20，40 分钟连续活跃，正好跨过本地午夜
    advance(40 * 60)

    timeService.stopTaskSession()

    const entry = completedEntries()[0]?.entry
    if (!entry) throw new Error('没有已完成记录')
    const segments = repo.listSegments(entry.id)
    expect(segments).toHaveLength(1)

    const byDay = mergeDaySlices(attributeEntryToDays(entry, segments, 'Asia/Shanghai'))

    // 本地 11-16 有 20 分钟（23:40 → 00:00），11-17 有 20 分钟（00:00 → 00:20）
    expect(byDay.get('2026-11-16')).toBe(20 * 60)
    expect(byDay.get('2026-11-17')).toBe(20 * 60)
    // 两天合计严格等于 elapsed_seconds，没有重复也没有丢失
    const total = [...byDay.values()].reduce((sum, value) => sum + value, 0)
    expect(total).toBe(entry.elapsedSeconds)
  })

  it('暂停期间不产生片段', () => {
    timeService.startTaskSession(taskId, false)
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(5 * 60)

    timeService.pauseTaskSession()

    // 暂停 10 分钟：即使绘画软件仍然活跃也不累计、不落片段
    advance(10 * 60)

    timeService.resumeTaskSession()
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(5 * 60)

    timeService.stopTaskSession()

    const entryId = onlyEntryId()
    const segments = repo.listSegments(entryId)

    // 只有两段（暂停前、继续后），暂停期间那 10 分钟没有任何片段
    expect(segments).toHaveLength(2)
    expect(totalSegmentSeconds(entryId)).toBe(10 * 60)
    expect(completedEntries()[0]?.entry.elapsedSeconds).toBe(10 * 60)

    // 两段之间存在明显空档（>= 暂停的 10 分钟）
    const gapSeconds =
      (Date.parse(segments[1]?.startedAt as string) -
        Date.parse(segments[0]?.endedAt as string)) /
      1000
    expect(gapSeconds).toBeGreaterThanOrEqual(10 * 60)
  })

  it('片段合计严格等于 elapsed_seconds（多段活跃 + 多次切换）', () => {
    timeService.startTaskSession(taskId, false)

    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(7 * 60)

    probe.sampleValue = { processName: 'chrome.exe', idleMs: 0 }
    monitor.tick()
    advance(3 * 60)

    probe.sampleValue = { processName: 'sai.exe', idleMs: 0 }
    monitor.tick()
    advance(4 * 60)

    // 空闲：不累计
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 10 * 60 * 1000 }
    monitor.tick()
    advance(6 * 60)

    probe.sampleValue = { processName: 'ClipStudioPaint.exe', idleMs: 0 }
    monitor.tick()
    advance(2 * 60)

    timeService.stopTaskSession()

    const entry = completedEntries()[0]?.entry
    if (!entry) throw new Error('没有已完成记录')
    const segments = repo.listSegments(entry.id)

    expect(segments).toHaveLength(3)
    expect(segments.map((segment) => segment.seconds)).toEqual([7 * 60, 4 * 60, 2 * 60])
    expect(totalSegmentSeconds(entry.id)).toBe(13 * 60)
    expect(entry.elapsedSeconds).toBe(13 * 60)

    // 每段都是合法区间，且归属同一条工时记录
    for (const segment of segments) {
      expect(Date.parse(segment.endedAt)).toBeGreaterThanOrEqual(Date.parse(segment.startedAt))
      expect(segment.entryId).toBe(entry.id)
    }
  })

  it('片段秒数为 0 时不写片段', () => {
    timeService.startTaskSession(taskId, false)

    // 一开始就切到浏览器：从未开始累计
    probe.sampleValue = { processName: 'chrome.exe', idleMs: 0 }
    monitor.tick()
    advance(60)

    timeService.stopTaskSession()

    const entry = completedEntries()[0]?.entry
    if (!entry) throw new Error('没有已完成记录')
    expect(entry.elapsedSeconds).toBe(0)
    expect(repo.listSegments(entry.id)).toHaveLength(0)
  })

  it('写入片段不改变 elapsed_seconds 的既有语义', () => {
    timeService.startTaskSession(taskId, false)
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(5 * 60)

    // 会话进行中：elapsed 仍是单调时钟累计值，与片段是否写入无关
    expect(timeService.status().taskSession?.accumulatedSeconds).toBe(5 * 60)

    timeService.stopTaskSession()

    const entry = completedEntries()[0]?.entry
    if (!entry) throw new Error('没有已完成记录')

    // 任务统计仍按 elapsed_seconds 聚合，不会被片段重复计入
    expect(timeService.taskTotals([taskId])).toEqual([{ taskId, seconds: 5 * 60 }])
    expect(
      timeService.summary({
        from: '2026-11-01T00:00:00.000Z',
        to: '2026-12-01T00:00:00.000Z'
      }).totalSeconds
    ).toBe(5 * 60)
  })

  it('listSegmentsForRange 按片段开始时间过滤并分组', () => {
    timeService.startTaskSession(taskId, false)
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(25 * 60)
    timeService.stopTaskSession()

    const entryId = onlyEntryId()
    const segment = repo.listSegments(entryId)[0]
    if (!segment) throw new Error('没有片段')

    // 命中：范围包含片段开始时间（片段始于 2026-11-16T15:40Z）
    const hit = repo.listSegmentsForRange('2026-11-16T00:00:00.000Z', '2026-11-17T00:00:00.000Z')
    expect(hit.get(entryId)).toHaveLength(1)

    // 未命中：范围在片段开始之后
    const miss = repo.listSegmentsForRange('2026-11-17T00:00:00.000Z', '2026-11-18T00:00:00.000Z')
    expect(miss.has(entryId)).toBe(false)
  })
})

describe('手动计时活跃片段', () => {
  let db: AppDatabase
  let repo: TimeEntriesRepository
  let timeService: TimeService
  let clock: FakeClock
  let manualTaskId: string

  beforeEach(() => {
    db = openDatabase(':memory:')
    applyMigrations(db)

    const clients = createClientsRepository(db)
    const client = clients.create(createClientInputSchema.parse({ name: '客户乙' }))
    const commissions = createCommissionsRepository(db)
    const commission = commissions.create(
      createCommissionInputSchema.parse({
        clientId: client.id,
        title: '头像',
        type: '插画',
        quoteAmountCents: 5000
      })
    )
    commissions.update({ id: commission.id, status: 'active' })
    const tasks = createTasksRepository(db)
    manualTaskId = tasks.create(
      createTaskInputSchema.parse({ commissionId: commission.id, title: '草稿', stage: 'draft' })
    ).id

    repo = createTimeEntriesRepository(db)
    clock = new FakeClock('2026-11-16T15:30:00.000Z')
    timeService = createTimeService(repo, { clock, timeZone: 'Asia/Shanghai' })
  })

  afterEach(() => {
    db.close()
  })

  function manualEntry() {
    const rows = timeService.list({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-01T00:00:00.000Z',
      filter: 'all'
    })
    expect(rows).toHaveLength(1)
    const entry = rows[0]?.entry
    if (!entry) throw new Error('没有记录')
    return entry
  }

  it('stop() 把运行区间落成一条片段，合计等于 elapsed', () => {
    timeService.start(manualTaskId)
    clock.advance(10 * 60)
    timeService.stop()

    const entry = manualEntry()
    const segments = repo.listSegments(entry.id)
    expect(segments).toHaveLength(1)
    expect(segments[0]?.seconds).toBe(10 * 60)
    expect(segments.reduce((sum, segment) => sum + segment.seconds, 0)).toBe(entry.elapsedSeconds)
  })

  it('pause() 落片段，暂停期间不产生新片段', () => {
    timeService.start(manualTaskId)
    clock.advance(5 * 60)
    timeService.pause()

    // 暂停 20 分钟
    clock.advance(20 * 60)

    timeService.resume()
    clock.advance(5 * 60)
    timeService.stop()

    const entry = manualEntry()
    const segments = repo.listSegments(entry.id)
    expect(segments).toHaveLength(2)
    expect(segments.map((segment) => segment.seconds)).toEqual([5 * 60, 5 * 60])
    expect(entry.elapsedSeconds).toBe(10 * 60)
    expect(segments.reduce((sum, segment) => sum + segment.seconds, 0)).toBe(entry.elapsedSeconds)

    // 两段之间是暂停的 20 分钟空档
    const gapSeconds =
      (Date.parse(segments[1]?.startedAt as string) -
        Date.parse(segments[0]?.endedAt as string)) /
      1000
    expect(gapSeconds).toBeGreaterThanOrEqual(20 * 60)
  })

  it('暂停中直接 stop() 不会重复写片段', () => {
    timeService.start(manualTaskId)
    clock.advance(5 * 60)
    timeService.pause()
    clock.advance(60)
    timeService.stop()

    const entry = manualEntry()
    const segments = repo.listSegments(entry.id)
    expect(segments).toHaveLength(1)
    expect(segments[0]?.seconds).toBe(5 * 60)
    expect(entry.elapsedSeconds).toBe(5 * 60)
  })
})
