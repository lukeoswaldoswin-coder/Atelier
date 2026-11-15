import { app, BrowserWindow, dialog, ipcMain, powerMonitor, session, shell } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createActivityMonitor, type ActivityMonitor } from './activity/activity-monitor'
import { createWin32Probe } from './activity/win32-probe'
import { buildAppInfo } from './app-info'
import { createBackupService } from './data/backup-service'
import { createDataController } from './data/controller'
import { createDataPaths } from './data/data-paths'
import { createRestoreService } from './data/restore-service'
import { quarantineOrphanSidecars, recoverRestoreState } from './data/startup-recovery'
import { createDatabaseService, type DatabaseService } from './db/service'
import { getAppliedMigrations } from './db/migrator'
import { createIpcHandlers } from './ipc/handlers'
import { registerIpcHandlers } from './ipc/register'
import { createSenderGuard, getRendererAllowedEntries } from './security'
import { createTimeService, type TimeService } from './time/time-service'
import { createAppTray, showMainWindow, type AppTray } from './tray'
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
} else {
  // 安装版与开发版统一使用 %APPDATA%\atelier，避免 productName 改变数据目录
  app.setPath('userData', join(app.getPath('appData'), 'atelier'))
}

app.setAppUserModelId('com.atelier.desktop')

/** 数据库只存在于主进程，渲染进程没有任何直接访问入口。 */
let database: DatabaseService | null = null
/** 计时状态唯一持有者（主进程） */
let timeService: TimeService | null = null
let timeTicker: ReturnType<typeof setInterval> | null = null
let activityMonitor: ActivityMonitor | null = null
let dataController: ReturnType<typeof createDataController> | null = null
/** 托盘图标；创建失败时保持 null，关闭窗口仍然是退出应用 */
let appTray: AppTray | null = null
/** 真正要退出的标志（托盘「退出」、系统关机、冒烟测试等），否则关窗只是隐藏 */
let isQuitting = false
/** 托盘提示只弹一次，避免每次关窗都打扰 */
let trayHintShown = false

/**
 * 安装托盘并接管「关闭窗口」。
 *
 * 画师经常一边画画一边让本工具在后台记工时，直接关掉窗口会连带停止计时，
 * 所以关闭操作改为收进托盘；要退出请用托盘菜单。
 */
function setupTray(win: BrowserWindow): void {
  appTray = createAppTray({
    win,
    iconPath: join(app.getAppPath(), 'build', 'icon.png'),
    onQuit: () => {
      isQuitting = true
      app.quit()
    }
  })

  if (!appTray) {
    console.warn('[atelier] 托盘图标不可用，关闭窗口将直接退出')
    return
  }
  console.log('[atelier] 系统托盘已启用，关闭窗口后计时继续运行')

  win.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    win.hide()
    if (!trayHintShown) {
      trayHintShown = true
      appTray?.notifyHidden()
    }
  })

  // Windows 关机/注销：必须放行关闭，否则关窗拦截会挡住系统关机
  win.on('session-end', () => {
    isQuitting = true
  })
}

function startTimeTicker(): void {
  if (timeTicker || !timeService) return
  timeTicker = setInterval(() => timeService?.tick(), 1000)
  timeTicker.unref?.()
}

