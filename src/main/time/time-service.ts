import { randomUUID } from 'node:crypto'
import type {
  TimeEntryView,
  TimeListInput,
  TimeMergeInput,
  TimeStatusOutput,
  TimeSummaryInput,
  TimeSummaryOutput,
  TimeTaskTotalsOutput,
  TimeUpdateInput
} from '@shared/domain'
import { DataError } from '@shared/errors'
import { computeClockSkewSeconds } from '@shared/time-entries'
import { resolveSystemTimeZone, todayInZone } from '@shared/time'
import type { TimeEntriesRepository } from '../db/repositories/time-entries'

export interface TimeClock {
  wallMs(): number
  monotonicMs(): number
}

export const systemTimeClock: TimeClock = {
  wallMs: () => Date.now(),
  monotonicMs: () => performance.now()
}

interface ManualState {
  entryId: string
  taskId: string
  accumulatedSeconds: number
  runStartedMono: number | null
  status: 'running' | 'paused'
  lastCheckpointMono: number
}

export interface TimeService {
  status(): TimeStatusOutput
  start(taskId: string): TimeStatusOutput
  pause(): TimeStatusOutput
  resume(): TimeStatusOutput
  stop(): TimeStatusOutput
  /** 由主进程定时器每秒调用：检查 24 小时上限并写检查点 */
  tick(): void
  getManualTaskId(): string | null
  list(input: TimeListInput): TimeEntryView[]
  summary(input: TimeSummaryInput): TimeSummaryOutput
  update(input: TimeUpdateInput): TimeEntryView | null
  assign(id: string, taskId: string): TimeEntryView | null
  remove(id: string): boolean
  merge(input: TimeMergeInput): TimeEntryView
  taskTotals(taskIds: readonly string[]): TimeTaskTotalsOutput
}

const MAX_MANUAL_SECONDS = 24 * 60 * 60

function iso(wallMs: number): string {
  return new Date(wallMs).toISOString()
}

