import { describe, expect, it, vi } from 'vitest'

/**
 * 主进程启动流程的集成测试。
 *
 * 当前命令行环境限制「创建子进程」，Electron 无法在这里真正打开窗口，
 * 因此这里用假的 electron 模块驱动真实的主进程代码，验证：
 * - 单实例锁、会话加固、IPC 注册、窗口创建的调用顺序与参数；
 * - 窗口的 webPreferences 保持安全基线；
 * - 生产构建时加载本地页面，而不是远程地址。
 */

const state = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<unknown>>()
  const windows: unknown[] = []
  const ready: { resolve?: () => void } = {}
  return { handlers, windows, ready }
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
    on: vi.fn(),
    quit: vi.fn(),
    exit: vi.fn(),
    getName: () => 'atelier',
    getVersion: () => '0.1.0',
    isPackaged: false
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
  it('应用就绪后加固会话、注册 IPC 并创建安全窗口', async () => {
    delete process.env['ATELIER_SMOKE_TEST']
    delete process.env['ELECTRON_RENDERER_URL']

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

    expect(state.handlers.has('app:get-info')).toBe(true)

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
  })
})
