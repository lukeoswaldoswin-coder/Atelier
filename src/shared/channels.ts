/**
 * IPC 通道名称的唯一来源。
 * 主进程注册、preload 调用、测试断言都从这里取值，避免字符串写错或通道名重复。
 */
export const IpcChannel = {
  appGetInfo: 'app:get-info'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

export const ipcChannelNames: readonly IpcChannelName[] = Object.values(IpcChannel)

export function isIpcChannelName(value: string): value is IpcChannelName {
  return (ipcChannelNames as readonly string[]).includes(value)
}
