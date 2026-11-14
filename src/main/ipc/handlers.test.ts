import { describe, expect, it } from 'vitest'
import { IpcChannel, ipcChannelNames } from '@shared/channels'
import type { AppInfo } from '@shared/contracts'
import type { CalendarTasksOutput, Client, Commission, Task } from '@shared/domain'
import { deadlineFingerprint, type ScheduleApplyOutput } from '@shared/scheduling'
import { applyMigrations } from '../db/migrator'
import { openDatabase, type AppDatabase } from '../db/database'
import { createClientsRepository, type ClientsRepository } from '../db/repositories/clients'
import { createCommissionsRepository, type CommissionsRepository } from '../db/repositories/commissions'
import { createTasksRepository, type TasksRepository } from '../db/repositories/tasks'
import { createTimeEntriesRepository } from '../db/repositories/time-entries'
import type { ActivityMonitor } from '../activity/activity-monitor'
import type { DataController } from '../data/controller'
import { createTimeService, type TimeService } from '../time/time-service'
import { createIpcHandlers, type IpcHandlers } from './handlers'

const monitorStatus = {
  platformSupported: true,
  enabled: false,
  apps: ['photoshop'],
  idleMinutes: 3,
  idleEnabled: true,
  running: false,
  activeAppKey: null,
  idleSeconds: null,
  error: null
}

function makeMonitor(): ActivityMonitor {
  return {
    status: () => monitorStatus,
    setEnabled: () => ({ ...monitorStatus, enabled: true }),
    setApps: () => monitorStatus,
    setIdleMinutes: () => monitorStatus,
    start: () => undefined,
    stop: () => undefined,
    tick: () => undefined,
    handleSuspend: () => undefined,
    handleResume: () => undefined,
    getConfig: () => ({ enabled: false, apps: ['photoshop'], idleMinutes: 3 })
  } as unknown as ActivityMonitor
}

const info: AppInfo = {
  name: 'atelier',
  version: '0.1.0',
  electron: '44.7.0',
  chrome: '152.0.0.0',
  node: '24.0.0',
  platform: 'win32',
  arch: 'x64',
  isDev: true
}

const newClientId = '3f2b8c4e-1a2b-4c5d-8e9f-0a1b2c3d4e5f'

interface HandlersFixture {
  db: AppDatabase
  handlers: IpcHandlers
  clients: ClientsRepository
  commissions: CommissionsRepository
  tasks: TasksRepository
  time: TimeService
}

function makeData(): DataController {
  return {
    info: () => ({
      appVersion: '0.1.0',
      dbPath: 'C:\\temp\\atelier.db',
      backupDir: 'C:\\temp\\backups',
      recoveryArchiveDir: 'C:\\temp\\recovery-archive',
      dbSizeBytes: 1024,
      schemaVersion: '005-time-entries',
      backupCount: 1,
      userDataDir: 'C:\\temp'
    }),
    createBackup: () => ({
      path: 'C:\\temp\\backups\\Atelier-backup-20261114-120000-000.db',
      fileName: 'Atelier-backup-20261114-120000-000.db',
      sizeBytes: 1024,
      createdAt: '2026-11-14T12:00:00.000Z',
      schemaVersion: '005-time-entries',
      kind: 'manual'
    }),
    listBackups: () => [],
    revealBackup: () => true
  } as unknown as DataController
}

function setup(): HandlersFixture {
  const db = openDatabase(':memory:')
  applyMigrations(db)
  const clients = createClientsRepository(db)
  const commissions = createCommissionsRepository(db)
  const tasks = createTasksRepository(db)
  const time = createTimeService(createTimeEntriesRepository(db))
  const handlers = createIpcHandlers({
    getAppInfo: () => info,
    clients,
    commissions,
    tasks,
    time,
    monitor: makeMonitor(),
    data: makeData()
  })
  return { db, handlers, clients, commissions, tasks, time }
}

