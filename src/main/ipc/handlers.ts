import { IpcChannel, type IpcChannelName } from '@shared/channels'
import { appInfoSchema, ipcContracts, type AppInfo } from '@shared/contracts'
import { clientSchema, commissionSchema } from '@shared/domain'
import type { ClientsRepository } from '../db/repositories/clients'
import type { CommissionsRepository } from '../db/repositories/commissions'

export type IpcHandler = (payload: unknown) => Promise<unknown>
export type IpcHandlers = Record<IpcChannelName, IpcHandler>

export interface IpcHandlerDeps {
  getAppInfo: () => AppInfo | Promise<AppInfo>
  clients: ClientsRepository
  commissions: CommissionsRepository
}

/**
 * 业务处理器：只负责“校验输入 → 调用仓储 → 校验输出”。
 *
 * 不直接接触 ipcMain，也不接触渲染进程，因此可以在单元测试里用真实数据库驱动。
 * 所有入参和返回值都经过 shared/contracts 中的 Zod schema 校验，
 * 非法数据不会越过进程边界。
 */
export function createIpcHandlers(deps: IpcHandlerDeps): IpcHandlers {
  const { clients, commissions } = deps

  return {
    [IpcChannel.appGetInfo]: async (payload) => {
      ipcContracts[IpcChannel.appGetInfo].input.parse(payload)
      return appInfoSchema.parse(await deps.getAppInfo())
    },

    [IpcChannel.clientsCreate]: async (payload) => {
      const input = ipcContracts[IpcChannel.clientsCreate].input.parse(payload)
      return clientSchema.parse(clients.create(input))
    },

    [IpcChannel.clientsList]: async (payload) => {
      const input = ipcContracts[IpcChannel.clientsList].input.parse(payload ?? {})
      return ipcContracts[IpcChannel.clientsList].output.parse(clients.list(input))
    },

    [IpcChannel.clientsGet]: async (payload) => {
      const input = ipcContracts[IpcChannel.clientsGet].input.parse(payload)
      return ipcContracts[IpcChannel.clientsGet].output.parse(clients.get(input))
    },

    [IpcChannel.clientsUpdate]: async (payload) => {
      const input = ipcContracts[IpcChannel.clientsUpdate].input.parse(payload)
      return ipcContracts[IpcChannel.clientsUpdate].output.parse(clients.update(input))
    },

    [IpcChannel.clientsArchive]: async (payload) => {
      const input = ipcContracts[IpcChannel.clientsArchive].input.parse(payload)
      return ipcContracts[IpcChannel.clientsArchive].output.parse(clients.archive(input))
    },

    [IpcChannel.commissionsCreate]: async (payload) => {
      const input = ipcContracts[IpcChannel.commissionsCreate].input.parse(payload)
      return commissionSchema.parse(commissions.create(input))
    },

    [IpcChannel.commissionsList]: async (payload) => {
      const input = ipcContracts[IpcChannel.commissionsList].input.parse(payload ?? {})
      return ipcContracts[IpcChannel.commissionsList].output.parse(commissions.list(input))
    },

    [IpcChannel.commissionsGet]: async (payload) => {
      const input = ipcContracts[IpcChannel.commissionsGet].input.parse(payload)
      return ipcContracts[IpcChannel.commissionsGet].output.parse(commissions.get(input))
    },

    [IpcChannel.commissionsUpdate]: async (payload) => {
      const input = ipcContracts[IpcChannel.commissionsUpdate].input.parse(payload)
      return ipcContracts[IpcChannel.commissionsUpdate].output.parse(commissions.update(input))
    },

    [IpcChannel.commissionsArchive]: async (payload) => {
      const input = ipcContracts[IpcChannel.commissionsArchive].input.parse(payload)
      return ipcContracts[IpcChannel.commissionsArchive].output.parse(commissions.archive(input))
    }
  }
}
