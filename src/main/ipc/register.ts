import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { IpcChannelName } from '@shared/channels'
import { DataError } from '@shared/errors'
import type { IpcHandler } from './handlers'

export interface RegisterIpcOptions {
  /** 校验调用方 frame 是否属于本应用界面；不传则不校验（仅用于测试）。 */
  isAllowedSender?: (url: string | null | undefined) => boolean
  logger?: (message: string) => void
}

/**
 * 把处理器注册到 ipcMain。
 * - 每个通道先做来源校验，拒绝非本应用页面的调用；
 * - 业务错误（DataError）回传可读信息，让界面能提示“客户不存在”这类问题；
 * - 其他异常只在主进程记录完整信息，对外统一返回稳定错误，避免泄露内部细节。
 */
export function registerIpcHandlers(
  ipc: Pick<IpcMain, 'handle'>,
  handlers: Partial<Record<IpcChannelName, IpcHandler>>,
  options: RegisterIpcOptions = {}
): void {
  const logger = options.logger ?? ((message: string) => console.error(message))

  for (const [channel, handler] of Object.entries(handlers) as [IpcChannelName, IpcHandler][]) {
    if (typeof handler !== 'function') continue

    ipc.handle(channel, async (event: IpcMainInvokeEvent, payload: unknown) => {
      const senderUrl = event.senderFrame?.url ?? null

      if (options.isAllowedSender && !options.isAllowedSender(senderUrl)) {
        logger(`[ipc] rejected sender for ${channel}: ${senderUrl ?? 'unknown'}`)
        throw new Error(`IPC sender not allowed for ${channel}`)
      }

      try {
        return await handler(payload)
      } catch (error) {
        logger(`[ipc] handler failed for ${channel}: ${String(error)}`)
        if (error instanceof DataError) {
          throw new Error(error.message)
        }
        throw new Error(`IPC handler failed for ${channel}`)
      }
    })
  }
}
