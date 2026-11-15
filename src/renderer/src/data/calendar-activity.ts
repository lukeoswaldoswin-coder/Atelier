import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  CalendarActivitySummaryOutput,
  CalendarDayActivity,
  CalendarDayDetailOutput
} from '@shared/domain'
import { getAtelierApi } from '@/lib/ipc'
import { formatIpcError } from '@/lib/ipc-error'

/**
 * 每日创作工时（P6.7）。
 *
 * 两个 hook 都沿用 useCalendarTasks 的 requestId 写法：
 * 只有「最后一次请求」的结果会被写入状态，快速切月时不会出现旧结果覆盖新结果。
 */

export type CalendarActivityStatus = 'idle' | 'loading' | 'ready' | 'error'

export const EMPTY_ACTIVITY: CalendarActivitySummaryOutput = { days: [] }

export interface CalendarActivityResult {
  status: CalendarActivityStatus
  /** 只含有工时记录的日期；没有记录的日期不会出现 */
  days: CalendarDayActivity[]
  error: string | null
  reload: () => void
}

/**
 * 读取日期范围内的每日创作摘要。from / to 均为 YYYY-MM-DD（闭区间）。
 * 月视图用整个网格区间一次请求，绝不为每个日期格子单独发 IPC。
 */
export function useCalendarActivity(from: string, to: string): CalendarActivityResult {
  const [state, setState] = useState<{
    status: CalendarActivityStatus
    days: CalendarDayActivity[]
    error: string | null
  }>({ status: 'loading', days: [], error: null })
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const current = ++requestId.current
    setState((previous) => ({ ...previous, status: 'loading', error: null }))

    const call = readActivityApi()
    if (!call) {
      setState({ status: 'ready', days: [], error: null })
      return
    }

    try {
      const data = await call({ from, to })
      if (current === requestId.current) {
        setState({ status: 'ready', days: data.days, error: null })
      }
    } catch (error) {
      if (current === requestId.current) {
        setState({ status: 'error', days: [], error: formatIpcError(error) })
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

/**
 * 读取每日创作摘要的原生方法。
 *
 * 接口在主进程接线完成前可能还不存在；此时降级为「没有创作记录」，
 * 而不是把整页变成错误状态——日历的既有功能不应该因为新功能未就绪而不可用。
 */
function readActivityApi():
  | ((input: { from: string; to: string }) => Promise<CalendarActivitySummaryOutput>)
  | null {
  const calendar = getAtelierApi().calendar as
    | { activity?: (input: { from: string; to: string }) => Promise<CalendarActivitySummaryOutput> }
    | undefined
  return typeof calendar?.activity === 'function' ? calendar.activity.bind(calendar) : null
}

function readDayDetailApi():
  | ((input: { date: string }) => Promise<CalendarDayDetailOutput>)
  | null {
  const calendar = getAtelierApi().calendar as
    | { dayDetail?: (input: { date: string }) => Promise<CalendarDayDetailOutput> }
    | undefined
  return typeof calendar?.dayDetail === 'function' ? calendar.dayDetail.bind(calendar) : null
}

export interface CalendarDayDetailResult {
  status: CalendarActivityStatus
  detail: CalendarDayDetailOutput | null
  error: string | null
}

/** 读取某一天的创作详情。date 为 null 表示没有选中日期，不发请求。 */
export function useCalendarDayDetail(date: string | null): CalendarDayDetailResult {
  const [state, setState] = useState<{
    status: CalendarActivityStatus
    detail: CalendarDayDetailOutput | null
    error: string | null
  }>({ status: 'idle', detail: null, error: null })
  const requestId = useRef(0)

  const load = useCallback(async () => {
    if (date === null) {
      requestId.current += 1
      setState({ status: 'idle', detail: null, error: null })
      return
    }

    const current = ++requestId.current
    setState({ status: 'loading', detail: null, error: null })

    const call = readDayDetailApi()
    if (!call) {
      setState({ status: 'ready', detail: null, error: null })
      return
    }

    try {
      const detail = await call({ date })
      if (current === requestId.current) {
        setState({ status: 'ready', detail, error: null })
      }
    } catch (error) {
      if (current === requestId.current) {
        setState({ status: 'error', detail: null, error: formatIpcError(error) })
      }
    }
  }, [date])

  useEffect(() => {
    void load()
    return () => {
      requestId.current += 1
    }
  }, [load])

  return state
}
