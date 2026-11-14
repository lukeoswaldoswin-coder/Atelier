import { useEffect, useState } from 'react'
import { getAtelierApi } from '@/lib/ipc'
import { useTimeStore } from '@/stores/time-store'

/** 批量读取任务的累计实际工时（秒）；计时操作后自动刷新。 */
export function useTaskTotals(taskIds: readonly string[]): Map<string, number> {
  const [totals, setTotals] = useState<Map<string, number>>(new Map())
  const actionVersion = useTimeStore((state) => state.actionVersion)
  const idsKey = taskIds.join(',')

  useEffect(() => {
    if (taskIds.length === 0) {
      setTotals(new Map())
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const api = getAtelierApi()
        if (typeof api.time?.taskTotals !== 'function') return
        const rows = await api.time.taskTotals({ taskIds: [...taskIds] })
        if (!cancelled) {
          setTotals(new Map(rows.map((row) => [row.taskId, row.seconds])))
        }
      } catch {
        // 计时统计失败不应阻塞任务列表；界面显示 0，等待下次刷新
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, actionVersion])

  return totals
}
