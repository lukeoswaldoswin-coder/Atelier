import { z } from 'zod'
import { IpcChannel } from './channels'
import {
  byIdInputSchema,
  calendarTasksInputSchema,
  calendarTasksOutputSchema,
  clientSchema,
  commissionSchema,
  createClientInputSchema,
  createCommissionInputSchema,
  createTaskInputSchema,
  listClientsInputSchema,
  listCommissionsInputSchema,
  listTasksInputSchema,
  reorderTasksInputSchema,
  taskSchema,
  timeAssignInputSchema,
  timeEntryViewSchema,
  timeListInputSchema,
  timeMergeInputSchema,
  timeStatusOutputSchema,
  timeSummaryInputSchema,
  timeSummaryOutputSchema,
  timeTaskTotalsInputSchema,
  timeTaskTotalsOutputSchema,
  timeUpdateInputSchema,
  updateClientInputSchema,
  updateCommissionInputSchema,
  updateTaskInputSchema,
  uuidSchema
} from './domain'

/**
 * 主进程返回给渲染进程的运行时信息。
 * 渲染进程无法直接读取 process.versions，所以应用版本、Electron/Chrome/Node 版本
 * 必须由主进程通过受控 IPC 提供。
 */
export const appInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  electron: z.string().min(1),
  chrome: z.string().min(1),
  node: z.string().min(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  isDev: z.boolean()
})

export type AppInfo = z.infer<typeof appInfoSchema>

/** 无参数通道的输入契约：显式要求 undefined，多余参数会被拒绝。 */
export const noInputSchema = z.undefined()

const clientListSchema = z.array(clientSchema)
const commissionListSchema = z.array(commissionSchema)
const taskListSchema = z.array(taskSchema)
const timeEntryViewListSchema = z.array(timeEntryViewSchema)

const timeStartInputSchema = z.strictObject({ taskId: uuidSchema })

/**
 * 通道契约表：每个通道声明输入与输出 schema。
 * 主进程在边界处用这里的 schema 校验与解析，渲染进程只依赖推导出的类型。
 *
 * 新增通道必须先在这里登记，否则 createIpcHandlers 的返回类型检查会失败。
 */
export const ipcContracts = {
  [IpcChannel.appGetInfo]: {
    input: noInputSchema,
    output: appInfoSchema
  },

  [IpcChannel.clientsCreate]: {
    input: createClientInputSchema,
    output: clientSchema
  },
  [IpcChannel.clientsList]: {
    input: listClientsInputSchema,
    output: clientListSchema
  },
  [IpcChannel.clientsGet]: {
    input: byIdInputSchema,
    output: clientSchema.nullable()
  },
  [IpcChannel.clientsUpdate]: {
    input: updateClientInputSchema,
    output: clientSchema.nullable()
  },
  [IpcChannel.clientsArchive]: {
    input: byIdInputSchema,
    output: clientSchema.nullable()
  },
  [IpcChannel.clientsUnarchive]: {
    input: byIdInputSchema,
    output: clientSchema.nullable()
  },

  [IpcChannel.commissionsCreate]: {
    input: createCommissionInputSchema,
    output: commissionSchema
  },
  [IpcChannel.commissionsList]: {
    input: listCommissionsInputSchema,
    output: commissionListSchema
  },
  [IpcChannel.commissionsGet]: {
    input: byIdInputSchema,
    output: commissionSchema.nullable()
  },
  [IpcChannel.commissionsUpdate]: {
    input: updateCommissionInputSchema,
    output: commissionSchema.nullable()
  },
  [IpcChannel.commissionsArchive]: {
    input: byIdInputSchema,
    output: commissionSchema.nullable()
  },
  [IpcChannel.commissionsUnarchive]: {
    input: byIdInputSchema,
    output: commissionSchema.nullable()
  },

  [IpcChannel.tasksCreate]: {
    input: createTaskInputSchema,
    output: taskSchema
  },
  [IpcChannel.tasksList]: {
    input: listTasksInputSchema,
    output: taskListSchema
  },
  [IpcChannel.tasksUpdate]: {
    input: updateTaskInputSchema,
    output: taskSchema.nullable()
  },
  [IpcChannel.tasksReorder]: {
    input: reorderTasksInputSchema,
    output: taskListSchema
  },
  [IpcChannel.tasksArchive]: {
    input: byIdInputSchema,
    output: taskSchema.nullable()
  },
  [IpcChannel.tasksUnarchive]: {
    input: byIdInputSchema,
    output: taskSchema.nullable()
  },

  [IpcChannel.calendarTasks]: {
    input: calendarTasksInputSchema,
    output: calendarTasksOutputSchema
  },

  [IpcChannel.timeStatus]: {
    input: noInputSchema,
    output: timeStatusOutputSchema
  },
  [IpcChannel.timeStart]: {
    input: timeStartInputSchema,
    output: timeStatusOutputSchema
  },
  [IpcChannel.timePause]: {
    input: noInputSchema,
    output: timeStatusOutputSchema
  },
  [IpcChannel.timeResume]: {
    input: noInputSchema,
    output: timeStatusOutputSchema
  },
  [IpcChannel.timeStop]: {
    input: noInputSchema,
    output: timeStatusOutputSchema
  },
  [IpcChannel.timeList]: {
    input: timeListInputSchema,
    output: timeEntryViewListSchema
  },
  [IpcChannel.timeSummary]: {
    input: timeSummaryInputSchema,
    output: timeSummaryOutputSchema
  },
  [IpcChannel.timeUpdate]: {
    input: timeUpdateInputSchema,
    output: timeEntryViewSchema.nullable()
  },
  [IpcChannel.timeAssign]: {
    input: timeAssignInputSchema,
    output: timeEntryViewSchema.nullable()
  },
  [IpcChannel.timeDelete]: {
    input: byIdInputSchema,
    output: z.boolean()
  },
  [IpcChannel.timeMerge]: {
    input: timeMergeInputSchema,
    output: timeEntryViewSchema
  },
  [IpcChannel.timeTaskTotals]: {
    input: timeTaskTotalsInputSchema,
    output: timeTaskTotalsOutputSchema
  }
} as const

export type IpcContractMap = typeof ipcContracts
