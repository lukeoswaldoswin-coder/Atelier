import { app, BrowserWindow, ipcMain, session } from 'electron'
import { buildAppInfo } from './app-info'
import { createIpcHandlers } from './ipc/handlers'
import { registerIpcHandlers } from './ipc/register'
import { createSenderGuard, getRendererAllowedEntries } from './security'
import { createMainWindow } from './window'

/** 冒烟模式：启动窗口、等页面加载完成后自动退出，用于在命令行里验证应用能否真正运行。 */
const isSmokeTest = process.env['ATELIER_SMOKE_TEST'] === '1'
const SMOKE_TIMEOUT_MS = 20_000

app.setAppUserModelId('com.atelier.desktop')

function getAppInfo() {
  return buildAppInfo({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    isDev: !app.isPackaged
  })
}

/** 拒绝一切权限申请（摄像头、通知、剪贴板等），本阶段不需要任何系统权限。 */
function applySessionHardening(): void {
  const defaultSession = session.defaultSession
  defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  defaultSession.setPermissionCheckHandler(() => false)
}

function runSmokeCheck(win: BrowserWindow): void {
  const timeout = setTimeout(() => {
    console.error('SMOKE_FAIL timeout: 页面在限定时间内没有加载完成')
    app.exit(1)
  }, SMOKE_TIMEOUT_MS)
  timeout.unref()

  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      clearTimeout(timeout)
      console.log('SMOKE_OK')
      app.exit(0)
    }, 500)
  })

  win.webContents.once('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame) return
    clearTimeout(timeout)
    console.error(`SMOKE_FAIL did-fail-load ${errorCode} ${errorDescription}`)
    app.exit(1)
  })

  win.webContents.once('render-process-gone', (_event, details) => {
    clearTimeout(timeout)
    console.error(`SMOKE_FAIL render-process-gone ${details.reason}`)
    app.exit(1)
  })
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const existing = BrowserWindow.getAllWindows()[0]
    if (existing) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
  })

  void app.whenReady().then(() => {
    applySessionHardening()

    registerIpcHandlers(ipcMain, createIpcHandlers({ getAppInfo }), {
      isAllowedSender: createSenderGuard(getRendererAllowedEntries())
    })

    const win = createMainWindow()
    if (isSmokeTest) runSmokeCheck(win)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