export function createTimeService(
  repo: TimeEntriesRepository,
  options: { clock?: TimeClock; timeZone?: string; checkpointIntervalSeconds?: number } = {}
): TimeService {
  const clock = options.clock ?? systemTimeClock
  const timeZone = options.timeZone ?? resolveSystemTimeZone()
  const checkpointInterval = (options.checkpointIntervalSeconds ?? 30) * 1000

  let manual: ManualState | null = null
  let notice: string | null = null

  // ---- 启动恢复：不按墙钟补算停机时间 ----
  const recoveredManual = repo.findActiveManual()
  if (recoveredManual) {
    if (recoveredManual.status === 'running') {
      repo.setStatus(
        recoveredManual.id,
        'paused',
        recoveredManual.elapsedSeconds,
        iso(clock.wallMs()),
        iso(clock.wallMs()),
        '上次运行异常退出，计时已自动暂停'
      )
      notice = '上次计时未正常结束，已暂停；请确认后继续或结束。'
    }
    manual = {
      entryId: recoveredManual.id,
      taskId: recoveredManual.taskId as string,
      accumulatedSeconds: recoveredManual.elapsedSeconds,
      runStartedMono: null,
      status: 'paused',
      lastCheckpointMono: clock.monotonicMs()
    }
  }

  const recoveredAuto = repo.findActiveAuto()
  if (recoveredAuto) {
    const endedAt = recoveredAuto.lastHeartbeatAt ?? recoveredAuto.startedAt
    repo.finalize({
      id: recoveredAuto.id,
      endedAt,
      elapsedSeconds: recoveredAuto.elapsedSeconds,
      lastHeartbeatAt: recoveredAuto.lastHeartbeatAt,
      clockSkewSeconds: computeClockSkewSeconds(
        recoveredAuto.startedAt,
        endedAt,
        recoveredAuto.elapsedSeconds
      ),
      note: '异常退出，已按检查点结算',
      updatedAt: iso(clock.wallMs())
    })
  }

  function currentElapsedSeconds(): number {
    if (!manual) return 0
    if (manual.status !== 'running' || manual.runStartedMono === null) {
      return manual.accumulatedSeconds
    }
    return (
      manual.accumulatedSeconds +
      Math.max(0, Math.floor((clock.monotonicMs() - manual.runStartedMono) / 1000))
    )
  }

  function status(): TimeStatusOutput {
    const manualView = manual ? repo.getView(manual.entryId) : null
    const autoEntry = repo.findActiveAuto()
    return {
      manual: manualView,
      auto: autoEntry ? repo.getView(autoEntry.id) : null,
      notice
    }
  }

  function assertStartable(taskId: string): void {
    const context = repo.taskContext(taskId)
    if (!context) throw new DataError('TASK_NOT_FOUND', '任务不存在，无法开始计时')
    if (context.taskArchivedAt) throw new DataError('TASK_ARCHIVED', '任务已归档，不能开始计时')
    if (context.taskStatus === 'done') {
      throw new DataError('TASK_COMPLETED', '任务已完成，不能开始计时')
    }
    if (context.commissionArchivedAt) {
      throw new DataError('COMMISSION_ARCHIVED', '委托已归档，不能开始计时')
    }
    if (context.commissionStatus !== 'draft' && context.commissionStatus !== 'active') {
      throw new DataError('COMMISSION_NOT_ACTIVE', '只有草稿或进行中的委托可以计时')
    }
  }

  function closeActiveAuto(): void {
    const autoEntry = repo.findActiveAuto()
    if (!autoEntry) return
    const endedAt = iso(clock.wallMs())
    repo.finalize({
      id: autoEntry.id,
      endedAt,
      elapsedSeconds: autoEntry.elapsedSeconds,
      lastHeartbeatAt: autoEntry.lastHeartbeatAt,
      clockSkewSeconds: computeClockSkewSeconds(
        autoEntry.startedAt,
        endedAt,
        autoEntry.elapsedSeconds
      ),
      note: null,
      updatedAt: endedAt
    })
  }

  function start(taskId: string): TimeStatusOutput {
    if (manual) throw new DataError('TIMER_ALREADY_RUNNING', '已有正在进行的计时，请先结束')
    if (repo.findActiveManual()) {
      throw new DataError('TIMER_ALREADY_RUNNING', '已有正在进行的计时，请先结束')
    }
    assertStartable(taskId)

    const nowWall = iso(clock.wallMs())
    const nowMono = clock.monotonicMs()

    repo.transaction(() => {
      closeActiveAuto()
      repo.insert({
        id: randomUUID(),
        taskId,
        source: 'manual',
        status: 'running',
        startedAt: nowWall,
        elapsedSeconds: 0,
        lastHeartbeatAt: nowWall,
        appKey: null,
        note: null
      })
    })

    const created = repo.findActiveManual()
    if (!created) throw new Error('计时启动后无法读回记录')
    manual = {
      entryId: created.id,
      taskId,
      accumulatedSeconds: 0,
      runStartedMono: nowMono,
      status: 'running',
      lastCheckpointMono: nowMono
    }
    notice = null
    return status()
  }

  function pause(): TimeStatusOutput {
    if (!manual || manual.status !== 'running') {
      throw new DataError('TIMER_NOT_RUNNING', '当前没有正在运行的计时')
    }
    const elapsed = currentElapsedSeconds()
    const nowWall = iso(clock.wallMs())
    const nowMono = clock.monotonicMs()

    repo.setStatus(manual.entryId, 'paused', elapsed, nowWall, nowWall)
    manual = {
      ...manual,
      status: 'paused',
      accumulatedSeconds: elapsed,
      runStartedMono: null,
      lastCheckpointMono: nowMono
    }
    notice = null
    return status()
  }

  function resume(): TimeStatusOutput {
    if (!manual || manual.status !== 'paused') {
      throw new DataError('TIMER_NOT_PAUSED', '当前没有已暂停的计时')
    }
    const nowWall = iso(clock.wallMs())
    const nowMono = clock.monotonicMs()

    repo.setStatus(manual.entryId, 'running', manual.accumulatedSeconds, nowWall, nowWall)
    manual = {
      ...manual,
      status: 'running',
      runStartedMono: nowMono,
      lastCheckpointMono: nowMono
    }
    notice = null
    return status()
  }

  function stop(): TimeStatusOutput {
    if (!manual) throw new DataError('TIMER_NOT_RUNNING', '当前没有计时')
    const elapsed = currentElapsedSeconds()
    const endedAt = iso(clock.wallMs())
    const startedAt = repo.get(manual.entryId)?.startedAt

    if (!startedAt) throw new Error('计时记录丢失')
    repo.finalize({
      id: manual.entryId,
      endedAt,
      elapsedSeconds: elapsed,
      lastHeartbeatAt: endedAt,
      clockSkewSeconds: computeClockSkewSeconds(startedAt, endedAt, elapsed),
      note: null,
      updatedAt: endedAt
    })
    manual = null
    notice = null
    return status()
  }

  function tick(): void {
    if (!manual || manual.status !== 'running') return

    const elapsed = currentElapsedSeconds()
    if (elapsed >= MAX_MANUAL_SECONDS) {
      const nowWall = iso(clock.wallMs())
      repo.setStatus(
        manual.entryId,
        'paused',
        elapsed,
        nowWall,
        nowWall,
        '计时超过 24 小时，已自动暂停'
      )
      manual = {
        ...manual,
        status: 'paused',
        accumulatedSeconds: elapsed,
        runStartedMono: null,
        lastCheckpointMono: clock.monotonicMs()
      }
      notice = '本次计时已超过 24 小时，已自动暂停；请确认后继续或结束。'
      return
    }

    const nowMono = clock.monotonicMs()
    if (nowMono - manual.lastCheckpointMono >= checkpointInterval) {
      const nowWall = iso(clock.wallMs())
      repo.checkpoint(manual.entryId, elapsed, nowWall, nowWall)
      manual.lastCheckpointMono = nowMono
    }
  }

  function list(input: TimeListInput): TimeEntryView[] {
    return repo.listViews(input)
  }

  function summary(input: TimeSummaryInput): TimeSummaryOutput {
    const views = repo.listForSummary(input.from, input.to)

    const byDay = new Map<string, number>()
    const byTask = new Map<
      string,
      { taskId: string | null; taskTitle: string | null; commissionId: string | null; commissionTitle: string | null; seconds: number }
    >()
    let totalSeconds = 0
    let unassignedSeconds = 0

    for (const view of views) {
      const seconds = view.entry.elapsedSeconds
      totalSeconds += seconds
      if (!view.entry.taskId) unassignedSeconds += seconds

      // 跨天记录归到开始日期（使用本地时区日历日）
      const day = todayInZone(timeZone, new Date(view.entry.startedAt))
      byDay.set(day, (byDay.get(day) ?? 0) + seconds)

      const key = view.entry.taskId ?? 'unassigned'
      const current = byTask.get(key) ?? {
        taskId: view.task?.id ?? null,
        taskTitle: view.task?.title ?? null,
        commissionId: view.commission?.id ?? null,
        commissionTitle: view.commission?.title ?? null,
        seconds: 0
      }
      current.seconds += seconds
      byTask.set(key, current)
    }

    return {
      totalSeconds,
      unassignedSeconds,
      byDay: [...byDay.entries()]
        .map(([date, seconds]) => ({ date, seconds }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      byTask: [...byTask.values()].sort((a, b) => b.seconds - a.seconds)
    }
  }

  function update(input: TimeUpdateInput): TimeEntryView | null {
    if (input.taskId !== undefined && input.taskId !== null) {
      if (!repo.taskContext(input.taskId)) {
        throw new DataError('TASK_NOT_FOUND', '任务不存在，无法归属')
      }
    }
    const updated = repo.updateCompleted(
      input.id,
      {
        taskId: input.taskId,
        note: input.note,
        startedAt: input.startedAt,
        endedAt: input.endedAt
      },
      iso(clock.wallMs())
    )
    return updated ? repo.getView(updated.id) : null
  }

  function assign(id: string, taskId: string): TimeEntryView | null {
    if (!repo.taskContext(taskId)) {
      throw new DataError('TASK_NOT_FOUND', '任务不存在，无法归属')
    }
    const updated = repo.updateCompleted(id, { taskId }, iso(clock.wallMs()))
    return updated ? repo.getView(updated.id) : null
  }

  function remove(id: string): boolean {
    const entry = repo.get(id)
    if (!entry) return false
    if (entry.status !== 'completed') {
      throw new DataError('TIME_ENTRY_RUNNING', '请先结束计时，再删除记录')
    }
    repo.softDelete(id, iso(clock.wallMs()))
    return true
  }

  function merge(input: TimeMergeInput): TimeEntryView {
    const uniqueIds = [...new Set(input.ids)]
    if (uniqueIds.length < 2) {
      throw new DataError('MERGE_INVALID', '至少需要两条不同的记录')
    }

    const entries = uniqueIds.map((id) => repo.get(id))
    if (entries.some((entry) => entry === null)) {
      throw new DataError('MERGE_INVALID', '部分记录不存在')
    }
    const rows = entries as NonNullable<(typeof entries)[number]>[]

    for (const entry of rows) {
      if (entry.status !== 'completed' || entry.deletedAt !== null) {
        throw new DataError('MERGE_INVALID', '只能合并已完成的记录')
      }
      if (entry.mergedIntoId) {
        throw new DataError('MERGE_INVALID', '记录已被合并过')
      }
    }

    const first = rows[0] as (typeof rows)[number]
    const sameTask = rows.every((entry) => entry.taskId === first.taskId)
    const sameSource = rows.every((entry) => entry.source === first.source)
    const sameApp = rows.every((entry) => entry.appKey === first.appKey)
    if (!sameTask || !sameSource || (first.source === 'auto' && !sameApp)) {
      throw new DataError('MERGE_INVALID', '只能合并同一任务、同一来源（自动记录还要求同一软件）的记录')
    }

    const startedAt = rows.map((entry) => entry.startedAt).sort()[0] as string
    const endedAt = rows.map((entry) => entry.endedAt as string).sort().slice(-1)[0] as string
    const elapsedSeconds = rows.reduce((total, entry) => total + entry.elapsedSeconds, 0)
    const newId = randomUUID()
    const now = iso(clock.wallMs())

    repo.transaction(() => {
      repo.insert({
        id: newId,
        taskId: first.taskId,
        source: first.source,
        status: 'completed',
        startedAt,
        endedAt,
        elapsedSeconds,
        lastHeartbeatAt: endedAt,
        appKey: first.appKey,
        note: `合并 ${rows.length} 条记录`,
        clockSkewSeconds: null
      })
      repo.markMerged(uniqueIds, newId, now)
    })

    const created = repo.getView(newId)
    if (!created) throw new Error('合并后无法读回记录')
    return created
  }

  function taskTotals(taskIds: readonly string[]): TimeTaskTotalsOutput {
    const totals = repo.sumByTask(taskIds)
    return taskIds
      .filter((taskId) => totals.has(taskId))
      .map((taskId) => ({ taskId, seconds: totals.get(taskId) as number }))
  }

  return {
    status,
    start,
    pause,
    resume,
    stop,
    tick,
    getManualTaskId: () => manual?.taskId ?? null,
    list,
    summary,
    update,
    assign,
    remove,
    merge,
    taskTotals
  }
}
