import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_THEME, THEME_STORAGE_KEY, useThemeStore } from './theme-store'

describe('主题状态', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.setState({ theme: DEFAULT_THEME })
  })

  it('默认使用深色主题', () => {
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('切换会在深浅之间往返', () => {
    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('light')

    useThemeStore.getState().toggleTheme()
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('设置后写入 localStorage 以便下次启动恢复', () => {
    useThemeStore.getState().setTheme('light')

    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string).state.theme).toBe('light')
  })
})
