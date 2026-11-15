import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Task, TimeStatusView, WorkbenchOutput, WorkbenchTask } from '@shared/domain'
import { useNavigationStore } from '@/stores/navigation-store'
import { useTimeStore } from '@/stores/time-store'
import { TasksPage } from './tasks-page'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: '人物线稿',
    description: null,
    stage: 'lineart',
    status: 'todo',
    estimatedMinutes: 120,
    plannedDate: null,
    sortOrder: 0,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides
  }
}

function makeItem(overrides: Partial<WorkbenchTask> = {}): WorkbenchTask {
  return {
    task: makeTask(),
    commission: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: '半身立绘',
      status: 'active',
      archivedAt: null
    },
    clientName: '客户甲',
    actualSeconds: 0,
    ...overrides
  }
}

function emptyStatus(overrides: Partial<TimeStatusView> = {}): TimeStatusView {
  return { manual: null, auto: null, notice: null, taskSession: null, ...overrides }
}

function makeApi(workbench: WorkbenchOutput) {
  return {
    getAppInfo: vi.fn(),
    tasks: {
      listAll: vi.fn(async () => []),
      workbench: vi.fn(async () => workbench),
      update: vi.fn(async () => makeTask()),
      create: vi.fn(),
      list: vi.fn(async () => []),
      reorder: vi.fn(),
      archive: vi.fn(),
      unarchive: vi.fn()
    },
    time: {
      status: vi.fn(async () => emptyStatus()),
      startTask: vi.fn(async () => emptyStatus()),
      pauseTask: vi.fn(async () => emptyStatus()),
      resumeTask: vi.fn(async () => emptyStatus()),
      stopTask: vi.fn(async () => emptyStatus()),
      taskTotals: vi.fn(async () => [])
    }
  }
}

const pendingItem = makeItem()
const doneItem = makeItem({
  task: makeTask({
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    title: '背景上色',
    stage: 'color',
    status: 'done',
    completedAt: '2026-01-02T00:00:00.000Z'
  }),
  actualSeconds: 3600
})

function install(api: ReturnType<typeof makeApi>): void {
  Object.defineProperty(window, 'atelier', { configurable: true, value: api })
}

beforeEach(() => {
  useTimeStore.setState({ status: emptyStatus(), fetchedAt: 0, busy: false, error: null, actionVersion: 0 })
  useNavigationStore.setState({ active: 'tasks' })
})

afterEach(() => {
  Reflect.deleteProperty(window, 'atelier')
  vi.restoreAllMocks()
})

