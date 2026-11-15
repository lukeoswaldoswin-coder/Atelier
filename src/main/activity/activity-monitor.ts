import type { MonitorConfig, MonitorStatusOutput } from '@shared/domain'
import { SUPPORTED_APPS, resolveAppKey } from '@shared/activity-apps'
import { computeClockSkewSeconds } from '@shared/time-entries'
import type { ActivityProbe, ActivitySample } from './win32-probe'
import type { TimeEntriesRepository } from '../db/repositories/time-entries'
import type { SettingsRepository } from '../db/repositories/settings'
import type { TimeService } from '../time/time-service'
import { randomUUID } from 'node:crypto'

export interface MonitorDeps {
  timeEntries: TimeEntriesRepository
  settings: SettingsRepository
  timeService: TimeService
  createProbe: () => ActivityProbe
  platform?: NodeJS.Platform
  checkpointIntervalSeconds?: number
  /** 测试注入：单调时钟 */
  monotonicMs?: () => number
  wallMs?: () => number
}

interface AutoSession {
  entryId: string
  appKey: string
  startedMono: number
  /** 片段的墙钟起点，用于落 time_entry_segments 的真实起止 */
  startedWall: number
  lastCheckpointMono: number
  lastSampleMono: number
}

const EMPTY_STATUS: MonitorStatusOutput = {
  platformSupported: process.platform === 'win32',
  enabled: false,
  apps: [],
  idleMinutes: 3,
  idleEnabled: true,
  running: false,
  activeAppKey: null,
  idleSeconds: null,
  error: null
}

/**
 * 自动监测协调器。
 *
 * - 只在「没有手动计时运行」时创建自动工时片段（手动计时拥有该时间段，避免重复）。
 * - 仅受支持应用在前台且空闲低于阈值时累计。
 * - 每 30 秒写检查点；状态变化时才切分记录。
 */
