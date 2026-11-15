import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  calendarActivitySummaryInputSchema,
  calendarDayDetailInputSchema,
  createClientInputSchema,
  createCommissionInputSchema,
  createTaskInputSchema,
  type Task
} from '@shared/domain'
import { openDatabase, type AppDatabase } from '../database'
import { applyMigrations } from '../migrator'
import { createClientsRepository } from './clients'
import { createCommissionsRepository } from './commissions'
import { createTasksRepository, type TasksRepository } from './tasks'
import {
  createCalendarActivityRepository,
  type CalendarActivityRepository
} from './calendar-activity'

/**
 * 聚合查询测试。
 *
 * 用真实的临时 SQLite 文件（不是 :memory:、也不是 mock），
 * 因为要验证的是真实 SQL、真实 CHECK 约束、真实索引下的行为；
 * 时区固定为 Asia/Shanghai（UTC+8），让「本地日 ≠ UTC 日」的用例稳定复现。
 */

const TIME_ZONE = 'Asia/Shanghai'

const IDS = {
  entryA: '11111111-1111-4111-8111-111111111111',
  entryB: '22222222-2222-4222-8222-222222222222',
  entryC: '33333333-3333-4333-8333-333333333333',
  entryD: '44444444-4444-4444-8444-444444444444',
  entryE: '55555555-5555-4555-8555-555555555555',
  entryF: '66666666-6666-4666-8666-666666666666',
  entryG: '77777777-7777-4777-8777-777777777777',
  entryH: '88888888-8888-4888-8888-888888888888',
  segmentA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  segmentB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
}

/** 一条待插入的工时记录（直接写 SQL，才能覆盖 merged_into_id / deleted_at）。 */
interface EntrySeed {
  id: string
  taskId: string | null
  source?: 'manual' | 'auto'
  startedAt: string
  endedAt: string
  elapsedSeconds: number
  mergedIntoId?: string | null
  deletedAt?: string | null
  appKey?: string | null
}

interface SegmentSeed {
  id: string
  entryId: string
  startedAt: string
  endedAt: string
  seconds: number
}

