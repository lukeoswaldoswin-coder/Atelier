import { IpcChannel, type IpcChannelName } from '@shared/channels'
import { appInfoSchema, ipcContracts, type AppInfo } from '@shared/contracts'
import { clientSchema, commissionSchema, taskSchema } from '@shared/domain'
import type { ClientsRepository } from '../db/repositories/clients'
import type { CommissionsRepository } from '../db/repositories/commissions'
import type { TasksRepository } from '../db/repositories/tasks'
import type { ActivityMonitor } from '../activity/activity-monitor'
import type { TimeService } from '../time/time-service'

export type IpcHandler = (payload: unknown) => Promise<unknown>
export type IpcHandlers = Record<IpcChannelName, IpcHandler>

export interface IpcHandlerDeps {
  getAppInfo: () => AppInfo | Promise<AppInfo>
  clients: ClientsRepository
  commissions: CommissionsRepository
  tasks: TasksRepository
  time: TimeService
  monitor: ActivityMonitor
}

/**
 * 业务处理器：只负责“校验输入 → 调用仓储 → 校验输出”。
 *
 * 不直接接触 ipcMain，也不接触渲染进程，因此可以在单元测试里用真实数据库驱动。
 * 所有入参和返回值都经过 shared/contracts 中的 Zod schema 校验，
 * 非法数据不会越过进程边界。
 */
