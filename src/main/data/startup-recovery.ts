import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { validateDatabaseFile } from './backup-validation'
import { sidecarPath, type DataPaths } from './data-paths'
import { archiveRollbackSet } from './restore-archive'
import {
  moveDatabaseSet,
  newJournal,
  readJournal,
  setPhase,
  writeJournal,
  type RestoreJournal
} from './restore-journal'

export interface RecoveryResult {
  status: 'ok' | 'recovered' | 'fatal'
  message: string | null
  archivedRollback: string | null
}

function stamp(): string {
  const iso = new Date().toISOString()
  const compact = iso.slice(0, 19).replace(/[-:T]/g, '')
  return `${compact.slice(0, 8)}-${compact.slice(8, 14)}-${iso.slice(20, 23)}`
}

function cleanupFileSet(mainPath: string): void {
  for (const path of [mainPath, sidecarPath(mainPath, '-wal'), sidecarPath(mainPath, '-shm')]) {
    try {
      rmSync(path, { force: true })
    } catch {
      // 清理失败不覆盖主流程错误
    }
  }
}

function journalFor(paths: DataPaths, sourcePath: string): RestoreJournal {
  return (
    readJournal(paths.restoreStatePath) ??
    newJournal({
      sourcePath,
      sourceHash: '',
      stagingPath: paths.stagingPath,
      rollbackPath: paths.rollbackPath
    })
  )
}

/**
 * 启动恢复现场处理。
 * 必须根据实际文件、只读校验结果和逐文件操作日志决定，不能只看阶段名。
 */
