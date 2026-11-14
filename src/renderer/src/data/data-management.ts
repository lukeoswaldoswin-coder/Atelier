import { useCallback, useEffect, useState } from 'react'
import type { BackupInfo, DataInfo, ExportResult, RestoreCandidate } from '@shared/data'
import { getAtelierApi } from '@/lib/ipc'
import { formatIpcError } from '@/lib/ipc-error'

export interface DataManagementState {
  info: DataInfo | null
  backups: BackupInfo[]
  busy: boolean
  error: string | null
  message: string | null
  lastBackup: BackupInfo | null
  restoreCandidate: RestoreCandidate | null
  restoring: boolean
  exportResult: ExportResult | null
  exporting: boolean
  refresh: () => Promise<void>
  createBackup: () => Promise<void>
  reveal: () => Promise<void>
  pickRestore: () => Promise<void>
  confirmRestore: () => Promise<void>
  cancelRestore: () => void
  exportCsv: () => Promise<void>
}

export function useDataManagement(): DataManagementState {
  const [info, setInfo] = useState<DataInfo | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [lastBackup, setLastBackup] = useState<BackupInfo | null>(null)
  const [restoreCandidate, setRestoreCandidate] = useState<RestoreCandidate | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [exportResult, setExportResult] = useState<ExportResult | null>(null)
  const [exporting, setExporting] = useState(false)

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

  async function pickRestore(): Promise<void> {
    setError(null)
    setMessage(null)
    try {
      const candidate = await getAtelierApi().backup.pickRestore()
      if (candidate) setRestoreCandidate(candidate)
    } catch (caught) {
      setError(formatIpcError(caught))
    }
  }

  async function confirmRestore(): Promise<void> {
    if (!restoreCandidate) return
    setRestoring(true)
    setError(null)
    try {
      const outcome = await getAtelierApi().backup.restore({ token: restoreCandidate.token })
      setRestoreCandidate(null)
      setMessage(outcome.message)
      if (!outcome.restarting) setError(outcome.message)
    } catch (caught) {
      setRestoreCandidate(null)
      setError(formatIpcError(caught))
    } finally {
      setRestoring(false)
    }
  }

  function cancelRestore(): void {
    setRestoreCandidate(null)
  }

  async function exportCsv(): Promise<void> {
    setExporting(true)
    setError(null)
    setMessage(null)
    try {
      const result = await getAtelierApi().exportData.csv()
      if (result) {
        setExportResult(result)
        setMessage(`已导出 ${result.totalRows} 行到：${result.folder}`)
      }
    } catch (caught) {
      setError(formatIpcError(caught))
    } finally {
      setExporting(false)
    }
  }

  return {
    info,
    backups,
    busy,
    error,
    message,
    lastBackup,
    restoreCandidate,
    restoring,
    exportResult,
    exporting,
    refresh,
    createBackup,
    reveal,
    pickRestore,
    confirmRestore,
    cancelRestore,
    exportCsv
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
