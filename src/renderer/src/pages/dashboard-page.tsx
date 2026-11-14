import { useEffect, useState } from 'react'
import type { AppInfo } from '@shared/contracts'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAppInfo } from '@/lib/ipc'

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

/**
 * 概览页。
 * P0 阶段没有任何业务数据，因此这里只展示真实可验证的内容：
 * 项目骨架的完成项，以及经 IPC 从主进程取回的运行时版本信息。
 */
export function DashboardPage() {
  const [state, setState] = useState<InfoState>({ status: 'loading' })

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

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>项目骨架已就绪</CardTitle>
            <Badge variant="success">P0</Badge>
          </div>
          <CardDescription>
            当前阶段只完成了应用外壳：Electron 安全架构、受控 IPC、界面框架与主题系统。委托、工作流、任务与排期都还没有实现。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-xs text-muted-foreground">
            <li>· 主进程 / preload / 渲染进程三层隔离，渲染进程无法直接访问数据库与文件系统。</li>
            <li>· 渲染进程只能通过 preload 暴露的白名单方法调用主进程。</li>
            <li>· 数据库尚未建立，P1 阶段将引入 SQLite、迁移机制与委托管理。</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>运行环境</CardTitle>
          <CardDescription>
            下面的版本信息由主进程通过 IPC 返回，用来验证安全通信链路是通的。
          </CardDescription>
        </CardHeader>
        <CardContent>{renderInfo(state)}</CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>还没有委托数据</CardTitle>
          <CardDescription>
            这里将显示进行中委托数量、近期交稿、今日绘画任务、待处理任务、延期风险与本周绘画工时。数据接入安排在 P1 阶段。
          </CardDescription>
        </CardHeader>
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
