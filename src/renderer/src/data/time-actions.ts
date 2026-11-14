import type { TimeAssignInput, TimeEntryView, TimeMergeInput, TimeUpdateInput } from '@shared/domain'
import { getAtelierApi } from '@/lib/ipc'

export function updateTimeEntry(input: TimeUpdateInput): Promise<TimeEntryView | null> {
  return getAtelierApi().time.update(input)
}

export function assignTimeEntry(input: TimeAssignInput): Promise<TimeEntryView | null> {
  return getAtelierApi().time.assign(input)
}

export function removeTimeEntry(id: string): Promise<boolean> {
  return getAtelierApi().time.remove({ id })
}

export function mergeTimeEntries(input: TimeMergeInput): Promise<TimeEntryView> {
  return getAtelierApi().time.merge(input)
}
