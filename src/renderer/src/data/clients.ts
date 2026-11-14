import { useCallback, useEffect, useRef, useState } from 'react'
import type { Client } from '@shared/domain'
import { getAtelierApi } from '@/lib/ipc'
import { formatIpcError } from '@/lib/ipc-error'
import { emptyListState, type LoadableList } from './load-state'

export interface ClientsListResult extends LoadableList<Client> {
  reload: () => void
}

/**
 * 读取客户列表。
 *
 * 默认包含已归档客户：委托列表需要用这份数据解析客户名称，
 * 若默认过滤掉已归档客户，历史委托会显示不出客户名。
 * 客户页签自己的「显示已归档」开关只影响展示，不影响这份数据。
 */
export function useClients(includeArchived = true): ClientsListResult {
  const [state, setState] = useState<LoadableList<Client>>(() => emptyListState<Client>())
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current
    setState((previous) => ({ ...previous, status: 'loading', error: null }))

    try {
      const rows = await getAtelierApi().clients.list({ includeArchived })
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
      requestId.current += 1
    }
  }, [load])

  return { ...state, reload: load }
}
