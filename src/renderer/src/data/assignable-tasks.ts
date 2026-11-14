import { useEffect, useState } from 'react'
import type { AssignableTask } from '@shared/domain'
import { getAtelierApi } from '@/lib/ipc'

/** 全部任务（含归档），用于工时归属选择。 */
export function useAssignableTasks(): { tasks: AssignableTask[]; error: string | null } {
  const [tasks, setTasks] = useState<AssignableTask[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const value = await getAtelierApi().tasks.listAll()
        if (!cancelled) setTasks(value)
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  return { tasks, error }
}