function stopTimeTicker(): void {
  if (timeTicker) clearInterval(timeTicker)
  timeTicker = null
}

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
    if (existing) showMainWindow(existing)
  })

  void app.whenReady().then(() => {
    applySessionHardening()

    // 只读数据目录诊断：不打开数据库，用于安装版默认路径验证
    const dataInfoSmokeFile = process.env['ATELIER_DATAINFO_SMOKE_FILE']
    if (dataInfoSmokeFile) {
      writeFileSync(
        dataInfoSmokeFile,
        JSON.stringify(
          {
            name: app.getName(),
            version: app.getVersion(),
            packaged: app.isPackaged,
            appData: app.getPath('appData'),
            userData: app.getPath('userData'),
            dbPath: getDatabaseFilePath()
          },
          null,
          2
        ),
        'utf8'
      )
      app.quit()
      return
    }

    // 打包/开发环境原生模块诊断：只写结果文件，不打开窗口
    const probeSmokeFile = process.env['ATELIER_PROBE_SMOKE_FILE']
    if (probeSmokeFile) {
      try {
        const probe = createWin32Probe()
        const sample = probe.sample()
        probe.dispose()
        writeFileSync(
          probeSmokeFile,
          JSON.stringify({
            ok: true,
            platform: process.platform,
            processName: sample.processName,
            idleMs: sample.idleMs,
            electron: process.versions.electron
          }),
          'utf8'
        )
      } catch (error) {
        writeFileSync(
          probeSmokeFile,
          JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
          'utf8'
        )
      }
      app.quit()
      return
    }

    try {
      const dataPaths = createDataPaths(app.getPath('userData'))
      const recovery = recoverRestoreState(dataPaths)
      if (recovery.status === 'fatal') {
        dialog.showErrorBox('Atelier 数据恢复失败', recovery.message ?? '恢复现场无法安全处理')
        app.quit()
        return
      }
      if (recovery.message) console.warn(`[atelier] 启动恢复: ${recovery.message}`)
      quarantineOrphanSidecars(dataPaths)

      database = createDatabaseService(getDatabaseFilePath())
      timeService = createTimeService(database.timeEntries)
      activityMonitor = createActivityMonitor({
        timeEntries: database.timeEntries,
        settings: database.settings,
        timeService,
        createProbe: createWin32Probe
      })
      const backups = createBackupService({
        paths: dataPaths,
        getDb: () => database?.db ?? null
      })
      const restore = createRestoreService({
        paths: dataPaths,
        getDb: () => database?.db ?? null,
        timeService,
        monitor: activityMonitor,
        backups,
        stopTimeTicker,
        startTimeTicker,
        closeDatabase: () => {
          stopTimeTicker()
          database?.close()
          database = null
          timeService = null
        },
        relaunch: () => {
          app.relaunch()
          app.exit(0)
        },
        fatal: (message) => {
          dialog.showErrorBox('Atelier 数据恢复失败', message)
          app.exit(1)
        }
      })
      dataController = createDataController({
        paths: dataPaths,
        appVersion: app.getVersion(),
        getSchemaVersion: () => {
          if (!database) return null
          return getAppliedMigrations(database.db).at(-1)?.id ?? null
        },
        backups,
        restore,
        pickRestoreFile: async () => {
          const result = await dialog.showOpenDialog({
            title: '选择 Atelier 数据库备份',
            properties: ['openFile'],
            filters: [{ name: 'Atelier 数据库备份', extensions: ['db'] }]
          })
          if (result.canceled || result.filePaths.length === 0) return null
          return result.filePaths[0] ?? null
        },
        pickExportDirectory: async () => {
          const result = await dialog.showOpenDialog({
            title: '选择数据导出位置',
            defaultPath: app.getPath('documents'),
            properties: ['openDirectory', 'createDirectory']
          })
          if (result.canceled || result.filePaths.length === 0) return null
          return result.filePaths[0] ?? null
        },
        revealPath: (path) => shell.showItemInFolder(path),
        openDirectory: (path) => {
          void shell.openPath(path)
        }
      })
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
        time: timeService as TimeService,
        monitor: activityMonitor as ActivityMonitor,
        data: dataController,
        onTaskSessionChanged: () => activityMonitor?.refreshTimer()
      }),
      { isAllowedSender: createSenderGuard(getRendererAllowedEntries()) }
    )

    // 每秒检查一次计时（24 小时上限、30 秒检查点）
    startTimeTicker()

    // 自动监测按设置启动（默认关闭，不会加载原生探测）
    activityMonitor.start()

    powerMonitor.on('suspend', () => activityMonitor?.handleSuspend())
    powerMonitor.on('resume', () => activityMonitor?.handleResume())

    const win = createMainWindow()
    setupTray(win)
    if (isSmokeTest) runSmokeCheck(win)

    app.on('activate', () => {
      const existing = BrowserWindow.getAllWindows()[0]
      if (existing) {
        showMainWindow(existing)
        return
      }
      const created = createMainWindow()
      setupTray(created)
    })
  })

  app.on('before-quit', () => {
    // 系统关机、托盘退出、冒烟测试等路径都必须真正关闭窗口
    isQuitting = true
  })

  app.on('will-quit', () => {
    if (timeTicker) clearInterval(timeTicker)
    timeTicker = null
    activityMonitor?.stop()
    activityMonitor = null
    timeService = null
    appTray?.destroy()
    appTray = null
    database?.close()
    database = null
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