describe('每日创作工时聚合', () => {
  let dir: string
  let db: AppDatabase
  let repo: CalendarActivityRepository
  let tasks: TasksRepository
  let taskA: Task
  let taskB: Task
  let taskDone: Task

  /**
   * 片段表可能由迁移 006 创建（另一位队友的工作），也可能还不存在。
   * 不存在时这里按已冻结的列定义补建，保证「有片段」和「无片段」两条路径都能测。
   */
  function ensureSegmentsTable(): void {
    const row = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'time_entry_segments'")
      .get()
    if (row) return
    db.exec(`
      CREATE TABLE time_entry_segments (
        id         TEXT PRIMARY KEY NOT NULL,
        entry_id   TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at   TEXT NOT NULL,
        seconds    INTEGER NOT NULL CHECK (typeof(seconds) = 'integer' AND seconds >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `)
  }

  function insertEntry(seed: EntrySeed): void {
    db.prepare(
      `INSERT INTO time_entries (
         id, task_id, source, status, started_at, ended_at, elapsed_seconds,
         last_heartbeat_at, app_key, merged_into_id, note, clock_skew_seconds,
         deleted_at, created_at, updated_at
       ) VALUES (
         @id, @taskId, @source, 'completed', @startedAt, @endedAt, @elapsedSeconds,
         @endedAt, @appKey, @mergedIntoId, NULL, 0,
         @deletedAt, @startedAt, @endedAt
       )`
    ).run({
      id: seed.id,
      taskId: seed.taskId,
      source: seed.source ?? 'manual',
      startedAt: seed.startedAt,
      endedAt: seed.endedAt,
      elapsedSeconds: seed.elapsedSeconds,
      appKey: seed.appKey ?? null,
      mergedIntoId: seed.mergedIntoId ?? null,
      deletedAt: seed.deletedAt ?? null
    })
  }

  function insertSegment(seed: SegmentSeed): void {
    db.prepare(
      `INSERT INTO time_entry_segments (
         id, entry_id, started_at, ended_at, seconds, created_at, updated_at
       ) VALUES (@id, @entryId, @startedAt, @endedAt, @seconds, @startedAt, @endedAt)`
    ).run(seed)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atelier-calendar-activity-'))
    db = openDatabase(join(dir, 'atelier.db'))
    applyMigrations(db)
    ensureSegmentsTable()

    const clients = createClientsRepository(db)
    const client = clients.create(createClientInputSchema.parse({ name: '三狼' }))
    const commissions = createCommissionsRepository(db)
    const commission = commissions.create(
      createCommissionInputSchema.parse({
        clientId: client.id,
        title: '猪猪熊熊讨薪大长篇',
        type: '插画',
        quoteAmountCents: 10000
      })
    )
    const secondCommission = commissions.create(
      createCommissionInputSchema.parse({
        clientId: client.id,
        title: '另一份委托',
        type: '插画',
        quoteAmountCents: 20000
      })
    )

    tasks = createTasksRepository(db)
    taskA = tasks.create(
      createTaskInputSchema.parse({
        commissionId: commission.id,
        title: '构图草稿',
        stage: 'draft'
      })
    )
    taskB = tasks.create(
      createTaskInputSchema.parse({
        commissionId: secondCommission.id,
        title: '上色',
        stage: 'color'
      })
    )
    taskDone = tasks.create(
      createTaskInputSchema.parse({
        commissionId: commission.id,
        title: '已完成的线稿',
        stage: 'lineart'
      })
    )
    // 标记完成：历史工时必须仍然可见
    tasks.update({ id: taskDone.id, status: 'done' })

    repo = createCalendarActivityRepository(db, { timeZone: TIME_ZONE })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('同一天同一任务的多笔工时正确合计', () => {
    // 本地 09:00–09:30 与 14:00–15:00（UTC+8）
    insertEntry({
      id: IDS.entryA,
      taskId: taskA.id,
      startedAt: '2026-03-02T01:00:00.000Z',
      endedAt: '2026-03-02T01:30:00.000Z',
      elapsedSeconds: 1800
    })
    insertEntry({
      id: IDS.entryB,
      taskId: taskA.id,
      startedAt: '2026-03-02T06:00:00.000Z',
      endedAt: '2026-03-02T07:00:00.000Z',
      elapsedSeconds: 3600
    })

    const summary = repo.summary({ from: '2026-03-02', to: '2026-03-02' })
    expect(summary.days).toHaveLength(1)
    expect(summary.days[0]).toMatchObject({
      date: '2026-03-02',
      seconds: 5400,
      taskCount: 1,
      commissionCount: 1,
      unassignedSeconds: 0
    })

    const detail = repo.dayDetail({ date: '2026-03-02' })
    expect(detail.totalSeconds).toBe(5400)
    expect(detail.tasks).toHaveLength(1)
    expect(detail.tasks[0]?.taskId).toBe(taskA.id)
    expect(detail.tasks[0]?.seconds).toBe(5400)
    expect(detail.tasks[0]?.entryIds.sort()).toEqual([IDS.entryA, IDS.entryB].sort())
    // 任务信息带齐，供界面直接展示与跳转
    expect(detail.tasks[0]?.taskTitle).toBe('构图草稿')
    expect(detail.tasks[0]?.commissionTitle).toBe('猪猪熊熊讨薪大长篇')
    expect(detail.tasks[0]?.clientName).toBe('三狼')
  })

  it('同一天多片段：按片段求和，不受墙钟跨度影响', () => {
    // 09:00 开始、11:00 结束，但中间只活跃了两段共 3600 秒
    insertEntry({
      id: IDS.entryC,
      taskId: taskA.id,
      startedAt: '2026-03-02T01:00:00.000Z',
      endedAt: '2026-03-02T03:00:00.000Z',
      elapsedSeconds: 3600
    })
    insertSegment({
      id: IDS.segmentA,
      entryId: IDS.entryC,
      startedAt: '2026-03-02T01:00:00.000Z',
      endedAt: '2026-03-02T01:20:00.000Z',
      seconds: 1200
    })
    insertSegment({
      id: IDS.segmentB,
      entryId: IDS.entryC,
      startedAt: '2026-03-02T02:00:00.000Z',
      endedAt: '2026-03-02T02:40:00.000Z',
      seconds: 2400
    })

    const summary = repo.summary({ from: '2026-03-02', to: '2026-03-02' })
    expect(summary.days[0]?.seconds).toBe(3600)
    expect(repo.dayDetail({ date: '2026-03-02' }).tasks[0]?.seconds).toBe(3600)
  })

  it('跨午夜 23:40→00:20 拆成两天各 20 分钟', () => {
    // 本地 2026-03-02 23:40 → 2026-03-03 00:20（UTC+8）
    insertEntry({
      id: IDS.entryD,
      taskId: taskA.id,
      startedAt: '2026-03-02T15:40:00.000Z',
      endedAt: '2026-03-02T16:20:00.000Z',
      elapsedSeconds: 2400
    })

    const summary = repo.summary({ from: '2026-03-01', to: '2026-03-05' })
    expect(summary.days.map((day) => [day.date, day.seconds])).toEqual([
      ['2026-03-02', 1200],
      ['2026-03-03', 1200]
    ])
    // 合计严格等于记录时长，不重复不丢失
    expect(summary.days.reduce((sum, day) => sum + day.seconds, 0)).toBe(2400)

    expect(repo.dayDetail({ date: '2026-03-02' }).totalSeconds).toBe(1200)
    expect(repo.dayDetail({ date: '2026-03-03' }).totalSeconds).toBe(1200)
    // 只查第二天也要能取到这笔跨午夜记录
    expect(repo.dayDetail({ date: '2026-03-03' }).tasks[0]?.entryIds).toEqual([IDS.entryD])
  })

  it('未关联任务的工时只计入 unassignedSeconds，不归入任何任务', () => {
    insertEntry({
      id: IDS.entryE,
      taskId: null,
      source: 'auto',
      appKey: 'photoshop',
      startedAt: '2026-03-02T01:00:00.000Z',
      endedAt: '2026-03-02T02:00:00.000Z',
      elapsedSeconds: 3600
    })
    insertEntry({
      id: IDS.entryA,
      taskId: taskA.id,
      startedAt: '2026-03-02T06:00:00.000Z',
      endedAt: '2026-03-02T06:30:00.000Z',
      elapsedSeconds: 1800
    })

    const summary = repo.summary({ from: '2026-03-02', to: '2026-03-02' })
    expect(summary.days[0]).toMatchObject({
      seconds: 5400,
      unassignedSeconds: 3600,
      taskCount: 1,
      commissionCount: 1
    })

    const detail = repo.dayDetail({ date: '2026-03-02' })
    expect(detail.totalSeconds).toBe(5400)
    expect(detail.unassignedSeconds).toBe(3600)
    expect(detail.unassignedEntryIds).toEqual([IDS.entryE])
    expect(detail.tasks.map((item) => item.taskId)).toEqual([taskA.id])
    expect(detail.tasks[0]?.entryIds).toEqual([IDS.entryA])
    expect(detail.commissions).toHaveLength(1)
    expect(detail.commissions[0]?.seconds).toBe(1800)
  })

  it('没有记录的日期不出现在 days 数组里', () => {
    insertEntry({
      id: IDS.entryA,
      taskId: taskA.id,
      startedAt: '2026-03-02T01:00:00.000Z',
      endedAt: '2026-03-02T02:00:00.000Z',
      elapsedSeconds: 3600
    })

    const summary = repo.summary({ from: '2026-03-01', to: '2026-03-05' })
    expect(summary.days.map((day) => day.date)).toEqual(['2026-03-02'])

    // 完全没有记录的区间返回空数组，而不是补齐 0
    const empty = repo.summary({ from: '2026-04-01', to: '2026-04-05' })
    expect(empty.days).toEqual([])

    const emptyDay = repo.dayDetail({ date: '2026-03-04' })
    expect(emptyDay).toEqual({
      date: '2026-03-04',
      totalSeconds: 0,
      unassignedSeconds: 0,
      tasks: [],
      unassignedEntryIds: [],
      commissions: []
    })
  })

  it('已完成任务的历史工时仍然可见', () => {
    insertEntry({
      id: IDS.entryF,
      taskId: taskDone.id,
      startedAt: '2026-03-02T01:00:00.000Z',
      endedAt: '2026-03-02T01:45:00.000Z',
      elapsedSeconds: 2700
    })

    const summary = repo.summary({ from: '2026-03-02', to: '2026-03-02' })
    expect(summary.days[0]?.seconds).toBe(2700)
    expect(summary.days[0]?.taskCount).toBe(1)

    const detail = repo.dayDetail({ date: '2026-03-02' })
    expect(detail.tasks).toHaveLength(1)
    expect(detail.tasks[0]?.taskId).toBe(taskDone.id)
    expect(detail.tasks[0]?.taskStatus).toBe('done')
    expect(detail.tasks[0]?.taskStage).toBe('lineart')
    expect(detail.tasks[0]?.seconds).toBe(2700)
  })

  it('被合并（merged_into_id 非空）的记录不重复计数', () => {
    // entryH 是合并后保留的记录，必须先存在（entryG 的外键指向它）
    insertEntry({
      id: IDS.entryH,
      taskId: taskA.id,
      startedAt: '2026-03-02T01:00:00.000Z',
      endedAt: '2026-03-02T02:00:00.000Z',
      elapsedSeconds: 3600
    })
    // entryG 是被合并掉的原记录：已软删除，且指向保留记录 entryH
    insertEntry({
      id: IDS.entryG,
      taskId: taskA.id,
      startedAt: '2026-03-02T01:00:00.000Z',
      endedAt: '2026-03-02T02:00:00.000Z',
      elapsedSeconds: 3600,
      mergedIntoId: IDS.entryH,
      deletedAt: '2026-03-02T03:00:00.000Z'
    })

    const summary = repo.summary({ from: '2026-03-02', to: '2026-03-02' })
    expect(summary.days).toHaveLength(1)
    // 只算保留的那一条，不是 7200
    expect(summary.days[0]?.seconds).toBe(3600)

    const detail = repo.dayDetail({ date: '2026-03-02' })
    expect(detail.totalSeconds).toBe(3600)
    expect(detail.tasks[0]?.entryIds).toEqual([IDS.entryH])
  })

  it('只统计已完成记录：进行中与已删除记录都不参与', () => {
    insertEntry({
      id: IDS.entryA,
      taskId: taskA.id,
      startedAt: '2026-03-02T01:00:00.000Z',
      endedAt: '2026-03-02T02:00:00.000Z',
      elapsedSeconds: 3600
    })
    // 已软删除（非合并）的记录
    insertEntry({
      id: IDS.entryB,
      taskId: taskA.id,
      startedAt: '2026-03-02T03:00:00.000Z',
      endedAt: '2026-03-02T04:00:00.000Z',
      elapsedSeconds: 3600,
      deletedAt: '2026-03-02T05:00:00.000Z'
    })
    // 进行中的记录（没有 ended_at）
    db.prepare(
      `INSERT INTO time_entries (
         id, task_id, source, status, started_at, ended_at, elapsed_seconds,
         last_heartbeat_at, app_key, merged_into_id, note, clock_skew_seconds,
         deleted_at, created_at, updated_at
       ) VALUES (
         @id, @taskId, 'manual', 'running', @startedAt, NULL, 600,
         @startedAt, NULL, NULL, NULL, NULL, NULL, @startedAt, @startedAt
       )`
    ).run({ id: IDS.entryC, taskId: taskA.id, startedAt: '2026-03-02T08:00:00.000Z' })

    const summary = repo.summary({ from: '2026-03-02', to: '2026-03-02' })
    expect(summary.days[0]?.seconds).toBe(3600)
    expect(repo.dayDetail({ date: '2026-03-02' }).totalSeconds).toBe(3600)
  })

  it('日期边界按本地 00:00 划分，不混用 UTC 日期', () => {
    // 本地 2026-03-02 07:00 = UTC 2026-03-01T23:00Z：
    // 若按 UTC 日期过滤会被错算到 3 月 1 日
    insertEntry({
      id: IDS.entryA,
      taskId: taskA.id,
      startedAt: '2026-03-01T23:00:00.000Z',
      endedAt: '2026-03-01T23:30:00.000Z',
      elapsedSeconds: 1800
    })
    // 本地 2026-03-02 23:30 = UTC 2026-03-02T15:30Z
    insertEntry({
      id: IDS.entryB,
      taskId: taskB.id,
      startedAt: '2026-03-02T15:30:00.000Z',
      endedAt: '2026-03-02T16:00:00.000Z',
      elapsedSeconds: 1800
    })

    const summary = repo.summary({ from: '2026-03-02', to: '2026-03-02' })
    expect(summary.days).toHaveLength(1)
    expect(summary.days[0]).toMatchObject({
      date: '2026-03-02',
      seconds: 3600,
      taskCount: 2,
      commissionCount: 2
    })

    // 两笔都发生在本地 3 月 2 日，3 月 1 日没有任何本地日内的工时
    expect(repo.summary({ from: '2026-03-01', to: '2026-03-01' }).days).toEqual([])
  })

  it('当天涉及多个任务与多个委托时分别去重计数', () => {
    insertEntry({
      id: IDS.entryA,
      taskId: taskA.id,
      startedAt: '2026-03-02T01:00:00.000Z',
      endedAt: '2026-03-02T01:30:00.000Z',
      elapsedSeconds: 1800
    })
    insertEntry({
      id: IDS.entryB,
      taskId: taskA.id,
      startedAt: '2026-03-02T02:00:00.000Z',
      endedAt: '2026-03-02T02:30:00.000Z',
      elapsedSeconds: 1800
    })
    insertEntry({
      id: IDS.entryC,
      taskId: taskB.id,
      startedAt: '2026-03-02T03:00:00.000Z',
      endedAt: '2026-03-02T04:00:00.000Z',
      elapsedSeconds: 3600
    })
    insertEntry({
      id: IDS.entryD,
      taskId: taskDone.id,
      startedAt: '2026-03-02T05:00:00.000Z',
      endedAt: '2026-03-02T05:10:00.000Z',
      elapsedSeconds: 600
    })

    const summary = repo.summary({ from: '2026-03-02', to: '2026-03-02' })
    expect(summary.days[0]).toMatchObject({
      seconds: 7800,
      // taskA 两笔只算一个任务
      taskCount: 3,
      // taskA 与 taskDone 同属一个委托
      commissionCount: 2
    })

    const detail = repo.dayDetail({ date: '2026-03-02' })
    expect(detail.tasks).toHaveLength(3)
    // taskA 两笔合计 3600，taskB 3600，taskDone 600；按秒数从多到少排序
    expect(detail.tasks.map((item) => [item.taskId, item.seconds])).toEqual([
      [taskA.id, 3600],
      [taskB.id, 3600],
      [taskDone.id, 600]
    ])
    // 委托汇总：taskA + taskDone 同属一个委托 4200，taskB 的委托 3600
    expect(detail.commissions).toHaveLength(2)
    expect(detail.commissions.map((item) => item.seconds)).toEqual([4200, 3600])
  })

  it('片段表不存在时按老记录规则降级，不崩溃', () => {
    // 模拟迁移 006 尚未执行
    db.exec('DROP TABLE time_entry_segments')

    insertEntry({
      id: IDS.entryA,
      taskId: taskA.id,
      startedAt: '2026-03-02T01:00:00.000Z',
      endedAt: '2026-03-02T02:00:00.000Z',
      elapsedSeconds: 3600
    })
    // 跨午夜 + 墙钟跨度与累计一致 → 老记录规则可按墙钟占比拆分
    insertEntry({
      id: IDS.entryD,
      taskId: taskA.id,
      startedAt: '2026-03-02T15:40:00.000Z',
      endedAt: '2026-03-02T16:20:00.000Z',
      elapsedSeconds: 2400
    })

    const summary = repo.summary({ from: '2026-03-02', to: '2026-03-03' })
    expect(summary.days.map((day) => [day.date, day.seconds])).toEqual([
      ['2026-03-02', 4800],
      ['2026-03-03', 1200]
    ])
    expect(repo.dayDetail({ date: '2026-03-02' }).totalSeconds).toBe(4800)
    expect(repo.dayDetail({ date: '2026-03-03' }).totalSeconds).toBe(1200)
  })

  it('老记录中间有长时间空闲时全部归到开始日（不伪造分布）', () => {
    db.exec('DROP TABLE time_entry_segments')

    // 墙钟 4 小时但只累计 1 小时 → 中间空闲，分布不可知
    insertEntry({
      id: IDS.entryE,
      taskId: taskA.id,
      startedAt: '2026-03-02T15:40:00.000Z',
      endedAt: '2026-03-02T19:40:00.000Z',
      elapsedSeconds: 3600
    })

    const summary = repo.summary({ from: '2026-03-01', to: '2026-03-05' })
    expect(summary.days.map((day) => [day.date, day.seconds])).toEqual([['2026-03-02', 3600]])
  })

  it('输入契约拒绝非法区间与超范围查询', () => {
    expect(() => calendarActivitySummaryInputSchema.parse({ from: '2026-03-05', to: '2026-03-01' })).toThrow()
    expect(() => calendarActivitySummaryInputSchema.parse({ from: '2026-02-30', to: '2026-03-01' })).toThrow()
    expect(() =>
      calendarActivitySummaryInputSchema.parse({ from: '2026-01-01', to: '2026-12-31' })
    ).toThrow()
    expect(() => calendarDayDetailInputSchema.parse({ date: '2026-13-01' })).toThrow()
    expect(() => calendarDayDetailInputSchema.parse({ date: '2026-03-01', extra: true })).toThrow()
  })
})
