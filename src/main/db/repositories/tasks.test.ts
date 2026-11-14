import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createClientInputSchema,
  createCommissionInputSchema,
  createTaskInputSchema,
  type Commission
} from '@shared/domain'
import { DataError } from '@shared/errors'
import { applyMigrations } from '../migrator'
import { openDatabase, type AppDatabase } from '../database'
import { createClientsRepository } from './clients'
import { createCommissionsRepository, type CommissionsRepository } from './commissions'
import { createTasksRepository, type TasksRepository } from './tasks'

function codeOf(fn: () => void): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof DataError) return error.code
    throw error
  }
  throw new Error('预期抛错但没有抛出')
}

describe('任务仓储与委托状态联动', () => {
  let db: AppDatabase
  let tasks: TasksRepository
  let commissions: CommissionsRepository
  let commission: Commission

  beforeEach(() => {
    db = openDatabase(':memory:')
    applyMigrations(db)
    const clients = createClientsRepository(db)
    const client = clients.create(createClientInputSchema.parse({ name: '客户' }))
    commissions = createCommissionsRepository(db)
    commission = commissions.create(
      createCommissionInputSchema.parse({
        clientId: client.id,
        title: '委托',
        type: '插画',
        quoteAmountCents: 120000
      })
    )
    tasks = createTasksRepository(db)
  })

  afterEach(() => {
    db.close()
  })

  function activate(): void {
    commission = commissions.update({ id: commission.id, status: 'active' }) as Commission
  }

  function add(overrides: Record<string, unknown> = {}) {
    return tasks.create(
      createTaskInputSchema.parse({ commissionId: commission.id, title: '任务', ...overrides })
    )
  }

  function current(): Commission {
    return commissions.get({ id: commission.id }) as Commission
  }

  it('新建任务默认待开始，同阶段追加排序，列表按阶段顺序返回', () => {
    const line = add({ title: '线稿任务', stage: 'lineart' })
    const draftA = add({ title: '草稿 A' })
    const draftB = add({ title: '草稿 B' })

    const list = tasks.list({ commissionId: commission.id, includeArchived: false })
    expect(list.map((task) => task.title)).toEqual(['草稿 A', '草稿 B', '线稿任务'])
    expect(list.map((task) => task.sortOrder)).toEqual([0, 1, 0])
    expect(list.every((task) => task.status === 'todo')).toBe(true)
    expect(list[2]?.id).toBe(line.id)
    expect(current().taskCount).toBe(3)
    expect(current().doneTaskCount).toBe(0)
    expect(draftA.id).not.toBe(draftB.id)
  })

  it('标记完成写入完成时间，重新打开清空', () => {
    const task = add()

    const done = tasks.update({ id: task.id, status: 'done' })
    expect(done?.completedAt).toMatch(/Z$/)

    const reopened = tasks.update({ id: task.id, status: 'doing' })
    expect(reopened?.completedAt).toBeNull()
    expect(reopened?.status).toBe('doing')
  })

  it('归档任务从默认列表隐藏，恢复后追加到阶段末尾', () => {
    const a = add({ title: 'A' })
    add({ title: 'B' })

    const archived = tasks.archive({ id: a.id })
    expect(archived?.archivedAt).not.toBeNull()
    expect(tasks.list({ commissionId: commission.id, includeArchived: false }).map((t) => t.title)).toEqual(['B'])
    expect(tasks.list({ commissionId: commission.id, includeArchived: true })).toHaveLength(2)

    const restored = tasks.unarchive({ id: a.id })
    expect(restored?.archivedAt).toBeNull()
    expect(restored?.sortOrder).toBe(2)
  })

  it('排序只允许同一阶段的完整任务集合', () => {
    const a = add({ title: 'A' })
    const b = add({ title: 'B' })
    add({ title: '线稿', stage: 'lineart' })

    const reordered = tasks.reorder({
      commissionId: commission.id,
      stage: 'draft',
      orderedIds: [b.id, a.id]
    })
    expect(reordered.filter((t) => t.stage === 'draft').map((t) => t.title)).toEqual(['B', 'A'])
    expect(reordered.filter((t) => t.stage === 'draft').map((t) => t.sortOrder)).toEqual([0, 1])

    // 缺项
    expect(
      codeOf(() =>
        tasks.reorder({ commissionId: commission.id, stage: 'draft', orderedIds: [a.id] })
      )
    ).toBe('TASK_ORDER_MISMATCH')

    // 混入其它阶段的任务
    const line = tasks.list({ commissionId: commission.id, includeArchived: false }).find(
      (t) => t.stage === 'lineart'
    )
    expect(
      codeOf(() =>
        tasks.reorder({
          commissionId: commission.id,
          stage: 'draft',
          orderedIds: [a.id, b.id, line?.id as string]
        })
      )
    ).toBe('TASK_ORDER_MISMATCH')
  })

  it('最后一个任务完成时自动完成委托，重新打开后回到进行中', () => {
    activate()
    const first = add({ title: '1' })
    const second = add({ title: '2' })

    tasks.update({ id: first.id, status: 'done' })
    expect(current().status).toBe('active')

    tasks.update({ id: second.id, status: 'done' })
    const completed = current()
    expect(completed.status).toBe('completed')
    expect(completed.completedAt).not.toBeNull()
    expect(completed.doneTaskCount).toBe(2)

    tasks.update({ id: first.id, status: 'doing' })
    const reopened = current()
    expect(reopened.status).toBe('active')
    expect(reopened.completedAt).toBeNull()
  })

  it('归档未完成任务不会导致委托自动完成（产品决策 1）', () => {
    activate()
    const done = add({ title: 'done' })
    const unfinished = add({ title: 'todo' })

    tasks.update({ id: done.id, status: 'done' })
    expect(current().status).toBe('active')

    tasks.archive({ id: unfinished.id })
    // 剩余任务虽然全是 done，但归档不是「完成任务」操作
    expect(current().status).toBe('active')

    // 此时没有未完成任务，可以手动标记完成
    expect(commissions.update({ id: commission.id, status: 'completed' })?.status).toBe('completed')
  })

  it('已完成委托新增未完成任务时自动回到进行中（产品决策 3）', () => {
    activate()
    const task = add({ title: '唯一任务' })
    tasks.update({ id: task.id, status: 'done' })
    expect(current().status).toBe('completed')

    add({ title: '新任务' })
    expect(current().status).toBe('active')
    expect(current().completedAt).toBeNull()
  })

  it('已完成委托恢复归档的未完成任务时自动回到进行中（产品决策 3）', () => {
    activate()
    const done = add({ title: '已完成' })
    const pending = add({ title: '被归档的未完成' })
    tasks.archive({ id: pending.id })

    tasks.update({ id: done.id, status: 'done' })
    expect(current().status).toBe('completed')

    tasks.unarchive({ id: pending.id })
    expect(current().status).toBe('active')
    expect(current().completedAt).toBeNull()
  })

  it('有未完成任务时禁止手动完成委托，归档后可完成', () => {
    activate()
    const task = add({ title: '未完成' })

    expect(codeOf(() => commissions.update({ id: commission.id, status: 'completed' }))).toBe(
      'TASKS_INCOMPLETE'
    )

    tasks.archive({ id: task.id })
    const completed = commissions.update({ id: commission.id, status: 'completed' })
    expect(completed?.status).toBe('completed')
    expect(completed?.completedAt).not.toBeNull()
  })

  it('没有任务的委托可以手动完成', () => {
    activate()
    const completed = commissions.update({ id: commission.id, status: 'completed' })
    expect(completed?.status).toBe('completed')
    expect(completed?.completedAt).not.toBeNull()
  })

  it('对不存在的委托创建任务会给出可读错误', () => {
    expect(
      codeOf(() =>
        tasks.create(
          createTaskInputSchema.parse({
            commissionId: '00000000-0000-4000-8000-000000000000',
            title: '任务'
          })
        )
      )
    ).toBe('COMMISSION_NOT_FOUND')
  })

  it('已归档委托不参与自动联动', () => {
    activate()
    const task = add({ title: '唯一任务' })
    tasks.update({ id: task.id, status: 'done' })
    commissions.archive({ id: commission.id })

    const added = add({ title: '归档后又加的任务' })
    expect(added.status).toBe('todo')
    expect(current().status).toBe('completed')
  })
})
