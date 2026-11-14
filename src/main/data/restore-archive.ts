import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateDatabaseFile } from './backup-validation'
import { sidecarPath, type DataPaths } from './data-paths'
import { moveWithJournal, type RestoreJournal } from './restore-journal'
import { truncateWal, walFileIsEmpty } from './wal'

export type RollbackArchiveResult =
  | { mode: 'none' }
  | { mode: 'standalone'; path: string }
  | { mode: 'archive'; path: string }
  | { mode: 'failed'; reason: string }

function stamp(): string {
  const iso = new Date().toISOString()
  const compact = iso.slice(0, 19).replace(/[-:T]/g, '')
  return `${compact.slice(0, 8)}-${compact.slice(8, 14)}-${iso.slice(20, 23)}`
}

function removeSet(mainPath: string): void {
  for (const path of [mainPath, sidecarPath(mainPath, '-wal'), sidecarPath(mainPath, '-shm')]) {
    try {
      rmSync(path, { force: true })
    } catch {
      // 清理失败时保留文件，调用方仍可依赖独立备份
    }
  }
}

/**
 * 将 rollback 数据库集合转为普通恢复备份，或完整归档到专用恢复目录。
 *
 * 普通备份必须通过独立的 integrity/foreign_key/schema 校验；失败时绝不能
 * 把带 WAL 依赖的数据库放进 backups/。
 */
export function archiveRollbackSet(input: {
  paths: DataPaths
  journalPath?: string
  journal?: RestoreJournal
}): RollbackArchiveResult {
  const { paths, journalPath, journal } = input
  if (!existsSync(paths.rollbackPath)) return { mode: 'none' }

  try {
    const db = new Database(paths.rollbackPath)
    try {
      const checkpoint = truncateWal(db)
      if (!checkpoint.ok || !walFileIsEmpty(paths.rollbackPath)) {
        throw new Error('rollback WAL 无法安全收尾')
      }
    } finally {
      db.close()
    }

    mkdirSync(paths.backupDir, { recursive: true })
    const target = join(paths.backupDir, `Atelier-recovered-${stamp()}.db`)
    const writer = new Database(paths.rollbackPath)
    try {
      writer.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
    } finally {
      writer.close()
    }

    const validation = validateDatabaseFile(target, { requireNoSidecars: true })
    if (!validation.ok) {
      rmSync(target, { force: true })
      throw new Error(validation.reason ?? '恢复备份校验失败')
    }

    removeSet(paths.rollbackPath)
    return { mode: 'standalone', path: target }
  } catch {
    // 无法转为单文件备份：保留完整集合到专用恢复归档，不放入普通备份
    try {
      mkdirSync(paths.recoveryArchiveDir, { recursive: true })
      const targetDir = join(paths.recoveryArchiveDir, stamp())
      mkdirSync(targetDir, { recursive: true })
      const targetMain = join(targetDir, 'atelier.db.restore-rollback')

      if (journal && journalPath) {
        moveWithJournal({
          journalPath,
          journal,
          from: paths.rollbackPath,
          to: targetMain,
          kind: 'archive-rollback-main'
        })
        moveWithJournal({
          journalPath,
          journal,
          from: sidecarPath(paths.rollbackPath, '-wal'),
          to: sidecarPath(targetMain, '-wal'),
          kind: 'archive-rollback-wal',
          optional: true
        })
        moveWithJournal({
          journalPath,
          journal,
          from: sidecarPath(paths.rollbackPath, '-shm'),
          to: sidecarPath(targetMain, '-shm'),
          kind: 'archive-rollback-shm',
          optional: true
        })
      } else {
        // 启动恢复阶段没有活动日志时，仍按集合移动，失败则保留原位置
        renameSync(paths.rollbackPath, targetMain)
        for (const suffix of ['-wal', '-shm'] as const) {
          const from = sidecarPath(paths.rollbackPath, suffix)
          if (existsSync(from)) renameSync(from, sidecarPath(targetMain, suffix))
        }
      }

      writeFileSync(
        join(targetDir, 'manifest.json'),
        JSON.stringify(
          {
            reason: 'rollback 无法转换为独立单文件备份，已原样归档完整数据库集合',
            files: readdirSync(targetDir),
            createdAt: new Date().toISOString()
          },
          null,
          2
        ),
        'utf8'
      )
      return { mode: 'archive', path: targetDir }
    } catch (error) {
      return {
        mode: 'failed',
        reason: error instanceof Error ? error.message : String(error)
      }
    }
  }
}

export function rollbackSetSize(paths: DataPaths): number {
  const files = [
    paths.rollbackPath,
    sidecarPath(paths.rollbackPath, '-wal'),
    sidecarPath(paths.rollbackPath, '-shm')
  ]
  return files.reduce((total, path) => (existsSync(path) ? total + statSync(path).size : total), 0)
}
