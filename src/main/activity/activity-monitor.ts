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

  function evaluate(sample: ActivitySample): void {
    const nowMono = monotonic()

    // 休眠/长暂停：不把中断时间计入
    if (auto && nowMono - auto.lastSampleMono > 5000) {
      closeAuto('检测中断，已按检查点结算')
    }

    const appKey = resolveAppKey(sample.processName)
    const supported = appKey !== null && config.apps.includes(appKey)
    const idleLimit = config.idleMinutes * 60 * 1000
    const idleOk = !config.idleEnabled || sample.idleMs < idleLimit
    const active = config.enabled && supported && idleOk

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
    if (!config.enabled) {
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
    if (!config.enabled || !isSupportedPlatform()) return
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
  }

  /**
   * 恢复数据库前的安全结算：停止采样，结束当前自动片段，确认没有 running 记录。
   * 返回刚结算的记录；没有活动片段时返回 null。
   */
  function settleForRestore(): { entryId: string; seconds: number } | null {
    if (timer) clearInterval(timer)
    timer = null

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
  }

  function handleResume(): void {
    lastSample = null
    tick()
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
    getConfig: (): MonitorConfig => config
  }
}

export type ActivityMonitor = ReturnType<typeof createActivityMonitor>
export { EMPTY_STATUS }
