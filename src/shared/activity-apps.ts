export interface SupportedApp {
  key: string
  label: string
  /** 小写可执行文件名 */
  executables: readonly string[]
}

/** P4 初始支持的绘画软件。新增软件只需在这里追加。 */
export const SUPPORTED_APPS: readonly SupportedApp[] = [
  { key: 'photoshop', label: 'Adobe Photoshop', executables: ['photoshop.exe'] },
  { key: 'clipstudio', label: 'Clip Studio Paint', executables: ['clipstudio.exe'] },
  { key: 'sai', label: 'PaintTool SAI', executables: ['sai.exe', 'sai2.exe'] },
  { key: 'krita', label: 'Krita', executables: ['krita.exe'] },
  { key: 'blender', label: 'Blender', executables: ['blender.exe'] }
]

export const APP_KEY_LABELS: Record<string, string> = Object.fromEntries(
  SUPPORTED_APPS.map((app) => [app.key, app.label])
)

export const DEFAULT_ENABLED_APP_KEYS: readonly string[] = SUPPORTED_APPS.map((app) => app.key)

/**
 * 可执行文件名 → 应用 key。
 * 只使用进程名，不读取窗口标题、文件路径或绘画内容。
 */
export function resolveAppKey(executableName: string | null | undefined): string | null {
  if (!executableName) return null
  const normalized = executableName.trim().toLowerCase()
  const matched = SUPPORTED_APPS.find((app) => app.executables.includes(normalized))
  return matched ? matched.key : null
}
