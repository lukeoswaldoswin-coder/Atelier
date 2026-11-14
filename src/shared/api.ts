import type {
  AssignableTask,
  ByIdInput,
  CalendarTasksInput,
  CalendarTasksOutput,
  Client,
  Commission,
  CreateClientInput,
  CreateCommissionInput,
  CreateTaskInput,
  ListClientsInput,
  ListCommissionsInput,
  ListTasksInput,
  MonitorStatusOutput,
  ReorderTasksInput,
  Task,
  TimeAssignInput,
  TimeEntryView,
  TimeListInput,
  TimeMergeInput,
  TimeStatusOutput,
  TimeSummaryInput,
  TimeSummaryOutput,
  TimeTaskTotalsOutput,
  TimeUpdateInput,
  UpdateClientInput,
  UpdateCommissionInput,
  UpdateTaskInput
} from './domain'
import type { ScheduleApplyInput, ScheduleApplyOutput } from './scheduling'
import type { BackupInfo, DataInfo, ExportResult, RestoreCandidate, RestoreOutcome } from './data'
import type { AppInfo } from './contracts'

/**
 * 渲染进程可见的全部原生能力。
 * 这是 preload 通过 contextBridge 暴露、渲染进程通过 window.atelier 访问的唯一入口，
 * 新增能力必须先在这里声明，再到主进程注册同名通道。
 *
 * 注意：这里没有任何数据库对象。渲染进程始终通过 IPC 请求主进程读写，
 * 数据库连接只存在于主进程。
 */
export interface AtelierApi {
  /** 读取应用与运行时版本信息（主进程提供，渲染进程无法伪造）。 */
  getAppInfo(): Promise<AppInfo>

  clients: {
    create(input: CreateClientInput): Promise<Client>
    list(input?: Partial<ListClientsInput>): Promise<Client[]>
    get(input: ByIdInput): Promise<Client | null>
    update(input: UpdateClientInput): Promise<Client | null>
    archive(input: ByIdInput): Promise<Client | null>
    unarchive(input: ByIdInput): Promise<Client | null>
  }

  commissions: {
    create(input: CreateCommissionInput): Promise<Commission>
    list(input?: Partial<ListCommissionsInput>): Promise<Commission[]>
    get(input: ByIdInput): Promise<Commission | null>
    update(input: UpdateCommissionInput): Promise<Commission | null>
    archive(input: ByIdInput): Promise<Commission | null>
    unarchive(input: ByIdInput): Promise<Commission | null>
  }

  tasks: {
    create(input: CreateTaskInput): Promise<Task>
    list(input: ListTasksInput): Promise<Task[]>
    update(input: UpdateTaskInput): Promise<Task | null>
    reorder(input: ReorderTasksInput): Promise<Task[]>
    archive(input: ByIdInput): Promise<Task | null>
    unarchive(input: ByIdInput): Promise<Task | null>
    listAll(): Promise<AssignableTask[]>
  }

  calendar: {
    tasks(input: CalendarTasksInput): Promise<CalendarTasksOutput>
  }

  schedule: {
    apply(input: ScheduleApplyInput): Promise<ScheduleApplyOutput>
  }

  data: {
    info(): Promise<DataInfo>
  }

  backup: {
    create(): Promise<BackupInfo>
    list(): Promise<BackupInfo[]>
    reveal(): Promise<boolean>
    pickRestore(): Promise<RestoreCandidate | null>
    restore(input: { token: string }): Promise<RestoreOutcome>
  }

  exportData: {
    csv(): Promise<ExportResult | null>
  }

  time: {
    status(): Promise<TimeStatusOutput>
    start(input: { taskId: string }): Promise<TimeStatusOutput>
    pause(): Promise<TimeStatusOutput>
    resume(): Promise<TimeStatusOutput>
    stop(): Promise<TimeStatusOutput>
    list(input: TimeListInput): Promise<TimeEntryView[]>
    summary(input: TimeSummaryInput): Promise<TimeSummaryOutput>
    update(input: TimeUpdateInput): Promise<TimeEntryView | null>
    assign(input: TimeAssignInput): Promise<TimeEntryView | null>
    remove(input: ByIdInput): Promise<boolean>
    merge(input: TimeMergeInput): Promise<TimeEntryView>
    taskTotals(input: { taskIds: string[] }): Promise<TimeTaskTotalsOutput>
  }

  monitor: {
    status(): Promise<MonitorStatusOutput>
    setEnabled(input: { enabled: boolean }): Promise<MonitorStatusOutput>
    setApps(input: { apps: string[] }): Promise<MonitorStatusOutput>
    setIdleMinutes(input: { idleMinutes: number }): Promise<MonitorStatusOutput>
    setIdleEnabled(input: { enabled: boolean }): Promise<MonitorStatusOutput>
  }
}
