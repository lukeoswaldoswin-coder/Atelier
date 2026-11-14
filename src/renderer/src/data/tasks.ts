import { useCallback, useEffect, useRef, useState } from 'react'
import type { Task } from '@shared/domain'
import { getAtelierApi } from '@/lib/ipc'
import { formatIpcError } from '@/lib/ipc-error'
import { emptyListState, type LoadableList } from './load-state'

export interface TasksListResult extends LoadableList<Task> {
  reload: () => void
}

/** 读取某个委托下的任务；commissionId 为空时返回空列表。 */
export function useTasks(commissionId: string | null, includeArchived = false): TasksListResult {
  const [state, setState] = useState<LoadableList<Task>>(() => emptyListState<Task>())
  const requestId = useRef(0)

  const load = useCallback(async () => {
    if (!commissionId) {
      setState({ status: 'ready', rows: [], error: null })
      return
    }

    const currentRequest = ++requestId.current
    setState((previous) => ({ ...previous, status: 'loading', error: null }))

    try {
      const rows = await getAtelierApi().tasks.list({ commissionId, includeArchived })
      if (currentRequest === requestId.current) {
        setState({ status: 'ready', rows, error: null })
      }
    } catch (error) {
      if (currentRequest === requestId.current) {
        setState({ status: 'error', rows: [], error: formatIpcError(error) })
      }
    }
  }, [commissionId, includeArchived])

  useEffect(() => {
    void load()
    return () => {
      requestId.current += 1
    }
  }, [load])

  return { ...state, reload: load }
}
