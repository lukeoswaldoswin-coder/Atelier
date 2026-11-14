import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Button } from './button'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** 轻量确认框（归档、放弃修改等）。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = '取消',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/50" />
        <DialogPrimitive.Content
          className="fixed top-1/2 left-1/2 z-[70] w-[360px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 text-card-foreground outline-none"
          data-testid="confirm-dialog"
        >
          <DialogPrimitive.Title className="text-sm font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {description}
          </DialogPrimitive.Description>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              size="sm"
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? '处理中…' : confirmLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
