import { useCallback, useEffect, useRef, useState } from 'react'
import type { Commission } from '@shared/domain'
import { getAtelierApi } from '@/lib/ipc'
import { formatIpcError } from '@/lib/ipc-error'
import { emptyListState, type LoadableList } from './load-state'

export interface CommissionsListResult extends LoadableList<Commission> {
  reload: () => void
}

/**
 * 读取委托列表（真实 IPC，无本地假数据）。
 * 多次请求时只采用最后一次的结果，避免旧响应覆盖新数据。
 */
export function useCommissions(includeArchived = false): CommissionsListResult {
  const [state, setState] = useState<LoadableList<Commission>>(() => emptyListState<Commission>())
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    setState((previous) => ({ ...previous, status: 'loading', error: null }))

    try {
      const rows = await getAtelierApi().commissions.list({ includeArchived })
      if (currentRequest === requestId.current) {
        setState({ status: 'ready', rows, error: null })
      }
    } catch (error) {
      if (currentRequest === requestId.current) {
        setState({ status: 'error', rows: [], error: formatIpcError(error) })
      }
    }
  }, [includeArchived])

  useEffect(() => {
    void load()
    return () => {
      // 卸载后递增，令在途请求的结果被丢弃
      requestId.current += 1
    }
  }, [load])

  return { ...state, reload: load }
}
