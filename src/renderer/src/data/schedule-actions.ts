import type { ScheduleApplyInput, ScheduleApplyOutput } from '@shared/scheduling'
import { getAtelierApi } from '@/lib/ipc'

/** 采纳排期建议：服务端会校验资格与建议快照，失败时整批拒绝。 */
export function applySchedule(input: ScheduleApplyInput): Promise<ScheduleApplyOutput> {
  return getAtelierApi().schedule.apply(input)
}
