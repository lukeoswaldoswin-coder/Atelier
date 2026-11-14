import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannel } from '@shared/channels'
import type { AppInfo } from '@shared/contracts'
import type { AtelierApi } from '@shared/api'

/**
 * 渲染进程唯一的原生能力入口。
 *
 * 这里刻意只暴露具体方法，而不是暴露 ipcRenderer 本身：
 * 渲染进程无法任意指定通道名，也无法监听主进程内部事件。
 */
const api: AtelierApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.appGetInfo) as Promise<AppInfo>
}

contextBridge.exposeInMainWorld('atelier', api)