describe('createIpcHandlers', () => {
  it('覆盖全部已声明通道', () => {
    const { handlers, db } = setup()
    expect(Object.keys(handlers).sort()).toEqual([...ipcChannelNames].sort())
    db.close()
  })

  it('app:get-info 返回主进程提供的运行时信息，入参不符合契约时拒绝', async () => {
    const { handlers, db } = setup()

    await expect(handlers[IpcChannel.appGetInfo](undefined)).resolves.toEqual(info)
    await expect(handlers[IpcChannel.appGetInfo]({ injected: true })).rejects.toThrow()
    db.close()
  })

  it('clients:create 写入数据库并返回通过输出契约校验的对象', async () => {
    const { handlers, clients, db } = setup()

    const created = (await handlers[IpcChannel.clientsCreate]({ name: '小夏' })) as Client

    expect(created.name).toBe('小夏')
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(clients.get({ id: created.id })?.name).toBe('小夏')
    db.close()
  })

  it('clients:create 拒绝空白名称，不写库', async () => {
    const { handlers, clients, db } = setup()

    await expect(handlers[IpcChannel.clientsCreate]({ name: '   ' })).rejects.toThrow()
    expect(clients.list({ includeArchived: true })).toHaveLength(0)
    db.close()
  })

  it('clients:list 不传参数也能工作，clients:get 不存在时返回 null', async () => {
    const { handlers, db } = setup()
    await handlers[IpcChannel.clientsCreate]({ name: 'A' })

    const list = (await handlers[IpcChannel.clientsList](undefined)) as Client[]
    expect(list).toHaveLength(1)

    const missing = await handlers[IpcChannel.clientsGet]({ id: newClientId })
    expect(missing).toBeNull()
    db.close()
  })

  it('clients:unarchive 恢复客户并重新出现在默认列表', async () => {
    const { handlers, db } = setup()
    const created = (await handlers[IpcChannel.clientsCreate]({ name: '归档客户' })) as Client

    const archived = (await handlers[IpcChannel.clientsArchive]({ id: created.id })) as Client
    expect(archived.archivedAt).not.toBeNull()
    expect((await handlers[IpcChannel.clientsList]({})) as Client[]).toHaveLength(0)

    const restored = (await handlers[IpcChannel.clientsUnarchive]({ id: created.id })) as Client
    expect(restored.archivedAt).toBeNull()

    const list = (await handlers[IpcChannel.clientsList]({})) as Client[]
    expect(list.map((client) => client.id)).toContain(created.id)
    db.close()
  })

  it('clients:unarchive 拒绝非法 id', async () => {
    const { handlers, db } = setup()
    await expect(handlers[IpcChannel.clientsUnarchive]({ id: 'not-a-uuid' })).rejects.toThrow()
    db.close()
  })

  it('commissions:create 默认按“未报价”处理', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client

    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: '半身立绘',
      type: '插画'
    })) as Commission

    expect(commission.quoteAmountCents).toBeNull()
    expect(commission.paymentStatus).toBe('unquoted')
    expect(commission.outstandingCents).toBeNull()
    expect(commission.deadline).toEqual({ kind: 'none' })
    db.close()
  })

  it('commissions:create 带报价时为未付款', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client

    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: '半身立绘',
      type: '插画',
      quoteAmountCents: 12800
    })) as Commission

    expect(commission.paymentStatus).toBe('unpaid')
    expect(commission.outstandingCents).toBe(12800)
    db.close()
  })

  it('渲染进程提交 paymentStatus 会被拒绝', async () => {
    const { handlers, commissions, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client

    await expect(
      handlers[IpcChannel.commissionsCreate]({
        clientId: client.id,
        title: 'x',
        type: 'y',
        paymentStatus: 'paid'
      })
    ).rejects.toThrow()

    expect(commissions.list({ includeArchived: true })).toHaveLength(0)
    db.close()
  })

  it('付款更新：部分付款后状态与未收金额正确，超额被拒绝', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client
    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: 'x',
      type: 'y',
      quoteAmountCents: 10000
    })) as Commission

    const partial = (await handlers[IpcChannel.commissionsUpdate]({
      id: commission.id,
      paidAmountCents: 4000
    })) as Commission
    expect(partial.paymentStatus).toBe('partial')
    expect(partial.outstandingCents).toBe(6000)

    await expect(
      handlers[IpcChannel.commissionsUpdate]({ id: commission.id, paidAmountCents: 20000 })
    ).rejects.toThrow(/不能超过报价/)
    db.close()
  })

  it('commissions:create 在客户不存在时给出可读错误', async () => {
    const { handlers, db } = setup()

    await expect(
      handlers[IpcChannel.commissionsCreate]({ clientId: newClientId, title: '委托', type: '插画' })
    ).rejects.toThrow(/客户不存在/)
    db.close()
  })

  it('commissions 全流程：创建、列表、更新、归档', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client

    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: '半身立绘',
      type: '插画',
      quoteAmountCents: 12800,
      deadline: { kind: 'date', date: '2026-12-31' }
    })) as Commission
    expect(commission.deadline).toEqual({ kind: 'date', date: '2026-12-31' })

    const updated = (await handlers[IpcChannel.commissionsUpdate]({
      id: commission.id,
      status: 'active'
    })) as Commission
    expect(updated.status).toBe('active')

    const archived = (await handlers[IpcChannel.commissionsArchive]({ id: commission.id })) as Commission
    expect(archived.archivedAt).not.toBeNull()

    const visible = (await handlers[IpcChannel.commissionsList]({})) as Commission[]
    expect(visible).toHaveLength(0)

    const all = (await handlers[IpcChannel.commissionsList]({ includeArchived: true })) as Commission[]
    expect(all).toHaveLength(1)
    db.close()
  })

  it('commissions:unarchive 恢复归档委托', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client
    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: '会归档',
      type: '插画'
    })) as Commission

    await handlers[IpcChannel.commissionsArchive]({ id: commission.id })
    expect((await handlers[IpcChannel.commissionsList]({})) as Commission[]).toHaveLength(0)

    const restored = (await handlers[IpcChannel.commissionsUnarchive]({
      id: commission.id
    })) as Commission
    expect(restored.archivedAt).toBeNull()
    expect((await handlers[IpcChannel.commissionsList]({})) as Commission[]).toHaveLength(1)
    db.close()
  })

  it('状态跳步时返回可读错误', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client
    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: 'x',
      type: 'y'
    })) as Commission

    await expect(
      handlers[IpcChannel.commissionsUpdate]({ id: commission.id, status: 'completed' })
    ).rejects.toThrow(/不能从「草稿」直接变更为「已完成」/)
    db.close()
  })

  it('tasks 全流程：创建、列表、完成、排序、归档、恢复', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client
    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: '委托',
      type: '插画',
      quoteAmountCents: 120000
    })) as Commission

    const draftTask = (await handlers[IpcChannel.tasksCreate]({
      commissionId: commission.id,
      title: '草稿',
      stage: 'draft',
      estimatedMinutes: 60
    })) as Task
    const lineTask = (await handlers[IpcChannel.tasksCreate]({
      commissionId: commission.id,
      title: '线稿',
      stage: 'lineart'
    })) as Task

    const list = (await handlers[IpcChannel.tasksList]({
      commissionId: commission.id
    })) as Task[]
    expect(list.map((task) => task.title)).toEqual(['草稿', '线稿'])

    const done = (await handlers[IpcChannel.tasksUpdate]({
      id: draftTask.id,
      status: 'done'
    })) as Task
    expect(done.completedAt).not.toBeNull()

    const reordered = (await handlers[IpcChannel.tasksReorder]({
      commissionId: commission.id,
      stage: 'draft',
      orderedIds: [draftTask.id]
    })) as Task[]
    expect(reordered[0]?.sortOrder).toBe(0)

    const archived = (await handlers[IpcChannel.tasksArchive]({ id: lineTask.id })) as Task
    expect(archived.archivedAt).not.toBeNull()

    const restored = (await handlers[IpcChannel.tasksUnarchive]({ id: lineTask.id })) as Task
    expect(restored.archivedAt).toBeNull()
    db.close()
  })

  it('tasks:reorder 拒绝不完整的任务集合，tasks:create 拒绝未知字段', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client
    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: '委托',
      type: '插画'
    })) as Commission

    await handlers[IpcChannel.tasksCreate]({
      commissionId: commission.id,
      title: '任务',
      stage: 'draft'
    })

    await expect(
      handlers[IpcChannel.tasksReorder]({
        commissionId: commission.id,
        stage: 'draft',
        orderedIds: []
      })
    ).rejects.toThrow(/全部任务/)

    await expect(
      handlers[IpcChannel.tasksCreate]({
        commissionId: commission.id,
        title: '任务',
        completedAt: '2026-01-01T00:00:00.000Z'
      })
    ).rejects.toThrow()
    db.close()
  })

  it('有未完成任务时，手动完成委托返回可读错误', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client
    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: '委托',
      type: '插画'
    })) as Commission
    await handlers[IpcChannel.commissionsUpdate]({ id: commission.id, status: 'active' })
    await handlers[IpcChannel.tasksCreate]({
      commissionId: commission.id,
      title: '未完成',
      stage: 'draft'
    })

    await expect(
      handlers[IpcChannel.commissionsUpdate]({ id: commission.id, status: 'completed' })
    ).rejects.toThrow(/未完成任务/)
    db.close()
  })

  it('calendar:tasks 返回日历数据，并拒绝非法日期', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client
    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: '委托',
      type: '插画',
      deadline: { kind: 'date', date: '2026-03-10' }
    })) as Commission
    await handlers[IpcChannel.commissionsUpdate]({ id: commission.id, status: 'active' })

    const task = (await handlers[IpcChannel.tasksCreate]({
      commissionId: commission.id,
      title: '任务',
      stage: 'draft'
    })) as Task
    await handlers[IpcChannel.tasksUpdate]({ id: task.id, plannedDate: '2026-03-02' })

    const result = (await handlers[IpcChannel.calendarTasks]({
      from: '2026-03-01',
      to: '2026-03-31'
    })) as CalendarTasksOutput

    expect(result.scheduled).toHaveLength(1)
    expect(result.scheduled[0]?.task.plannedDate).toBe('2026-03-02')
    expect(result.deadlines[0]?.date).toBe('2026-03-10')

    await expect(
      handlers[IpcChannel.calendarTasks]({ from: '2026-04-01', to: '2026-03-01' })
    ).rejects.toThrow()
    await expect(
      handlers[IpcChannel.calendarTasks]({ from: '2026-02-30', to: '2026-03-01' })
    ).rejects.toThrow()
    db.close()
  })

  it('schedule:apply 校验建议快照并批量写入，过期时拒绝', async () => {
    const { handlers, db, commissions, tasks } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client
    const created = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: '委托',
      type: '插画',
      priority: 3,
      deadline: { kind: 'date', date: '2026-11-20' }
    })) as Commission
    await handlers[IpcChannel.commissionsUpdate]({ id: created.id, status: 'active' })
    const commission = commissions.get({ id: created.id }) as Commission

    const task = (await handlers[IpcChannel.tasksCreate]({
      commissionId: commission.id,
      title: '构图草稿',
      stage: 'draft',
      estimatedMinutes: 90
    })) as Task

    const basis = {
      taskStatus: task.status,
      estimatedMinutes: task.estimatedMinutes,
      commissionStatus: 'active' as const,
      commissionPriority: commission.priority,
      deadlineFingerprint: deadlineFingerprint(commission.deadline)
    }

    const result = (await handlers[IpcChannel.scheduleApply]({
      items: [{ taskId: task.id, plannedDate: '2026-11-18', basis }]
    })) as ScheduleApplyOutput

    expect(result.applied).toEqual([{ taskId: task.id, plannedDate: '2026-11-18' }])
    expect(
      tasks.list({ commissionId: commission.id, includeArchived: false })[0]?.plannedDate
    ).toBe('2026-11-18')

    const staleTask = (await handlers[IpcChannel.tasksCreate]({
      commissionId: commission.id,
      title: '上色',
      stage: 'color',
      estimatedMinutes: 120
    })) as Task

    await expect(
      handlers[IpcChannel.scheduleApply]({
        items: [
          {
            taskId: staleTask.id,
            plannedDate: '2026-11-18',
            basis: { ...basis, estimatedMinutes: 999 }
          }
        ]
      })
    ).rejects.toThrow(/建议依据已变化/)
    expect(
      tasks
        .list({ commissionId: commission.id, includeArchived: false })
        .find((item) => item.id === staleTask.id)?.plannedDate
    ).toBeNull()

    await expect(
      handlers[IpcChannel.scheduleApply]({ items: [] })
    ).rejects.toThrow()
    db.close()
  })

  it('time 通道：开始、暂停、继续、结束与状态查询', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client
    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: '委托',
      type: '插画'
    })) as Commission
    const task = (await handlers[IpcChannel.tasksCreate]({
      commissionId: commission.id,
      title: '任务',
      stage: 'draft'
    })) as Task

    const started = (await handlers[IpcChannel.timeStart]({ taskId: task.id })) as {
      manual: { entry: { status: string; taskId: string } } | null
    }
    expect(started.manual?.entry.status).toBe('running')
    expect(started.manual?.entry.taskId).toBe(task.id)

    const paused = (await handlers[IpcChannel.timePause](undefined)) as {
      manual: { entry: { status: string } } | null
    }
    expect(paused.manual?.entry.status).toBe('paused')

    const resumed = (await handlers[IpcChannel.timeResume](undefined)) as {
      manual: { entry: { status: string } } | null
    }
    expect(resumed.manual?.entry.status).toBe('running')

    const stopped = (await handlers[IpcChannel.timeStop](undefined)) as {
      manual: unknown | null
    }
    expect(stopped.manual).toBeNull()

    const status = (await handlers[IpcChannel.timeStatus](undefined)) as {
      manual: unknown | null
      auto: unknown | null
    }
    expect(status.manual).toBeNull()
    expect(status.auto).toBeNull()

    const list = (await handlers[IpcChannel.timeList]({
      from: '2026-01-01T00:00:00.000Z',
      to: '2030-01-01T00:00:00.000Z'
    })) as unknown[]
    expect(list).toHaveLength(1)

    await expect(handlers[IpcChannel.timeStart]({ taskId: task.id })).resolves.toBeTruthy()
    await expect(handlers[IpcChannel.timeStart]({ taskId: task.id })).rejects.toThrow(/已有正在进行的计时/)
    await handlers[IpcChannel.timeStop](undefined)
    db.close()
  })

  it('输出不符合契约时不会把脏数据交给渲染进程', async () => {
    const dirtyClients = {
      create: () => ({ id: 'not-a-uuid' }),
      list: () => [],
      get: () => null,
      update: () => null,
      archive: () => null
    } as unknown as ClientsRepository

    const handlers = createIpcHandlers({
      getAppInfo: () => info,
      clients: dirtyClients,
      commissions: {} as CommissionsRepository,
      tasks: {} as TasksRepository,
      time: {} as TimeService,
      monitor: {} as ActivityMonitor,
      data: makeData()
    })

    await expect(handlers[IpcChannel.clientsCreate]({ name: 'x' })).rejects.toThrow()
  })
})
