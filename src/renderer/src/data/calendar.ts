import { useCallback, useEffect, useRef, useState } from 'react'
import type { CalendarTasksOutput } from '@shared/domain'
import { getAtelierApi } from '@/lib/ipc'
import { formatIpcError } from '@/lib/ipc-error'

export type CalendarLoadStatus = 'loading' | 'ready' | 'error'

export const EMPTY_CALENDAR: CalendarTasksOutput = {
  scheduled: [],
  unscheduled: [],
  deadlines: []
}

export interface CalendarResult {
  status: CalendarLoadStatus
  data: CalendarTasksOutput
  error: string | null
  reload: () => void
}

/** 读取日期范围内的日历数据。from / to 均为 YYYY-MM-DD（闭区间）。 */
export function useCalendarTasks(from: string, to: string): CalendarResult {
  const [state, setState] = useState<{ status: CalendarLoadStatus; data: CalendarTasksOutput; error: string | null }>(
    { status: 'loading', data: EMPTY_CALENDAR, error: null }
  )
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const current = ++requestId.current
    setState((previous) => ({ ...previous, status: 'loading', error: null }))

    try {
      const data = await getAtelierApi().calendar.tasks({ from, to })
      if (current === requestId.current) {
        setState({ status: 'ready', data, error: null })
      }
    } catch (error) {
      if (current === requestId.current) {
        setState({ status: 'error', data: EMPTY_CALENDAR, error: formatIpcError(error) })
      }
    }
  }, [from, to])

  useEffect(() => {
    void load()
    return () => {
      requestId.current += 1
    }
  }, [load])

  return { ...state, reload: load }
}
