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
  tasksListAll: 'tasks:list-all',
  tasksWorkbench: 'tasks:workbench',

  calendarTasks: 'calendar:tasks',
  calendarActivity: 'calendar:activity',
  calendarDayDetail: 'calendar:day-detail',

  scheduleApply: 'schedule:apply',

  dataInfo: 'data:info',
  backupCreate: 'backup:create',
  backupList: 'backup:list',
  backupReveal: 'backup:reveal',
  backupPickRestore: 'backup:pick-restore',
  backupRestore: 'backup:restore',

  exportCsv: 'export:csv',

  timeStatus: 'time:status',
  timeStart: 'time:start',
  timePause: 'time:pause',
  timeResume: 'time:resume',
  timeStop: 'time:stop',
  timeList: 'time:list',
  timeSummary: 'time:summary',
  timeUpdate: 'time:update',
  timeAssign: 'time:assign',
  timeDelete: 'time:delete',
  timeMerge: 'time:merge',
  timeTaskTotals: 'time:task-totals',
  timeStartTask: 'time:start-task',
  timeTaskPause: 'time:task-pause',
  timeTaskResume: 'time:task-resume',
  timeTaskStop: 'time:task-stop',

  monitorStatus: 'monitor:status',
  monitorSetEnabled: 'monitor:set-enabled',
  monitorSetApps: 'monitor:set-apps',
  monitorSetIdle: 'monitor:set-idle',
  monitorSetIdleEnabled: 'monitor:set-idle-enabled'
} as const

export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel]

export const ipcChannelNames: readonly IpcChannelName[] = Object.values(IpcChannel)

export function isIpcChannelName(value: string): value is IpcChannelName {
  return (ipcChannelNames as readonly string[]).includes(value)
}
