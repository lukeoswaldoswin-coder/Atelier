import type { TaskStage, TaskStatus } from './domain'

/** 固定阶段顺序：草稿 → 线稿 → 上色 → 完稿 → 其他。 */
export const TASK_STAGES: readonly TaskStage[] = ['draft', 'lineart', 'color', 'final', 'other']

export const TASK_STAGE_LABELS: Record<TaskStage, string> = {
  draft: '草稿',
  lineart: '线稿',
  color: '上色',
  final: '完稿',
  other: '其他'
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: '待开始',
  doing: '进行中',
  done: '已完成'
}

/** 阶段在排序中的序号（用于 SQL 与内存排序保持一致）。 */
export function taskStageRank(stage: TaskStage): number {
  const index = TASK_STAGES.indexOf(stage)
  return index < 0 ? TASK_STAGES.length : index
}
