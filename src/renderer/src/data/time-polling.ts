import { useEffect, useState } from 'react'
import { useTimeStore } from '@/stores/time-store'

/** 周期同步计时状态；本地秒表由组件自行平滑。 */
export function useTimePolling(intervalMs = 2000): void {
  const refresh = useTimeStore((state) => state.refresh)

  useEffect(() => {
    void refresh()
    const timer = setInterval(() => {
      void refresh()
    }, intervalMs)
    return () => clearInterval(timer)
  }, [refresh, intervalMs])
}

/** 当前手动计时已累计的秒数（运行中按本地时间平滑递增）。 */
export function useLiveElapsedSeconds(): number {
  const status = useTimeStore((state) => state.status)
  const fetchedAt = useTimeStore((state) => state.fetchedAt)
  const entry = status?.manual?.entry
  const [, setTick] = useState(0)

  useEffect(() => {
    if (entry?.status !== 'running') return
    const timer = setInterval(() => setTick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [entry?.status])

  if (!entry) return 0
  if (entry.status !== 'running') return entry.elapsedSeconds

  const drift = fetchedAt > 0 ? Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000)) : 0
  return entry.elapsedSeconds + drift
}
