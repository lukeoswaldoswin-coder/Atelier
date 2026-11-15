export interface SupportedApp {
  key: string
  label: string
  /** 小写可执行文件名 */
  executables: readonly string[]
}

/** P4 初始支持的绘画软件。新增软件只需在这里追加。 */
export const SUPPORTED_APPS: readonly SupportedApp[] = [
  { key: 'photoshop', label: 'Adobe Photoshop', executables: ['photoshop.exe'] },
  {
    key: 'clipstudio',
    label: 'Clip Studio Paint（含优动漫）',
    // 国际版绘画主程序是 CLIPStudioPaint.exe，clipstudio.exe 是 CLIP STUDIO 管理程序；
    // 中文版优动漫 PAINT 的可执行名是 UDMPaint.exe / UDMPaintPRO.exe。
    executables: ['clipstudiopaint.exe', 'clipstudio.exe']
  },
  { key: 'sai', label: 'PaintTool SAI', executables: ['sai.exe', 'sai2.exe'] },
  { key: 'krita', label: 'Krita', executables: ['krita.exe'] },
  { key: 'blender', label: 'Blender', executables: ['blender.exe'] }
]

export const APP_KEY_LABELS: Record<string, string> = Object.fromEntries(
  SUPPORTED_APPS.map((app) => [app.key, app.label])
)

export const DEFAULT_ENABLED_APP_KEYS: readonly string[] = SUPPORTED_APPS.map((app) => app.key)

/**
 * 优动漫 PAINT（Clip Studio Paint 中文版）的进程名随版本变化：
 * UDMPaint.exe（标准版）、UDMPaintPRO.exe（EX 版），后续版本可能带数字后缀。
 * 这里按前缀统一识别，避免再次因为版本改名而漏记。
 */
const UDM_PAINT_EXECUTABLE = /^udmpaint[a-z0-9]*\.exe$/

/**
 * 可执行文件名 → 应用 key。
 * 只使用进程名，不读取窗口标题、文件路径或绘画内容。
 */
export function resolveAppKey(executableName: string | null | undefined): string | null {
  if (!executableName) return null
  const normalized = executableName.trim().toLowerCase()
  if (UDM_PAINT_EXECUTABLE.test(normalized)) return 'clipstudio'
  const matched = SUPPORTED_APPS.find((app) => app.executables.includes(normalized))
  return matched ? matched.key : null
}
