import { useEffect, useState } from 'react'
import type { TimeEntryView, TimeListFilter, TimeSummaryOutput } from '@shared/domain'
import { getAtelierApi } from '@/lib/ipc'
import { formatIpcError } from '@/lib/ipc-error'

export interface TimeEntriesState {
  status: 'loading' | 'ready' | 'error'
  rows: TimeEntryView[]
  error: string | null
  reload: () => void
}

export function useTimeEntries(
  from: string,
  to: string,
  filter: TimeListFilter,
  version: number,
  /** 只看某个任务的工时（P6.7 从日历跳转过来时使用）；省略表示不按任务收窄。 */
  taskId?: string | null
): TimeEntriesState {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; rows: TimeEntryView[]; error: string | null }>(
    { status: 'loading', rows: [], error: null }
  )

  useEffect(() => {
    let cancelled = false
    setState((previous) => ({ ...previous, status: 'loading', error: null }))
    void (async () => {
      try {
        const rows = await getAtelierApi().time.list(
          taskId ? { from, to, filter, taskId } : { from, to, filter }
        )
        if (!cancelled) setState({ status: 'ready', rows, error: null })
      } catch (caught) {
        if (!cancelled) {
          setState({ status: 'error', rows: [], error: formatIpcError(caught) })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [from, to, filter, version, taskId])

  return { ...state, reload: () => setState((previous) => ({ ...previous })) }
}

export function useTimeSummary(from: string, to: string, version: number): TimeSummaryOutput | null {
  const [summary, setSummary] = useState<TimeSummaryOutput | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const value = await getAtelierApi().time.summary({ from, to })
        if (!cancelled) setSummary(value)
      } catch {
        if (!cancelled) setSummary(null)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [from, to, version])

  return summary
}