export function createActivityMonitor(deps: MonitorDeps) {
  const monotonic = deps.monotonicMs ?? (() => performance.now())
  const wall = deps.wallMs ?? (() => Date.now())
  const platform = deps.platform ?? process.platform
  const checkpointInterval = (deps.checkpointIntervalSeconds ?? 30) * 1000

  let config: MonitorConfig = deps.settings.getMonitorConfig()
  let probe: ActivityProbe | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let auto: AutoSession | null = null
  let lastSample: ActivitySample | null = null
  let error: string | null = null

  function isSupportedPlatform(): boolean {
    return platform === 'win32'
  }

  function ensureProbe(): boolean {
    if (probe) return true
    if (!isSupportedPlatform()) return false
    try {
      probe = deps.createProbe()
      error = null
      return true
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
      probe = null
      return false
    }
  }

  function closeAuto(reason: string | null = null): void {
    if (!auto) return
    const elapsed = Math.max(0, Math.floor((monotonic() - auto.startedMono) / 1000))
    const endedAt = new Date(wall()).toISOString()
    const entry = deps.timeEntries.get(auto.entryId)
    deps.timeEntries.finalize({
      id: auto.entryId,
      endedAt,
      elapsedSeconds: elapsed,
      lastHeartbeatAt: entry?.lastHeartbeatAt ?? endedAt,
      clockSkewSeconds: entry ? computeClockSkewSeconds(entry.startedAt, endedAt, elapsed) : 0,
      note: reason,
      updatedAt: endedAt
    })

    // 明细：真实墙钟起止 + 本段秒数。0 秒片段不写（没有信息量）。
    // 片段不改变 elapsed_seconds 的语义，也不参与任何金额/统计口径的二次计算。
    if (elapsed > 0) {
      try {
        deps.timeEntries.appendSegment({
          id: randomUUID(),
          entryId: auto.entryId,
          startedAt: new Date(auto.startedWall).toISOString(),
          endedAt,
          seconds: elapsed,
          createdAt: endedAt,
          updatedAt: endedAt
        })
      } catch (caught) {
        // 明细写入失败不能影响自动计时的正常结算
        error = caught instanceof Error ? caught.message : String(caught)
      }
    }

    auto = null
  }

  function startAuto(appKey: string): void {
    const nowWall = new Date(wall()).toISOString()
    const id = randomUUID()
    deps.timeEntries.insert({
      id,
      taskId: null,
      source: 'auto',
      status: 'running',
      startedAt: nowWall,
      elapsedSeconds: 0,
      lastHeartbeatAt: nowWall,
      appKey,
      note: null
    })
    auto = {
      entryId: id,
      appKey,
      startedMono: monotonic(),
      startedWall: wall(),
      lastCheckpointMono: monotonic(),
      lastSampleMono: monotonic()
    }
  }

  function checkpoint(): void {
    if (!auto) return
    const nowMono = monotonic()
    if (nowMono - auto.lastCheckpointMono < checkpointInterval) return
    const elapsed = Math.max(0, Math.floor((nowMono - auto.startedMono) / 1000))
    const nowWall = new Date(wall()).toISOString()
    deps.timeEntries.checkpoint(auto.entryId, elapsed, nowWall, nowWall)
    auto.lastCheckpointMono = nowMono
  }

  /** 判定当前采样是否算「绘画软件活跃」（与 P4 原有规则完全一致）。 */
  function isActiveSample(sample: ActivitySample): { active: boolean; appKey: string | null } {
    const appKey = resolveAppKey(sample.processName)
    const supported = appKey !== null && config.apps.includes(appKey)
    const idleLimit = config.idleMinutes * 60 * 1000
    const idleOk = !config.idleEnabled || sample.idleMs < idleLimit
    return { active: supported && idleOk, appKey }
  }

  function evaluate(sample: ActivitySample): void {
    const nowMono = monotonic()

    // 休眠/长暂停：不把中断时间计入
    if (auto && nowMono - auto.lastSampleMono > 5000) {
      closeAuto('检测中断，已按检查点结算')
    }

    const { active, appKey } = isActiveSample(sample)

    // ---- 任务计时会话优先：活跃时间归属当前任务，不产生独立自动记录 ----
    // 注意：这里刻意不看 config.enabled —— 用户主动开启任务计时时，
    // 即使「自动监测」总开关是关的，也必须能累计（P6.6 明确要求）。
    if (deps.timeService.hasTaskSession()) {
      closeAuto()
      deps.timeService.applyTaskActivity(active, active ? appKey : null)
      lastSample = sample
      return
    }

    if (!config.enabled) {
      closeAuto()
      lastSample = sample
      return
    }

    if (!active) {
      closeAuto()
      lastSample = sample
      return
    }

    // 手动计时运行期间：自动监测只观察，不产生记录
    if (deps.timeService.isManualRunning()) {
      closeAuto()
      lastSample = sample
      return
    }

    const key = appKey as string
    if (!auto) {
      startAuto(key)
    } else if (auto.appKey !== key) {
      closeAuto()
      startAuto(key)
    } else {
      auto.lastSampleMono = nowMono
      checkpoint()
    }

    lastSample = sample
  }

  function tick(): void {
    // 没有任务会话且监测关闭时完全不采样，保持 P4 行为（不加载原生探测）。
    if (!config.enabled && !deps.timeService.hasTaskSession()) {
      closeAuto()
      return
    }
    if (!ensureProbe() || !probe) return

    try {
      const sample = probe.sample()
      evaluate(sample)
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught)
      closeAuto()
    }
  }

  function restartTimer(): void {
    if (timer) clearInterval(timer)
    timer = null
    if (!isSupportedPlatform()) return
    // 任务会话期间即使监测关闭也必须继续采样，否则无法累计。
    if (!config.enabled && !deps.timeService.hasTaskSession()) return
    timer = setInterval(tick, 1000)
    timer.unref?.()
  }

  function status(): MonitorStatusOutput {
    const entry = auto ? deps.timeEntries.get(auto.entryId) : null
    return {
      platformSupported: isSupportedPlatform(),
      enabled: config.enabled,
      apps: config.apps,
      idleMinutes: config.idleMinutes,
      idleEnabled: config.idleEnabled,
      running: entry?.status === 'running',
      activeAppKey: auto?.appKey ?? null,
      idleSeconds: lastSample ? Math.floor(lastSample.idleMs / 1000) : null,
      error
    }
  }

  function setEnabled(enabled: boolean): MonitorStatusOutput {
    config = deps.settings.setMonitorConfig({ ...config, enabled })
    if (!enabled) closeAuto()
    restartTimer()
    if (enabled) tick()
    return status()
  }

  function setApps(apps: string[]): MonitorStatusOutput {
    const allowed = apps.filter((key) => SUPPORTED_APPS.some((app) => app.key === key))
    config = deps.settings.setMonitorConfig({ ...config, apps: allowed })
    if (auto && !allowed.includes(auto.appKey)) closeAuto()
    return status()
  }

  function setIdleMinutes(idleMinutes: number): MonitorStatusOutput {
    config = deps.settings.setMonitorConfig({ ...config, idleMinutes })
    return status()
  }

  function setIdleEnabled(idleEnabled: boolean): MonitorStatusOutput {
    config = deps.settings.setMonitorConfig({ ...config, idleEnabled })
    if (!idleEnabled) tick()
    return status()
  }

  function start(): void {
    restartTimer()
    tick()
  }

  function stop(): void {
    closeAuto()
    if (timer) clearInterval(timer)
    timer = null
    // 退出前把任务会话的累计值落库，避免丢最后一个检查点区间
    if (deps.timeService.hasTaskSession()) deps.timeService.persistTaskSessionProgress()
  }

  /**
   * 恢复数据库前的安全结算：停止采样，结束当前自动片段，确认没有 running 记录。
   * 返回刚结算的记录；没有活动片段时返回 null。
   */
  function settleForRestore(): { entryId: string; seconds: number } | null {
    if (timer) clearInterval(timer)
    timer = null

    // 任务会话同样是 running 的 auto 记录，恢复数据库前必须先结算，
    // 否则「没有 running 记录」的断言会失败。
    if (deps.timeService.hasTaskSession()) {
      deps.timeService.stopTaskSession()
    }

    const entryId = auto?.entryId ?? null
    if (!entryId) {
      if (deps.timeEntries.findActiveAuto()) {
        throw new Error('存在无法识别的自动工时活动记录')
      }
      return null
    }

    closeAuto()

    const entry = deps.timeEntries.get(entryId)
    if (!entry || entry.status !== 'completed' || entry.endedAt === null) {
      throw new Error('自动工时结算失败：记录未完整结束')
    }
    if (deps.timeEntries.findActiveAuto()) {
      throw new Error('自动工时结算失败：仍有进行中的自动记录')
    }

    return { entryId, seconds: entry.elapsedSeconds }
  }

  function handleSuspend(): void {
    closeAuto('系统休眠，已结算')
    // 任务会话不因休眠结束，只停止累计（休眠时间不计入实际工时）
    if (deps.timeService.hasTaskSession()) deps.timeService.applyTaskActivity(false, null)
  }

  function handleResume(): void {
    lastSample = null
    restartTimer()
    tick()
  }

  /** 任务会话开始/结束时调用：保证监测定时器按需启停。 */
  function refreshTimer(): void {
    restartTimer()
    if (timer) tick()
  }

  return {
    start,
    stop,
    settleForRestore,
    tick,
    status,
    setEnabled,
    setApps,
    setIdleMinutes,
    setIdleEnabled,
    handleSuspend,
    handleResume,
    refreshTimer,
    getConfig: (): MonitorConfig => config
  }
}

export type ActivityMonitor = ReturnType<typeof createActivityMonitor>
export { EMPTY_STATUS }
