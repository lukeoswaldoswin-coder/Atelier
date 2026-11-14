import { create } from 'zustand'
import type { TimeStatusOutput } from '@shared/domain'
import { getAtelierApi } from '@/lib/ipc'
import { formatIpcError } from '@/lib/ipc-error'

interface TimeState {
  status: TimeStatusOutput | null
  /** 最近一次从主进程同步的时间（用于本地平滑计时） */
  fetchedAt: number
  error: string | null
  busy: boolean
  /** 每次计时操作后递增，供任务工时等派生数据刷新 */
  actionVersion: number
  refresh: () => Promise<void>
  start: (taskId: string) => Promise<void>
  pause: () => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<void>
}

export const useTimeStore = create<TimeState>((set, get) => {
  async function run(action: () => Promise<TimeStatusOutput>): Promise<void> {
    set({ busy: true, error: null })
    try {
      const status = await action()
      set({
        status,
        fetchedAt: Date.now(),
        busy: false,
        actionVersion: get().actionVersion + 1
      })
    } catch (error) {
      set({ busy: false, error: formatIpcError(error) })
    }
  }

  return {
    status: null,
    fetchedAt: 0,
    error: null,
    busy: false,
    actionVersion: 0,

    refresh: async () => {
      try {
        const status = await getAtelierApi().time.status()
        set({ status, fetchedAt: Date.now(), error: null })
      } catch (error) {
        set({ error: formatIpcError(error) })
      }
    },

    start: (taskId) => run(() => getAtelierApi().time.start({ taskId })),
    pause: () => run(() => getAtelierApi().time.pause()),
    resume: () => run(() => getAtelierApi().time.resume()),
    stop: () => run(() => getAtelierApi().time.stop())
  }
})