export function createIpcHandlers(deps: IpcHandlerDeps): IpcHandlers {
  const { clients, commissions, tasks, time, monitor } = deps

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

    [IpcChannel.clientsUnarchive]: async (payload) => {
      const input = ipcContracts[IpcChannel.clientsUnarchive].input.parse(payload)
      return ipcContracts[IpcChannel.clientsUnarchive].output.parse(clients.unarchive(input))
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
    },

    [IpcChannel.commissionsUnarchive]: async (payload) => {
      const input = ipcContracts[IpcChannel.commissionsUnarchive].input.parse(payload)
      return ipcContracts[IpcChannel.commissionsUnarchive].output.parse(commissions.unarchive(input))
    },

    [IpcChannel.tasksCreate]: async (payload) => {
      const input = ipcContracts[IpcChannel.tasksCreate].input.parse(payload)
      return taskSchema.parse(tasks.create(input))
    },

    [IpcChannel.tasksList]: async (payload) => {
      const input = ipcContracts[IpcChannel.tasksList].input.parse(payload ?? {})
      return ipcContracts[IpcChannel.tasksList].output.parse(tasks.list(input))
    },

    [IpcChannel.tasksUpdate]: async (payload) => {
      const input = ipcContracts[IpcChannel.tasksUpdate].input.parse(payload)
      return ipcContracts[IpcChannel.tasksUpdate].output.parse(tasks.update(input))
    },

    [IpcChannel.tasksReorder]: async (payload) => {
      const input = ipcContracts[IpcChannel.tasksReorder].input.parse(payload)
      return ipcContracts[IpcChannel.tasksReorder].output.parse(tasks.reorder(input))
    },

    [IpcChannel.tasksArchive]: async (payload) => {
      const input = ipcContracts[IpcChannel.tasksArchive].input.parse(payload)
      return ipcContracts[IpcChannel.tasksArchive].output.parse(tasks.archive(input))
    },

    [IpcChannel.tasksUnarchive]: async (payload) => {
      const input = ipcContracts[IpcChannel.tasksUnarchive].input.parse(payload)
      return ipcContracts[IpcChannel.tasksUnarchive].output.parse(tasks.unarchive(input))
    },

    [IpcChannel.calendarTasks]: async (payload) => {
      const input = ipcContracts[IpcChannel.calendarTasks].input.parse(payload)
      return ipcContracts[IpcChannel.calendarTasks].output.parse(tasks.calendar(input))
    },

    [IpcChannel.timeStatus]: async (payload) => {
      ipcContracts[IpcChannel.timeStatus].input.parse(payload)
      return ipcContracts[IpcChannel.timeStatus].output.parse(time.status())
    },

    [IpcChannel.timeStart]: async (payload) => {
      const input = ipcContracts[IpcChannel.timeStart].input.parse(payload)
      return ipcContracts[IpcChannel.timeStart].output.parse(time.start(input.taskId))
    },

    [IpcChannel.timePause]: async (payload) => {
      ipcContracts[IpcChannel.timePause].input.parse(payload)
      return ipcContracts[IpcChannel.timePause].output.parse(time.pause())
    },

    [IpcChannel.timeResume]: async (payload) => {
      ipcContracts[IpcChannel.timeResume].input.parse(payload)
      return ipcContracts[IpcChannel.timeResume].output.parse(time.resume())
    },

    [IpcChannel.timeStop]: async (payload) => {
      ipcContracts[IpcChannel.timeStop].input.parse(payload)
      return ipcContracts[IpcChannel.timeStop].output.parse(time.stop())
    },

    [IpcChannel.timeList]: async (payload) => {
      const input = ipcContracts[IpcChannel.timeList].input.parse(payload)
      return ipcContracts[IpcChannel.timeList].output.parse(time.list(input))
    },

    [IpcChannel.timeSummary]: async (payload) => {
      const input = ipcContracts[IpcChannel.timeSummary].input.parse(payload)
      return ipcContracts[IpcChannel.timeSummary].output.parse(time.summary(input))
    },

    [IpcChannel.timeUpdate]: async (payload) => {
      const input = ipcContracts[IpcChannel.timeUpdate].input.parse(payload)
      return ipcContracts[IpcChannel.timeUpdate].output.parse(time.update(input))
    },

    [IpcChannel.timeAssign]: async (payload) => {
      const input = ipcContracts[IpcChannel.timeAssign].input.parse(payload)
      return ipcContracts[IpcChannel.timeAssign].output.parse(time.assign(input.id, input.taskId))
    },

    [IpcChannel.timeDelete]: async (payload) => {
      const input = ipcContracts[IpcChannel.timeDelete].input.parse(payload)
      return ipcContracts[IpcChannel.timeDelete].output.parse(time.remove(input.id))
    },

    [IpcChannel.timeMerge]: async (payload) => {
      const input = ipcContracts[IpcChannel.timeMerge].input.parse(payload)
      return ipcContracts[IpcChannel.timeMerge].output.parse(time.merge(input))
    },

    [IpcChannel.timeTaskTotals]: async (payload) => {
      const input = ipcContracts[IpcChannel.timeTaskTotals].input.parse(payload)
      return ipcContracts[IpcChannel.timeTaskTotals].output.parse(time.taskTotals(input.taskIds))
    },

    [IpcChannel.monitorStatus]: async (payload) => {
      ipcContracts[IpcChannel.monitorStatus].input.parse(payload)
      return ipcContracts[IpcChannel.monitorStatus].output.parse(monitor.status())
    },

    [IpcChannel.monitorSetEnabled]: async (payload) => {
      const input = ipcContracts[IpcChannel.monitorSetEnabled].input.parse(payload)
      return ipcContracts[IpcChannel.monitorSetEnabled].output.parse(monitor.setEnabled(input.enabled))
    },

    [IpcChannel.monitorSetApps]: async (payload) => {
      const input = ipcContracts[IpcChannel.monitorSetApps].input.parse(payload)
      return ipcContracts[IpcChannel.monitorSetApps].output.parse(monitor.setApps(input.apps))
    },

    [IpcChannel.monitorSetIdle]: async (payload) => {
      const input = ipcContracts[IpcChannel.monitorSetIdle].input.parse(payload)
      return ipcContracts[IpcChannel.monitorSetIdle].output.parse(monitor.setIdleMinutes(input.idleMinutes))
    }
  }
}
