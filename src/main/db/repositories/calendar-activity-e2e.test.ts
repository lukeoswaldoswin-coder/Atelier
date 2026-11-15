/**
 * P6.7 真实数据链路验证（不是 mock）。
 *
 * 与 calendar-activity.test.ts 的分工：
 * - calendar-activity.test.ts 验证聚合仓储自身的边界与规则；
 * - 本文件验证「端到端一致性」：同一笔工时在**日历**、**工时记录页**、
 *   **任务汇总**三处的数字必须完全相同，且跨午夜拆分守恒。
 *
 * 全部使用真实临时 SQLite 文件 + 真实迁移 + 真实仓储 + 真实 TimeService，
 * 不替换任何数据访问层。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createClientInputSchema,
  createCommissionInputSchema,
  createTaskInputSchema,
  type TaskStage
} from '@shared/domain'
import { createDatabaseService, type DatabaseService } from '../service'
import { createTimeService } from '../../time/time-service'
import { createCalendarActivityRepository } from './calendar-activity'

const TZ = 'Asia/Shanghai'

/** 东八区本地日期 → UTC ISO。 */
function localToUtc(date: string, time: string): string {
  return new Date(`${date}T${time}:00.000+08:00`).toISOString()
}

describe('P6.7 端到端一致性：日历 / 工时记录 / 任务汇总', () => {
  let dir: string
  let service: DatabaseService
  let entrySeq: number

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atelier-p67-e2e-'))
    service = createDatabaseService(join(dir, 'atelier.db'))
    entrySeq = 0
  })

  afterEach(() => {
    service.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /** 写一条已完成工时记录，并落它的活跃片段。 */
  function addEntry(options: {
    taskId: string | null
    startedAt: string
    endedAt: string
    seconds: number
    segments?: Array<{ startedAt: string; endedAt: string; seconds: number }>
  }): string {
    const id = `00000000-0000-4000-8000-${String(++entrySeq).padStart(12, '0')}`
    service.timeEntries.insert({
      id,
      taskId: options.taskId,
      source: 'auto',
      status: 'running',
      startedAt: options.startedAt,
      elapsedSeconds: 0,
      lastHeartbeatAt: options.startedAt,
      appKey: options.taskId ? null : 'clipstudio',
      note: null
    })

    const segments = options.segments ?? [
      { startedAt: options.startedAt, endedAt: options.endedAt, seconds: options.seconds }
    ]
    segments.forEach((segment, index) => {
      // 片段 id 也必须是合法 UUID：用 entry 序号 + 片段序号拼出稳定且唯一的值
      service.timeEntries.appendSegment({
        id: `00000000-0000-4000-9000-${String(entrySeq).padStart(8, '0')}${String(index).padStart(4, '0')}`,
        entryId: id,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        seconds: segment.seconds,
        createdAt: segment.endedAt,
        updatedAt: segment.endedAt
      })
    })

    service.timeEntries.finalize({
      id,
      endedAt: options.endedAt,
      elapsedSeconds: options.seconds,
      lastHeartbeatAt: options.endedAt,
      clockSkewSeconds: 0,
      note: null,
      updatedAt: options.endedAt
    })
    return id
  }

  /** 建一套真实数据：2 个委托、3 个任务、5 笔工时（含跨午夜与未关联）。 */
  function seed(): {
    lineartTaskId: string
    clothTaskId: string
    bgTaskId: string
    commissionAId: string
    commissionBId: string
    clothEntryId: string
    crossMidnightEntryId: string
    unassignedEntryId: string
  } {
    const client = service.clients.create(createClientInputSchema.parse({ name: '三狼' }))

    const mkCommission = (title: string) =>
      service.commissions.create(
        createCommissionInputSchema.parse({
          clientId: client.id,
          title,
          type: '插画',
          quoteAmountCents: 100000
        })
      )

    const commissionA = mkCommission('角色立绘 A')
    const commissionB = mkCommission('角色插画 B')
    service.commissions.update({ id: commissionA.id, status: 'active' })
    service.commissions.update({ id: commissionB.id, status: 'active' })

    const mkTask = (commissionId: string, title: string, stage: TaskStage) =>
      service.tasks.create(
        createTaskInputSchema.parse({
          commissionId,
          title,
          stage,
          plannedDate: null
        })
      )

    const lineart = mkTask(commissionA.id, '人物线稿', 'lineart')
    const cloth = mkTask(commissionA.id, '服装细化', 'color')
    const bg = mkTask(commissionB.id, '背景草图', 'draft')

    // 11-18 人物线稿 2h10m（两段：1h + 1h10m）
    addEntry({
      taskId: lineart.id,
      startedAt: localToUtc('2026-11-18', '09:00'),
      endedAt: localToUtc('2026-11-18', '12:10'),
      seconds: 7800,
      segments: [
        {
          startedAt: localToUtc('2026-11-18', '09:00'),
          endedAt: localToUtc('2026-11-18', '10:00'),
          seconds: 3600
        },
        {
          startedAt: localToUtc('2026-11-18', '10:50'),
          endedAt: localToUtc('2026-11-18', '12:10'),
          seconds: 4200
        }
      ]
    })

    // 11-18 服装细化 1h25m
    const clothEntryId = addEntry({
      taskId: cloth.id,
      startedAt: localToUtc('2026-11-18', '13:00'),
      endedAt: localToUtc('2026-11-18', '14:25'),
      seconds: 5100
    })

    // 11-18 背景草图 1h
    addEntry({
      taskId: bg.id,
      startedAt: localToUtc('2026-11-18', '15:00'),
      endedAt: localToUtc('2026-11-18', '16:00'),
      seconds: 3600
    })

    // 11-18 23:40 → 11-19 00:20 跨午夜，连续 40 分钟
    const crossMidnightEntryId = addEntry({
      taskId: lineart.id,
      startedAt: localToUtc('2026-11-18', '23:40'),
      endedAt: localToUtc('2026-11-19', '00:20'),
      seconds: 2400
    })

    // 11-19 未关联任务 30 分钟
    const unassignedEntryId = addEntry({
      taskId: null,
      startedAt: localToUtc('2026-11-19', '10:00'),
      endedAt: localToUtc('2026-11-19', '10:30'),
      seconds: 1800
    })

    return {
      lineartTaskId: lineart.id,
      clothTaskId: cloth.id,
      bgTaskId: bg.id,
      commissionAId: commissionA.id,
      commissionBId: commissionB.id,
      clothEntryId,
      crossMidnightEntryId,
      unassignedEntryId
    }
  }

  it('月视图每日工时、任务数、委托数正确（含跨午夜拆分）', () => {
    seed()
    const repo = createCalendarActivityRepository(service.db, { timeZone: TZ })
    const summary = repo.summary({ from: '2026-11-16', to: '2026-11-22' })

    const day18 = summary.days.find((day) => day.date === '2026-11-18')
    const day19 = summary.days.find((day) => day.date === '2026-11-19')

    // 11-18：7800 + 5100 + 3600 + 跨午夜前段 1200 = 17700
    expect(day18).toMatchObject({ seconds: 17700, taskCount: 3, commissionCount: 2 })
    // 11-19：跨午夜后段 1200 + 未关联 1800 = 3000
    expect(day19).toMatchObject({ seconds: 3000, unassignedSeconds: 1800 })

    // 没有记录的日期不出现在结果里
    expect(summary.days.map((day) => day.date)).toEqual(['2026-11-18', '2026-11-19'])
  })

  it('跨午夜 23:40→00:20 拆成两天各 20 分钟，合计守恒', () => {
    seed()
    const repo = createCalendarActivityRepository(service.db, { timeZone: TZ })
    const detail18 = repo.dayDetail({ date: '2026-11-18' })
    const detail19 = repo.dayDetail({ date: '2026-11-19' })

    const lineart18 = detail18.tasks.find((task) => task.taskTitle === '人物线稿')
    const lineart19 = detail19.tasks.find((task) => task.taskTitle === '人物线稿')

    // 11-18：7800 + 1200（跨午夜前段）
    expect(lineart18?.seconds).toBe(9000)
    // 11-19：1200（跨午夜后段）
    expect(lineart19?.seconds).toBe(1200)
    // 两段合计严格等于该记录总时长 2400
    expect((lineart18?.seconds ?? 0) + (lineart19?.seconds ?? 0)).toBe(10200)
  })

  it('同一天同一任务多笔工时正确合计，并按任务分组', () => {
    seed()
    const repo = createCalendarActivityRepository(service.db, { timeZone: TZ })
    const detail = repo.dayDetail({ date: '2026-11-18' })

    expect(detail.tasks).toHaveLength(3)
    const lineart = detail.tasks.find((task) => task.taskTitle === '人物线稿')
    expect(lineart?.seconds).toBe(9000)
    expect(lineart?.entryIds).toHaveLength(2)
    expect(lineart?.commissionTitle).toBe('角色立绘 A')
    expect(lineart?.clientName).toBe('三狼')

    // 服装细化 5100、背景草图 3600
    expect(detail.tasks.find((task) => task.taskTitle === '服装细化')?.seconds).toBe(5100)
    expect(detail.tasks.find((task) => task.taskTitle === '背景草图')?.seconds).toBe(3600)
  })

  it('多个委托的工时正确区分', () => {
    seed()
    const repo = createCalendarActivityRepository(service.db, { timeZone: TZ })
    const detail = repo.dayDetail({ date: '2026-11-18' })

    expect(detail.commissions).toHaveLength(2)
    const commissionA = detail.commissions.find((item) => item.title === '角色立绘 A')
    const commissionB = detail.commissions.find((item) => item.title === '角色插画 B')
    // A：人物线稿 9000 + 服装细化 5100
    expect(commissionA?.seconds).toBe(14100)
    // B：背景草图 3600
    expect(commissionB?.seconds).toBe(3600)
  })

  it('未关联任务的工时单独显示，不归入任何任务', () => {
    seed()
    const repo = createCalendarActivityRepository(service.db, { timeZone: TZ })
    const detail = repo.dayDetail({ date: '2026-11-19' })

    expect(detail.unassignedSeconds).toBe(1800)
    expect(detail.unassignedEntryIds).toHaveLength(1)
    // 未关联的 30 分钟没有被塞进任何任务
    expect(detail.tasks).toHaveLength(1)
    expect(detail.tasks[0]?.taskTitle).toBe('人物线稿')
    expect(detail.tasks[0]?.seconds).toBe(1200)
  })

  it('日历合计 == 工时记录页同一区间合计（三处一致的核心）', () => {
    seed()
    const repo = createCalendarActivityRepository(service.db, { timeZone: TZ })
    const summary = repo.summary({ from: '2026-11-18', to: '2026-11-19' })
    const calendarTotal = summary.days.reduce((sum, day) => sum + day.seconds, 0)

    // 工时记录页用同一套 UTC 边界取数
    const rows = service.timeEntries.listViews({
      from: localToUtc('2026-11-18', '00:00'),
      to: localToUtc('2026-11-20', '00:00'),
      filter: 'all'
    })
    const timePageTotal = rows.reduce((sum, row) => sum + row.entry.elapsedSeconds, 0)

    expect(calendarTotal).toBe(timePageTotal)
    expect(calendarTotal).toBe(20700)
  })

  it('任务汇总 == 该任务各日之和（不重复、不丢失）', () => {
    seed()
    const repo = createCalendarActivityRepository(service.db, { timeZone: TZ })
    const time = createTimeService(service.timeEntries, { timeZone: TZ })

    const detail18 = repo.dayDetail({ date: '2026-11-18' })
    const detail19 = repo.dayDetail({ date: '2026-11-19' })

    const allTaskIds = [
      ...detail18.tasks.map((task) => task.taskId),
      ...detail19.tasks.map((task) => task.taskId)
    ]
    const totals = time.taskTotals([...new Set(allTaskIds)])

    for (const total of totals) {
      const perDay =
        (detail18.tasks.find((task) => task.taskId === total.taskId)?.seconds ?? 0) +
        (detail19.tasks.find((task) => task.taskId === total.taskId)?.seconds ?? 0)
      expect(perDay).toBe(total.seconds)
    }
  })

  it('已完成任务的历史工时仍然出现在日历里', () => {
    const ids = seed()
    // 把人物线稿标记完成
    service.tasks.update({ id: ids.lineartTaskId, status: 'done' })

    const repo = createCalendarActivityRepository(service.db, { timeZone: TZ })
    const detail = repo.dayDetail({ date: '2026-11-18' })
    const lineart = detail.tasks.find((task) => task.taskId === ids.lineartTaskId)

    expect(lineart).toBeDefined()
    expect(lineart?.taskStatus).toBe('done')
    expect(lineart?.seconds).toBe(9000)
  })

  it('已软删除的工时不计入日历', () => {
    const ids = seed()
    const repo = createCalendarActivityRepository(service.db, { timeZone: TZ })
    const before = repo.dayDetail({ date: '2026-11-18' })
    expect(before.totalSeconds).toBe(17700)

    // 删除「服装细化 1h25m」这条不跨午夜的记录，当天合计应正好少 5100
    service.timeEntries.softDelete(ids.clothEntryId, new Date().toISOString())

    const after = repo.dayDetail({ date: '2026-11-18' })
    expect(after.totalSeconds).toBe(17700 - 5100)
    expect(after.tasks.some((task) => task.taskId === ids.clothTaskId)).toBe(false)
  })

  it('删除跨午夜的记录后，两天各自只减去属于自己那一段', () => {
    const ids = seed()
    const repo = createCalendarActivityRepository(service.db, { timeZone: TZ })

    service.timeEntries.softDelete(ids.crossMidnightEntryId, new Date().toISOString())

    const day18 = repo.dayDetail({ date: '2026-11-18' })
    const day19 = repo.dayDetail({ date: '2026-11-19' })
    // 该记录 18 日占 20 分钟、19 日占 20 分钟
    expect(day18.totalSeconds).toBe(17700 - 1200)
    expect(day19.totalSeconds).toBe(3000 - 1200)
  })

  it('没有片段的记录走老记录规则，仍不丢工时', () => {
    const client = service.clients.create(createClientInputSchema.parse({ name: '老客户' }))
    const commission = service.commissions.create(
      createCommissionInputSchema.parse({
        clientId: client.id,
        title: '老委托',
        type: '插画',
        quoteAmountCents: 1000
      })
    )
    service.commissions.update({ id: commission.id, status: 'active' })
    const task = service.tasks.create(
      createTaskInputSchema.parse({
        commissionId: commission.id,
        title: '老任务',
        stage: 'draft',
        plannedDate: null
      })
    )

    // 直接插入一条已完成记录，完全不写片段（模拟 P6.7 之前的老数据）
    const id = '00000000-0000-4000-8000-999999999999'
    service.db
      .prepare(
        `INSERT INTO time_entries (id, task_id, source, status, started_at, ended_at,
           elapsed_seconds, last_heartbeat_at, app_key, merged_into_id, note,
           clock_skew_seconds, deleted_at, created_at, updated_at)
         VALUES (?, ?, 'manual', 'completed', ?, ?, 3600, NULL, NULL, NULL, NULL, 0, NULL, ?, ?)`
      )
      .run(
        id,
        task.id,
        localToUtc('2026-11-18', '09:00'),
        localToUtc('2026-11-18', '10:00'),
        localToUtc('2026-11-18', '09:00'),
        localToUtc('2026-11-18', '10:00')
      )

    const repo = createCalendarActivityRepository(service.db, { timeZone: TZ })
    const detail = repo.dayDetail({ date: '2026-11-18' })
    expect(detail.totalSeconds).toBe(3600)
  })
})
