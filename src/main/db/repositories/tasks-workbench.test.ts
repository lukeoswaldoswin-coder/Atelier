import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createClientInputSchema,
  createCommissionInputSchema,
  createTaskInputSchema
} from '@shared/domain'
import { openDatabase, type AppDatabase } from '../database'
import { applyMigrations } from '../migrator'
import { createClientsRepository } from './clients'
import { createCommissionsRepository, type CommissionsRepository } from './commissions'
import { createTasksRepository, type TasksRepository } from './tasks'
import { createTimeEntriesRepository, type TimeEntriesRepository } from './time-entries'

/**
 * 工作台聚合查询（P6.6）。
 *
 * 验证的是「复用现有任务数据与业务规则」：归档任务、归档/取消委托下的任务
 * 不进默认待处理列表，已完成任务单独分组，不引入第二套状态。
 */
describe('绘画任务工作台查询', () => {
  let db: AppDatabase
  let tasks: TasksRepository
  let commissions: CommissionsRepository
  let repo: TimeEntriesRepository
  let activeCommissionId: string
  let cancelledCommissionId: string
  let archivedCommissionId: string

  function makeCommission(clientId: string, title: string): string {
    return commissions.create(
      createCommissionInputSchema.parse({ clientId, title, type: '插画', quoteAmountCents: 1000 })
    ).id
  }

  beforeEach(() => {
    db = openDatabase(':memory:')
    applyMigrations(db)

    const clients = createClientsRepository(db)
    const client = clients.create(createClientInputSchema.parse({ name: '客户甲' }))
    commissions = createCommissionsRepository(db)
    tasks = createTasksRepository(db)
    repo = createTimeEntriesRepository(db)

    activeCommissionId = makeCommission(client.id, '进行中委托')
    commissions.update({ id: activeCommissionId, status: 'active' })

    cancelledCommissionId = makeCommission(client.id, '已取消委托')
    commissions.update({ id: cancelledCommissionId, status: 'cancelled' })

    archivedCommissionId = makeCommission(client.id, '已归档委托')
    commissions.update({ id: archivedCommissionId, status: 'active' })
    commissions.archive({ id: archivedCommissionId })
  })

  afterEach(() => db.close())

  function addTask(commissionId: string, title: string, stage: 'draft' | 'color' = 'draft'): string {
    return tasks.create(createTaskInputSchema.parse({ commissionId, title, stage })).id
  }

  it('聚合多个委托的待处理任务，并带出委托与客户', () => {
    addTask(activeCommissionId, '任务一')
    const other = makeCommission(
      createClientsRepository(db).list({ includeArchived: false })[0]!.id,
      '另一个委托'
    )
    commissions.update({ id: other, status: 'active' })
    addTask(other, '任务二')

    const result = tasks.workbench({ includeDone: false, includeArchived: false })

    expect(result.pending.map((item) => item.task.title).sort()).toEqual(['任务一', '任务二'])
    expect(result.pending[0]?.clientName).toBe('客户甲')
    expect(result.pending[0]?.commission.title).toBeTruthy()
  })

  it('默认排除归档任务、归档委托与已取消委托下的任务', () => {
    addTask(activeCommissionId, '正常任务')
    const archivedTask = addTask(activeCommissionId, '归档任务')
    tasks.archive({ id: archivedTask })
    addTask(cancelledCommissionId, '取消委托任务')
    addTask(archivedCommissionId, '归档委托任务')

    const result = tasks.workbench({ includeDone: false, includeArchived: false })

    expect(result.pending.map((item) => item.task.title)).toEqual(['正常任务'])
  })

  it('已完成任务单独分组，默认不混入待处理', () => {
    const doneId = addTask(activeCommissionId, '已完成任务')
    tasks.update({ id: doneId, status: 'done' })
    addTask(activeCommissionId, '待办任务')

    const result = tasks.workbench({ includeDone: true, includeArchived: false })

    expect(result.pending.map((item) => item.task.title)).toEqual(['待办任务'])
    expect(result.done.map((item) => item.task.title)).toEqual(['已完成任务'])
  })

  it('返回每个任务的已累计实际工时', () => {
    const taskId = addTask(activeCommissionId, '有工时的任务')

    repo.insert({
      id: '11111111-1111-4111-8111-111111111111',
      taskId,
      source: 'auto',
      status: 'running',
      startedAt: '2026-11-15T06:00:00.000Z',
      elapsedSeconds: 0,
      lastHeartbeatAt: '2026-11-15T06:00:00.000Z',
      appKey: null,
      note: null
    })
    repo.finalize({
      id: '11111111-1111-4111-8111-111111111111',
      endedAt: '2026-11-15T06:30:00.000Z',
      elapsedSeconds: 1800,
      lastHeartbeatAt: '2026-11-15T06:30:00.000Z',
      clockSkewSeconds: 0,
      note: null,
      updatedAt: '2026-11-15T06:30:00.000Z'
    })

    const result = tasks.workbench({ includeDone: false, includeArchived: false })
    expect(result.pending[0]?.actualSeconds).toBe(1800)
  })

  it('数据库唯一索引保证同一时刻只有一条 running 自动记录', () => {
    const first = addTask(activeCommissionId, '任务A')
    const second = addTask(activeCommissionId, '任务B')

    // 任务会话：source='auto' + task_id 非空
    repo.insert({
      id: '22222222-2222-4222-8222-222222222222',
      taskId: first,
      source: 'auto',
      status: 'running',
      startedAt: '2026-11-15T06:00:00.000Z',
      elapsedSeconds: 0,
      lastHeartbeatAt: '2026-11-15T06:00:00.000Z',
      appKey: null,
      note: null
    })

    // 第二条 running 的 auto 记录（无论是否带任务）都会被拒绝
    expect(() =>
      repo.insert({
        id: '33333333-3333-4333-8333-333333333333',
        taskId: second,
        source: 'auto',
        status: 'running',
        startedAt: '2026-11-15T06:00:01.000Z',
        elapsedSeconds: 0,
        lastHeartbeatAt: '2026-11-15T06:00:01.000Z',
        appKey: null,
        note: null
      })
    ).toThrow()

    expect(() =>
      repo.insert({
        id: '44444444-4444-4444-8444-444444444444',
        taskId: null,
        source: 'auto',
        status: 'running',
        startedAt: '2026-11-15T06:00:02.000Z',
        elapsedSeconds: 0,
        lastHeartbeatAt: '2026-11-15T06:00:02.000Z',
        appKey: 'photoshop',
        note: null
      })
    ).toThrow()

    // 查询也把两类记录区分开
    expect(repo.findActiveTaskSession()?.taskId).toBe(first)
    expect(repo.findActiveAuto()).toBeNull()
  })
})
