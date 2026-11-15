import { Menu, Tray, nativeImage, type BrowserWindow, type NativeImage } from 'electron'

/** 托盘图标在任务栏里的显示尺寸；Windows 会按 DPI 再缩放。 */
const TRAY_ICON_PX = 32

export interface AppTrayOptions {
  win: BrowserWindow
  /** PNG 图标路径（开发版指向项目 build/，安装版在 asar 内） */
  iconPath: string
  /** 用户在托盘菜单里选择「退出」 */
  onQuit: () => void
}

export interface AppTray {
  /** 首次把窗口收进托盘时给出一次提示，避免用户以为程序被关掉了 */
  notifyHidden(): void
  destroy(): void
}

/** 把主窗口重新显示到前台（窗口可能处于最小化或隐藏状态）。 */
export function showMainWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function loadTrayIcon(iconPath: string): NativeImage | null {
  const image = nativeImage.createFromPath(iconPath)
  if (image.isEmpty()) return null
  return image.resize({ width: TRAY_ICON_PX, height: TRAY_ICON_PX, quality: 'best' })
}

/**
 * 创建系统托盘图标。
 *
 * 关闭窗口时应用只在托盘里隐藏，主进程继续运行，自动监测与手动计时都不会中断。
 * 图标不可用时返回 null，调用方应保持「关闭窗口即退出」的旧行为，避免窗口消失后
 * 再也找不到程序。
 */
export function createAppTray({ win, iconPath, onQuit }: AppTrayOptions): AppTray | null {
  const image = loadTrayIcon(iconPath)
  if (!image) return null

  let tray: Tray
  try {
    tray = new Tray(image)
    tray.setToolTip('Atelier 画师工坊')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主界面', click: () => showMainWindow(win) },
        { type: 'separator' },
        { label: '退出 画师工坊', click: () => onQuit() }
      ])
    )
    tray.on('click', () => showMainWindow(win))
  } catch {
    return null
  }

  let notified = false

  return {
    notifyHidden(): void {
      if (notified) return
      notified = true
      try {
        tray.displayBalloon({
          title: 'Atelier 画师工坊',
          content: '窗口已收进系统托盘，计时在后台继续；右键托盘图标可退出。'
        })
      } catch {
        // 系统通知被关闭时忽略即可，不影响后台计时
      }
    },
    destroy(): void {
      try {
        tray.destroy()
      } catch {
        // 退出阶段托盘已不可用，忽略
      }
    }
  }
}
