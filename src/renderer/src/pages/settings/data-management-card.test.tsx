import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { BackupInfo, DataInfo } from '@shared/data'
import { DataManagementCard } from './data-management-card'

const INFO: DataInfo = {
  appVersion: '0.1.0',
  dbPath: 'C:\\Users\\test\\AppData\\Roaming\\atelier\\atelier.db',
  backupDir: 'C:\\Users\\test\\AppData\\Roaming\\atelier\\backups',
  recoveryArchiveDir: 'C:\\Users\\test\\AppData\\Roaming\\atelier\\recovery-archive',
  dbSizeBytes: 2048,
  schemaVersion: '005-time-entries',
  backupCount: 1,
  userDataDir: 'C:\\Users\\test\\AppData\\Roaming\\atelier'
}

const BACKUP: BackupInfo = {
  path: 'C:\\Users\\test\\AppData\\Roaming\\atelier\\backups\\Atelier-backup-20261114-120000-000.db',
  fileName: 'Atelier-backup-20261114-120000-000.db',
  sizeBytes: 2048,
  createdAt: '2026-11-14T12:00:00.000Z',
  schemaVersion: '005-time-entries',
  kind: 'manual'
}

function installApi(overrides: { create?: ReturnType<typeof vi.fn> } = {}) {
  const create = overrides.create ?? vi.fn(async () => BACKUP)
  const list = vi.fn(async () => [BACKUP])
  const reveal = vi.fn(async () => true)
  const pickRestore = vi.fn(async () => ({
    token: '11111111-1111-4111-8111-111111111111',
    fileName: 'Atelier-backup-20261114-120000-000.db',
    sizeBytes: 2048,
    modifiedAt: '2026-11-14T12:00:00.000Z',
    schemaVersion: '005-time-entries'
  }))
  const restore = vi.fn(async () => ({ restarting: true, message: '恢复完成，应用即将重启' }))
  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: {
      data: { info: vi.fn(async () => INFO) },
      backup: { create, list, reveal, pickRestore, restore }
    }
  })
  return { create, list, reveal, pickRestore, restore }
}

afterEach(() => {
  Reflect.deleteProperty(window, 'atelier')
  vi.restoreAllMocks()
})

describe('设置页：数据备份', () => {
  it('展示数据库路径、版本与备份数量', async () => {
    installApi()
    render(<DataManagementCard />)

    expect(await screen.findByTestId('data-db-path')).toHaveTextContent('atelier.db')
    expect(screen.getByTestId('data-backup-dir')).toHaveTextContent('backups')
    expect(screen.getByText('005-time-entries')).toBeInTheDocument()
    expect(screen.getByText(/1 个 · 2\.0 KB/)).toBeInTheDocument()
  })

  it('点击立即备份调用 IPC 并显示成功路径', async () => {
    const { create } = installApi()
    const user = userEvent.setup()
    render(<DataManagementCard />)

    await screen.findByTestId('data-db-path')
    await user.click(screen.getByRole('button', { name: '立即备份' }))

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    const message = await screen.findByTestId('backup-message')
    expect(message).toHaveTextContent('备份成功')
    expect(message).toHaveTextContent('Atelier-backup-20261114-120000-000.db')
    expect(screen.getByTestId('last-backup')).toHaveTextContent('Atelier-backup')
  })

  it('备份失败显示错误', async () => {
    installApi({
      create: vi.fn(async () => {
        throw new Error("Error invoking remote method 'backup:create': Error: 磁盘空间不足")
      })
    })
    const user = userEvent.setup()
    render(<DataManagementCard />)

    await screen.findByTestId('data-db-path')
    await user.click(screen.getByRole('button', { name: '立即备份' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('磁盘空间不足')
  })

  it('打开备份文件夹调用 IPC', async () => {
    const { reveal } = installApi()
    const user = userEvent.setup()
    render(<DataManagementCard />)

    await screen.findByTestId('data-db-path')
    await user.click(screen.getByRole('button', { name: '打开备份文件夹' }))
    await waitFor(() => expect(reveal).toHaveBeenCalledTimes(1))
  })

  it('选择备份后先显示替换确认，确认后调用恢复', async () => {
    const { pickRestore, restore } = installApi()
    const user = userEvent.setup()
    render(<DataManagementCard />)

    await screen.findByTestId('data-db-path')
    await user.click(screen.getByRole('button', { name: '从备份恢复' }))

    const dialog = await screen.findByTestId('confirm-dialog')
    expect(dialog).toHaveTextContent('用备份替换当前数据')
    expect(dialog).toHaveTextContent('Atelier-backup-20261114-120000-000.db')
    await user.click(within(dialog).getByRole('button', { name: '确认恢复' }))

    await waitFor(() =>
      expect(restore).toHaveBeenCalledWith({ token: '11111111-1111-4111-8111-111111111111' })
    )
    expect(pickRestore).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('恢复完成，应用即将重启')).toBeInTheDocument()
  })

  it('取消恢复确认不会调用恢复', async () => {
    const { restore } = installApi()
    const user = userEvent.setup()
    render(<DataManagementCard />)

    await screen.findByTestId('data-db-path')
    await user.click(screen.getByRole('button', { name: '从备份恢复' }))
    const dialog = await screen.findByTestId('confirm-dialog')
    await user.click(within(dialog).getByRole('button', { name: '取消' }))

    expect(restore).not.toHaveBeenCalled()
    expect(screen.queryByTestId('confirm-dialog')).not.toBeInTheDocument()
  })
})
