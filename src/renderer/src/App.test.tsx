import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AppInfo } from '@shared/contracts'
import App from './App'
import { useNavigationStore } from '@/stores/navigation-store'
import { useThemeStore } from '@/stores/theme-store'

const info: AppInfo = {
  name: 'atelier',
  version: '0.1.0',
  electron: '40.0.0',
  chrome: '140.0.0.0',
  node: '24.0.0',
  platform: 'win32',
  arch: 'x64',
  isDev: true
}

beforeEach(() => {
  useNavigationStore.setState({ active: 'dashboard' })
  useThemeStore.setState({ theme: 'dark' })
  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: { getAppInfo: vi.fn(async () => info) }
  })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'atelier')
})

describe('应用外壳', () => {
  it('启动后显示深色主题与概览页', async () => {
    render(<App />)

    expect(document.documentElement).toHaveClass('dark')
    expect(screen.getByRole('heading', { name: '概览', level: 1 })).toBeInTheDocument()
    await screen.findByTestId('app-info')
  })

  it('切换到未实现页面时如实提示所属阶段', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByTestId('app-info')

    await user.click(screen.getByRole('button', { name: /委托管理/ }))

    expect(screen.getByRole('heading', { name: '委托管理', level: 1 })).toBeInTheDocument()
    expect(screen.getByText('计划在 P1 阶段实现')).toBeInTheDocument()
  })

  it('主题切换会更新根元素与按钮文案', async () => {
    const user = userEvent.setup()
    render(<App />)
    await screen.findByTestId('app-info')

    await user.click(screen.getByRole('button', { name: '切换到浅色主题' }))

    expect(document.documentElement).not.toHaveClass('dark')
    expect(useThemeStore.getState().theme).toBe('light')
    expect(screen.getByRole('button', { name: '切换到深色主题' })).toBeInTheDocument()
  })
})
