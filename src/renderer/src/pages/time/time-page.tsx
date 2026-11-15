import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { TimeEntryView, TimeListFilter } from '@shared/domain'
import { APP_KEY_LABELS } from '@shared/activity-apps'
import { formatDuration } from '@shared/time-entries'
import { formatDateTimeInZone, resolveSystemTimeZone, todayInZone, zonedDateTimeToUtc } from '@shared/time'
import { addDays, startOfWeek } from '@/lib/calendar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Segmented } from '@/components/ui/segmented'
import { useAssignableTasks } from '@/data/assignable-tasks'
import { removeTimeEntry, mergeTimeEntries } from '@/data/time-actions'
import { useTimeEntries, useTimeSummary } from '@/data/time-entries'
import { formatIpcError } from '@/lib/ipc-error'
import { cn } from '@/lib/utils'
import { TimeEntrySheet } from './time-entry-sheet'

const FILTER_OPTIONS = [
  { value: 'all' as const, label: '全部' },
  { value: 'unassigned' as const, label: '未分配' }
]

function dayStartIso(date: string, timeZone: string): string {
  const conversion = zonedDateTimeToUtc({ date, time: '00:00', timeZone })
  if (!conversion.ok) throw new Error('日期无效')
  return conversion.utc
}

function timeOfDay(iso: string, timeZone: string): string {
  return formatDateTimeInZone(iso, timeZone).slice(11, 16)
}

/** 框选矩形的最小拖动距离，低于该值视为普通点击，不改动选择。 */
const MARQUEE_THRESHOLD_PX = 4

interface ClientBox {
  left: number
  top: number
  right: number
  bottom: number
}

function boxFromPoints(ax: number, ay: number, bx: number, by: number): ClientBox {
  return {
    left: Math.min(ax, bx),
    top: Math.min(ay, by),
    right: Math.max(ax, bx),
    bottom: Math.max(ay, by)
  }
}

function intersects(a: ClientBox, b: ClientBox): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
}

interface TimePageProps {
  /** 测试用：固定“今天” */
  today?: string
}

/** 这些元素保持原有行为，不触发框选。 */
const INTERACTIVE_SELECTOR = [
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'label',
  '[role="button"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[contenteditable="true"]'
].join(',')

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return target.closest(INTERACTIVE_SELECTOR) !== null
}

