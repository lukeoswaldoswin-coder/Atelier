import { app, BrowserWindow, dialog, ipcMain, session } from 'electron'
import { join } from 'node:path'
import { buildAppInfo } from './app-info'
import { createDatabaseService, type DatabaseService } from './db/service'
import { createIpcHandlers } from './ipc/handlers'
import { registerIpcHandlers } from './ipc/register'
import { createSenderGuard, getRendererAllowedEntries } from './security'
import { createTimeService, type TimeService } from './time/time-service'
import { createMainWindow } from './window'

/** 冒烟模式：启动窗口、等页面加载完成后自动退出，用于在命令行里验证应用能否真正运行。 */
const isSmokeTest = process.env['ATELIER_SMOKE_TEST'] === '1'
const SMOKE_TIMEOUT_MS = 20_000

/**
 * 允许通过环境变量指定数据目录（自动化测试、便携模式使用）。
 * 必须在 app ready 之前设置，否则 Electron 已经按默认路径初始化完毕。
 * 正常双击启动时该变量不存在，数据仍保存在默认的用户数据目录。
 */
const userDataOverride = process.env['ATELIER_USER_DATA_DIR']
if (userDataOverride && userDataOverride.trim().length > 0) {
  app.setPath('userData', userDataOverride)
}

app.setAppUserModelId('com.atelier.desktop')

/** 数据库只存在于主进程，渲染进程没有任何直接访问入口。 */
let database: DatabaseService | null = null
/** 计时状态唯一持有者（主进程） */
let timeService: TimeService | null = null
let timeTicker: ReturnType<typeof setInterval> | null = null

function getDatabaseFilePath(): string {
  return join(app.getPath('userData'), 'atelier.db')
}

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

function finishSmoke(exitCode: number): void {
  process.exitCode = exitCode
  // 使用 quit 而不是 exit，确保 will-quit 中的数据库关闭逻辑被执行。
  app.quit()
}

function runSmokeCheck(win: BrowserWindow): void {
  const timeout = setTimeout(() => {
    console.error('SMOKE_FAIL timeout: 页面在限定时间内没有加载完成')
    finishSmoke(1)
  }, SMOKE_TIMEOUT_MS)
  timeout.unref()

  win.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      clearTimeout(timeout)
      console.log('SMOKE_OK')
      finishSmoke(0)
    }, 500)
  })

  win.webContents.once('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame) return
    clearTimeout(timeout)
    console.error(`SMOKE_FAIL did-fail-load ${errorCode} ${errorDescription}`)
    finishSmoke(1)
  })

  win.webContents.once('render-process-gone', (_event, details) => {
    clearTimeout(timeout)
    console.error(`SMOKE_FAIL render-process-gone ${details.reason}`)
    finishSmoke(1)
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

    try {
      database = createDatabaseService(getDatabaseFilePath())
      timeService = createTimeService(database.timeEntries)
      console.log(`[atelier] 数据库文件: ${database.filePath}`)
      console.log(
        `[atelier] 数据库迁移: 本次应用 ${database.migration.applied.length} 个，已存在 ${database.migration.previouslyApplied.length} 个`
      )
    } catch (error) {
      console.error('[atelier] 数据库初始化失败:', error)
      dialog.showErrorBox(
        'Atelier 启动失败',
        `无法打开本地数据库：\n${database === null ? getDatabaseFilePath() : ''}\n\n${String(error)}`
      )
      app.quit()
      return
    }

    registerIpcHandlers(
      ipcMain,
      createIpcHandlers({
        getAppInfo,
        clients: database.clients,
        commissions: database.commissions,
        tasks: database.tasks,
        time: timeService as TimeService
      }),
      { isAllowedSender: createSenderGuard(getRendererAllowedEntries()) }
    )

    // 每秒检查一次计时（24 小时上限、30 秒检查点）
    timeTicker = setInterval(() => timeService?.tick(), 1000)
    timeTicker.unref?.()

    const win = createMainWindow()
    if (isSmokeTest) runSmokeCheck(win)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('will-quit', () => {
    if (timeTicker) clearInterval(timeTicker)
    timeTicker = null
    timeService = null
    database?.close()
    database = null
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
