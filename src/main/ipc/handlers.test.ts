import { describe, expect, it, vi } from 'vitest'
import { IpcChannel } from '@shared/channels'
import type { AppInfo } from '@shared/contracts'
import { createIpcHandlers } from './handlers'

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

describe('createIpcHandlers', () => {
  it('覆盖全部已声明通道', () => {
    const handlers = createIpcHandlers({ getAppInfo: () => info })
    expect(Object.keys(handlers)).toEqual([IpcChannel.appGetInfo])
  })

  it('app:get-info 返回主进程提供的运行时信息', async () => {
    const getAppInfo = vi.fn().mockReturnValue(info)
    const handlers = createIpcHandlers({ getAppInfo })

    const result = await handlers[IpcChannel.appGetInfo](undefined)

    expect(getAppInfo).toHaveBeenCalledTimes(1)
    expect(result).toEqual(info)
  })

  it('入参不符合契约时直接拒绝，不调用依赖', async () => {
    const getAppInfo = vi.fn().mockReturnValue(info)
    const handlers = createIpcHandlers({ getAppInfo })

    await expect(handlers[IpcChannel.appGetInfo]({ injected: true })).rejects.toThrow()
    expect(getAppInfo).not.toHaveBeenCalled()
  })

  it('依赖返回的数据不符合契约时不会把脏数据交给渲染进程', async () => {
    const handlers = createIpcHandlers({
      getAppInfo: () => ({ ...info, chrome: '' }) as unknown as AppInfo
    })

    await expect(handlers[IpcChannel.appGetInfo](undefined)).rejects.toThrow()
  })
})
