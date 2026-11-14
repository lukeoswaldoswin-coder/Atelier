import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createClientInputSchema,
  createCommissionInputSchema,
  createTaskInputSchema
} from '@shared/domain'
import { openDatabase, type AppDatabase } from '../database'
import { applyMigrations } from '../migrator'
import { createClientsRepository } from './clients'
import { createCommissionsRepository } from './commissions'
import { createTasksRepository } from './tasks'
import {
  createTimeEntriesRepository,
  type NewTimeEntry,
  type TimeEntriesRepository
} from './time-entries'
import { createSettingsRepository } from './settings'
import { DEFAULT_MONITOR_CONFIG } from '@shared/time-entries'

const IDS = {
  manual: '11111111-1111-4111-8111-111111111111',
  auto: '22222222-2222-4222-8222-222222222222',
  second: '33333333-3333-4333-8333-333333333333',
  third: '44444444-4444-4444-8444-444444444444'
}

describe('工时记录仓储', () => {
  let db: AppDatabase
  let repo: TimeEntriesRepository
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
    const tasks = createTasksRepository(db)
    taskId = tasks.create(
      createTaskInputSchema.parse({ commissionId: commission.id, title: '任务', stage: 'draft' })
    ).id
    repo = createTimeEntriesRepository(db)
  })

  afterEach(() => {
    db.close()
  })

  const baseEntry = (overrides: Partial<NewTimeEntry> = {}): NewTimeEntry => ({
    id: IDS.manual,
    taskId,
    source: 'manual',
    status: 'running',
    startedAt: '2026-11-14T02:00:00.000Z',
    elapsedSeconds: 0,
    lastHeartbeatAt: '2026-11-14T02:00:00.000Z',
    appKey: null,
    note: null,
    ...overrides
  })

  it('创建、检查点、暂停、继续、结束', () => {
    repo.insert(baseEntry())
    repo.checkpoint(IDS.manual, 120, '2026-11-14T02:02:00.000Z', '2026-11-14T02:02:00.000Z')

    repo.setStatus(IDS.manual, 'paused', 120, '2026-11-14T02:02:00.000Z', '2026-11-14T02:02:00.000Z')
    expect(repo.get(IDS.manual)?.status).toBe('paused')
    expect(repo.get(IDS.manual)?.elapsedSeconds).toBe(120)

    repo.setStatus(IDS.manual, 'running', 120, '2026-11-14T02:05:00.000Z', '2026-11-14T02:05:00.000Z')
    repo.finalize({
      id: IDS.manual,
      endedAt: '2026-11-14T02:10:00.000Z',
      elapsedSeconds: 420,
      lastHeartbeatAt: '2026-11-14T02:10:00.000Z',
      clockSkewSeconds: 180,
      note: null,
      updatedAt: '2026-11-14T02:10:00.000Z'
    })

    const entry = repo.get(IDS.manual)
    expect(entry?.status).toBe('completed')
    expect(entry?.elapsedSeconds).toBe(420)
    expect(entry?.clockSkewSeconds).toBe(180)
  })

  it('列表只返回已完成、未删除记录，并支持未分配/任务/委托过滤', () => {
    repo.insert(
      baseEntry({
        id: IDS.manual,
        startedAt: '2026-11-14T02:00:00.000Z'
      })
    )
    repo.finalize({
      id: IDS.manual,
      endedAt: '2026-11-14T02:10:00.000Z',
      elapsedSeconds: 600,
      lastHeartbeatAt: null,
      clockSkewSeconds: 0,
      note: null,
      updatedAt: '2026-11-14T02:10:00.000Z'
    })

    repo.insert(
      baseEntry({
        id: IDS.auto,
        source: 'auto',
        taskId: null,
        appKey: 'photoshop',
        startedAt: '2026-11-14T03:00:00.000Z'
      })
    )
    repo.finalize({
      id: IDS.auto,
      endedAt: '2026-11-14T03:05:00.000Z',
      elapsedSeconds: 300,
      lastHeartbeatAt: null,
      clockSkewSeconds: 0,
      note: null,
      updatedAt: '2026-11-14T03:05:00.000Z'
    })

    const range = { from: '2026-11-14T00:00:00.000Z', to: '2026-11-15T00:00:00.000Z' }
    expect(repo.listViews({ ...range, filter: 'all' })).toHaveLength(2)
    expect(repo.listViews({ ...range, filter: 'unassigned' }).map((view) => view.entry.id)).toEqual([
      IDS.auto
    ])
    expect(repo.listViews({ ...range, filter: 'all', taskId }).map((view) => view.entry.id)).toEqual([
      IDS.manual
    ])
    expect(
      repo.listViews({ ...range, filter: 'all', commissionId: '00000000-0000-4000-8000-000000000000' })
    ).toHaveLength(0)

    // 运行中的记录不出现在列表
    repo.insert(baseEntry({ id: IDS.second, startedAt: '2026-11-14T04:00:00.000Z' }))
    expect(repo.listViews({ ...range, filter: 'all' })).toHaveLength(2)
  })

  it('修正时间会重新计算时长，并拒绝结束早于开始', () => {
    repo.insert(baseEntry())
    repo.finalize({
      id: IDS.manual,
      endedAt: '2026-11-14T02:10:00.000Z',
      elapsedSeconds: 600,
      lastHeartbeatAt: null,
      clockSkewSeconds: 0,
      note: null,
      updatedAt: '2026-11-14T02:10:00.000Z'
    })

    const updated = repo.updateCompleted(
      IDS.manual,
      { startedAt: '2026-11-14T02:00:00.000Z', endedAt: '2026-11-14T02:30:00.000Z' },
      '2026-11-14T03:00:00.000Z'
    )
    expect(updated?.elapsedSeconds).toBe(1800)

    expect(() =>
      repo.updateCompleted(
        IDS.manual,
        { endedAt: '2026-11-14T01:00:00.000Z' },
        '2026-11-14T03:00:00.000Z'
      )
    ).toThrow(/结束时间不能早于开始时间/)
  })

  it('未完成记录不允许直接修正', () => {
    repo.insert(baseEntry())
    expect(() => repo.updateCompleted(IDS.manual, {}, '2026-11-14T03:00:00.000Z')).toThrow()
  })

  it('软删除与合并标记都会把记录排除在列表外', () => {
    for (const [index, id] of [IDS.manual, IDS.second, IDS.third].entries()) {
      repo.insert(
        baseEntry({
          id,
          startedAt: `2026-11-14T0${2 + index}:00:00.000Z`
        })
      )
      repo.finalize({
        id,
        endedAt: `2026-11-14T0${2 + index}:10:00.000Z`,
        elapsedSeconds: 600,
        lastHeartbeatAt: null,
        clockSkewSeconds: 0,
        note: null,
        updatedAt: `2026-11-14T0${2 + index}:10:00.000Z`
      })
    }

    repo.softDelete(IDS.third, '2026-11-14T05:00:00.000Z')
    repo.markMerged([IDS.manual, IDS.second], IDS.third, '2026-11-14T05:00:00.000Z')

    const range = { from: '2026-11-14T00:00:00.000Z', to: '2026-11-15T00:00:00.000Z' }
    expect(repo.listViews({ ...range, filter: 'all' })).toHaveLength(0)
    expect(repo.get(IDS.manual)?.mergedIntoId).toBe(IDS.third)
  })

  it('任务上下文包含任务与委托状态，用于启动前校验', () => {
    const context = repo.taskContext(taskId)
    expect(context).toMatchObject({
      taskId,
      taskStatus: 'todo',
      commissionStatus: 'draft'
    })
    expect(repo.taskContext('00000000-0000-4000-8000-000000000000')).toBeNull()
  })
})

describe('应用设置仓储', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = openDatabase(':memory:')
    applyMigrations(db)
  })

  afterEach(() => db.close())

  it('没有配置时返回默认值（监测关闭、空闲 3 分钟）', () => {
    const settings = createSettingsRepository(db)
    const config = settings.getMonitorConfig()
    expect(config).toEqual(DEFAULT_MONITOR_CONFIG)
    expect(config.enabled).toBe(false)
    expect(config.idleMinutes).toBe(3)
  })

  it('写入后可读回', () => {
    const settings = createSettingsRepository(db)
    settings.setMonitorConfig({ enabled: true, apps: ['photoshop', 'krita'], idleMinutes: 5, idleEnabled: true })
    expect(settings.getMonitorConfig()).toEqual({
      enabled: true,
      apps: ['photoshop', 'krita'],
      idleMinutes: 5,
      idleEnabled: true
    })
  })

  it('损坏的 apps 配置回退到默认值', () => {
    const settings = createSettingsRepository(db)
    db.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES ('monitor.apps', 'not-json', '2026-01-01T00:00:00.000Z')"
    ).run()
    expect(settings.getMonitorConfig().apps).toEqual(DEFAULT_MONITOR_CONFIG.apps)
  })
})
