import type { ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Button } from './button'

interface SheetProps {
  title: string
  description?: string
  /** 任何关闭意图（Esc、遮罩、关闭按钮）都会走这里，由调用方决定是否真的关闭 */
  onRequestClose: () => void
  footer?: ReactNode
  children: ReactNode
}

/**
 * 右侧滑出面板。
 *
 * 使用 Radix Dialog 提供焦点陷阱、Esc、遮罩与无障碍语义，
 * 但视觉上固定为右侧 420px 面板（窄屏铺满），不是居中弹窗。
 */
export function Sheet({ title, description, onRequestClose, footer, children }: SheetProps) {
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) onRequestClose()
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 right-0 z-50 flex h-full w-[420px] flex-col border-l border-border bg-card text-card-foreground outline-none max-[1099px]:w-full"
          data-testid="sheet"
        >
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-sm font-semibold">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="truncate text-[11px] text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="关闭面板">
                <X className="size-4" aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer ? (
            <footer className="shrink-0 border-t border-border px-5 py-3">{footer}</footer>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
