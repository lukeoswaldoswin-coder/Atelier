import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AppInfo } from '@shared/contracts'
import { DashboardPage } from './dashboard-page'

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

function mockApi(impl: () => Promise<AppInfo>) {
  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: { getAppInfo: vi.fn(impl) }
  })
}

describe('概览页', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'atelier')
  })

  it('展示经 IPC 取回的真实运行环境信息', async () => {
    mockApi(async () => info)
    render(<DashboardPage />)

    const list = await screen.findByTestId('app-info')
    expect(list).toHaveTextContent('0.1.0')
    expect(list).toHaveTextContent('40.0.0')
    expect(list).toHaveTextContent('Windows (x64)')
    expect(list).toHaveTextContent('开发模式')
  })

  it('读取失败时显示错误，而不是假装成功', async () => {
    mockApi(async () => {
      throw new Error('IPC handler failed for app:get-info')
    })
    render(<DashboardPage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('读取运行环境失败')
    expect(alert).toHaveTextContent('IPC handler failed for app:get-info')
  })

  it('没有业务数据时如实说明，不展示伪造数字', async () => {
    mockApi(async () => info)
    render(<DashboardPage />)

    expect(screen.getByText('还没有委托数据')).toBeInTheDocument()
    await screen.findByTestId('app-info')
  })
})
