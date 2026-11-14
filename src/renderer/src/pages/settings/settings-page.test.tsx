import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { MonitorStatusOutput } from '@shared/domain'
import { SettingsPage } from './settings-page'

const baseStatus: MonitorStatusOutput = {
  platformSupported: true,
  enabled: false,
  apps: ['photoshop', 'clipstudio', 'sai', 'krita', 'blender'],
  idleMinutes: 3,
  idleEnabled: true,
  running: false,
  activeAppKey: null,
  idleSeconds: null,
  error: null
}

function installApi(
  overrides: Partial<
    Record<'status' | 'setEnabled' | 'setApps' | 'setIdleMinutes' | 'setIdleEnabled', unknown>
  > = {}
) {
  const status = overrides.status ?? vi.fn(async () => baseStatus)
  const setEnabled = overrides.setEnabled ?? vi.fn(async () => ({ ...baseStatus, enabled: true }))
  const setApps = overrides.setApps ?? vi.fn(async () => baseStatus)
  const setIdleMinutes = overrides.setIdleMinutes ?? vi.fn(async () => baseStatus)
  const setIdleEnabled =
    overrides.setIdleEnabled ?? vi.fn(async () => ({ ...baseStatus, idleEnabled: false }))

  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: { monitor: { status, setEnabled, setApps, setIdleMinutes, setIdleEnabled } }
  })

  return { status, setEnabled, setApps, setIdleMinutes, setIdleEnabled }
}

afterEach(() => {
  Reflect.deleteProperty(window, 'atelier')
  vi.restoreAllMocks()
})

describe('设置页：自动监测', () => {
  it('默认关闭，并列出支持的软件与隐私说明', async () => {
    installApi()
    render(<SettingsPage />)

    const toggle = await screen.findByLabelText('启用自动监测')
    expect(toggle).not.toBeChecked()
    expect(screen.getByLabelText('启用 Adobe Photoshop')).toBeChecked()
    expect(screen.getByText('· 不读取窗口标题、文件路径、绘画内容，不截屏。')).toBeInTheDocument()
  })

  it('开启监测会调用 IPC 并更新状态', async () => {
    const { setEnabled } = installApi()
    const user = userEvent.setup()
    render(<SettingsPage />)

    await user.click(await screen.findByLabelText('启用自动监测'))

    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith({ enabled: true }))
    expect(await screen.findByText('监测运行中')).toBeInTheDocument()
  })

  it('取消勾选软件会提交新的应用列表', async () => {
    const { setApps } = installApi()
    const user = userEvent.setup()
    render(<SettingsPage />)

    const krita = await screen.findByLabelText('启用 Krita')
    await user.click(krita)

    await waitFor(() =>
      expect(setApps).toHaveBeenCalledWith({
        apps: ['photoshop', 'clipstudio', 'sai', 'blender']
      })
    )
  })

  it('空闲阈值保存前校验范围', async () => {
    const { setIdleMinutes } = installApi()
    const user = userEvent.setup()
    render(<SettingsPage />)

    const input = await screen.findByLabelText('空闲阈值（分钟）')
    await waitFor(() => expect(input).toHaveValue('3'))
    await user.clear(input)
    await user.type(input, '0')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(await screen.findByText('空闲阈值需为 1–120 的整数分钟')).toBeInTheDocument()
    expect(setIdleMinutes).not.toHaveBeenCalled()

    await user.clear(input)
    await user.type(input, '5')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(setIdleMinutes).toHaveBeenCalledWith({ idleMinutes: 5 }))
  })

  it('不支持的平台会禁用开关', async () => {
    installApi({ status: vi.fn(async () => ({ ...baseStatus, platformSupported: false })) })
    render(<SettingsPage />)

    expect(await screen.findByLabelText('启用自动监测')).toBeDisabled()
  })

  it('可以关闭空闲检测', async () => {
    const { setIdleEnabled } = installApi()
    const user = userEvent.setup()
    render(<SettingsPage />)

    await user.click(await screen.findByLabelText('启用空闲检测'))

    await waitFor(() => expect(setIdleEnabled).toHaveBeenCalledWith({ enabled: false }))
  })
})
