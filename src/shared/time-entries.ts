import type { MonitorConfig } from './domain'
import { DEFAULT_ENABLED_APP_KEYS } from './activity-apps'

export const TIME_SOURCE_LABELS = {
  manual: '手动',
  auto: '自动'
} as const

export const TIME_STATUS_LABELS = {
  running: '进行中',
  paused: '已暂停',
  completed: '已完成'
} as const

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  enabled: false,
  apps: [...DEFAULT_ENABLED_APP_KEYS],
  idleMinutes: 3
}

/** 秒 → `1 小时 05 分` / `3 分 20 秒`。 */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const rest = safe % 60

  if (hours > 0) return `${hours} 小时 ${String(minutes).padStart(2, '0')} 分`
  if (minutes > 0) return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`
  return `${rest} 秒`
}

/** 秒 → `HH:MM:SS`（运行中计时显示）。 */
export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const rest = safe % 60
  return [hours, minutes, rest].map((part) => String(part).padStart(2, '0')).join(':')
}

/**
 * 墙钟观察差与实际累计的偏差（秒）。
 * 仅用于记录异常信息，不参与工时统计。
 */
export function computeClockSkewSeconds(
  startedAt: string,
  endedAt: string,
  elapsedSeconds: number
): number {
  const wallSeconds = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)
  return wallSeconds - elapsedSeconds
}