export function recoverRestoreState(paths: DataPaths): RecoveryResult {
  // 先隔离无主 sidecar，避免它们与随后恢复的主文件被错误组合。
  quarantineOrphanSidecars(paths)

  const currentExists = existsSync(paths.dbPath)
  const rollbackExists = existsSync(paths.rollbackPath)
  const stagingExists = existsSync(paths.stagingPath)
  const journal = readJournal(paths.restoreStatePath)

  if (!currentExists && !rollbackExists) {
    if (stagingExists || journal) {
      return {
        status: 'fatal',
        message: '检测到未完成的恢复现场，但没有可用的正式数据库或 rollback。已保留全部文件，未创建空数据库。',
        archivedRollback: null
      }
    }
    return { status: 'ok', message: null, archivedRollback: null }
  }

  if (!currentExists && rollbackExists) {
    const rollbackValidation = validateDatabaseFile(paths.rollbackPath, { allowOlder: true })
    if (!rollbackValidation.ok) {
      return {
        status: 'fatal',
        message: `正式数据库缺失，rollback 也无法通过校验：${rollbackValidation.reason ?? '未知原因'}。已保留全部现场，未创建空数据库。`,
        archivedRollback: null
      }
    }

    const activeJournal = journalFor(paths, paths.rollbackPath)
    try {
      setPhase(paths.restoreStatePath, activeJournal, 'old-moved')
      moveDatabaseSet({
        journalPath: paths.restoreStatePath,
        journal: activeJournal,
        fromMain: paths.rollbackPath,
        toMain: paths.dbPath,
        kindPrefix: 'startup-restore-rollback'
      })
      const restored = validateDatabaseFile(paths.dbPath, { allowOlder: true })
      if (!restored.ok) throw new Error(restored.reason ?? '恢复后数据库校验失败')
      setPhase(paths.restoreStatePath, activeJournal, 'completed')
      rmSync(paths.restoreStatePath, { force: true })
      cleanupFileSet(paths.stagingPath)
      return { status: 'recovered', message: '已从 rollback 恢复正式数据库', archivedRollback: null }    } catch (error) {
      return {
        status: 'fatal',
        message: `从 rollback 恢复失败：${error instanceof Error ? error.message : String(error)}。已保留全部现场。`,
        archivedRollback: null
      }
    }
  }

  // 正式库存在：先只读验证，再处理 rollback
  const currentValidation = validateDatabaseFile(paths.dbPath, { allowOlder: true })

  if (!rollbackExists) {
    if (stagingExists && currentValidation.ok) cleanupFileSet(paths.stagingPath)
    if (!currentValidation.ok) {
      return {
        status: 'fatal',
        message: `正式数据库校验失败：${currentValidation.reason ?? '未知原因'}。已保留全部文件，未创建空数据库。`,
        archivedRollback: null
      }
    }
    if (journal) rmSync(paths.restoreStatePath, { force: true })
    return { status: 'ok', message: null, archivedRollback: null }
  }

  if (currentValidation.ok) {
    const activeJournal = journal ?? journalFor(paths, paths.rollbackPath)
    const archive = archiveRollbackSet({
      paths,
      journalPath: paths.restoreStatePath,
      journal: activeJournal
    })

    if (archive.mode === 'failed') {
      return {
        status: 'ok',
        message: `正式数据库有效，但 rollback 归档失败：${archive.reason}。rollback 已保留在原位置。`,
        archivedRollback: null
      }
    }

    setPhase(paths.restoreStatePath, activeJournal, 'completed')
    rmSync(paths.restoreStatePath, { force: true })
    if (stagingExists) cleanupFileSet(paths.stagingPath)
    return {
      status: 'ok',
      message: archive.mode === 'none' ? null : '正式数据库有效，rollback 已归档',
      archivedRollback: archive.mode === 'none' ? null : archive.path
    }
  }

  // 正式库无效：先验证 rollback，再移动，避免破坏唯一可用副本
  const rollbackValidation = validateDatabaseFile(paths.rollbackPath, { allowOlder: true })
  if (!rollbackValidation.ok) {
    return {
      status: 'fatal',
      message: `正式数据库与 rollback 均无法通过校验。正式库：${currentValidation.reason ?? '未知'}；rollback：${rollbackValidation.reason ?? '未知'}。已保留全部现场。`,
      archivedRollback: null
    }
  }

  const failedPath = `${paths.dbPath}.restore-failed-${stamp()}`
  const activeJournal = journal ?? journalFor(paths, paths.rollbackPath)
  try {
    mkdirSync(paths.userDataDir, { recursive: true })
    moveDatabaseSet({
      journalPath: paths.restoreStatePath,
      journal: activeJournal,
      fromMain: paths.dbPath,
      toMain: failedPath,
      kindPrefix: 'startup-current-to-failed'
    })
    moveDatabaseSet({
      journalPath: paths.restoreStatePath,
      journal: activeJournal,
      fromMain: paths.rollbackPath,
      toMain: paths.dbPath,
      kindPrefix: 'startup-rollback-to-current'
    })
    const restored = validateDatabaseFile(paths.dbPath, { allowOlder: true })
    if (!restored.ok) throw new Error(restored.reason ?? '恢复后数据库校验失败')
    setPhase(paths.restoreStatePath, activeJournal, 'completed')
    writeJournal(paths.restoreStatePath, activeJournal)
    cleanupFileSet(paths.stagingPath)
    return {
      status: 'recovered',
      message: `正式数据库损坏，已恢复 rollback；失败的新库保留在 ${failedPath}`,
      archivedRollback: failedPath
    }
  } catch (error) {
    return {
      status: 'fatal',
      message: `恢复 rollback 失败：${error instanceof Error ? error.message : String(error)}。已保留全部现场。`,
      archivedRollback: null
    }
  }
}

/** 启动时清理无主 sidecar，避免它们与新主文件组合。 */
export function quarantineOrphanSidecars(paths: DataPaths): void {
  for (const mainPath of [paths.dbPath, paths.rollbackPath, paths.stagingPath]) {
    if (existsSync(mainPath)) continue
    for (const suffix of ['-wal', '-shm'] as const) {
      const orphan = sidecarPath(mainPath, suffix)
      if (!existsSync(orphan)) continue
      try {
        mkdirSync(paths.orphanDir, { recursive: true })
        renameSync(orphan, `${paths.orphanDir}\\${stamp()}${suffix}`)
      } catch {
        // 隔离失败时保留原文件
      }
    }
  }
}
