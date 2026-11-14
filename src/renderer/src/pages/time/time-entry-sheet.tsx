import { useState } from 'react'
import type { AssignableTask, TimeEntryView } from '@shared/domain'
import { resolveSystemTimeZone, zonedDateTimeToUtc } from '@shared/time'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { updateTimeEntry } from '@/data/time-actions'
import { formatIpcError } from '@/lib/ipc-error'
import { formatDateTimeInZone } from '@shared/time'
import { formatDuration } from '@shared/time-entries'

interface TimeEntrySheetProps {
  entry: TimeEntryView
  tasks: AssignableTask[]
  onClose: () => void
  onSaved: () => void
}

function toLocalInput(iso: string, timeZone: string): string {
  return formatDateTimeInZone(iso, timeZone).replace(' ', 'T')
}

/** 工时记录编辑：任务归属、起止时间、备注。 */
export function TimeEntrySheet({ entry, tasks, onClose, onSaved }: TimeEntrySheetProps) {
  const timeZone = resolveSystemTimeZone()
  const [taskId, setTaskId] = useState(entry.entry.taskId ?? '')
  const [startedText, setStartedText] = useState(toLocalInput(entry.entry.startedAt, timeZone))
  const [endedText, setEndedText] = useState(
    entry.entry.endedAt ? toLocalInput(entry.entry.endedAt, timeZone) : ''
  )
  const [note, setNote] = useState(entry.entry.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function toUtc(input: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) return null
    const conversion = zonedDateTimeToUtc({
      date: input.slice(0, 10),
      time: input.slice(11, 16),
      timeZone
    })
    return conversion.ok ? conversion.utc : null
  }

  async function save(): Promise<void> {
    const startedAt = toUtc(startedText)
    const endedAt = toUtc(endedText)
    if (!startedAt || !endedAt) {
      setError('请填写合法的开始与结束时间')
      return
    }
    if (Date.parse(endedAt) < Date.parse(startedAt)) {
      setError('结束时间不能早于开始时间')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await updateTimeEntry({
        id: entry.entry.id,
        taskId: taskId === '' ? null : taskId,
        note: note.trim() === '' ? null : note.trim(),
        startedAt,
        endedAt
      })
      onSaved()
      onClose()
    } catch (caught) {
      setError(formatIpcError(caught))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      title="编辑工时记录"
      description={`${entry.entry.source === 'auto' ? '自动记录' : '手动记录'} · ${formatDuration(entry.entry.elapsedSeconds)}`}
      onRequestClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entry-task">归属任务</Label>
          <select
            id="entry-task"
            aria-label="归属任务"
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">未分配</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.commissionTitle} · {task.title}
                {task.archivedAt ? '（已归档）' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="entry-start">开始时间</Label>
            <Input
              id="entry-start"
              type="datetime-local"
              value={startedText}
              onChange={(event) => setStartedText(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="entry-end">结束时间</Label>
            <Input
              id="entry-end"
              type="datetime-local"
              value={endedText}
              onChange={(event) => setEndedText(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="entry-note">备注</Label>
          <Textarea
            id="entry-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder="可选"
          />
        </div>

        <p className="text-[11px] text-muted-foreground">
          修改起止时间会按墙钟差重新计算持续时间；来源与应用标识不会被修改。
        </p>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
