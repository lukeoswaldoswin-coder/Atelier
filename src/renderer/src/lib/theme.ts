import type { ThemeMode } from '@/stores/theme-store'

/**
 * 把主题写到 <html> 上：
 * - .dark 类驱动 Tailwind 的 dark 变体；
 * - data-theme 便于自动化测试与后续主题扩展；
 * - color-scheme 让原生滚动条、表单控件跟随主题。
 */
export function applyTheme(theme: ThemeMode, root: HTMLElement = document.documentElement): void {
  root.classList.toggle('dark', theme === 'dark')
  root.dataset['theme'] = theme
  root.style.colorScheme = theme
}
