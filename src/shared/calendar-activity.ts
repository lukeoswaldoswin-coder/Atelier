/**
 * 每日创作工时归属（P6.7）。
 *
 * 目标：把一条工时记录还原成「每个自然日各占多少秒」。
 *
 * 规则来源（用户需求第五节）：
 * - 每日工时必须是该自然日真实发生的有效工时，不能用记录创建日期、
 *   任务计划日期、任务完成日期或会话开始日期代替；
 * - 跨午夜的连续片段要按两侧实际时长拆分；
 * - 时区与日期边界遵循 Atelier 现有的本地日期规则（shared/time 的 todayInZone），
 *   不混用 UTC 日期和本地日期；
 * - 同一笔工时在所有页面必须一致：本模块保证「各日合计 == elapsed_seconds」，
 *   不会因为四舍五入产生重复或丢失。
 *
 * 数据前提：
 * - 权威总时长始终是 time_entries.elapsed_seconds（单调时钟累计）；
 * - 每个活跃片段由 time_entry_segments 记录真实墙钟起止与秒数；
 * - 老记录（P6.7 之前）没有片段，只能按连续性判断后尽力还原，见 splitLegacyEntry。
 */

import { todayInZone } from './time'

export interface DaySlice {
  date: string
  seconds: number
}

/** 一个活跃片段：真实发生的一段连续绘画时间。 */
export interface SegmentLike {
  startedAt: string
  endedAt: string
  seconds: number
}

/** 参与归属计算的工时记录（只用到这三个字段）。 */
export interface AttributableEntry {
  startedAt: string
  endedAt: string | null
  elapsedSeconds: number
}

/**
 * 老记录（没有片段）的连续性容差。
 * 墙钟跨度与实际累计之差在这个范围内，视为「整段都在活跃」，
 * 可以按墙钟占比安全拆分；超出则说明中间有空闲或暂停，分布不可知。
 */
export const LEGACY_CONTINUITY_TOLERANCE_SECONDS = 120

function localDayOf(ms: number, timeZone: string): string {
  return todayInZone(timeZone, ms)
}

/**
 * 找到 `ms` 之后「本地日发生变化」的第一个瞬间。
 *
 * 用二分查找而不是「本地 00:00 转 UTC」，因为：
 * - 某些时区在夏令时切换当天的本地 00:00 并不存在；
 * - 二分只依赖 todayInZone 的单调性，对任何时区都成立。
 */
function nextLocalDayBoundary(ms: number, limitMs: number, timeZone: string): number {
  const day = localDayOf(ms, timeZone)
  if (localDayOf(limitMs, timeZone) === day) return limitMs

  let lo = ms
  let hi = limitMs
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (localDayOf(mid, timeZone) === day) lo = mid
    else hi = mid
  }
  return hi
}

/**
 * 把一个连续片段按本地自然日拆分。
 *
 * 秒数按各日墙钟时长占比分配，余数全部给最后一天，
 * 因此返回值合计严格等于 `seconds`（不产生重复或丢失）。
 */
export function splitSegmentByLocalDay(
  startedAt: string,
  endedAt: string,
  seconds: number,
  timeZone: string
): DaySlice[] {
  const total = Math.max(0, Math.floor(seconds))
  const startMs = Date.parse(startedAt)
  const endMs = Date.parse(endedAt)

  if (total === 0) return []

  // 时间戳异常（例如只有开始时间）：保守地全部归到开始那一天
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    const fallback = Number.isFinite(startMs) ? startMs : Date.now()
    return [{ date: localDayOf(fallback, timeZone), seconds: total }]
  }

  const parts: Array<{ date: string; ms: number }> = []
  let cursor = startMs
  while (cursor < endMs) {
    const boundary = nextLocalDayBoundary(cursor, endMs, timeZone)
    parts.push({ date: localDayOf(cursor, timeZone), ms: boundary - cursor })
    cursor = boundary
  }

  if (parts.length === 0) {
    return [{ date: localDayOf(startMs, timeZone), seconds: total }]
  }
  if (parts.length === 1) {
    return [{ date: (parts[0] as { date: string }).date, seconds: total }]
  }

  const totalMs = endMs - startMs
  const slices: DaySlice[] = []
  let assigned = 0

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index] as { date: string; ms: number }
    const isLast = index === parts.length - 1
    // 非最后一天向下取整，保证余数非负；最后一天拿走全部余数
    const value = isLast ? total - assigned : Math.floor((total * part.ms) / totalMs)
    assigned += value
    if (value > 0) slices.push({ date: part.date, seconds: value })
  }

  return slices
}

