import type { MonitorConfig } from '@shared/domain'
import { monitorConfigSchema } from '@shared/domain'
import { DEFAULT_MONITOR_CONFIG } from '@shared/time-entries'
import type { AppDatabase } from '../database'

export interface SettingsRepository {
  getMonitorConfig(): MonitorConfig
  setMonitorConfig(config: MonitorConfig): MonitorConfig
}

const KEYS = {
  enabled: 'monitor.enabled',
  apps: 'monitor.apps',
  idleMinutes: 'monitor.idleMinutes',
  idleEnabled: 'monitor.idleEnabled'
} as const

export function createSettingsRepository(db: AppDatabase): SettingsRepository {
  function read(key: string): string | undefined {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    return row?.value
  }

  function write(key: string, value: string, now: string): void {
    db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, value, now)
  }

  function getMonitorConfig(): MonitorConfig {
    const rawEnabled = read(KEYS.enabled)
    const rawApps = read(KEYS.apps)
    const rawIdle = read(KEYS.idleMinutes)
    const rawIdleEnabled = read(KEYS.idleEnabled)

    let apps: string[] = [...DEFAULT_MONITOR_CONFIG.apps]
    if (rawApps !== undefined) {
      try {
        const parsed = JSON.parse(rawApps)
        if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
          apps = parsed
        }
      } catch {
        // 配置损坏时回退到默认值，不影响主流程
      }
    }

    const candidate = {
      enabled: rawEnabled === '1',
      apps,
      idleMinutes: rawIdle === undefined ? DEFAULT_MONITOR_CONFIG.idleMinutes : Number(rawIdle),
      idleEnabled: rawIdleEnabled === undefined ? true : rawIdleEnabled !== '0'
    }

    const parsed = monitorConfigSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
    return { ...DEFAULT_MONITOR_CONFIG, apps }
  }

  function setMonitorConfig(config: MonitorConfig): MonitorConfig {
    const parsed = monitorConfigSchema.parse(config)
    const now = new Date().toISOString()
    db.transaction(() => {
      write(KEYS.enabled, parsed.enabled ? '1' : '0', now)
      write(KEYS.apps, JSON.stringify(parsed.apps), now)
      write(KEYS.idleMinutes, String(parsed.idleMinutes), now)
      write(KEYS.idleEnabled, parsed.idleEnabled ? '1' : '0', now)
    })()
    return parsed
  }

  return { getMonitorConfig, setMonitorConfig }
}