describe('绘画任务工作台', () => {
  it('聚合多个委托的任务并显示委托与客户信息', async () => {
    const api = makeApi({
      pending: [
        pendingItem,
        makeItem({
          task: makeTask({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: '最终完稿' }),
          commission: {
            id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            title: '风景插画',
            status: 'active',
            archivedAt: null
          },
          clientName: '客户乙'
        })
      ],
      done: []
    })
    install(api)

    render(<TasksPage />)

    expect(await screen.findByText('人物线稿')).toBeInTheDocument()
    expect(screen.getByText('最终完稿')).toBeInTheDocument()
    expect(screen.getByText('半身立绘 · 客户甲')).toBeInTheDocument()
    expect(screen.getByText('风景插画 · 客户乙')).toBeInTheDocument()
  })

  it('没有会话时显示空状态，不展示虚假计时数字', async () => {
    install(makeApi({ pending: [pendingItem], done: [] }))
    render(<TasksPage />)

    expect(await screen.findByTestId('current-session-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('session-accumulated')).not.toBeInTheDocument()
    expect(screen.getByText(/从下方选择一个绘画任务开始计时/)).toBeInTheDocument()
  })

  it('显示任务阶段、状态、预计工时与实际工时', async () => {
    install(makeApi({ pending: [makeItem({ actualSeconds: 1800 })], done: [] }))
    render(<TasksPage />)

    expect(await screen.findByText('人物线稿')).toBeInTheDocument()
    expect(screen.getByText('人物线稿')).toBeInTheDocument()
    expect(screen.getByText('待开始')).toBeInTheDocument()
    expect(screen.getByText('预计 2 小时')).toBeInTheDocument()
    expect(screen.getByText('· 实际 30 分钟')).toBeInTheDocument()
  })

  it('点击开始计时会调用任务计时接口', async () => {
    const api = makeApi({ pending: [pendingItem], done: [] })
    install(api)
    const user = userEvent.setup()

    render(<TasksPage />)
    await screen.findByText('人物线稿')
    await user.click(screen.getByRole('button', { name: '开始计时' }))

    await waitFor(() => {
      expect(api.time.startTask).toHaveBeenCalledWith({ taskId: pendingItem.task.id, replaceCurrent: false })
    })
  })

  it('已有其它任务在计时时先询问再切换', async () => {
    const api = makeApi({ pending: [pendingItem], done: [] })
    install(api)

    useTimeStore.setState({
      status: emptyStatus({
        taskSession: {
          entry: {
            entry: {
              id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
              taskId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
              source: 'auto',
              status: 'running',
              startedAt: '2026-11-15T06:00:00.000Z',
              endedAt: null,
              elapsedSeconds: 600,
              lastHeartbeatAt: '2026-11-15T06:10:00.000Z',
              appKey: null,
              mergedIntoId: null,
              note: null,
              clockSkewSeconds: null,
              deletedAt: null,
              createdAt: '2026-11-15T06:00:00.000Z',
              updatedAt: '2026-11-15T06:10:00.000Z'
            },
            task: { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', title: '最终完稿', stage: 'final' },
            commission: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '半身立绘', clientName: '客户甲' }
          },
          taskId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          state: 'running',
          accumulating: true,
          activeAppKey: 'photoshop',
          accumulatedSeconds: 600,
          sessionSeconds: 900,
          startedAt: '2026-11-15T06:00:00.000Z'
        }
      })
    })

    const user = userEvent.setup()
    render(<TasksPage />)
    await screen.findByText('人物线稿')

    await user.click(screen.getByRole('button', { name: '开始计时' }))
    expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '结束并开始' }))

    await waitFor(() => {
      expect(api.time.startTask).toHaveBeenCalledWith({
        taskId: pendingItem.task.id,
        replaceCurrent: true
      })
    })
  })

  it('当前会话区分实际累计工时与会话持续时间', async () => {
    install(makeApi({ pending: [], done: [] }))

    useTimeStore.setState({
      status: emptyStatus({
        taskSession: {
          entry: {
            entry: {
              id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
              taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              source: 'auto',
              status: 'running',
              startedAt: '2026-11-15T06:00:00.000Z',
              endedAt: null,
              elapsedSeconds: 3300,
              lastHeartbeatAt: '2026-11-15T06:55:00.000Z',
              appKey: null,
              mergedIntoId: null,
              note: null,
              clockSkewSeconds: null,
              deletedAt: null,
              createdAt: '2026-11-15T06:00:00.000Z',
              updatedAt: '2026-11-15T06:55:00.000Z'
            },
            task: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: '人物线稿', stage: 'lineart' },
            commission: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '半身立绘', clientName: '客户甲' }
          },
          taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          state: 'running',
          accumulating: false,
          activeAppKey: null,
          accumulatedSeconds: 3300,
          sessionSeconds: 5400,
          startedAt: '2026-11-15T06:00:00.000Z'
        }
      })
    })

    render(<TasksPage />)

    expect(await screen.findByTestId('current-session')).toBeInTheDocument()
    // 实际累计 55 分钟，会话持续 90 分钟，两者必须不同
    expect(screen.getByTestId('session-accumulated')).toHaveTextContent('00:55:00')
    expect(screen.getByTestId('session-elapsed')).toHaveTextContent('01:30:00')
    expect(screen.getByTestId('session-state')).toHaveTextContent('暂停累计：当前未检测到绘画软件活动')
  })

  it('手动暂停时显示暂停文案并可继续', async () => {
    const api = makeApi({ pending: [], done: [] })
    install(api)

    useTimeStore.setState({
      status: emptyStatus({
        taskSession: {
          entry: {
            entry: {
              id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
              taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              source: 'auto',
              status: 'running',
              startedAt: '2026-11-15T06:00:00.000Z',
              endedAt: null,
              elapsedSeconds: 600,
              lastHeartbeatAt: '2026-11-15T06:10:00.000Z',
              appKey: null,
              mergedIntoId: null,
              note: null,
              clockSkewSeconds: null,
              deletedAt: null,
              createdAt: '2026-11-15T06:00:00.000Z',
              updatedAt: '2026-11-15T06:10:00.000Z'
            },
            task: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: '人物线稿', stage: 'lineart' },
            commission: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '半身立绘', clientName: '客户甲' }
          },
          taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          state: 'paused',
          accumulating: false,
          activeAppKey: null,
          accumulatedSeconds: 600,
          sessionSeconds: 1200,
          startedAt: '2026-11-15T06:00:00.000Z'
        }
      })
    })

    const user = userEvent.setup()
    render(<TasksPage />)

    expect(await screen.findByTestId('session-state')).toHaveTextContent('手动暂停：用户已暂停本次计时')
    await user.click(screen.getByRole('button', { name: '继续计时' }))

    await waitFor(() => expect(api.time.resumeTask).toHaveBeenCalled())
  })

  it('已完成任务默认折叠，可展开查看', async () => {
    install(makeApi({ pending: [pendingItem], done: [doneItem] }))
    const user = userEvent.setup()

    render(<TasksPage />)
    await screen.findByText('人物线稿')

    // 默认折叠：已完成任务不占据主区域
    expect(screen.queryByText('背景上色')).not.toBeInTheDocument()
    expect(screen.getByText(/已完成任务（1）/)).toBeInTheDocument()

    await user.click(screen.getByText(/已完成任务（1）/))
    expect(await screen.findByText('背景上色')).toBeInTheDocument()
  })

  it('标记完成会更新任务状态', async () => {
    const api = makeApi({ pending: [pendingItem], done: [] })
    install(api)
    const user = userEvent.setup()

    render(<TasksPage />)
    await screen.findByText('人物线稿')
    await user.click(screen.getByRole('button', { name: '标记完成' }))

    await waitFor(() => {
      expect(api.tasks.update).toHaveBeenCalledWith({ id: pendingItem.task.id, status: 'done' })
    })
  })

  it('正在计时的任务不能直接标记完成，需先结束计时', async () => {
    const api = makeApi({ pending: [pendingItem], done: [] })
    install(api)

    useTimeStore.setState({
      status: emptyStatus({
        taskSession: {
          entry: {
            entry: {
              id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
              taskId: pendingItem.task.id,
              source: 'auto',
              status: 'running',
              startedAt: '2026-11-15T06:00:00.000Z',
              endedAt: null,
              elapsedSeconds: 600,
              lastHeartbeatAt: '2026-11-15T06:10:00.000Z',
              appKey: null,
              mergedIntoId: null,
              note: null,
              clockSkewSeconds: null,
              deletedAt: null,
              createdAt: '2026-11-15T06:00:00.000Z',
              updatedAt: '2026-11-15T06:10:00.000Z'
            },
            task: { id: pendingItem.task.id, title: '人物线稿', stage: 'lineart' },
            commission: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '半身立绘', clientName: '客户甲' }
          },
          taskId: pendingItem.task.id,
          state: 'running',
          accumulating: true,
          activeAppKey: 'photoshop',
          accumulatedSeconds: 600,
          sessionSeconds: 900,
          startedAt: '2026-11-15T06:00:00.000Z'
        }
      })
    })

    const user = userEvent.setup()
    render(<TasksPage />)
    await screen.findByText('人物线稿')

    await user.click(screen.getByRole('button', { name: '标记完成' }))
    expect(await screen.findByTestId('confirm-dialog')).toBeInTheDocument()
    // 未确认前不能直接改状态
    expect(api.tasks.update).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '结束计时并完成' }))

    await waitFor(() => expect(api.time.stopTask).toHaveBeenCalled())
    await waitFor(() => {
      expect(api.tasks.update).toHaveBeenCalledWith({ id: pendingItem.task.id, status: 'done' })
    })
  })

  it('没有任务时显示空状态提示', async () => {
    install(makeApi({ pending: [], done: [] }))
    render(<TasksPage />)

    expect(await screen.findByText(/还没有待处理的绘画任务/)).toBeInTheDocument()
  })

  it('从日历跳转过来时定位高亮目标任务，并清空一次性意图', async () => {
    install(makeApi({ pending: [pendingItem], done: [doneItem] }))
    useNavigationStore.setState({ focusTaskId: doneItem.task.id })

    render(<TasksPage />)

    // 已完成任务默认折叠，定位时必须自动展开，否则高亮不可见
    const row = await waitFor(() => {
      const found = document.querySelector(`[data-task-id="${doneItem.task.id}"]`)
      expect(found).not.toBeNull()
      return found as HTMLElement
    })
    expect(row).toHaveAttribute('data-focused', 'true')
    expect(row).toHaveTextContent('背景上色')

    // 意图只消费一次
    await waitFor(() => expect(useNavigationStore.getState().focusTaskId).toBeNull())
  })

  it('定位意图指向不存在的任务时直接丢弃，不影响页面', async () => {
    install(makeApi({ pending: [pendingItem], done: [] }))
    useNavigationStore.setState({ focusTaskId: '99999999-9999-4999-8999-999999999999' })

    render(<TasksPage />)
    await screen.findByText('人物线稿')

    await waitFor(() => expect(useNavigationStore.getState().focusTaskId).toBeNull())
    expect(screen.getByText('人物线稿')).toBeInTheDocument()
  })
})
