import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
  Object.defineProperty(window, 'atelier', {
    configurable: true,
    value: {
      data: { info: vi.fn(async () => INFO) },
      backup: { create, list, reveal }
    }
  })
  return { create, list, reveal }
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
})
