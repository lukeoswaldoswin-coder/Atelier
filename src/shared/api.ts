import type {
  AssignableTask,
  ByIdInput,
  CalendarActivitySummaryInput,
  CalendarActivitySummaryOutput,
  CalendarDayDetailInput,
  CalendarDayDetailOutput,
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
  TimeStartTaskInput,
  TimeStatusView,
  TimeSummaryInput,
  TimeSummaryOutput,
  TimeTaskTotalsOutput,
  TimeUpdateInput,
  WorkbenchInput,
  WorkbenchOutput,
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
    /** 绘画任务工作台：跨委托聚合任务 */
    workbench(input?: Partial<WorkbenchInput>): Promise<WorkbenchOutput>
  }

  calendar: {
    tasks(input: CalendarTasksInput): Promise<CalendarTasksOutput>
    /** 月视图每日创作摘要：只返回有工时的日期（P6.7） */
    activity(input: CalendarActivitySummaryInput): Promise<CalendarActivitySummaryOutput>
    /** 某一天的创作详情：按任务聚合，未关联任务的记录单列（P6.7） */
    dayDetail(input: CalendarDayDetailInput): Promise<CalendarDayDetailOutput>
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
    status(): Promise<TimeStatusView>
    start(input: { taskId: string }): Promise<TimeStatusView>
    pause(): Promise<TimeStatusView>
    resume(): Promise<TimeStatusView>
    stop(): Promise<TimeStatusView>
    list(input: TimeListInput): Promise<TimeEntryView[]>
    summary(input: TimeSummaryInput): Promise<TimeSummaryOutput>
    update(input: TimeUpdateInput): Promise<TimeEntryView | null>
    assign(input: TimeAssignInput): Promise<TimeEntryView | null>
    remove(input: ByIdInput): Promise<boolean>
    merge(input: TimeMergeInput): Promise<TimeEntryView>
    taskTotals(input: { taskIds: string[] }): Promise<TimeTaskTotalsOutput>

    /** 任务计时会话（P6.6）：只累计绘画软件活跃时间 */
    startTask(input: TimeStartTaskInput): Promise<TimeStatusView>
    pauseTask(): Promise<TimeStatusView>
    resumeTask(): Promise<TimeStatusView>
    stopTask(): Promise<TimeStatusView>
  }

  monitor: {
    status(): Promise<MonitorStatusOutput>
    setEnabled(input: { enabled: boolean }): Promise<MonitorStatusOutput>
    setApps(input: { apps: string[] }): Promise<MonitorStatusOutput>
    setIdleMinutes(input: { idleMinutes: number }): Promise<MonitorStatusOutput>
    setIdleEnabled(input: { enabled: boolean }): Promise<MonitorStatusOutput>
  }
}