/**
 * 老记录（没有片段）的还原规则。
 *
 * - 墙钟跨度与实际累计基本一致 → 说明整段连续活跃，按墙钟占比拆分（可信）；
 * - 否则中间存在暂停或空闲，活跃时间在会话内的位置不可知。
 *   此时**不伪造**精确的每日分布，全部归到会话开始日，并在交付报告中列为限制。
 */
function splitLegacyEntry(
  entry: AttributableEntry,
  elapsed: number,
  timeZone: string,
  toleranceSeconds: number
): DaySlice[] {
  if (elapsed <= 0) return []

  const startMs = Date.parse(entry.startedAt)
  if (!Number.isFinite(startMs)) {
    return [{ date: localDayOf(Date.now(), timeZone), seconds: elapsed }]
  }

  const endMs = entry.endedAt ? Date.parse(entry.endedAt) : startMs
  const wallSeconds = Number.isFinite(endMs) ? Math.round((endMs - startMs) / 1000) : 0

  const continuous =
    wallSeconds > 0 && Math.abs(wallSeconds - elapsed) <= toleranceSeconds

  if (!continuous || !entry.endedAt) {
    return [{ date: localDayOf(startMs, timeZone), seconds: elapsed }]
  }

  return splitSegmentByLocalDay(entry.startedAt, entry.endedAt, elapsed, timeZone)
}

/**
 * 把一条工时记录归属到本地自然日。
 *
 * 合计严格等于 elapsedSeconds：
 * - 有片段时按片段拆分；
 * - 片段未覆盖全部累计（例如重启恢复前那段没有片段）时，余量归到会话开始日；
 * - 完全没有片段时走老记录规则。
 */
export function attributeEntryToDays(
  entry: AttributableEntry,
  segments: readonly SegmentLike[],
  timeZone: string,
  options: { toleranceSeconds?: number } = {}
): DaySlice[] {
  const tolerance = options.toleranceSeconds ?? LEGACY_CONTINUITY_TOLERANCE_SECONDS
  const elapsed = Math.max(0, Math.floor(entry.elapsedSeconds))

  if (segments.length === 0) {
    return splitLegacyEntry(entry, elapsed, timeZone, tolerance)
  }

  const slices: DaySlice[] = []
  let covered = 0

  for (const segment of segments) {
    const value = Math.max(0, Math.floor(segment.seconds))
    covered += value
    slices.push(...splitSegmentByLocalDay(segment.startedAt, segment.endedAt, value, timeZone))
  }

  const remainder = elapsed - covered
  if (remainder > 0) {
    const startMs = Date.parse(entry.startedAt)
    const fallbackMs = Number.isFinite(startMs) ? startMs : Date.now()
    slices.push({ date: localDayOf(fallbackMs, timeZone), seconds: remainder })
  }

  return slices
}

/** 把同一天的多个片段合并成「日期 → 秒数」的映射（同一天求和）。 */
export function mergeDaySlices(slices: readonly DaySlice[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const slice of slices) {
    if (slice.seconds <= 0) continue
    totals.set(slice.date, (totals.get(slice.date) ?? 0) + slice.seconds)
  }
  return totals
}