export function TimePage({ today: todayProp }: TimePageProps = {}) {
  const timeZone = useMemo(() => resolveSystemTimeZone(), [])
  const today = useMemo(() => todayProp ?? todayInZone(resolveSystemTimeZone()), [todayProp])

  const [fromDate, setFromDate] = useState(today)
  const [toDate, setToDate] = useState(today)
  const [filter, setFilter] = useState<TimeListFilter>('all')
  const [version, setVersion] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<TimeEntryView | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TimeEntryView | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<ClientBox | null>(null)
  const [dragging, setDragging] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)
  /** 拖动起点（客户端坐标）；为 null 表示当前没有进行中的框选。 */
  const dragStart = useRef<{ x: number; y: number } | null>(null)

  const fromIso = useMemo(() => dayStartIso(fromDate, timeZone), [fromDate, timeZone])
  const toIso = useMemo(() => dayStartIso(addDays(toDate, 1), timeZone), [toDate, timeZone])

  const entries = useTimeEntries(fromIso, toIso, filter, version)
  const summary = useTimeSummary(fromIso, toIso, version)
  const { tasks } = useAssignableTasks()

  const bump = (): void => setVersion((value) => value + 1)

  const groups = useMemo(() => {
    const map = new Map<string, TimeEntryView[]>()
    for (const entry of entries.rows) {
      const date = todayInZone(timeZone, new Date(entry.entry.startedAt))
      const list = map.get(date) ?? []
      list.push(entry)
      map.set(date, list)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [entries.rows, timeZone])

  const selectedEntries = entries.rows.filter((entry) => selected.has(entry.entry.id))
  const unassignedIds = useMemo(
    () =>
      entries.rows
        .filter((entry) => entry.entry.taskId === null)
        .map((entry) => entry.entry.id),
    [entries.rows]
  )
  const canMerge =
    selectedEntries.length >= 2 &&
    selectedEntries.every(
      (entry) =>
        entry.entry.taskId === selectedEntries[0]?.entry.taskId &&
        entry.entry.source === selectedEntries[0]?.entry.source &&
        (entry.entry.source !== 'auto' || entry.entry.appKey === selectedEntries[0]?.entry.appKey)
    )

  // 查询结果变化（日期范围、筛选、增删改）后，丢弃已不在当前结果里的选择。
  useEffect(() => {
    const visible = new Set(entries.rows.map((entry) => entry.entry.id))
    setSelected((previous) => {
      const next = new Set([...previous].filter((id) => visible.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [entries.rows])

  /** 一键全选当前查询范围内的未分配记录。 */
  function selectUnassigned(): void {
    setSelected(new Set(unassignedIds))
  }

  function toggleSelected(id: string): void {
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** 按框选矩形更新选择：只收未分配记录，并整体替换本次框选结果。 */
  function applyMarquee(box: ClientBox): void {
    const container = listRef.current
    if (!container) return
    const next = new Set<string>()
    const rows = container.querySelectorAll<HTMLElement>('[data-entry-id]')
    for (const row of rows) {
      const id = row.dataset['entryId']
      if (!id) continue
      if (row.dataset['assigned'] === 'true') continue
      const rect = row.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      if (intersects(box, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom })) {
        next.add(id)
      }
    }
    setSelected(next)
  }

  async function deleteEntry(): Promise<void> {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    setActionError(null)
    try {
      await removeTimeEntry(target.entry.id)
      bump()
    } catch (caught) {
      setActionError(formatIpcError(caught))
    }
  }

  async function mergeSelected(): Promise<void> {
    if (!canMerge) {
      setActionError('只能合并同一任务、同一来源（自动记录还需同一软件）的记录')
      return
    }
    setActionError(null)
    try {
      await mergeTimeEntries({ ids: selectedEntries.map((entry) => entry.entry.id) })
      setSelected(new Set())
      bump()
    } catch (caught) {
      setActionError(formatIpcError(caught))
    }
  }

  function setPreset(preset: 'today' | 'week'): void {
    if (preset === 'today') {
      setFromDate(today)
      setToDate(today)
    } else {
      const start = startOfWeek(today)
      setFromDate(start)
      setToDate(addDays(start, 6))
    }
  }

  function clearMarquee(): void {
    dragStart.current = null
    setDragging(false)
    setMarquee(null)
  }

  function updateMarquee(x: number, y: number): void {
    const start = dragStart.current
    if (!start) return
    const box = boxFromPoints(start.x, start.y, x, y)
    if (box.right - box.left < MARQUEE_THRESHOLD_PX && box.bottom - box.top < MARQUEE_THRESHOLD_PX) {
      setMarquee(null)
      return
    }
    setMarquee(box)
    applyMarquee(box)
  }

  function startMarquee(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return
    if (isInteractiveTarget(event.target)) return
    event.preventDefault()
    dragStart.current = { x: event.clientX, y: event.clientY }
    setDragging(true)
  }

  // 拖动期间在 window 上监听，鼠标移出列表或快速移动也能正确收尾。
  useEffect(() => {
    if (!dragging) return
    const handleMove = (event: PointerEvent): void => {
      // 鼠标在窗口外松开时收不到 pointerup，这里按按键状态兜底结束。
      if (event.buttons === 0) {
        updateMarquee(event.clientX, event.clientY)
        clearMarquee()
        return
      }
      updateMarquee(event.clientX, event.clientY)
    }
    const handleUp = (event: PointerEvent): void => {
      updateMarquee(event.clientX, event.clientY)
      clearMarquee()
    }
    const handleCancel = (): void => {
      clearMarquee()
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
    window.addEventListener('blur', handleCancel)
    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
      window.removeEventListener('blur', handleCancel)
    }
  }, [dragging])

  return (
    <div className="flex flex-col gap-3" data-testid="time-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setPreset('today')}>
            今天
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setPreset('week')}>
            本周
          </Button>
          <Input
            type="date"
            aria-label="开始日期"
            value={fromDate}
            onChange={(event) => setFromDate(event.target.value)}
            className="h-8 w-36"
          />
          <span className="text-xs text-muted-foreground">–</span>
          <Input
            type="date"
            aria-label="结束日期"
            value={toDate}
            onChange={(event) => setToDate(event.target.value)}
            className="h-8 w-36"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={unassignedIds.length === 0}
            onClick={selectUnassigned}
          >
            全选未分配
          </Button>
          <span className="text-xs text-muted-foreground" data-testid="time-total">
            {summary ? `实际 ${formatDuration(summary.totalSeconds)}` : '统计中…'}
          </span>
          <Segmented ariaLabel="工时筛选" value={filter} options={FILTER_OPTIONS} onChange={setFilter} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={selectedEntries.length < 2}
            onClick={() => void mergeSelected()}
          >
            合并{selectedEntries.length > 0 ? `（${selectedEntries.length}）` : ''}
          </Button>
        </div>
      </div>

      {summary && summary.unassignedSeconds > 0 ? (
        <p className="text-[11px] text-warning" data-testid="unassigned-total">
          有 {formatDuration(summary.unassignedSeconds)} 未分配工时，可点击「归属」指定任务。
        </p>
      ) : null}

      {actionError ? (
        <p role="alert" className="text-xs text-destructive">
          {actionError}
        </p>
      ) : null}

      {entries.status === 'error' ? (
        <p role="alert" className="text-xs text-destructive">
          {entries.error}
        </p>
      ) : null}

      {entries.status === 'loading' && entries.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">正在读取工时…</p>
      ) : null}

      {entries.status === 'ready' && entries.rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/70 px-4 py-10 text-center text-xs text-muted-foreground">
          这个时间段还没有工时记录。
        </p>
      ) : null}

      {groups.length > 0 ? (
        <div
          ref={listRef}
          data-testid="time-list"
          onPointerDown={startMarquee}
          className={cn('flex flex-col gap-3', dragging && 'cursor-crosshair select-none')}
        >
          {groups.map(([date, rows]) => (
            <section key={date} className="flex flex-col gap-1">
              <h2 className="text-xs font-medium text-muted-foreground">{date}</h2>
              <div className="flex flex-col gap-1">
                {rows.map((entry) => {
                  const isAuto = entry.entry.source === 'auto'
                  const assigned = entry.entry.taskId !== null
                  return (
                    <div
                      key={entry.entry.id}
                      data-testid="time-entry"
                      data-entry-id={entry.entry.id}
                      data-assigned={assigned ? 'true' : 'false'}
                      className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 size-3.5"
                        aria-label="选择工时记录"
                        checked={selected.has(entry.entry.id)}
                        onChange={() => toggleSelected(entry.entry.id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="tabular-nums text-foreground">
                            {timeOfDay(entry.entry.startedAt, timeZone)} –{' '}
                            {entry.entry.endedAt ? timeOfDay(entry.entry.endedAt, timeZone) : '—'}
                          </span>
                          <span className="font-medium text-foreground">
                            {formatDuration(entry.entry.elapsedSeconds)}
                          </span>
                          <Badge variant={isAuto ? 'outline' : 'muted'}>
                            {isAuto ? '自动' : '手动'}
                          </Badge>
                          {isAuto && entry.entry.appKey ? (
                            <span className="text-[10px] text-muted-foreground">
                              {APP_KEY_LABELS[entry.entry.appKey] ?? entry.entry.appKey}
                            </span>
                          ) : null}
                        </div>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {entry.task
                            ? `${entry.commission?.title ?? '未知委托'} · ${entry.task.title}`
                            : '未分配'}
                        </p>
                        {entry.entry.note ? (
                          <p className="truncate text-[10px] text-muted-foreground">
                            {entry.entry.note}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => setEditing(entry)}
                        >
                          {entry.entry.taskId ? '编辑' : '归属'}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[11px] text-destructive"
                          onClick={() => setDeleteTarget(entry)}
                        >
                          删除
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}

          {marquee ? (
            <div
              data-testid="marquee-box"
              aria-hidden="true"
              className="pointer-events-none fixed z-50 rounded-sm border border-primary/70 bg-primary/15"
              style={{
                left: marquee.left,
                top: marquee.top,
                width: marquee.right - marquee.left,
                height: marquee.bottom - marquee.top
              }}
            />
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <TimeEntrySheet
          entry={editing}
          tasks={tasks}
          onClose={() => setEditing(null)}
          onSaved={bump}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除这条工时记录？"
        description="删除后不计入统计；记录会以软删除方式保留在数据库中。"
        confirmLabel="删除"
        destructive
        onConfirm={() => void deleteEntry()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
