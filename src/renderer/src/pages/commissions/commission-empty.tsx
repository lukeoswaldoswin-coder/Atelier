import { AlertCircle, ClipboardList } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

/** 数据库里还没有任何委托。 */
export function CommissionEmptyState() {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-border/70 px-6 py-16 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ClipboardList className="size-5" aria-hidden="true" />
      </span>
      <h2 className="text-sm font-medium">还没有委托</h2>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
        创建第一个委托后，这里会显示交稿时间与收款情况。
      </p>
    </div>
  )
}

/** 有数据但被筛选条件全部过滤掉（筛选界面在 P1.2.5 接入，这里先如实区分两种情况）。 */
export function CommissionNoResultsState() {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center rounded-lg border border-dashed border-border/70 px-6 py-12 text-center">
      <h2 className="text-sm font-medium">没有符合条件的委托</h2>
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
        试着调整筛选条件或搜索关键词。
      </p>
    </div>
  )
}

/** IPC 读取失败：展示真实错误信息，并提供重试。 */
export function CommissionErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex min-h-[240px] flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-12 text-center"
    >
      <AlertCircle className="size-5 text-destructive" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium">无法读取委托列表</p>
        <p className="mt-1 max-w-md break-words text-xs leading-relaxed text-muted-foreground">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        重试
      </Button>
    </div>
  )
}

/** 加载骨架：用与真实行相同的列宽，避免加载完成后跳动。 */
export function CommissionSkeletonList() {
  return (
    <div data-testid="commission-loading" aria-busy="true" aria-label="正在加载委托">
      <div className="grid grid-cols-[minmax(0,1fr)_92px_128px_190px] gap-3 border-b border-border/70 px-4 py-2">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-3 w-12" />
        ))}
      </div>
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div
          key={index}
          className="grid grid-cols-[minmax(0,1fr)_92px_128px_190px] items-center gap-3 border-b border-border/50 px-4 py-3"
        >
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-2.5 w-1/3" />
          </div>
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-3 w-20" />
          <div className="space-y-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-2.5 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}
