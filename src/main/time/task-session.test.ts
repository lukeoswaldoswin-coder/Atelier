import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createClientInputSchema,
  createCommissionInputSchema,
  createTaskInputSchema
} from '@shared/domain'
import { DataError } from '@shared/errors'
import { openDatabase, type AppDatabase } from '../db/database'
import { applyMigrations } from '../db/migrator'
import { createClientsRepository } from '../db/repositories/clients'
import { createCommissionsRepository } from '../db/repositories/commissions'
import { createSettingsRepository } from '../db/repositories/settings'
import { createTasksRepository, type TasksRepository } from '../db/repositories/tasks'
import { createTimeEntriesRepository, type TimeEntriesRepository } from '../db/repositories/time-entries'
import { createActivityMonitor, type ActivityMonitor } from '../activity/activity-monitor'
import type { ActivityProbe, ActivitySample } from '../activity/win32-probe'
import { createTimeService, type TimeClock, type TimeService } from './time-service'

class FakeClock implements TimeClock {
  wall = Date.parse('2026-11-15T06:00:00.000Z')
  mono = 1000

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

function codeOf(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof DataError) return error.code
    throw error
  }
  throw new Error('预期抛错但没有抛出')
}

/**
 * 任务计时会话（P6.6）。
 *
 * 这些用例走真实链路：真实 SQLite + 真实仓储 + 真实 TimeService + 真实活动监测，
 * 只有「原生探测」和「时钟」被替换，因此验证的是实际累计与防重复逻辑。
 */
