import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createClientInputSchema,
  createCommissionInputSchema,
  createTaskInputSchema
} from '@shared/domain'
import { openDatabase, type AppDatabase } from '../db/database'
import { applyMigrations } from '../db/migrator'
import { createClientsRepository } from '../db/repositories/clients'
import { createCommissionsRepository } from '../db/repositories/commissions'
import { createTasksRepository } from '../db/repositories/tasks'
import { createTimeEntriesRepository, type TimeEntriesRepository } from '../db/repositories/time-entries'
import { createSettingsRepository } from '../db/repositories/settings'
import { createTimeService, type TimeClock, type TimeService } from '../time/time-service'
import { createActivityMonitor } from './activity-monitor'
import type { ActivityProbe, ActivitySample } from './win32-probe'

class FakeClock implements TimeClock {
  wall = Date.parse('2026-11-14T02:00:00.000Z')
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

describe('自动监测协调器', () => {
  let db: AppDatabase
  let repo: TimeEntriesRepository
  let timeService: TimeService
  let clock: FakeClock
  let probe: FakeProbe
  let monitor: ReturnType<typeof createActivityMonitor>
  let taskId: string

  beforeEach(() => {
    db = openDatabase(':memory:')
    applyMigrations(db)
    const clients = createClientsRepository(db)
    const client = clients.create(createClientInputSchema.parse({ name: '客户' }))
    const commissions = createCommissionsRepository(db)
    const commission = commissions.create(
      createCommissionInputSchema.parse({
        clientId: client.id,
        title: '委托',
        type: '插画',
        quoteAmountCents: 10000
      })
    )
    commissions.update({ id: commission.id, status: 'active' })
    const tasks = createTasksRepository(db)
    taskId = tasks.create(
      createTaskInputSchema.parse({ commissionId: commission.id, title: '任务', stage: 'draft' })
    ).id

    repo = createTimeEntriesRepository(db)
    clock = new FakeClock()
    timeService = createTimeService(repo, { clock, timeZone: 'Asia/Shanghai' })
    probe = new FakeProbe()

    const settings = createSettingsRepository(db)
    monitor = createActivityMonitor({
      timeEntries: repo,
      settings,
      timeService,
      createProbe: () => probe,
      platform: 'win32',
      monotonicMs: () => clock.mono,
      wallMs: () => clock.wall
    })
    monitor.setEnabled(true)
  })

  afterEach(() => {
    monitor.stop()
    db.close()
  })

  /** 按真实节奏推进（每秒一次 tick 的近似，避免触发 5 秒中断保护） */
  function advance(seconds: number): void {
    for (let elapsed = 0; elapsed < seconds; elapsed += 5) {
      clock.advance(5)
      monitor.tick()
    }
  }

  it('受支持应用在前台且不空闲时创建自动记录', () => {
    probe.sampleValue = { processName: 'Photoshop.exe', idleMs: 0 }
    monitor.tick()

    const entry = repo.findActiveAuto()
    expect(entry?.source).toBe('auto')
    expect(entry?.appKey).toBe('photoshop')
    expect(entry?.taskId).toBeNull()
    expect(monitor.status().activeAppKey).toBe('photoshop')
  })

  it('空闲超过阈值会结束自动片段', () => {
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(60)

    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 200_000 }
    monitor.tick()

    expect(repo.findActiveAuto()).toBeNull()
    const completed = timeService.list({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-01T00:00:00.000Z',
      filter: 'all'
    })
    expect(completed).toHaveLength(1)
    expect(completed[0]?.entry.elapsedSeconds).toBe(60)
  })

  it('切换到另一个绘画软件会切分记录', () => {
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(10)

    probe.sampleValue = { processName: 'krita.exe', idleMs: 0 }
    monitor.tick()

    const active = repo.findActiveAuto()
    expect(active?.appKey).toBe('krita')
    expect(active?.id).not.toBe(undefined)

    const all = timeService.list({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-01T00:00:00.000Z',
      filter: 'all'
    })
    expect(all).toHaveLength(1)
    expect(all[0]?.entry.appKey).toBe('photoshop')
    expect(all[0]?.entry.elapsedSeconds).toBe(10)
  })

  it('非绘画软件不记录', () => {
    probe.sampleValue = { processName: 'chrome.exe', idleMs: 0 }
    monitor.tick()
    expect(repo.findActiveAuto()).toBeNull()
  })

  it('手动计时运行期间不创建自动记录', () => {
    timeService.start(taskId)
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    expect(repo.findActiveAuto()).toBeNull()

    timeService.stop()
    monitor.tick()
    expect(repo.findActiveAuto()?.appKey).toBe('photoshop')
  })

  it('关闭监测会结束正在进行的自动片段', () => {
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    expect(repo.findActiveAuto()).not.toBeNull()

    monitor.setEnabled(false)
    expect(repo.findActiveAuto()).toBeNull()
  })

  it('休眠时结算自动片段', () => {
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(30)
    monitor.handleSuspend()

    expect(repo.findActiveAuto()).toBeNull()
  })

  it('超过 30 秒会写检查点', () => {
    probe.sampleValue = { processName: 'photoshop.exe', idleMs: 0 }
    monitor.tick()
    advance(35)

    const entry = repo.findActiveAuto()
    expect(entry?.elapsedSeconds).toBeGreaterThanOrEqual(30)
  })
})
