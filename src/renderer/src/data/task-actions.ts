import type { ByIdInput, CreateTaskInput, ReorderTasksInput, Task, UpdateTaskInput } from '@shared/domain'
import { getAtelierApi } from '@/lib/ipc'

/** 任务写操作。错误由调用方捕获并用 formatIpcError 展示。 */
export function createTask(input: CreateTaskInput): Promise<Task> {
  return getAtelierApi().tasks.create(input)
}

export function updateTask(input: UpdateTaskInput): Promise<Task | null> {
  return getAtelierApi().tasks.update(input)
}

export function reorderTasks(input: ReorderTasksInput): Promise<Task[]> {
  return getAtelierApi().tasks.reorder(input)
}

export function archiveTask(id: string): Promise<Task | null> {
  return getAtelierApi().tasks.archive({ id })
}

export function unarchiveTask(id: string): Promise<Task | null> {
  return getAtelierApi().tasks.unarchive({ id })
}

/** 供测试与调用方复用：把 id 包装成 ByIdInput。 */
export function byTaskId(id: string): ByIdInput {
  return { id }
}
