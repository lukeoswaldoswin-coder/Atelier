import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/contracts'
import { APP_KEY_LABELS } from '@shared/activity-apps'
import { formatClock, formatDuration } from '@shared/time-entries'
import { resolveSystemTimeZone, todayInZone } from '@shared/time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useLiveElapsedSeconds } from '@/data/time-polling'
import { useTimeSummary } from '@/data/time-entries'
import { getAppInfo } from '@/lib/ipc'
import { dayRangeIso, weekRangeIso } from '@/lib/time-range'
import { useNavigationStore } from '@/stores/navigation-store'
import { useTimeStore } from '@/stores/time-store'

type InfoState =
  | { status: 'loading' }
  | { status: 'ready'; info: AppInfo }
  | { status: 'error'; message: string }

const PLATFORM_LABELS: Record<string, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux'
}

function formatPlatform(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform
}

export function DashboardPage() {
  const [state, setState] = useState<InfoState>({ status: 'loading' })
  const setActive = useNavigationStore((store) => store.setActive)

  const timeZone = resolveSystemTimeZone()
  const today = todayInZone(timeZone)
  const version = useTimeStore((store) => store.actionVersion)
  const timeStatus = useTimeStore((store) => store.status)
  const elapsed = useLiveElapsedSeconds()

  const todayRange = dayRangeIso(today, timeZone)
  const weekRange = weekRangeIso(today, timeZone)
  const todaySummary = useTimeSummary(todayRange.from, todayRange.to, version)
  const weekSummary = useTimeSummary(weekRange.from, weekRange.to, version)

  useEffect(() => {
    let cancelled = false
    getAppInfo()
      .then((info) => {
        if (!cancelled) setState({ status: 'ready', info })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error ? error.message : String(error)
        setState({ status: 'error', message })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const manual = timeStatus?.manual ?? null
  const auto = timeStatus?.auto ?? null

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>今日实际工时</CardTitle>
            <CardDescription>按已完成的手动与自动工时记录统计</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums" data-testid="today-total">
              {todaySummary ? formatDuration(todaySummary.totalSeconds) : '读取中…'}
            </p>
            {todaySummary && todaySummary.unassignedSeconds > 0 ? (
              <p className="mt-1 text-[11px] text-warning">
                其中 {formatDuration(todaySummary.unassignedSeconds)} 未分配
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>本周实际工时</CardTitle>
            <CardDescription>周一到周日</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tabular-nums" data-testid="week-total">
              {weekSummary ? formatDuration(weekSummary.totalSeconds) : '读取中…'}
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-[11px] text-muted-foreground">
              {(weekSummary?.byDay ?? []).slice(-7).map((day) => (
                <li key={day.date} className="flex justify-between gap-4">
                  <span>{day.date}</span>
                  <span className="tabular-nums">{formatDuration(day.seconds)}</span>
                </li>
              ))}
              {weekSummary && weekSummary.byDay.length === 0 ? <li>本周还没有记录</li> : null}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>当前计时</CardTitle>
          <CardDescription>手动计时优先；没有手动计时时显示自动监测状态</CardDescription>
        </CardHeader>
        <CardContent>
          {manual ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant={manual.entry.status === 'running' ? 'default' : 'muted'}>
                {manual.entry.status === 'running' ? '计时中' : '已暂停'}
              </Badge>
              <span className="text-foreground">{manual.task?.title ?? '未知任务'}</span>
              <span className="tabular-nums text-muted-foreground">{formatClock(elapsed)}</span>
            </div>
          ) : auto ? (
            <p className="text-sm text-muted-foreground">
              自动记录中
              {auto.entry.appKey ? ` · ${APP_KEY_LABELS[auto.entry.appKey] ?? auto.entry.appKey}` : ''}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">没有正在进行的计时</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>未分配工时</CardTitle>
          <CardDescription>自动记录不会猜测任务归属，需要你手动指定</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <p className="text-sm text-foreground" data-testid="unassigned-today">
            {todaySummary ? formatDuration(todaySummary.unassignedSeconds) : '读取中…'}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => setActive('time')}>
            去工时记录
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>运行环境</CardTitle>
          <CardDescription>版本信息由主进程通过 IPC 返回</CardDescription>
        </CardHeader>
        <CardContent>{renderInfo(state)}</CardContent>
      </Card>
    </div>
  )
}

function renderInfo(state: InfoState) {
  if (state.status === 'loading') {
    return <p className="text-xs text-muted-foreground">正在读取运行环境…</p>
  }

  if (state.status === 'error') {
    return (
      <p role="alert" className="text-xs text-destructive">
        读取运行环境失败：{state.message}
      </p>
    )
  }

  const rows: Array<[string, string]> = [
    ['应用版本', state.info.version],
    ['Electron', state.info.electron],
    ['Chromium', state.info.chrome],
    ['Node.js', state.info.node],
    ['平台', `${formatPlatform(state.info.platform)} (${state.info.arch})`],
    ['运行模式', state.info.isDev ? '开发模式' : '打包模式']
  ]

  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2 text-xs" data-testid="app-info">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-mono text-foreground/90">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
