import { IpcChannel, type IpcChannelName } from '@shared/channels'
import { appInfoSchema, ipcContracts, type AppInfo } from '@shared/contracts'

export type IpcHandler = (payload: unknown) => Promise<unknown>
export type IpcHandlers = Record<IpcChannelName, IpcHandler>

export interface IpcHandlerDeps {
  getAppInfo: () => AppInfo | Promise<AppInfo>
}

/**
 * 业务处理器：只负责校验输入、调用依赖、校验输出。
 * 不直接接触 ipcMain，因此可以在单元测试里用假依赖驱动。
 */
export function createIpcHandlers(deps: IpcHandlerDeps): IpcHandlers {
  return {
    [IpcChannel.appGetInfo]: async (payload: unknown) => {
      ipcContracts[IpcChannel.appGetInfo].input.parse(payload)
      const info = await deps.getAppInfo()
      return appInfoSchema.parse(info)
    }
  }
}
