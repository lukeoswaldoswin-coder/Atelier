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

/**
 * 任务计时会话的实时秒数。
 *
 * 两个数字必须区分：
 * - accumulated：实际累计工时，只在 accumulating 时按本地时间平滑递增；
 * - session：会话持续时间（墙钟），从会话开始一直走。
 */
export function useLiveTaskSession(): {
  accumulated: number
  session: number
  accumulating: boolean
} {
  const status = useTimeStore((state) => state.status)
  const fetchedAt = useTimeStore((state) => state.fetchedAt)
  const [, setTick] = useState(0)

  const taskSession = status?.taskSession ?? null
  const accumulating = taskSession?.accumulating ?? false

  useEffect(() => {
    if (!taskSession) return
    const timer = setInterval(() => setTick((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [taskSession?.entry.entry.id, accumulating])

  if (!taskSession) return { accumulated: 0, session: 0, accumulating: false }

  const drift = fetchedAt > 0 ? Math.max(0, Math.floor((Date.now() - fetchedAt) / 1000)) : 0
  return {
    accumulated: taskSession.accumulatedSeconds + (accumulating ? drift : 0),
    session: taskSession.sessionSeconds + drift,
    accumulating
  }
}
