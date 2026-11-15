import { randomUUID } from 'node:crypto'
import type {
  TaskSessionStatus,
  TimeEntryView,
  TimeListInput,
  TimeMergeInput,
  TimeStatusView,
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
  /** 当前运行区间的墙钟起点；null = 当前没有在累计（暂停中） */
  runStartedWall: number | null
  status: 'running' | 'paused'
  lastCheckpointMono: number
}

/**
 * 任务计时会话（P6.6）。
 *
 * 与手动计时的关键区别：累计时间**只**来自绘画软件活跃片段，不按墙钟累加。
 * 会话记录本身是一条 time_entries（source='auto'、task_id 非空），
 * 数据库的唯一索引保证同一时刻只能存在一条 running 的 auto 记录，
 * 因此任务会话与普通自动片段天然互斥，不可能重复累计。
 */
interface TaskSessionState {
  entryId: string
  taskId: string
  /** 已结算的活跃秒数 */
  accumulatedSeconds: number
  /** 当前活跃片段开始时的单调时钟；null = 当前没有在累计 */
  segmentStartedMono: number | null
  /** 当前活跃片段开始时的墙钟时间；用于落 time_entry_segments 的真实起止 */
  segmentStartedWall: number | null
  /** 用户手动暂停：不再累计，但会话保持 */
  manualPaused: boolean
  /** 最近一次活跃判定的应用 key */
  activeAppKey: string | null
  /** 会话开始的墙钟时间，用于计算会话持续时间 */
  startedAtWall: number
  lastCheckpointMono: number
}

export interface TimeService {
  status(): TimeStatusView
  start(taskId: string): TimeStatusView
  pause(): TimeStatusView
  resume(): TimeStatusView
  stop(): TimeStatusView

