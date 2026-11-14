import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '@shared/channels'
import type { AtelierApi } from '@shared/api'
import type { ByIdInput } from '@shared/domain'

/**
 * 渲染进程唯一的原生能力入口。
 *
 * 这里刻意只暴露具体方法，而不是暴露 ipcRenderer 本身：
 * 渲染进程无法任意指定通道名，也无法监听主进程内部事件，更拿不到数据库连接。
 */
const api: AtelierApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.appGetInfo),

  clients: {
    create: (input) => ipcRenderer.invoke(IpcChannel.clientsCreate, input),
    list: (input) => ipcRenderer.invoke(IpcChannel.clientsList, input ?? {}),
    get: (input: ByIdInput) => ipcRenderer.invoke(IpcChannel.clientsGet, input),
    update: (input) => ipcRenderer.invoke(IpcChannel.clientsUpdate, input),
    archive: (input: ByIdInput) => ipcRenderer.invoke(IpcChannel.clientsArchive, input),
    unarchive: (input: ByIdInput) => ipcRenderer.invoke(IpcChannel.clientsUnarchive, input)
  },

  commissions: {
    create: (input) => ipcRenderer.invoke(IpcChannel.commissionsCreate, input),
    list: (input) => ipcRenderer.invoke(IpcChannel.commissionsList, input ?? {}),
    get: (input: ByIdInput) => ipcRenderer.invoke(IpcChannel.commissionsGet, input),
    update: (input) => ipcRenderer.invoke(IpcChannel.commissionsUpdate, input),
    archive: (input: ByIdInput) => ipcRenderer.invoke(IpcChannel.commissionsArchive, input),
    unarchive: (input: ByIdInput) => ipcRenderer.invoke(IpcChannel.commissionsUnarchive, input)
  }
}

contextBridge.exposeInMainWorld('atelier', api)
