import { useCallback, useEffect, useState } from 'react'
import type { BackupInfo, DataInfo } from '@shared/data'
import { getAtelierApi } from '@/lib/ipc'
import { formatIpcError } from '@/lib/ipc-error'

export interface DataManagementState {
  info: DataInfo | null
  backups: BackupInfo[]
  busy: boolean
  error: string | null
  message: string | null
  lastBackup: BackupInfo | null
  refresh: () => Promise<void>
  createBackup: () => Promise<void>
  reveal: () => Promise<void>
}

export function useDataManagement(): DataManagementState {
  const [info, setInfo] = useState<DataInfo | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [lastBackup, setLastBackup] = useState<BackupInfo | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [nextInfo, nextBackups] = await Promise.all([
        getAtelierApi().data.info(),
        getAtelierApi().backup.list()
      ])
      setInfo(nextInfo)
      setBackups(nextBackups)
      setError(null)
    } catch (caught) {
      setError(formatIpcError(caught))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function createBackup(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const backup = await getAtelierApi().backup.create()
      setLastBackup(backup)
      setMessage(`备份成功：${backup.path}`)
      await refresh()
    } catch (caught) {
      setError(formatIpcError(caught))
    } finally {
      setBusy(false)
    }
  }

  async function reveal(): Promise<void> {
    try {
      await getAtelierApi().backup.reveal()
    } catch (caught) {
      setError(formatIpcError(caught))
    }
  }

  return {
    info,
    backups,
    busy,
    error,
    message,
    lastBackup,
    refresh,
    createBackup,
    reveal
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
