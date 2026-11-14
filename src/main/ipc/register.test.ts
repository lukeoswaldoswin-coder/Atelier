import { describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { IpcChannel } from '@shared/channels'
import { registerIpcHandlers } from './register'

type InvokeHandler = (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>

function createFakeIpc() {
  const registered = new Map<string, InvokeHandler>()
  const ipc = {
    handle: vi.fn((channel: string, handler: InvokeHandler) => {
      registered.set(channel, handler)
    })
  } as unknown as Pick<IpcMain, 'handle'>
  return { ipc, registered }
}

function event(url: string | null): IpcMainInvokeEvent {
  return { senderFrame: url === null ? null : { url } } as unknown as IpcMainInvokeEvent
}

describe('registerIpcHandlers', () => {
  it('把处理器注册到对应通道', () => {
    const { ipc, registered } = createFakeIpc()
    registerIpcHandlers(ipc, { [IpcChannel.appGetInfo]: async () => ({ ok: true }) }, { logger: () => {} })

    expect(ipc.handle).toHaveBeenCalledTimes(1)
    expect(registered.has(IpcChannel.appGetInfo)).toBe(true)
  })

  it('接受来自本应用页面的调用', async () => {
    const { ipc, registered } = createFakeIpc()
    registerIpcHandlers(
      ipc,
      { [IpcChannel.appGetInfo]: async () => ({ ok: true }) },
      { isAllowedSender: (url) => typeof url === 'string' && url.startsWith('file://'), logger: () => {} }
    )

    const handler = registered.get(IpcChannel.appGetInfo)
    expect(handler).toBeDefined()
    await expect(handler!(event('file:///D:/Atelier/project/out/renderer/index.html'), undefined)).resolves.toEqual({
      ok: true
    })
  })

  it('拒绝外部页面发起的调用', async () => {
    const { ipc, registered } = createFakeIpc()
    const logger = vi.fn()
    registerIpcHandlers(
      ipc,
      { [IpcChannel.appGetInfo]: async () => ({ ok: true }) },
      { isAllowedSender: (url) => url === 'file:///app/index.html', logger }
    )

    const handler = registered.get(IpcChannel.appGetInfo)
    await expect(handler!(event('https://evil.example.com'), undefined)).rejects.toThrow('sender not allowed')
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('rejected sender'))
  })

  it('没有 senderFrame 时无法通过来源校验，按拒绝处理', async () => {
    const { ipc, registered } = createFakeIpc()
    registerIpcHandlers(
      ipc,
      { [IpcChannel.appGetInfo]: async () => ({ ok: true }) },
      { isAllowedSender: (url) => typeof url === 'string' && url.startsWith('file://'), logger: () => {} }
    )

    const handler = registered.get(IpcChannel.appGetInfo)
    await expect(handler!(event(null), undefined)).rejects.toThrow('sender not allowed')
  })

  it('处理器异常不会把内部错误信息原样抛给渲染进程', async () => {
    const { ipc, registered } = createFakeIpc()
    const logger = vi.fn()
    registerIpcHandlers(
      ipc,
      {
        [IpcChannel.appGetInfo]: async () => {
          throw new Error('数据库密码是 hunter2')
        }
      },
      { logger }
    )

    const handler = registered.get(IpcChannel.appGetInfo)
    const error = await handler!(event('file:///app/index.html'), undefined).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe(`IPC handler failed for ${IpcChannel.appGetInfo}`)
    expect((error as Error).message).not.toContain('hunter2')
    expect(logger).toHaveBeenCalledWith(expect.stringContaining('hunter2'))
  })
})
