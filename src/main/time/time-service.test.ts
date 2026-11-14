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
import { createTasksRepository } from '../db/repositories/tasks'
import { createTimeEntriesRepository, type TimeEntriesRepository } from '../db/repositories/time-entries'
import { createTimeService, type TimeClock } from './time-service'

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

function codeOf(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof DataError) return error.code
    throw error
  }
  throw new Error('预期抛错但没有抛出')
}

describe('工时服务：手动计时', () => {
  let db: AppDatabase
  let repo: TimeEntriesRepository
  let clock: FakeClock
  let service: ReturnType<typeof createTimeService>
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
    service = createTimeService(repo, { clock, timeZone: 'Asia/Shanghai' })
  })

  afterEach(() => db.close())

  it('开始、暂停、继续、结束的累计时长来自单调时钟', () => {
    const started = service.start(taskId)
    expect(started.manual?.entry.status).toBe('running')

    clock.advance(65)
    const paused = service.pause()
    expect(paused.manual?.entry.elapsedSeconds).toBe(65)
    expect(paused.manual?.entry.status).toBe('paused')

    clock.advance(30)
    service.resume()
    clock.advance(10)
    const stopped = service.stop()
    expect(stopped.manual).toBeNull()

    const entries = service.list({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-01T00:00:00.000Z',
      filter: 'all'
    })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.entry.elapsedSeconds).toBe(75)
    expect(entries[0]?.entry.status).toBe('completed')
    expect(service.taskTotals([taskId])).toEqual([{ taskId, seconds: 75 }])
  })

  it('重复开始被拒绝；已完成任务不能开始计时', () => {
    service.start(taskId)
    expect(codeOf(() => service.start(taskId))).toBe('TIMER_ALREADY_RUNNING')
    service.stop()

    const tasks = createTasksRepository(db)
    tasks.update({ id: taskId, status: 'done' })
    expect(codeOf(() => service.start(taskId))).toBe('TASK_COMPLETED')
  })

  it('24 小时上限自动暂停并给出提示', () => {
    service.start(taskId)
    clock.advance(24 * 60 * 60 + 5)
    service.tick()

    const status = service.status()
    expect(status.manual?.entry.status).toBe('paused')
    expect(status.notice).toContain('超过 24 小时')
    expect(status.manual?.entry.note).toContain('超过 24 小时')
  })

  it('启动时把运行中的手动计时恢复为暂停，不补算停机时间', () => {
    repo.insert({
      id: '11111111-1111-4111-8111-111111111111',
      taskId,
      source: 'manual',
      status: 'running',
      startedAt: '2026-11-13T20:00:00.000Z',
      elapsedSeconds: 120,
      lastHeartbeatAt: '2026-11-13T20:02:00.000Z',
      appKey: null,
      note: null
    })

    const recovered = createTimeService(repo, { clock, timeZone: 'Asia/Shanghai' })
    const status = recovered.status()
    expect(status.manual?.entry.status).toBe('paused')
    expect(status.manual?.entry.elapsedSeconds).toBe(120)
    expect(status.notice).toContain('上次计时未正常结束')
  })

  it('启动时结算未结束的自动片段', () => {
    repo.insert({
      id: '22222222-2222-4222-8222-222222222222',
      taskId: null,
      source: 'auto',
      status: 'running',
      startedAt: '2026-11-13T20:00:00.000Z',
      elapsedSeconds: 300,
      lastHeartbeatAt: '2026-11-13T20:05:00.000Z',
      appKey: 'photoshop',
      note: null
    })

    createTimeService(repo, { clock, timeZone: 'Asia/Shanghai' })
    const entry = repo.get('22222222-2222-4222-8222-222222222222')
    expect(entry?.status).toBe('completed')
    expect(entry?.elapsedSeconds).toBe(300)
    expect(entry?.note).toContain('检查点')
  })

  it('统计按本地日期与任务聚合，未分配单独计算', () => {
    service.start(taskId)
    clock.advance(600)
    service.stop()

    repo.insert({
      id: '33333333-3333-4333-8333-333333333333',
      taskId: null,
      source: 'auto',
      status: 'running',
      startedAt: '2026-11-14T03:00:00.000Z',
      elapsedSeconds: 0,
      lastHeartbeatAt: '2026-11-14T03:00:00.000Z',
      appKey: 'krita',
      note: null
    })
    repo.finalize({
      id: '33333333-3333-4333-8333-333333333333',
      endedAt: '2026-11-14T03:05:00.000Z',
      elapsedSeconds: 300,
      lastHeartbeatAt: null,
      clockSkewSeconds: 0,
      note: null,
      updatedAt: '2026-11-14T03:05:00.000Z'
    })

    const summary = service.summary({
      from: '2026-11-13T16:00:00.000Z',
      to: '2026-11-14T16:00:00.000Z'
    })
    expect(summary.totalSeconds).toBe(900)
    expect(summary.unassignedSeconds).toBe(300)
    expect(summary.byDay).toEqual([{ date: '2026-11-14', seconds: 900 }])
    expect(summary.byTask[0]).toMatchObject({ taskId, seconds: 600 })
  })

  it('合并只允许同一任务、同一来源，并保留溯源', () => {
    const createCompleted = (id: string, start: string, seconds: number) => {
      repo.insert({
        id,
        taskId,
        source: 'manual',
        status: 'running',
        startedAt: start,
        elapsedSeconds: 0,
        lastHeartbeatAt: start,
        appKey: null,
        note: null
      })
      repo.finalize({
        id,
        endedAt: new Date(Date.parse(start) + seconds * 1000).toISOString(),
        elapsedSeconds: seconds,
        lastHeartbeatAt: null,
        clockSkewSeconds: 0,
        note: null,
        updatedAt: start
      })
    }

    createCompleted('44444444-4444-4444-8444-444444444444', '2026-11-14T02:00:00.000Z', 300)
    createCompleted('55555555-5555-4555-8555-555555555555', '2026-11-14T03:00:00.000Z', 600)

    const merged = service.merge({ ids: ['44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555'] })
    expect(merged.entry.elapsedSeconds).toBe(900)
    expect(merged.entry.status).toBe('completed')
    expect(merged.entry.note).toContain('合并 2 条')

    expect(repo.get('44444444-4444-4444-8444-444444444444')?.mergedIntoId).toBe(merged.entry.id)
    expect(repo.get('55555555-5555-4555-8555-555555555555')?.deletedAt).not.toBeNull()

    const remaining = service.list({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-01T00:00:00.000Z',
      filter: 'all'
    })
    expect(remaining.map((view) => view.entry.id)).toEqual([merged.entry.id])
  })

  it('系统时间跳变不影响累计时长，并保留偏差信息', () => {
    service.start(taskId)
    clock.advance(60)
    // 墙钟被向前调整 1 小时，单调时钟不变
    clock.wall += 60 * 60 * 1000
    service.stop()

    const entry = service.list({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-02T00:00:00.000Z',
      filter: 'all'
    })[0]

    expect(entry?.entry.elapsedSeconds).toBe(60)
    expect(entry?.entry.clockSkewSeconds).toBeGreaterThanOrEqual(3000)
  })

  it('删除是软删除，统计排除', () => {
    service.start(taskId)
    clock.advance(100)
    const stopped = service.stop()
    expect(stopped.manual).toBeNull()

    const entry = service.list({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-01T00:00:00.000Z',
      filter: 'all'
    })[0]
    expect(entry).toBeDefined()

    expect(service.remove(entry?.entry.id as string)).toBe(true)
    expect(
      service.list({ from: '2026-11-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z', filter: 'all' })
    ).toHaveLength(0)
  })
})
