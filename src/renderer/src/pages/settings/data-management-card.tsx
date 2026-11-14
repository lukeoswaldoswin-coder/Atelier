import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBytes, useDataManagement } from '@/data/data-management'

/** 设置页的数据备份入口；恢复与导出在 P6.2/P6.3 接入。 */
export function DataManagementCard() {
  const data = useDataManagement()
  const info = data.info

  return (
    <Card>
      <CardHeader>
        <CardTitle>数据备份</CardTitle>
        <CardDescription>
          创建完整数据库备份。备份是可恢复的单文件数据库，与 CSV 导出不同。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-[11px]">
          <dt className="text-muted-foreground">数据库</dt>
          <dd className="break-all font-mono text-foreground/90" data-testid="data-db-path">
            {info?.dbPath ?? '读取中…'}
          </dd>
          <dt className="text-muted-foreground">备份目录</dt>
          <dd className="break-all font-mono text-foreground/90" data-testid="data-backup-dir">
            {info?.backupDir ?? '读取中…'}
          </dd>
          <dt className="text-muted-foreground">数据库版本</dt>
          <dd className="text-foreground/90">{info?.schemaVersion ?? '—'}</dd>
          <dt className="text-muted-foreground">已有备份</dt>
          <dd className="text-foreground/90">
            {info ? `${info.backupCount} 个 · ${formatBytes(info.dbSizeBytes)}` : '—'}
          </dd>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={data.busy} onClick={() => void data.createBackup()}>
            {data.busy ? '备份中…' : '立即备份'}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void data.reveal()}>
            打开备份文件夹
          </Button>
        </div>

        {data.message ? (
          <p role="status" className="break-all rounded-md border border-success/30 bg-success/5 px-2 py-1.5 text-[11px] text-success" data-testid="backup-message">
            {data.message}
          </p>
        ) : null}

        {data.error ? (
          <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
            {data.error}
          </p>
        ) : null}

        {data.lastBackup ? (
          <p className="break-all text-[10px] text-muted-foreground" data-testid="last-backup">
            最近备份：{data.lastBackup.fileName}（{formatBytes(data.lastBackup.sizeBytes)}）
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
