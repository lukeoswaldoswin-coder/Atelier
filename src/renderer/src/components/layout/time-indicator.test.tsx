import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TimeStatusOutput } from '@shared/domain'
import { TimeIndicator } from './time-indicator'
import { useTimeStore } from '@/stores/time-store'

const manualStatus: TimeStatusOutput = {
  manual: {
    entry: {
      id: '11111111-1111-4111-8111-111111111111',
      taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      source: 'manual',
      status: 'running',
      startedAt: '2026-11-14T02:00:00.000Z',
      endedAt: null,
      elapsedSeconds: 5,
      lastHeartbeatAt: '2026-11-14T02:00:05.000Z',
      appKey: null,
      mergedIntoId: null,
      note: null,
      clockSkewSeconds: null,
      deletedAt: null,
      createdAt: '2026-11-14T02:00:00.000Z',
      updatedAt: '2026-11-14T02:00:05.000Z'
    },
    task: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', title: '构图草稿', stage: 'draft' },
    commission: {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      title: '委托',
      clientName: '客户'
    }
  },
  auto: null,
  notice: null
}

describe('顶栏计时指示器', () => {
  beforeEach(() => {
    useTimeStore.setState({
      status: manualStatus,
      fetchedAt: Date.now(),
      error: null,
      busy: false,
      actionVersion: 0
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(window, 'atelier')
    useTimeStore.setState({ status: null, fetchedAt: 0 })
    vi.restoreAllMocks()
  })

  it('显示当前任务与累计时间，暂停会调用 IPC', async () => {
    const paused: TimeStatusOutput = {
      ...manualStatus,
      manual: manualStatus.manual
        ? {
            ...manualStatus.manual,
            entry: { ...manualStatus.manual.entry, status: 'paused' }
          }
        : null
    }
    const pause = vi.fn(async () => paused)
    Object.defineProperty(window, 'atelier', {
      configurable: true,
      value: { time: { pause } }
    })

    const user = userEvent.setup()
    render(<TimeIndicator />)

    expect(screen.getByTestId('time-indicator')).toHaveTextContent('构图草稿')
    expect(screen.getByTestId('time-indicator-elapsed')).toHaveTextContent('00:00:05')

    await user.click(screen.getByRole('button', { name: '暂停' }))

    await waitFor(() => expect(pause).toHaveBeenCalledTimes(1))
    expect(useTimeStore.getState().status?.manual?.entry.status).toBe('paused')
    expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument()
  })

  it('没有手动计时时显示自动记录状态', () => {
    useTimeStore.setState({
      status: {
        manual: null,
        auto: {
          ...manualStatus.manual!,
          entry: {
            ...manualStatus.manual!.entry,
            source: 'auto',
            taskId: null,
            appKey: 'photoshop'
          },
          task: null,
          commission: null
        },
        notice: null
      }
    })

    render(<TimeIndicator />)
    expect(screen.getByTestId('auto-indicator')).toHaveTextContent('自动记录中 · Adobe Photoshop')
  })

  it('没有计时也没有自动记录时不渲染', () => {
    useTimeStore.setState({ status: { manual: null, auto: null, notice: null } })
    const { container } = render(<TimeIndicator />)
    expect(container).toBeEmptyDOMElement()
  })

  it('任务计时会话显示任务名、累计时间与活跃状态', () => {
    const stopTask = vi.fn(async () => ({
      manual: null,
      auto: null,
      notice: null,
      taskSession: null
    }))
    Object.defineProperty(window, 'atelier', {
      configurable: true,
      value: { time: { stopTask } }
    })

    useTimeStore.setState({
      status: {
        manual: null,
        auto: null,
        notice: null,
        taskSession: {
          entry: {
            ...manualStatus.manual!,
            entry: {
              ...manualStatus.manual!.entry,
              source: 'auto',
              taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
            }
          },
          taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          state: 'running',
          accumulating: true,
          activeAppKey: 'photoshop',
          accumulatedSeconds: 125,
          sessionSeconds: 600,
          startedAt: '2026-11-14T02:00:00.000Z'
        }
      },
      fetchedAt: Date.now()
    })

    render(<TimeIndicator />)

    const indicator = screen.getByTestId('task-indicator')
    expect(indicator).toHaveTextContent('构图草稿')
    expect(screen.getByTestId('task-indicator-elapsed')).toHaveTextContent('00:02:05')
    // 累计 2 分 05 秒，而会话已持续 10 分钟，两者必须区分
    expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument()
  })

  it('任务计时手动暂停时显示继续按钮', () => {
    useTimeStore.setState({
      status: {
        manual: null,
        auto: null,
        notice: null,
        taskSession: {
          entry: {
            ...manualStatus.manual!,
            entry: {
              ...manualStatus.manual!.entry,
              source: 'auto',
              taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
            }
          },
          taskId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          state: 'paused',
          accumulating: false,
          activeAppKey: null,
          accumulatedSeconds: 60,
          sessionSeconds: 300,
          startedAt: '2026-11-14T02:00:00.000Z'
        }
      },
      fetchedAt: Date.now()
    })

    render(<TimeIndicator />)
    expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument()
  })
})
