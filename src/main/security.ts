import type { WebContents } from 'electron'

/**
 * 判断某个 frame 的 URL 是否是本应用自己的界面。
 *
 * 开发模式下渲染进程由 Vite 开发服务器提供（http://localhost:5173），
 * 打包后由本地 file:// 提供。仅比较 origin，避免 http://localhost:5173.evil.com
 * 这类前缀相同但实际不同的地址通过校验。
 */
export function createSenderGuard(entries: readonly string[]): (url: string | null | undefined) => boolean {
  const normalized = entries.map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0)

  return (url) => {
    if (typeof url !== 'string' || url.length === 0) return false
    const lower = url.toLowerCase()

    return normalized.some((entry) => {
      if (entry.startsWith('file://')) return lower.startsWith('file://')
      try {
        return new URL(lower).origin === new URL(entry).origin
      } catch {
        return false
      }
    })
  }
}

/** 当前运行模式下允许的渲染进程来源。 */
export function getRendererAllowedEntries(): string[] {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl && devUrl.length > 0) return [devUrl]
  return ['file://']
}

/**
 * 窗口级加固：
 * - 禁止渲染进程打开新窗口（包括 window.open 与 target=_blank）；
 * - 禁止页面被导航到应用之外的地址；
 * - 禁止挂载 webview。
 */
export function hardenWebContents(contents: WebContents, isInternalUrl: (url: string) => boolean): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))

  contents.on('will-navigate', (event, url) => {
    if (!isInternalUrl(url)) {
      event.preventDefault()
    }
  })

  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}
