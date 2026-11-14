import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createClientInputSchema,
  createCommissionInputSchema,
  createTaskInputSchema,
  updateTaskInputSchema,
  type Commission
} from '@shared/domain'
import { applyMigrations } from '../migrator'
import { openDatabase, type AppDatabase } from '../database'
import { createClientsRepository } from './clients'
import { createCommissionsRepository, type CommissionsRepository } from './commissions'
import { createTasksRepository, type TasksRepository } from './tasks'

describe('日历查询与计划日期', () => {
  let db: AppDatabase
  let tasks: TasksRepository
  let commissions: CommissionsRepository

  let c1: Commission
  let c2: Commission
  let c3: Commission
  let c4: Commission
  let c5: Commission
  let t1: ReturnType<TasksRepository['create']>
  let t3: ReturnType<TasksRepository['create']>

  beforeEach(() => {
    db = openDatabase(':memory:')
    applyMigrations(db)
    const clients = createClientsRepository(db)
    const client = clients.create(createClientInputSchema.parse({ name: '小夏' }))
    commissions = createCommissionsRepository(db)
    tasks = createTasksRepository(db)

    const createCommission = (title: string, deadline: Record<string, unknown> = { kind: 'none' }) =>
      commissions.create(
        createCommissionInputSchema.parse({
          clientId: client.id,
          title,
          type: '插画',
          quoteAmountCents: 10000,
          deadline
        })
      )

    c1 = createCommission('委托一', { kind: 'date', date: '2026-03-10' })
    c2 = createCommission('委托二')
    c3 = createCommission('委托三', {
      kind: 'datetime',
      at: '2026-03-04T20:00:00.000Z',
      timeZone: 'Asia/Shanghai'
    })
    c4 = createCommission('委托四', { kind: 'date', date: '2026-03-08' })
    c5 = createCommission('委托五', { kind: 'date', date: '2026-03-09' })

    commissions.update({ id: c1.id, status: 'active' })
    commissions.update({ id: c3.id, status: 'active' })
    commissions.update({ id: c4.id, status: 'cancelled' })
    commissions.archive({ id: c5.id })

    const add = (commission: Commission, title: string, plannedDate: string | null = null) =>
      tasks.create(
        createTaskInputSchema.parse({
          commissionId: commission.id,
          title,
          stage: 'draft',
          plannedDate
        })
      )

    t1 = add(c1, '一-计划2号', '2026-03-02')
    const t2 = add(c1, '一-完成10号', '2026-03-10')
    t3 = add(c1, '一-未安排')
    add(c1, '一-已归档', '2026-03-02')
    add(c1, '一-完成但未计划')
    add(c2, '二-计划3号', '2026-03-03')

    // 委托三：先加任务并完成，让委托自动完成
    const t5 = add(c3, '三-计划4号', '2026-03-04')
    add(c4, '四-已取消', '2026-03-06')
    add(c5, '五-已归档', '2026-03-07')

    tasks.update({ id: t2.id, status: 'done' })
    tasks.update({ id: t5.id, status: 'done' })

    // 归档其中一个任务
    const archivedTask = tasks
      .list({ commissionId: c1.id, includeArchived: false })
      .find((task) => task.title === '一-已归档')
    if (archivedTask) tasks.archive({ id: archivedTask.id })

    // 一个已完成但未计划的任务
    const doneUnscheduled = tasks
      .list({ commissionId: c1.id, includeArchived: false })
      .find((task) => task.title === '一-完成但未计划')
    if (doneUnscheduled) tasks.update({ id: doneUnscheduled.id, status: 'done' })
  })
  afterEach(() => {
    db.close()
  })

  it('已安排任务：范围内、含已完成任务与已完成委托，排除已取消/已归档与归档任务', () => {
    const result = tasks.calendar({ from: '2026-03-01', to: '2026-03-31' })

    expect(result.scheduled.map((item) => item.task.title)).toEqual([
      '一-计划2号',
      '二-计划3号',
      '三-计划4号',
      '一-完成10号'
    ])
    expect(result.scheduled.some((item) => item.commission.status === 'completed')).toBe(true)
    expect(result.scheduled.some((item) => item.task.title === '一-已归档')).toBe(false)
    expect(result.scheduled.some((item) => item.task.title === '四-已取消')).toBe(false)
    expect(result.scheduled.some((item) => item.task.title === '五-已归档')).toBe(false)
  })

  it('范围闭区间与跨月过滤', () => {
    const narrow = tasks.calendar({ from: '2026-03-02', to: '2026-03-03' })
    expect(narrow.scheduled.map((item) => item.task.title)).toEqual(['一-计划2号', '二-计划3号'])

    const empty = tasks.calendar({ from: '2026-04-01', to: '2026-04-30' })
    expect(empty.scheduled).toEqual([])
  })

  it('未安排任务：仅未完成、未归档、委托草稿/进行中', () => {
    const result = tasks.calendar({ from: '2026-03-01', to: '2026-03-31' })
    expect(result.unscheduled.map((item) => item.task.title)).toEqual(['一-未安排'])
    expect(result.unscheduled[0]?.task.id).toBe(t3.id)
  })

  it('委托截止与任务计划日期独立展示，时刻型按创建时区取日期', () => {
    const result = tasks.calendar({ from: '2026-03-01', to: '2026-03-31' })

    expect(result.deadlines.map((item) => item.commission.title)).toEqual(['委托三', '委托一'])
    expect(result.deadlines[0]?.date).toBe('2026-03-05')
    expect(result.deadlines[0]?.deadline.kind).toBe('datetime')
    // 截止不会因为任务计划日期而出现在任务列表里
    expect(result.scheduled.some((item) => item.task.title === '委托一')).toBe(false)
  })

  it('部分更新语义：不传保持、null 清除、日期更新', () => {
    expect(tasks.update({ id: t1.id, title: '改名' })?.plannedDate).toBe('2026-03-02')
    expect(tasks.update({ id: t1.id, plannedDate: null })?.plannedDate).toBeNull()
    expect(tasks.update({ id: t1.id, plannedDate: '2026-04-01' })?.plannedDate).toBe('2026-04-01')
  })

  it('非法日期被输入契约拒绝', () => {
    expect(() =>
      createTaskInputSchema.parse({
        commissionId: c1.id,
        title: 'x',
        plannedDate: '2026-02-30'
      })
    ).toThrow()
    expect(() =>
      updateTaskInputSchema.parse({ id: t1.id, plannedDate: '2026-04-31' })
    ).toThrow()
  })

  it('计划日期与委托截止互不影响', () => {
    const before = commissions.get({ id: c1.id })?.deadline
    tasks.update({ id: t1.id, plannedDate: '2026-03-20' })
    expect(commissions.get({ id: c1.id })?.deadline).toEqual(before)

    const planned = tasks.list({ commissionId: c1.id, includeArchived: false }).find((t) => t.id === t1.id)
      ?.plannedDate
    commissions.update({ id: c1.id, deadline: { kind: 'date', date: '2026-06-01' } })
    expect(
      tasks.list({ commissionId: c1.id, includeArchived: false }).find((t) => t.id === t1.id)?.plannedDate
    ).toBe(planned)
  })

  it('任务完成不清除计划日期', () => {
    const task = tasks.list({ commissionId: c1.id, includeArchived: false }).find((item) => item.title === '一-完成10号')
    expect(task?.status).toBe('done')
    expect(task?.plannedDate).toBe('2026-03-10')
  })
})
