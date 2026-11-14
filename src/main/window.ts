import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { createSenderGuard, getRendererAllowedEntries, hardenWebContents } from './security'
import { computeWindowSize } from './window-size'

/** 与渲染层深色主题的 --background 保持一致，避免启动瞬间闪白。 */
const WINDOW_BACKGROUND = '#0d0d10'

/**
 * 创建主窗口。
 *
 * 安全基线（与 package.json / 契约共同构成 P0 的安全架构）：
 * - nodeIntegration: false —— 渲染进程拿不到 Node API；
 * - contextIsolation: true —— 页面脚本与 preload 运行在隔离的上下文；
 * - sandbox: true —— 渲染进程运行在 Chromium 沙箱中；
 * - 只通过 preload 暴露的白名单 API 与主进程通信。
 */
export function createMainWindow(): BrowserWindow {
  const { width: areaWidth, height: areaHeight } = screen.getPrimaryDisplay().workAreaSize
  const size = computeWindowSize(areaWidth, areaHeight)
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    center: true,
    show: false,
    title: 'Atelier 画师工坊',
    backgroundColor: WINDOW_BACKGROUND,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  })

  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => {
    win.show()
  })

  hardenWebContents(win.webContents, createSenderGuard(getRendererAllowedEntries()))

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl && devUrl.length > 0) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}
