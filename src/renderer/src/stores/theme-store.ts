import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export type ThemeMode = 'dark' | 'light'

export const DEFAULT_THEME: ThemeMode = 'dark'
export const THEME_STORAGE_KEY = 'atelier.theme'

export interface ThemeState {
  theme: ThemeMode
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

/**
 * 主题状态。
 *
 * 说明：P0 阶段主题偏好保存在渲染进程的 localStorage。
 * P1 建立 app_settings 表后，这里会改为经 IPC 读写主进程设置，渲染层结构不变。
 */
export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: DEFAULT_THEME,
      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' })
    }),
    {
      name: THEME_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage)
    }
  )
)