  // ---- 任务计时会话（P6.6）----
  /** 开始任务计时会话；已有其它任务会话时按 replaceCurrent 决定是否先结算。 */
  startTaskSession(taskId: string, replaceCurrent: boolean): TimeStatusView
  /** 手动暂停：停止累计，会话保持 */
  pauseTaskSession(): TimeStatusView
  /** 手动继续：恢复自动监测驱动的累计 */
  resumeTaskSession(): TimeStatusView
  /** 结束会话并结算累计工时 */
  stopTaskSession(): TimeStatusView
  /** 当前任务会话的任务 id；没有会话时为 null */
  getTaskSessionTaskId(): string | null
  /** 是否存在任务计时会话（含手动暂停） */
  hasTaskSession(): boolean
  /**
   * 由活动监测每秒调用：根据当前是否活跃推进累计。
   * active=false 只暂停累计，绝不结束会话。
   */
  applyTaskActivity(active: boolean, appKey: string | null): void
  /** 把当前累计值立即落库（退出前调用，避免丢最后一个检查点区间） */
  persistTaskSessionProgress(): void
  /** 由主进程定时器每秒调用：检查 24 小时上限并写检查点 */
  tick(): void
  getManualTaskId(): string | null
  /** 手动计时是否正在运行（暂停不算） */
  isManualRunning(): boolean
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
  let taskSession: TaskSessionState | null = null

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
      runStartedWall: null,
      status: 'paused',
      lastCheckpointMono: clock.monotonicMs()
    }
  }

  // 任务计时会话（source='auto' 且 task_id 非空）要恢复为进行中，不能像普通自动片段那样结算：
  // 用户点击开始后会话一直存在直到手动结束，重启不应丢掉它。
  const recoveredTaskSession = repo.findActiveTaskSession()
  if (recoveredTaskSession) {
    const recoveredAt = iso(clock.wallMs())
    taskSession = {
      entryId: recoveredTaskSession.id,
      taskId: recoveredTaskSession.taskId as string,
      accumulatedSeconds: recoveredTaskSession.elapsedSeconds,
      // 重启后不能把停机时间算进去，从「未累计」状态等下一次活跃判定
      segmentStartedMono: null,
      segmentStartedWall: null,
      manualPaused: false,
      activeAppKey: null,
      startedAtWall: Date.parse(recoveredTaskSession.startedAt),
      lastCheckpointMono: clock.monotonicMs()
    }
    repo.checkpoint(
      recoveredTaskSession.id,
      recoveredTaskSession.elapsedSeconds,
      recoveredTaskSession.lastHeartbeatAt ?? recoveredAt,
      recoveredAt
    )
    notice = '上次任务计时未正常结束，已恢复；累计工时按重启前的检查点继续。'
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

  /**
   * 落一条活跃片段明细。
   *
   * 只有 seconds > 0 才写：0 秒片段既没有信息量，也会让「片段合计 == elapsed」的
   * 校验多出噪声。写片段绝不修改 elapsed_seconds。
   */
  function recordSegment(entryId: string, startedWall: number, endedWall: number, seconds: number): void {
    if (seconds <= 0) return
    const now = iso(clock.wallMs())
    try {
      repo.appendSegment({
        id: randomUUID(),
        entryId,
        startedAt: iso(startedWall),
        endedAt: iso(endedWall),
        seconds,
        createdAt: now,
        updatedAt: now
      })
    } catch (error) {
      // 明细失败不能影响用户的实际计时与总时长
      console.warn('[time-service] 写入活跃片段失败，已忽略：', error)
    }
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

  function currentSessionAccumulated(): number {
    if (!taskSession) return 0
    if (taskSession.segmentStartedMono === null) return taskSession.accumulatedSeconds
    return (
      taskSession.accumulatedSeconds +
      Math.max(0, Math.floor((clock.monotonicMs() - taskSession.segmentStartedMono) / 1000))
    )
  }

  function taskSessionView(): TaskSessionStatus | null {
    if (!taskSession) return null
    const entry = repo.getView(taskSession.entryId)
    if (!entry) return null

    const accumulating = taskSession.segmentStartedMono !== null
    return {
      entry,
      taskId: taskSession.taskId,
      state: taskSession.manualPaused ? 'paused' : 'running',
      accumulating,
      activeAppKey: taskSession.activeAppKey,
      accumulatedSeconds: currentSessionAccumulated(),
      sessionSeconds: Math.max(
        0,
        Math.floor((clock.wallMs() - taskSession.startedAtWall) / 1000)
      ),
      startedAt: entry.entry.startedAt
    }
  }

  function status(): TimeStatusView {
    const manualView = manual ? repo.getView(manual.entryId) : null
    const autoEntry = repo.findActiveAuto()
    return {
      manual: manualView,
      auto: autoEntry ? repo.getView(autoEntry.id) : null,
      notice,
      taskSession: taskSessionView()
    }
  }

  /** 把当前活跃片段结算进累计值（不写库），并清空片段起点。 */
  function closeActiveSegment(): void {
    if (!taskSession || taskSession.segmentStartedMono === null) return
    const entryId = taskSession.entryId
    const startedWall = taskSession.segmentStartedWall ?? clock.wallMs()
    const endedWall = clock.wallMs()
    const delta = Math.max(
      0,
      Math.floor((clock.monotonicMs() - taskSession.segmentStartedMono) / 1000)
    )

    taskSession = {
      ...taskSession,
      accumulatedSeconds: taskSession.accumulatedSeconds + delta,
      segmentStartedMono: null,
      segmentStartedWall: null
    }

    // 明细：真实墙钟起止 + 本段秒数；elapsed_seconds 仍是权威总时长，不参与二次计算
    recordSegment(entryId, startedWall, endedWall, delta)
  }

  /**
   * 把当前累计值立即落库。
   *
   * 用于「重启前最后时刻」：若不落库，异常退出会丢掉最后一个检查点区间
   * （最多 30 秒），重启恢复出来的数字就会少于用户实际看到的。
   */
  function persistTaskSessionProgress(): void {
    if (!taskSession) return
    const nowWall = iso(clock.wallMs())
    repo.checkpoint(
      taskSession.entryId,
      currentSessionAccumulated(),
      nowWall,
      nowWall
    )
  }

  /** 结束会话并写库。seconds 由调用方决定（结束前必须已 closeActiveSegment）。 */
  function finalizeTaskSession(note: string | null): void {
    if (!taskSession) return
    const elapsed = taskSession.accumulatedSeconds
    const endedAt = iso(clock.wallMs())
    const startedAt = repo.get(taskSession.entryId)?.startedAt
    if (!startedAt) throw new Error('任务计时记录丢失')

    repo.finalize({
      id: taskSession.entryId,
      endedAt,
      elapsedSeconds: elapsed,
      lastHeartbeatAt: endedAt,
      clockSkewSeconds: computeClockSkewSeconds(startedAt, endedAt, elapsed),
      note,
      updatedAt: endedAt
    })
    taskSession = null
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

  function start(taskId: string): TimeStatusView {
    if (manual) throw new DataError('TIMER_ALREADY_RUNNING', '已有正在进行的计时，请先结束')
    if (repo.findActiveManual()) {
      throw new DataError('TIMER_ALREADY_RUNNING', '已有正在进行的计时，请先结束')
    }
    if (taskSession) {
      throw new DataError(
        'TASK_SESSION_ALREADY_RUNNING',
        '已有绘画任务正在计时，请先结束该任务计时'
      )
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
      runStartedWall: clock.wallMs(),
      status: 'running',
      lastCheckpointMono: nowMono
    }
    notice = null
    return status()
  }

  function pause(): TimeStatusView {
    if (!manual || manual.status !== 'running') {
      throw new DataError('TIMER_NOT_RUNNING', '当前没有正在运行的计时')
    }
    const elapsed = currentElapsedSeconds()
    const nowWall = iso(clock.wallMs())
    const nowMono = clock.monotonicMs()

    repo.setStatus(manual.entryId, 'paused', elapsed, nowWall, nowWall)
    // 明细：把刚结算的这一段活跃区间落库（暂停期间不再产生片段）
    recordSegment(
      manual.entryId,
      manual.runStartedWall ?? Date.parse(nowWall),
      Date.parse(nowWall),
      Math.max(0, elapsed - manual.accumulatedSeconds)
    )
    manual = {
      ...manual,
      status: 'paused',
      accumulatedSeconds: elapsed,
      runStartedMono: null,
      runStartedWall: null,
      lastCheckpointMono: nowMono
    }
    notice = null
    return status()
  }

  function resume(): TimeStatusView {
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
      runStartedWall: clock.wallMs(),
      lastCheckpointMono: nowMono
    }
    notice = null
    return status()
  }

  function stop(): TimeStatusView {
    if (!manual) throw new DataError('TIMER_NOT_RUNNING', '当前没有计时')
    const elapsed = currentElapsedSeconds()
    const endedAt = iso(clock.wallMs())
    const startedAt = repo.get(manual.entryId)?.startedAt

    if (!startedAt) throw new Error('计时记录丢失')

    // 明细：运行中才有「当前活跃区间」，暂停时最后一段已在 pause 落库
    if (manual.status === 'running' && manual.runStartedWall !== null) {
      recordSegment(
        manual.entryId,
        manual.runStartedWall,
        Date.parse(endedAt),
        Math.max(0, elapsed - manual.accumulatedSeconds)
      )
    }

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

  // -------------------------------------------------------------------------
  // 任务计时会话
  // -------------------------------------------------------------------------

  function startTaskSession(taskId: string, replaceCurrent: boolean): TimeStatusView {
    if (manual) {
      throw new DataError(
        'TIMER_ALREADY_RUNNING',
        '已有手动计时正在进行，请先结束它再开始任务计时'
      )
    }

    // 已在本任务上计时：幂等返回，不新建会话
    if (taskSession && taskSession.taskId === taskId) {
      if (taskSession.manualPaused) return resumeTaskSession()
      return status()
    }

    if (taskSession && !replaceCurrent) {
      const current = repo.getView(taskSession.entryId)
      throw new DataError(
        'TASK_SESSION_ALREADY_RUNNING',
        `「${current?.task?.title ?? '当前任务'}」仍在计时，请先结束它`
      )
    }

    assertStartable(taskId)

    const nowWall = iso(clock.wallMs())
    const nowMono = clock.monotonicMs()

    repo.transaction(() => {
      // 先结算旧会话，保证不会同时存在两个会话（数据库唯一索引也会拒绝）
      if (taskSession) {
        closeActiveSegment()
        finalizeTaskSession('切换到新任务，已自动结算')
      }
      // 普通自动片段也必须先结算，否则唯一索引冲突
      closeActiveAuto()

      repo.insert({
        id: randomUUID(),
        taskId,
        source: 'auto',
        status: 'running',
        startedAt: nowWall,
        elapsedSeconds: 0,
        lastHeartbeatAt: nowWall,
        appKey: null,
        note: null
      })
    })

    const created = repo.findActiveTaskSession()
    if (!created) throw new Error('任务计时启动后无法读回记录')

    taskSession = {
      entryId: created.id,
      taskId,
      accumulatedSeconds: 0,
      // 先不累计，等监测确认绘画软件活跃后才开始计时
      segmentStartedMono: null,
      segmentStartedWall: null,
      manualPaused: false,
      activeAppKey: null,
      startedAtWall: clock.wallMs(),
      lastCheckpointMono: nowMono
    }
    notice = null
    return status()
  }

  function pauseTaskSession(): TimeStatusView {
    if (!taskSession) throw new DataError('TASK_SESSION_NOT_RUNNING', '当前没有任务计时')
    if (taskSession.manualPaused) return status()

    closeActiveSegment()
    taskSession = { ...taskSession, manualPaused: true, activeAppKey: null }
    const nowWall = iso(clock.wallMs())
    repo.checkpoint(
      taskSession.entryId,
      taskSession.accumulatedSeconds,
      nowWall,
      nowWall
    )
    return status()
  }

  function resumeTaskSession(): TimeStatusView {
    if (!taskSession) throw new DataError('TASK_SESSION_NOT_RUNNING', '当前没有任务计时')
    if (!taskSession.manualPaused) return status()

    taskSession = {
      ...taskSession,
      manualPaused: false,
      segmentStartedMono: null,
      segmentStartedWall: null,
      lastCheckpointMono: clock.monotonicMs()
    }
    return status()
  }

  function stopTaskSession(): TimeStatusView {
    if (!taskSession) throw new DataError('TASK_SESSION_NOT_RUNNING', '当前没有任务计时')
    closeActiveSegment()
    finalizeTaskSession(null)
    notice = null
    return status()
  }

  /**
   * 每秒由活动监测调用。
   *
   * active 只影响「是否累计」，永远不会结束会话——用户切到浏览器、休息、
   * 电脑空闲都只是停止累计，会话保持进行中，直到用户手动结束。
   */
  function applyTaskActivity(active: boolean, appKey: string | null): void {
    if (!taskSession) return
    if (taskSession.manualPaused) return

    if (!active) {
      closeActiveSegment()
      if (taskSession.activeAppKey !== null) {
        taskSession = { ...taskSession, activeAppKey: null }
      }
      return
    }

    if (taskSession.segmentStartedMono === null) {
      taskSession = {
        ...taskSession,
        segmentStartedMono: clock.monotonicMs(),
        segmentStartedWall: clock.wallMs(),
        activeAppKey: appKey,
        lastCheckpointMono: clock.monotonicMs()
      }
      return
    }

    if (taskSession.activeAppKey !== appKey) {
      taskSession = { ...taskSession, activeAppKey: appKey }
    }

    // 每 30 秒落一次检查点，异常退出后最多丢一个检查点区间
    const nowMono = clock.monotonicMs()
    if (nowMono - taskSession.lastCheckpointMono >= checkpointInterval) {
      const nowWall = iso(clock.wallMs())
      const elapsed = currentSessionAccumulated()
      repo.checkpoint(taskSession.entryId, elapsed, nowWall, nowWall)
      taskSession = { ...taskSession, lastCheckpointMono: nowMono }
    }
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
      // 明细：自动暂停同样是「结算出一段活跃时间」，必须落片段
      recordSegment(
        manual.entryId,
        manual.runStartedWall ?? Date.parse(nowWall),
        Date.parse(nowWall),
        Math.max(0, elapsed - manual.accumulatedSeconds)
      )
      manual = {
        ...manual,
        status: 'paused',
        accumulatedSeconds: elapsed,
        runStartedMono: null,
        runStartedWall: null,
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
    startTaskSession,
    pauseTaskSession,
    resumeTaskSession,
    stopTaskSession,
    applyTaskActivity,
    persistTaskSessionProgress,
    tick,
    getManualTaskId: () => manual?.taskId ?? null,
    getTaskSessionTaskId: () => taskSession?.taskId ?? null,
    hasTaskSession: () => taskSession !== null,
    isManualRunning: () => manual?.status === 'running',
    list,
    summary,
    update,
    assign,
    remove,
    merge,
    taskTotals
  }
}
