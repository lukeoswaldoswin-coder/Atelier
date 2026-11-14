import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import {
  createClientInputSchema,
  createCommissionInputSchema,
  createTaskInputSchema,
  type Commission,
  type Task
} from '@shared/domain'
import {
  deadlineFingerprint,
  scheduleApplyInputSchema,
  type ScheduleApplyInput,
  type ScheduleBasis
} from '@shared/scheduling'
import { DataError } from '@shared/errors'
import { openDatabase, type AppDatabase } from '../database'
import { applyMigrations } from '../migrator'
import { createClientsRepository } from './clients'
import { createCommissionsRepository, type CommissionsRepository } from './commissions'
import { createTasksRepository, type TasksRepository } from './tasks'

function basisOf(task: Task, commission: Commission): ScheduleBasis {
  return {
    taskStatus: task.status,
    estimatedMinutes: task.estimatedMinutes,
    commissionStatus: commission.status as 'draft' | 'active',
    commissionPriority: commission.priority,
    deadlineFingerprint: deadlineFingerprint(commission.deadline)
  }
}

describe('采纳排期建议', () => {
  let db: AppDatabase
  let tasks: TasksRepository
  let commissions: CommissionsRepository
  let commission: Commission
  let taskA: Task
  let taskB: Task

  beforeEach(() => {
    db = openDatabase(':memory:')
    applyMigrations(db)

    const clients = createClientsRepository(db)
    const client = clients.create(createClientInputSchema.parse({ name: '三狼' }))
    commissions = createCommissionsRepository(db)
    const draft = commissions.create(
      createCommissionInputSchema.parse({
        clientId: client.id,
        title: '猪猪熊熊讨薪大长篇',
        type: '插画',
        priority: 3,
        deadline: { kind: 'date', date: '2026-11-20' },
        quoteAmountCents: 400000
      })
    )
    commissions.update({ id: draft.id, status: 'active' })
    commission = commissions.get({ id: draft.id }) as Commission

    tasks = createTasksRepository(db)
    taskA = tasks.create(
      createTaskInputSchema.parse({
        commissionId: commission.id,
        title: '构图草稿',
        stage: 'draft',
        estimatedMinutes: 90
      })
    )
    taskB = tasks.create(
      createTaskInputSchema.parse({
        commissionId: commission.id,
        title: '上色',
        stage: 'color',
        estimatedMinutes: 180
      })
    )
  })

  afterEach(() => {
    db.close()
  })

  function input(
    items: Array<{ task: Task; basis?: ScheduleBasis; plannedDate?: string }>
  ): ScheduleApplyInput {
    return {
      items: items.map((item) => ({
        taskId: item.task.id,
        plannedDate: item.plannedDate ?? '2026-11-18',
        basis: item.basis ?? basisOf(item.task, commission)
      }))
    }
  }

  function expectCode(fn: () => unknown, code: string): void {
    try {
      fn()
      throw new Error('预期抛出 DataError，但实际成功')
    } catch (error) {
      expect(error).toBeInstanceOf(DataError)
      expect((error as DataError).code).toBe(code)
    }
  }

  it('批量写入成功，且不修改委托截止与任务状态', () => {
    const result = tasks.applyPlannedDates(input([{ task: taskA }, { task: taskB }]))

    expect(result).toEqual([
      { taskId: taskA.id, plannedDate: '2026-11-18' },
      { taskId: taskB.id, plannedDate: '2026-11-18' }
    ])

    const list = tasks.list({ commissionId: commission.id, includeArchived: false })
    expect(list.map((task) => task.plannedDate)).toEqual(['2026-11-18', '2026-11-18'])
    expect(list.map((task) => task.status)).toEqual(['todo', 'todo'])

    const after = commissions.get({ id: commission.id })
    expect(after?.deadline).toEqual({ kind: 'date', date: '2026-11-20' })
    expect(after?.status).toBe('active')
  })

  it('预计工时变化时整批拒绝，已校验的任务也不写入', () => {
    tasks.update({ id: taskA.id, estimatedMinutes: 120 })

    expectCode(
      () => tasks.applyPlannedDates(input([{ task: taskA }, { task: taskB }])),
      'SCHEDULE_STALE'
    )

    expect(tasks.list({ commissionId: commission.id, includeArchived: false }).every((task) => task.plannedDate === null)).toBe(true)
  })

  it('任务状态变化视为建议过期', () => {
    tasks.update({ id: taskA.id, status: 'doing' })

    expectCode(() => tasks.applyPlannedDates(input([{ task: taskA }])), 'SCHEDULE_STALE')
    expect(tasks.list({ commissionId: commission.id, includeArchived: false })[0]?.plannedDate).toBeNull()
  })

  it('委托优先级变化视为建议过期', () => {
    commissions.update({ id: commission.id, priority: 1 })

    expectCode(() => tasks.applyPlannedDates(input([{ task: taskA }])), 'SCHEDULE_STALE')
  })

  it('日期型截止变化视为建议过期', () => {
    commissions.update({ id: commission.id, deadline: { kind: 'date', date: '2026-11-25' } })

    expectCode(() => tasks.applyPlannedDates(input([{ task: taskA }])), 'SCHEDULE_STALE')
  })

  it('时刻型截止仅改变时区也视为建议过期', () => {
    commissions.update({
      id: commission.id,
      deadline: { kind: 'datetime', at: '2026-11-20T15:00:00.000Z', timeZone: 'Asia/Shanghai' }
    })
    const current = commissions.get({ id: commission.id }) as Commission
    const task = tasks.list({ commissionId: commission.id, includeArchived: false })[0] as Task
    const originalBasis = basisOf(task, current)

    commissions.update({
      id: commission.id,
      deadline: { kind: 'datetime', at: '2026-11-20T15:00:00.000Z', timeZone: 'Pacific/Kiritimati' }
    })

    expectCode(
      () =>
        tasks.applyPlannedDates(
          input([{ task, basis: originalBasis }])
        ),
      'SCHEDULE_STALE'
    )
  })

  it('委托状态变化视为建议过期', () => {
    db.prepare("UPDATE commissions SET status = 'completed' WHERE id = ?").run(commission.id)

    expectCode(() => tasks.applyPlannedDates(input([{ task: taskA }])), 'SCHEDULE_STALE')
  })

  it('已有计划日期只算冲突，不误报为建议过期', () => {
    tasks.update({ id: taskA.id, plannedDate: '2026-11-17' })

    expectCode(() => tasks.applyPlannedDates(input([{ task: taskA }])), 'SCHEDULE_CONFLICT')
    expect(tasks.list({ commissionId: commission.id, includeArchived: false })[0]?.plannedDate).toBe('2026-11-17')
  })

  it('批量中后一项已有计划日期时，前一项也不写入', () => {
    tasks.update({ id: taskB.id, plannedDate: '2026-11-17' })

    expectCode(
      () => tasks.applyPlannedDates(input([{ task: taskA }, { task: taskB }])),
      'SCHEDULE_CONFLICT'
    )

    const list = tasks.list({ commissionId: commission.id, includeArchived: false })
    expect(list.find((task) => task.id === taskA.id)?.plannedDate).toBeNull()
    expect(list.find((task) => task.id === taskB.id)?.plannedDate).toBe('2026-11-17')
  })

  it('已完成任务不能安排', () => {
    tasks.update({ id: taskA.id, status: 'done' })
    const done = tasks.list({ commissionId: commission.id, includeArchived: false }).find((task) => task.id === taskA.id) as Task
    const basis = basisOf(done, commission)

    expectCode(
      () => tasks.applyPlannedDates(input([{ task: done, basis }])),
      'SCHEDULE_CONFLICT'
    )
  })

  it('已归档任务不能安排', () => {
    const archived = tasks.archive({ id: taskA.id }) as Task
    const basis = basisOf(archived, commission)

    expectCode(
      () => tasks.applyPlannedDates(input([{ task: archived, basis }])),
      'SCHEDULE_CONFLICT'
    )
  })

  it('委托归档后不能安排', () => {
    const basis = basisOf(taskA, commission)
    commissions.archive({ id: commission.id })

    expectCode(
      () => tasks.applyPlannedDates(input([{ task: taskA, basis }])),
      'SCHEDULE_CONFLICT'
    )
  })

  it('不存在的任务返回冲突', () => {
    expectCode(
      () =>
        tasks.applyPlannedDates({
          items: [
            {
              taskId: '99999999-9999-4999-8999-999999999999',
              plannedDate: '2026-11-18',
              basis: basisOf(taskA, commission)
            }
          ]
        }),
      'SCHEDULE_CONFLICT'
    )
  })

  it('契约层拒绝重复任务、空批次与非法日期', () => {
    const item = input([{ task: taskA }]).items[0]!
    expect(scheduleApplyInputSchema.safeParse({ items: [] }).success).toBe(false)
    expect(scheduleApplyInputSchema.safeParse({ items: [item, item] }).success).toBe(false)
    expect(
      scheduleApplyInputSchema.safeParse({
        items: [{ ...item, plannedDate: '2026-02-30' }]
      }).success
    ).toBe(false)
    expect(
      scheduleApplyInputSchema.safeParse({
        items: [{ ...item, basis: { ...item.basis, deadlineFingerprint: 'tampered' } }]
      }).success
    ).toBe(false)
  })
})
