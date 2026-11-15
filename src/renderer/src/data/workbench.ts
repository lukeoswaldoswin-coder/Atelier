import { useCallback, useEffect, useState } from 'react'
import type { WorkbenchInput, WorkbenchOutput } from '@shared/domain'
import { getAtelierApi } from '@/lib/ipc'
import { formatIpcError } from '@/lib/ipc-error'

export interface WorkbenchResult {
  data: WorkbenchOutput | null
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * 绘画任务工作台数据。
 * includeDone 只影响「已完成」分组是否返回；待处理分组始终返回。
 */
export function useWorkbench(input: WorkbenchInput): WorkbenchResult {
  const [data, setData] = useState<WorkbenchOutput | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const { includeDone, includeArchived } = input

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    void (async () => {
      try {
        const value = await getAtelierApi().tasks.workbench({ includeDone, includeArchived })
        if (cancelled) return
        setData(value)
        setError(null)
      } catch (caught) {
        if (cancelled) return
        setError(formatIpcError(caught))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [includeDone, includeArchived, version])

  const reload = useCallback(() => setVersion((value) => value + 1), [])

  return { data, loading, error, reload }
}
