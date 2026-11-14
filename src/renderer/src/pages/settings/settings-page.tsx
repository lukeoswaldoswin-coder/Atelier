import { useEffect, useState } from 'react'
import { APP_KEY_LABELS, SUPPORTED_APPS } from '@shared/activity-apps'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useMonitor } from '@/data/monitor'

export function SettingsPage() {
  const monitor = useMonitor()
  const [idleDraft, setIdleDraft] = useState('3')
  const [idleError, setIdleError] = useState<string | null>(null)

  useEffect(() => {
    if (monitor.status) setIdleDraft(String(monitor.status.idleMinutes))
  }, [monitor.status?.idleMinutes])

  const status = monitor.status

  function saveIdle(): void {
    const value = Number(idleDraft)
    if (!Number.isInteger(value) || value < 1 || value > 120) {
      setIdleError('空闲阈值需为 1–120 的整数分钟')
      return
    }
    setIdleError(null)
    void monitor.setIdleMinutes(value)
  }

  return (
    <div className="flex flex-col gap-4" data-testid="settings-page">
      <Card>
        <CardHeader>
          <CardTitle>自动监测</CardTitle>
          <CardDescription>
            在受支持的绘画软件处于前台且你正在操作时自动记录工时。默认关闭，开启后才会读取前台进程名与空闲时间。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm text-foreground">启用自动监测</p>
              <p className="text-[11px] text-muted-foreground">
                {status?.platformSupported === false
                  ? '当前系统不支持自动监测（仅 Windows）'
                  : status?.enabled
                    ? '监测运行中'
                    : '已关闭，仅手动计时'}
              </p>
            </div>
            <Switch
              id="monitor-enabled"
              aria-label="启用自动监测"
              checked={status?.enabled ?? false}
              disabled={!status?.platformSupported || monitor.busy}
              onCheckedChange={(checked) => void monitor.setEnabled(checked)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>支持的绘画软件</Label>
            <div className="grid grid-cols-2 gap-2">
              {SUPPORTED_APPS.map((app) => {
                const checked = status?.apps.includes(app.key) ?? false
                return (
                  <label
                    key={app.key}
                    className="flex items-center gap-2 rounded-md border border-border/60 px-2 py-1.5 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={monitor.busy}
                      aria-label={`启用 ${app.label}`}
                      onChange={() => {
                        const current = status?.apps ?? []
                        const next = checked
                          ? current.filter((key) => key !== app.key)
                          : [...current, app.key]
                        void monitor.setApps(next)
                      }}
                    />
                    {app.label}
                  </label>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="idle-minutes">空闲阈值（分钟）</Label>
            <div className="flex items-center gap-2">
              <Input
                id="idle-minutes"
                aria-label="空闲阈值（分钟）"
                value={idleDraft}
                onChange={(event) => setIdleDraft(event.target.value)}
                className="w-24"
                inputMode="numeric"
              />
              <Button type="button" variant="outline" size="sm" onClick={saveIdle}>
                保存
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              连续无键盘/鼠标输入达到该时长后暂停自动累计，默认 3 分钟。
            </p>
            {idleError ? (
              <p role="alert" className="text-xs text-destructive">
                {idleError}
              </p>
            ) : null}
          </div>

          {status?.activeAppKey ? (
            <p className="text-[11px] text-muted-foreground" data-testid="monitor-active">
              当前前台：{APP_KEY_LABELS[status.activeAppKey] ?? status.activeAppKey}
              {status.idleSeconds !== null ? ` · 空闲 ${status.idleSeconds} 秒` : ''}
            </p>
          ) : null}

          {monitor.error ? (
            <p role="alert" className="text-xs text-destructive">
              {monitor.error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>隐私说明</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-1.5 text-[11px] text-muted-foreground">
            <li>· 仅读取前台进程的可执行文件名和系统空闲时间。</li>
            <li>· 不读取窗口标题、文件路径、绘画内容，不截屏。</li>
            <li>· 不记录键盘输入内容或鼠标轨迹，不上传任何数据。</li>
            <li>· 自动产生的是未分配工时，需要你手动归属到具体任务。</li>
            <li>· 自动记录只作为参考，不能保证完全等同于真实绘画时间。</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
