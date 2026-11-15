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
  },

  tasks: {
    create: (input) => ipcRenderer.invoke(IpcChannel.tasksCreate, input),
    list: (input) => ipcRenderer.invoke(IpcChannel.tasksList, input),
    update: (input) => ipcRenderer.invoke(IpcChannel.tasksUpdate, input),
    reorder: (input) => ipcRenderer.invoke(IpcChannel.tasksReorder, input),
    archive: (input: ByIdInput) => ipcRenderer.invoke(IpcChannel.tasksArchive, input),
    unarchive: (input: ByIdInput) => ipcRenderer.invoke(IpcChannel.tasksUnarchive, input),
    listAll: () => ipcRenderer.invoke(IpcChannel.tasksListAll),
    workbench: (input) => ipcRenderer.invoke(IpcChannel.tasksWorkbench, input ?? {})
  },

  calendar: {
    tasks: (input) => ipcRenderer.invoke(IpcChannel.calendarTasks, input),
    activity: (input) => ipcRenderer.invoke(IpcChannel.calendarActivity, input),
    dayDetail: (input) => ipcRenderer.invoke(IpcChannel.calendarDayDetail, input)
  },

  schedule: {
    apply: (input) => ipcRenderer.invoke(IpcChannel.scheduleApply, input)
  },

  data: {
    info: () => ipcRenderer.invoke(IpcChannel.dataInfo)
  },

  backup: {
    create: () => ipcRenderer.invoke(IpcChannel.backupCreate),
    list: () => ipcRenderer.invoke(IpcChannel.backupList),
    reveal: () => ipcRenderer.invoke(IpcChannel.backupReveal),
    pickRestore: () => ipcRenderer.invoke(IpcChannel.backupPickRestore),
    restore: (input) => ipcRenderer.invoke(IpcChannel.backupRestore, input)
  },

  exportData: {
    csv: () => ipcRenderer.invoke(IpcChannel.exportCsv)
  },

  time: {
    status: () => ipcRenderer.invoke(IpcChannel.timeStatus),
    start: (input) => ipcRenderer.invoke(IpcChannel.timeStart, input),
    pause: () => ipcRenderer.invoke(IpcChannel.timePause),
    resume: () => ipcRenderer.invoke(IpcChannel.timeResume),
    stop: () => ipcRenderer.invoke(IpcChannel.timeStop),
    list: (input) => ipcRenderer.invoke(IpcChannel.timeList, input),
    summary: (input) => ipcRenderer.invoke(IpcChannel.timeSummary, input),
    update: (input) => ipcRenderer.invoke(IpcChannel.timeUpdate, input),
    assign: (input) => ipcRenderer.invoke(IpcChannel.timeAssign, input),
    remove: (input: ByIdInput) => ipcRenderer.invoke(IpcChannel.timeDelete, input),
    merge: (input) => ipcRenderer.invoke(IpcChannel.timeMerge, input),
    taskTotals: (input) => ipcRenderer.invoke(IpcChannel.timeTaskTotals, input),
    startTask: (input) => ipcRenderer.invoke(IpcChannel.timeStartTask, input),
    pauseTask: () => ipcRenderer.invoke(IpcChannel.timeTaskPause),
    resumeTask: () => ipcRenderer.invoke(IpcChannel.timeTaskResume),
    stopTask: () => ipcRenderer.invoke(IpcChannel.timeTaskStop)
  },

  monitor: {
    status: () => ipcRenderer.invoke(IpcChannel.monitorStatus),
    setEnabled: (input) => ipcRenderer.invoke(IpcChannel.monitorSetEnabled, input),
    setApps: (input) => ipcRenderer.invoke(IpcChannel.monitorSetApps, input),
    setIdleMinutes: (input) => ipcRenderer.invoke(IpcChannel.monitorSetIdle, input),
    setIdleEnabled: (input) => ipcRenderer.invoke(IpcChannel.monitorSetIdleEnabled, input)
  }
}

contextBridge.exposeInMainWorld('atelier', api)
