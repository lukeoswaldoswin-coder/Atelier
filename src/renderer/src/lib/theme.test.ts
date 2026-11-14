import { describe, expect, it } from 'vitest'
import { applyTheme } from './theme'

describe('applyTheme', () => {
  it('深色主题给根元素加 dark 类并设置 color-scheme', () => {
    const root = document.createElement('div')

    applyTheme('dark', root)

    expect(root.classList.contains('dark')).toBe(true)
    expect(root.dataset['theme']).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
  })

  it('切回浅色主题会移除 dark 类', () => {
    const root = document.createElement('div')
    applyTheme('dark', root)
    applyTheme('light', root)

    expect(root.classList.contains('dark')).toBe(false)
    expect(root.dataset['theme']).toBe('light')
    expect(root.style.colorScheme).toBe('light')
  })
})
