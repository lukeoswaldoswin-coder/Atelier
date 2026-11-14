import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { IpcChannel } from '@shared/channels'

/**
 * 主进程启动流程的集成测试。
 *
 * 用假的 electron 模块驱动真实的主进程代码，验证：
 * - 单实例锁、会话加固、数据库初始化、IPC 注册、窗口创建的顺序与参数；
 * - 窗口的 webPreferences 保持安全基线；
 * - 生产构建时加载本地页面，而不是远程地址；
 * - 启动时确实在用户数据目录创建了数据库文件并完成迁移。
 */

const state = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  const windows: unknown[] = []
  const listeners = new Map<string, () => void>()
  const ready: { resolve?: () => void } = {}
  return { handlers, windows, listeners, ready, tempDir: '' }
})

vi.mock('electron', () => {
  const app = {
    setAppUserModelId: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          state.ready.resolve = resolve
        })
    ),
    on: vi.fn((event: string, listener: () => void) => {
      state.listeners.set(event, listener)
    }),
    once: vi.fn(),
    quit: vi.fn(),
    exit: vi.fn(),
    getName: () => 'atelier',
    getVersion: () => '0.1.0',
    isPackaged: false,
    getPath: () => state.tempDir,
    setPath: vi.fn()
  }

  class FakeWebContents {
    setWindowOpenHandler = vi.fn()
    on = vi.fn()
    once = vi.fn()
    loadURL = vi.fn(async () => {})
    loadFile = vi.fn(async () => {})
  }

  class FakeBrowserWindow {
    static getAllWindows = (): unknown[] => []
    options: Record<string, unknown>
    webContents = new FakeWebContents()
    loadFile = vi.fn(async () => {})
    loadURL = vi.fn(async () => {})
    setMenuBarVisibility = vi.fn()
    once = vi.fn()
    show = vi.fn()
    isMinimized = vi.fn(() => false)
    restore = vi.fn()
    focus = vi.fn()

    constructor(options: Record<string, unknown>) {
      this.options = options
      state.windows.push(this)
    }
  }

  const sessionDefault = {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn()
  }

  return {
    app,
    BrowserWindow: FakeBrowserWindow,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (event: unknown, payload: unknown) => Promise<unknown>) => {
        state.handlers.set(channel, handler)
      })
    },
    session: { defaultSession: sessionDefault },
    shell: { openExternal: vi.fn() },
    dialog: { showErrorBox: vi.fn() },
    screen: {
      getPrimaryDisplay: () => ({ workAreaSize: { width: 2048, height: 1232 } })
    }
  }
})

interface WindowLike {
  options: {
    webPreferences: Record<string, unknown>
    width: number
    minWidth: number
    show: boolean
  }
  loadFile: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  webContents: {
    setWindowOpenHandler: ReturnType<typeof vi.fn>
  }
}

describe('主进程启动流程', () => {
  beforeAll(() => {
    state.tempDir = mkdtempSync(join(tmpdir(), 'atelier-bootstrap-'))
  })

  afterAll(() => {
    try {
      rmSync(state.tempDir, { recursive: true, force: true })
    } catch {
      // 临时目录清理失败不影响测试结论（Windows 上偶尔仍有句柄未释放）
    }
  })

  it('应用就绪后加固会话、初始化数据库、注册 IPC 并创建安全窗口', async () => {
    delete process.env['ATELIER_SMOKE_TEST']
    delete process.env['ELECTRON_RENDERER_URL']
    delete process.env['ATELIER_USER_DATA_DIR']

    await import('./index')
    state.ready.resolve?.()

    await vi.waitFor(() => {
      expect(state.windows).toHaveLength(1)
    })

    const electron = await import('electron')
    const session = (electron.session as unknown as { defaultSession: Record<string, ReturnType<typeof vi.fn>> })
      .defaultSession
    const permissionRequest = session['setPermissionRequestHandler'] as ReturnType<typeof vi.fn>
    const permissionCheck = session['setPermissionCheckHandler'] as ReturnType<typeof vi.fn>

    expect(electron.app.setAppUserModelId).toHaveBeenCalledWith('com.atelier.desktop')
    expect(permissionRequest).toHaveBeenCalledTimes(1)
    expect(permissionCheck).toHaveBeenCalledTimes(1)

    // 权限申请一律拒绝
    const requestHandler = permissionRequest.mock.calls[0]?.[0] as (
      contents: unknown,
      permission: string,
      callback: (granted: boolean) => void
    ) => void
    const callback = vi.fn()
    requestHandler(null, 'camera', callback)
    expect(callback).toHaveBeenCalledWith(false)

    // 数据库在用户数据目录初始化
    const dbFile = join(state.tempDir, 'atelier.db')
    expect(existsSync(dbFile)).toBe(true)

    const probe = new Database(dbFile, { readonly: true })
    const tables = probe
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as Array<{ name: string }>
    const migrations = probe.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as Array<{
      id: string
    }>
    probe.close()
    expect(tables.map((row) => row.name)).toEqual([
      'app_settings',
      'clients',
      'commissions',
      'schema_migrations',
      'tasks',
      'time_entries'
    ])
    expect(migrations.map((row) => row.id)).toEqual([
      '001-initial',
      '002-deadline-and-payment',
      '003-tasks',
    '004-task-planned-date',
      '005-time-entries'
    ])

    // 数据相关通道均已注册
    expect(state.handlers.has(IpcChannel.appGetInfo)).toBe(true)
    expect(state.handlers.has(IpcChannel.clientsCreate)).toBe(true)
    expect(state.handlers.has(IpcChannel.clientsUnarchive)).toBe(true)
    expect(state.handlers.has(IpcChannel.commissionsCreate)).toBe(true)
    expect(state.handlers.has(IpcChannel.commissionsUnarchive)).toBe(true)
    expect(state.handlers.has(IpcChannel.tasksCreate)).toBe(true)
    expect(state.handlers.has(IpcChannel.tasksReorder)).toBe(true)
    expect(state.handlers.has(IpcChannel.tasksArchive)).toBe(true)
    expect(state.handlers.has(IpcChannel.tasksUnarchive)).toBe(true)
    expect(state.handlers.has(IpcChannel.calendarTasks)).toBe(true)

    const win = state.windows[0] as WindowLike
    const webPreferences = win.options.webPreferences

    expect(webPreferences['nodeIntegration']).toBe(false)
    expect(webPreferences['contextIsolation']).toBe(true)
    expect(webPreferences['sandbox']).toBe(true)
    expect(webPreferences['webSecurity']).toBe(true)
    expect(String(webPreferences['preload'])).toMatch(/preload[\\/]index\.js$/)

    // 没有远端地址时必须加载本地构建产物
    expect(win.loadFile).toHaveBeenCalledTimes(1)
    expect(String(win.loadFile.mock.calls[0]?.[0])).toMatch(/renderer[\\/]index\.html$/)
    expect(win.loadURL).not.toHaveBeenCalled()

    // 禁止打开新窗口
    expect(win.webContents.setWindowOpenHandler).toHaveBeenCalledTimes(1)
    expect(win.webContents.setWindowOpenHandler.mock.calls[0]?.[0]?.()).toEqual({ action: 'deny' })

    // 模拟退出：will-quit 应关闭数据库，文件句柄被释放后才可以删除
    const willQuit = state.listeners.get('will-quit')
    expect(typeof willQuit).toBe('function')
    willQuit?.()
    expect(() => rmSync(dbFile, { force: true })).not.toThrow()
  })
})
