import { useCallback, useEffect, useRef, useState } from 'react'
import type { MonitorStatusOutput } from '@shared/domain'
import { getAtelierApi } from '@/lib/ipc'
import { formatIpcError } from '@/lib/ipc-error'

export interface MonitorResult {
  status: MonitorStatusOutput | null
  error: string | null
  busy: boolean
  refresh: () => Promise<void>
  setEnabled: (enabled: boolean) => Promise<void>
  setApps: (apps: string[]) => Promise<void>
  setIdleMinutes: (minutes: number) => Promise<void>
  setIdleEnabled: (enabled: boolean) => Promise<void>
}

/** 读取并修改自动监测设置（3 秒轮询运行状态）。 */
export function useMonitor(): MonitorResult {
  const [status, setStatus] = useState<MonitorStatusOutput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const next = await getAtelierApi().monitor.status()
      if (mounted.current) {
        setStatus(next)
        setError(null)
      }
    } catch (caught) {
      if (mounted.current) setError(formatIpcError(caught))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => void refresh(), 3000)
    return () => clearInterval(timer)
  }, [refresh])

  async function apply(action: () => Promise<MonitorStatusOutput>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const next = await action()
      if (mounted.current) setStatus(next)
    } catch (caught) {
      if (mounted.current) setError(formatIpcError(caught))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return {
    status,
    error,
    busy,
    refresh,
    setEnabled: (enabled) => apply(() => getAtelierApi().monitor.setEnabled({ enabled })),
    setApps: (apps) => apply(() => getAtelierApi().monitor.setApps({ apps })),
    setIdleMinutes: (minutes) => apply(() => getAtelierApi().monitor.setIdleMinutes({ idleMinutes: minutes })),
    setIdleEnabled: (enabled) => apply(() => getAtelierApi().monitor.setIdleEnabled({ enabled }))
  }
}
