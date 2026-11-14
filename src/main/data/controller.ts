import { existsSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import type { DataInfo, ExportResult, RestoreCandidate, RestoreOutcome } from '@shared/data'
import type { BackupService } from './backup-service'
import type { DataPaths } from './data-paths'
import { exportData } from './export-service'
import type { RestoreService } from './restore-service'

export interface DataControllerDeps {
  paths: DataPaths
  appVersion: string
  getSchemaVersion: () => string | null
  backups: BackupService
  restore: RestoreService
  pickRestoreFile: () => Promise<string | null>
  pickExportDirectory: () => Promise<string | null>
  revealPath: (path: string) => void
  openDirectory: (path: string) => void
}

/**
 * 数据管理的应用级入口。
 * P6.1 先提供信息与备份；恢复/导出在后续子阶段接入。
 */
export function createDataController(deps: DataControllerDeps) {
  function info(): DataInfo {
    const stat = existsSync(deps.paths.dbPath) ? statSync(deps.paths.dbPath) : null
    return {
      appVersion: deps.appVersion,
      dbPath: deps.paths.dbPath,
      backupDir: deps.paths.backupDir,
      recoveryArchiveDir: deps.paths.recoveryArchiveDir,
      dbSizeBytes: stat?.size ?? 0,
      schemaVersion: deps.getSchemaVersion(),
      backupCount: deps.backups.list().length,
      userDataDir: deps.paths.userDataDir
    }
  }

  return {
    info,
    createBackup: () => deps.backups.createManual(),
    listBackups: () => deps.backups.list(),
    revealBackup: (path?: string) => {
      const target = path ?? deps.backups.list()[0]?.path
      if (!target) {
        deps.openDirectory(deps.paths.backupDir)
        return false
      }
      deps.revealPath(target)
      return true
    },
    openBackupDirectory: () => {
      deps.openDirectory(deps.paths.backupDir)
      return true
    },
    pickRestore: async (): Promise<RestoreCandidate | null> => {
      const path = await deps.pickRestoreFile()
      if (!path) return null
      return deps.restore.prepare(path)
    },
    restore: (token: string): RestoreOutcome => deps.restore.restore(token),
    exportCsv: async (): Promise<ExportResult | null> => {
      const directory = await deps.pickExportDirectory()
      if (!directory) return null
      return exportData(directory, { dbPath: deps.paths.dbPath, appVersion: deps.appVersion })
    },
    getBackupFileName: (path: string) => basename(path)
  }
}

export type DataController = ReturnType<typeof createDataController>
