import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AppInfo } from '@shared/contracts'
import type { TimeSummaryOutput } from '@shared/domain'
import { useNavigationStore } from '@/stores/navigation-store'
import { DashboardPage } from './dashboard-page'

const info: AppInfo = {
  name: 'atelier',
  version: '0.1.0',
  electron: '44.7.0',
  chrome: '152.0.0.0',
  node: '24.0.0',
  platform: 'win32',
  arch: 'x64',
  isDev: true
}

const summary: TimeSummaryOutput = {
  totalSeconds: 3600,
  unassignedSeconds: 600,
  byDay: [{ date: '2026-11-14', seconds: 3600 }],
  byTask: []
}

function mockApi(options: { infoError?: boolean } = {}) {
  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: {
      getAppInfo: vi.fn(async () => {
        if (options.infoError) throw new Error('IPC handler failed for app:get-info')
        return info
      }),
      time: {
        summary: vi.fn(async () => summary),
        status: vi.fn(async () => ({ manual: null, auto: null, notice: null }))
      }
    }
  })
}

afterEach(() => {
  Reflect.deleteProperty(window, 'atelier')
  useNavigationStore.setState({ active: 'dashboard' })
  vi.restoreAllMocks()
})

describe('概览页', () => {
  it('展示今日/本周实际工时与未分配工时', async () => {
    mockApi()
    render(<DashboardPage />)

    expect(await screen.findByTestId('today-total')).toHaveTextContent('1 小时 00 分')
    expect(screen.getByTestId('week-total')).toHaveTextContent('1 小时 00 分')
    expect(screen.getByTestId('unassigned-today')).toHaveTextContent('10 分钟')
    expect(screen.getByText('其中 10 分钟 未分配')).toBeInTheDocument()
  })

  it('展示经 IPC 取回的真实运行环境信息', async () => {
    mockApi()
    render(<DashboardPage />)

    const list = await screen.findByTestId('app-info')
    expect(list).toHaveTextContent('0.1.0')
    expect(list).toHaveTextContent('44.7.0')
    expect(list).toHaveTextContent('Windows (x64)')
    expect(list).toHaveTextContent('开发模式')
  })

  it('读取运行环境失败时如实显示错误', async () => {
    mockApi({ infoError: true })
    render(<DashboardPage />)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('读取运行环境失败')
    expect(alert).toHaveTextContent('IPC handler failed for app:get-info')
  })

  it('未分配工时可跳转到工时记录页', async () => {
    mockApi()
    const user = userEvent.setup()
    render(<DashboardPage />)

    await screen.findByTestId('unassigned-today')
    await user.click(screen.getByRole('button', { name: '去工时记录' }))

    expect(useNavigationStore.getState().active).toBe('time')
  })

  it('没有手动计时时显示“没有正在进行的计时”', async () => {
    mockApi()
    render(<DashboardPage />)

    expect(await screen.findByText('没有正在进行的计时')).toBeInTheDocument()
  })
})
