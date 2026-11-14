import type { Task } from '@shared/domain'

/** 分钟 → 可读文本。null 表示未估。 */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '未估'
  if (minutes === 0) return '0 分钟'

  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} 分钟`
  if (rest === 0) return `${hours} 小时`
  return `${hours} 小时 ${rest} 分`
}

export function sumEstimatedMinutes(tasks: readonly Task[], onlyUnfinished = false): number {
  return tasks.reduce((total, task) => {
    if (task.archivedAt !== null) return total
    if (onlyUnfinished && task.status === 'done') return total
    return total + (task.estimatedMinutes ?? 0)
  }, 0)
}

export interface TaskProgress {
  total: number
  done: number
  /** 未完成的预计分钟 */
  undoneMinutes: number
  /** 全部未归档任务的预计分钟 */
  totalMinutes: number
}

export function computeTaskProgress(tasks: readonly Task[]): TaskProgress {
  const active = tasks.filter((task) => task.archivedAt === null)
  const done = active.filter((task) => task.status === 'done').length
  return {
    total: active.length,
    done,
    undoneMinutes: sumEstimatedMinutes(active, true),
    totalMinutes: sumEstimatedMinutes(active)
  }
}