describe('任务计时会话', () => {
  let db: AppDatabase
  let repo: TimeEntriesRepository
  let tasks: TasksRepository
  let timeService: TimeService
  let monitor: ActivityMonitor
  let clock: FakeClock
  let probe: FakeProbe
  let taskA: string
  let taskB: string

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
    taskA = tasks.create(
      createTaskInputSchema.parse({ commissionId: commission.id, title: '线稿', stage: 'lineart' })
    ).id
    taskB = tasks.create(
      createTaskInputSchema.parse({ commissionId: commission.id, title: '上色', stage: 'color' })
    ).id

    repo = createTimeEntriesRepository(db)
    clock = new FakeClock()
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
   *
   * 先采样再推进时间，模拟真实节奏：监测每秒看到当前状态，然后时间前进。
   * 反过来（先推进再采样）会让「片段开始」那一次采样凭空多出 5 秒。
   */
  function advance(seconds: number): void {
    for (let elapsed = 0; elapsed < seconds; elapsed += 5) {
      monitor.tick()
      clock.advance(5)
    }
  }

  function completeEntries(): ReturnType<TimeService['list']> {
    return timeService.list({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-01T00:00:00.000Z',
      filter: 'all'
    })
  }

  it('开始任务计时后只累计绘画软件活跃时间', () => {
    timeService.startTaskSession(taskA, false)

    // 绘画软件活跃 25 分钟
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(25 * 60)

    // 切到浏览器 15 分钟：不累计
    probe.sampleValue = { processName: 'chrome.exe', idleMs: 0 }
    monitor.tick()
    advance(15 * 60)

    // 回到绘画软件 30 分钟：恢复累计
    probe.sampleValue = { processName: 'ClipStudioPaint.exe', idleMs: 0 }
    monitor.tick()
    advance(30 * 60)

    // 休息（空闲）20 分钟：不累计
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 10 * 60 * 1000 }
    monitor.tick()
    advance(20 * 60)

    const status = timeService.stopTaskSession()
    expect(status.taskSession).toBeNull()

    const rows = completeEntries()
    expect(rows).toHaveLength(1)
    const entry = rows[0]?.entry
    expect(entry?.taskId).toBe(taskA)
    // 25 + 30 = 55 分钟，绝不是 90 分钟的墙钟时间
    expect(entry?.elapsedSeconds).toBe(55 * 60)
  })

  it('会话持续时间与实际累计工时是两个不同数字', () => {
    timeService.startTaskSession(taskA, false)

    probe.sampleValue = { processName: 'krita.exe', idleMs: 0 }
    monitor.tick()
    advance(10 * 60)

    // 只有一半时间在画画
    probe.sampleValue = { processName: 'chrome.exe', idleMs: 0 }
    monitor.tick()
    advance(10 * 60)

    const status = timeService.status()
    expect(status.taskSession?.sessionSeconds).toBe(20 * 60)
    expect(status.taskSession?.accumulatedSeconds).toBe(10 * 60)
    expect(status.taskSession?.accumulating).toBe(false)
  })

  it('手动暂停停止累计但不结束会话，继续后恢复', () => {
    timeService.startTaskSession(taskA, false)
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(5 * 60)

    const paused = timeService.pauseTaskSession()
    expect(paused.taskSession?.state).toBe('paused')

    // 暂停期间即使绘画软件活跃也不累计
    advance(10 * 60)
    expect(timeService.status().taskSession?.accumulatedSeconds).toBe(5 * 60)

    timeService.resumeTaskSession()
    advance(5 * 60)

    const stopped = timeService.stopTaskSession()
    expect(stopped.taskSession).toBeNull()
    expect(completeEntries()[0]?.entry.elapsedSeconds).toBe(10 * 60)
  })

  it('切换到浏览器不结束会话，回到绘画软件自动恢复', () => {
    timeService.startTaskSession(taskA, false)
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(60)

    probe.sampleValue = { processName: 'chrome.exe', idleMs: 0 }
    monitor.tick()
    advance(120)

    // 会话仍在，只是没有在累计
    const away = timeService.status().taskSession
    expect(away).not.toBeNull()
    expect(away?.accumulating).toBe(false)
    expect(away?.activeAppKey).toBeNull()

    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(60)

    expect(timeService.status().taskSession?.accumulating).toBe(true)
    expect(timeService.status().taskSession?.accumulatedSeconds).toBe(120)
  })

  it('不产生重复工时：任务会话期间没有独立自动片段', () => {
    timeService.startTaskSession(taskA, false)
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(10 * 60)

    // 会话进行中，不应存在普通自动片段
    expect(repo.findActiveAuto()).toBeNull()

    timeService.stopTaskSession()
    // 结束后仍没有额外自动记录（会话本身已结算）
    expect(completeEntries()).toHaveLength(1)

    // 会话结束后普通自动监测恢复原样
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.setEnabled(true)
    monitor.tick()
    expect(repo.findActiveAuto()).not.toBeNull()
    expect(repo.findActiveAuto()?.taskId).toBeNull()
  })

  it('同一时刻只能有一个任务会话；切换任务会先结算旧任务', () => {
    timeService.startTaskSession(taskA, false)
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(5 * 60)

    // 未确认替换：拒绝
    expect(codeOf(() => timeService.startTaskSession(taskB, false))).toBe(
      'TASK_SESSION_ALREADY_RUNNING'
    )

    // 确认替换：先结算 A，再开始 B
    const swapped = timeService.startTaskSession(taskB, true)
    expect(swapped.taskSession?.taskId).toBe(taskB)
    expect(swapped.taskSession?.accumulatedSeconds).toBe(0)

    const rows = completeEntries()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.entry.taskId).toBe(taskA)
    expect(rows[0]?.entry.elapsedSeconds).toBe(5 * 60)
    expect(rows[0]?.entry.status).toBe('completed')

    advance(5 * 60)
    timeService.stopTaskSession()

    const all = completeEntries()
    expect(all).toHaveLength(2)
    expect(all.map((row) => row.entry.taskId).sort()).toEqual([taskA, taskB].sort())
    // 每个任务各自 5 分钟，没有交叉累计
    for (const row of all) expect(row.entry.elapsedSeconds).toBe(5 * 60)
  })

  it('自动监测关闭时任务计时仍然累计', () => {
    monitor.setEnabled(false)
    expect(monitor.status().enabled).toBe(false)

    timeService.startTaskSession(taskA, false)
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(10 * 60)

    expect(timeService.status().taskSession?.accumulatedSeconds).toBe(10 * 60)

    timeService.stopTaskSession()
    expect(completeEntries()[0]?.entry.elapsedSeconds).toBe(10 * 60)
  })

  it('手动计时与任务会话互斥', () => {
    timeService.startTaskSession(taskA, false)
    expect(codeOf(() => timeService.start(taskB))).toBe('TASK_SESSION_ALREADY_RUNNING')
    timeService.stopTaskSession()

    timeService.start(taskB)
    expect(codeOf(() => timeService.startTaskSession(taskA, true))).toBe('TIMER_ALREADY_RUNNING')
    timeService.stop()
  })

  it('已完成任务不能开始任务计时', () => {
    tasks.update({ id: taskA, status: 'done' })
    expect(codeOf(() => timeService.startTaskSession(taskA, false))).toBe('TASK_COMPLETED')
  })

  it('休眠只停止累计，不结束会话', () => {
    timeService.startTaskSession(taskA, false)
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(5 * 60)

    monitor.handleSuspend()
    const suspended = timeService.status().taskSession
    expect(suspended).not.toBeNull()
    expect(suspended?.accumulating).toBe(false)
    expect(suspended?.accumulatedSeconds).toBe(5 * 60)

    monitor.handleResume()
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(5 * 60)

    expect(timeService.status().taskSession?.accumulatedSeconds).toBe(10 * 60)
  })

  it('重启后会话恢复为进行中，且不把停机时间计入', () => {
    timeService.startTaskSession(taskA, false)
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(5 * 60)
    monitor.stop()

    // 模拟应用重启：新服务实例读同一个库
    const restarted = createTimeService(repo, { clock, timeZone: 'Asia/Shanghai' })
    const recovered = restarted.status()
    expect(recovered.taskSession?.taskId).toBe(taskA)
    expect(recovered.taskSession?.accumulatedSeconds).toBe(5 * 60)
    expect(recovered.taskSession?.accumulating).toBe(false)
    expect(recovered.notice).toContain('任务计时未正常结束')

    // 停机 30 分钟后回来继续画：只累计新的活跃时间
    clock.advance(30 * 60)
    const restartedMonitor = createActivityMonitor({
      timeEntries: repo,
      settings: createSettingsRepository(db),
      timeService: restarted,
      createProbe: () => probe,
      platform: 'win32',
      monotonicMs: () => clock.mono,
      wallMs: () => clock.wall
    })
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    restartedMonitor.tick()
    for (let elapsed = 0; elapsed < 5 * 60; elapsed += 5) {
      restartedMonitor.tick()
      clock.advance(5)
    }

    expect(restarted.status().taskSession?.accumulatedSeconds).toBe(10 * 60)
    restartedMonitor.stop()
  })

  it('结束后的工时归属正确任务，并在统计中体现', () => {
    timeService.startTaskSession(taskB, false)
    probe.sampleValue = { processName: 'sai.exe', idleMs: 0 }
    monitor.tick()
    advance(10 * 60)
    timeService.stopTaskSession()

    const totals = timeService.taskTotals([taskA, taskB])
    expect(totals).toEqual([{ taskId: taskB, seconds: 10 * 60 }])

    const summary = timeService.summary({
      from: '2026-11-15T00:00:00.000Z',
      to: '2026-11-16T00:00:00.000Z'
    })
    expect(summary.unassignedSeconds).toBe(0)
    expect(summary.byTask[0]).toMatchObject({ taskId: taskB, seconds: 10 * 60 })
  })

  it('未配置的绘画软件不累计', () => {
    monitor.setApps(['photoshop'])
    timeService.startTaskSession(taskA, false)

    probe.sampleValue = { processName: 'krita.exe', idleMs: 0 }
    monitor.tick()
    advance(5 * 60)

    expect(timeService.status().taskSession?.accumulatedSeconds).toBe(0)
  })
})
