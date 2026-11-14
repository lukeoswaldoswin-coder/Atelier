import { join } from 'node:path'

export interface DataPaths {
  userDataDir: string
  dbPath: string
  backupDir: string
  recoveryArchiveDir: string
  stagingPath: string
  rollbackPath: string
  restoreStatePath: string
  orphanDir: string
}

/**
 * 所有数据安全相关路径的唯一来源。
 * 恢复现场文件与正式库位于同一目录，保证可以同卷 rename。
 */
export function createDataPaths(userDataDir: string): DataPaths {
  return {
    userDataDir,
    dbPath: join(userDataDir, 'atelier.db'),
    backupDir: join(userDataDir, 'backups'),
    recoveryArchiveDir: join(userDataDir, 'recovery-archive'),
    stagingPath: join(userDataDir, 'atelier.db.restore-staging'),
    rollbackPath: join(userDataDir, 'atelier.db.restore-rollback'),
    restoreStatePath: join(userDataDir, 'restore-state.json'),
    orphanDir: join(userDataDir, 'restore-orphans')
  }
}

export function sidecarPath(mainPath: string, suffix: '-wal' | '-shm'): string {
  return `${mainPath}${suffix}`
}
