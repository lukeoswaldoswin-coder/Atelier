/**
 * IPC 通道名称的唯一来源。
 * 主进程注册、preload 调用、测试断言都从这里取值，避免字符串写错或通道名重复。
 */
export const IpcChannel = {
  appGetInfo: 'app:get-info',

  clientsCreate: 'clients:create',
  clientsList: 'clients:list',
  clientsGet: 'clients:get',
  clientsUpdate: 'clients:update',
  clientsArchive: 'clients:archive',
  clientsUnarchive: 'clients:unarchive',

  commissionsCreate: 'commissions:create',
  commissionsList: 'commissions:list',
  commissionsGet: 'commissions:get',
  commissionsUpdate: 'commissions:update',
  commissionsArchive: 'commissions:archive',
  commissionsUnarchive: 'commissions:unarchive',

  tasksCreate: 'tasks:create',
  tasksList: 'tasks:list',
  tasksUpdate: 'tasks:update',
  tasksReorder: 'tasks:reorder',
  tasksArchive: 'tasks:archive',
  tasksUnarchive: 'tasks:unarchive',

  calendarTasks: 'calendar:tasks'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

export const ipcChannelNames: readonly IpcChannelName[] = Object.values(IpcChannel)

export function isIpcChannelName(value: string): value is IpcChannelName {
  return (ipcChannelNames as readonly string[]).includes(value)
}
