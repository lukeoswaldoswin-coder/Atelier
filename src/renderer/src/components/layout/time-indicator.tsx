import { APP_KEY_LABELS } from '@shared/activity-apps'
import { formatClock } from '@shared/time-entries'
import { Pause, Play, Square, Timer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLiveElapsedSeconds } from '@/data/time-polling'
import { useTimeStore } from '@/stores/time-store'

const SMALL = 'h-7 px-2 text-[11px]'

/** 顶栏全局计时状态：手动计时优先，否则显示自动监测状态。 */
export function TimeIndicator() {
  const status = useTimeStore((state) => state.status)
  const busy = useTimeStore((state) => state.busy)
  const pause = useTimeStore((state) => state.pause)
  const resume = useTimeStore((state) => state.resume)
  const stop = useTimeStore((state) => state.stop)
  const elapsed = useLiveElapsedSeconds()

  const manual = status?.manual ?? null
  const notice = status?.notice

  if (!manual) {
    if (!status?.auto) return null
    const appKey = status.auto.entry.appKey
    return (
      <div
        data-testid="auto-indicator"
        className="flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground"
        title={notice ?? '根据绘画软件前台与空闲状态自动记录'}
      >
        <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
        自动记录中{appKey ? ` · ${APP_KEY_LABELS[appKey] ?? appKey}` : ''}
      </div>
    )
  }

  const running = manual.entry.status === 'running'

  return (
    <div
      data-testid="time-indicator"
      className="flex min-w-0 items-center gap-1.5 rounded-md border border-border/60 px-2 py-1"
      title={notice ?? '当前计时'}
    >
      <Timer className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
      <span className="max-w-40 truncate text-[11px] text-foreground">
        {manual.task?.title ?? '计时中'}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums" data-testid="time-indicator-elapsed">
        {formatClock(elapsed)}
      </span>
      {notice ? (
        <span className="size-1.5 shrink-0 rounded-full bg-warning" title={notice} aria-hidden="true" />
      ) : null}
      {running ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={SMALL}
          disabled={busy}
          onClick={() => void pause()}
        >
          <Pause className="size-3" aria-hidden="true" />
          暂停
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={SMALL}
          disabled={busy}
          onClick={() => void resume()}
        >
          <Play className="size-3" aria-hidden="true" />
          继续
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={SMALL}
        disabled={busy}
        onClick={() => void stop()}
      >
        <Square className="size-3" aria-hidden="true" />
        结束
      </Button>
    </div>
  )
}
