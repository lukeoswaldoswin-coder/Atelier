import { copyFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { openDatabase } from '../db/database'
import { applyMigrations } from '../db/migrator'
import type { RestoreCandidate, RestoreOutcome } from '@shared/data'
import type { BackupService } from './backup-service'
import { hashFile, validateDatabaseFile } from './backup-validation'
import type { DataPaths } from './data-paths'
import { sidecarPath } from './data-paths'
import {
  moveDatabaseSet,
  newJournal,
  setPhase,
  writeJournal,
  type RestoreJournal
} from './restore-journal'
import { truncateWal, walFileIsEmpty } from './wal'

export interface RestoreServiceDeps {
  paths: DataPaths
  getDb: () => Database.Database | null
  timeService: { status: () => { manual: unknown | null } }
  monitor: {
    settleForRestore: () => { entryId: string; seconds: number } | null
    start: () => void
  }
  backups: BackupService
  stopTimeTicker: () => void
  startTimeTicker: () => void
  closeDatabase: () => void
  relaunch: () => void
  fatal: (message: string) => void
  now?: () => number
}

interface PendingRestore {
  token: string
  path: string
  sizeBytes: number
  mtimeMs: number
  hash: string
  schemaVersion: string | null
  createdAt: number
}

const TOKEN_TTL_MS = 10 * 60 * 1000

function stamp(): string {
  const iso = new Date().toISOString()
  const compact = iso.slice(0, 19).replace(/[-:T]/g, '')
  return `${compact.slice(0, 8)}-${compact.slice(8, 14)}-${iso.slice(20, 23)}`
}

function removeSet(mainPath: string): void {
  for (const path of [mainPath, sidecarPath(mainPath, '-wal'), sidecarPath(mainPath, '-shm')]) {
    rmSync(path, { force: true })
  }
}

export function createRestoreService(deps: RestoreServiceDeps) {
  const pending = new Map<string, PendingRestore>()
  const now = deps.now ?? (() => Date.now())

  function cleanupTokens(): void {
    const current = now()
    for (const [token, item] of pending) {
      if (current - item.createdAt > TOKEN_TTL_MS) pending.delete(token)
    }
  }

  /** 预检文件并生成一次性 token；不关闭或修改正式数据库。 */
  function prepare(path: string): RestoreCandidate {
    cleanupTokens()
    const stat = statSync(path)
    const hash = hashFile(path)
    const validation = validateDatabaseFile(path, { requireNoSidecars: true, allowOlder: true })
    if (!validation.ok) throw new Error(`备份不可用：${validation.reason ?? '未知原因'}`)

    const token = randomUUID()
    pending.set(token, {
      token,
      path,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      hash,
      schemaVersion: validation.schemaVersion,
      createdAt: now()
    })

    return {
      token,
      fileName: path.slice(path.lastIndexOf('\\') + 1),
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      schemaVersion: validation.schemaVersion
    }
  }

  function restore(token: string): RestoreOutcome {
    cleanupTokens()
    const item = pending.get(token)
    if (!item) throw new Error('恢复令牌无效或已过期，请重新选择备份')
    pending.delete(token)

    const currentStat = existsSync(item.path) ? statSync(item.path) : null
    if (!currentStat) throw new Error('备份文件已被移动或删除，请重新选择')
    if (currentStat.size !== item.sizeBytes || currentStat.mtimeMs !== item.mtimeMs) {
      throw new Error('备份文件在预检后发生变化，请重新选择')
    }
    if (hashFile(item.path) !== item.hash) {
      throw new Error('备份文件内容在预检后发生变化，请重新选择')
    }

    if (deps.timeService.status().manual !== null) {
      throw new Error('请先结束当前计时，再恢复数据库')
    }

    // 1. 复制到暂存区，校验复制完整性与数据库结构
    try {
      removeSet(deps.paths.stagingPath)
      copyFileSync(item.path, deps.paths.stagingPath)
      if (hashFile(deps.paths.stagingPath) !== item.hash) {
        throw new Error('暂存副本与源备份哈希不一致')
      }

      const stagingDb = openDatabase(deps.paths.stagingPath)
      try {
        applyMigrations(stagingDb)
        const checkpoint = truncateWal(stagingDb)
        if (!checkpoint.ok || !walFileIsEmpty(deps.paths.stagingPath)) {
          throw new Error('staging 数据库 WAL 无法安全收尾')
        }
      } finally {
        stagingDb.close()
      }

      if (!walFileIsEmpty(deps.paths.stagingPath)) {
        throw new Error('staging 数据库关闭后仍有未合并 WAL')
      }
      // 关闭后 WAL 已为空；SHM 是纯共享内存索引，删除后再作为单文件备份校验
      rmSync(sidecarPath(deps.paths.stagingPath, '-wal'), { force: true })
      rmSync(sidecarPath(deps.paths.stagingPath, '-shm'), { force: true })

      const validation = validateDatabaseFile(deps.paths.stagingPath, {
        requireNoSidecars: true,
        allowOlder: false
      })
      if (!validation.ok) throw new Error(`暂存数据库校验失败：${validation.reason ?? '未知原因'}`)
    } catch (error) {
      removeSet(deps.paths.stagingPath)
      throw error
    }

    // 2. 停止自动监测并结算自动工时；失败则恢复监测并中止
    let settled: { entryId: string; seconds: number } | null = null
    try {
      settled = deps.monitor.settleForRestore()
    } catch (error) {
      deps.monitor.start()
      throw new Error(`自动工时结算失败，已中止恢复：${error instanceof Error ? error.message : String(error)}`)
    }
    if (settled) {
      const running = deps
        .getDb()
        ?.prepare("SELECT COUNT(*) AS c FROM time_entries WHERE source='auto' AND status='running' AND deleted_at IS NULL")
        .get() as { c: number } | undefined
      if ((running?.c ?? 0) > 0) {
        deps.monitor.start()
        throw new Error('自动工时仍处于进行中，已中止恢复')
      }
    }

    // 3. 恢复前自动备份（包含刚结算的自动工时）
    let preRestoreBackup
    try {
      preRestoreBackup = deps.backups.createPreRestore()
    } catch (error) {
      deps.monitor.start()
      throw new Error(`恢复前自动备份失败，已中止恢复：${error instanceof Error ? error.message : String(error)}`)
    }

    // 4. 正式库 WAL 收尾；失败不得关闭/替换
    const db = deps.getDb()
    if (!db) {
      deps.monitor.start()
      throw new Error('数据库未打开，无法恢复')
    }
    deps.stopTimeTicker()
    const checkpoint = truncateWal(db)
    if (!checkpoint.ok || !walFileIsEmpty(deps.paths.dbPath)) {
      deps.startTimeTicker()
      deps.monitor.start()
      throw new Error('正式数据库 WAL 未能安全收尾，已中止恢复')
    }

    // 5. 关闭连接后替换
    deps.closeDatabase()

    const journal: RestoreJournal = newJournal({
      sourcePath: item.path,
      sourceHash: item.hash,
      stagingPath: deps.paths.stagingPath,
      rollbackPath: deps.paths.rollbackPath
    })
    journal.preRestoreBackup = preRestoreBackup.path
    setPhase(deps.paths.restoreStatePath, journal, 'backup-complete')

    try {
      moveDatabaseSet({
        journalPath: deps.paths.restoreStatePath,
        journal,
        fromMain: deps.paths.dbPath,
        toMain: deps.paths.rollbackPath,
        kindPrefix: 'current-to-rollback'
      })
      setPhase(deps.paths.restoreStatePath, journal, 'old-moved')

      moveDatabaseSet({
        journalPath: deps.paths.restoreStatePath,
        journal,
        fromMain: deps.paths.stagingPath,
        toMain: deps.paths.dbPath,
        kindPrefix: 'staging-to-current'
      })
      setPhase(deps.paths.restoreStatePath, journal, 'new-installed')

      const validation = validateDatabaseFile(deps.paths.dbPath, {
        requireNoSidecars: false,
        allowOlder: false
      })
      if (!validation.ok) throw new Error(validation.reason ?? '新数据库校验失败')

      setPhase(deps.paths.restoreStatePath, journal, 'validated')
      writeJournal(deps.paths.restoreStatePath, journal)

      // 新库已验证成功；rollback 保留给启动恢复归档，重启后由启动恢复处理
      setTimeout(deps.relaunch, 300)
      return {
        restarting: true,
        message: settled
          ? `恢复完成（已结算自动工时 ${settled.seconds} 秒），应用即将重启`
          : '恢复完成，应用即将重启'
      }
    } catch (error) {
      // 新库失败：保留失败新库，恢复 rollback；仍重启以重建服务
      try {
        const failedPath = `${deps.paths.dbPath}.restore-failed-${stamp()}`
        if (existsSync(deps.paths.dbPath)) {
          moveDatabaseSet({
            journalPath: deps.paths.restoreStatePath,
            journal,
            fromMain: deps.paths.dbPath,
            toMain: failedPath,
            kindPrefix: 'failed-new-to-failed'
          })
        }
        if (existsSync(deps.paths.rollbackPath)) {
          moveDatabaseSet({
            journalPath: deps.paths.restoreStatePath,
            journal,
            fromMain: deps.paths.rollbackPath,
            toMain: deps.paths.dbPath,
            kindPrefix: 'rollback-to-current'
          })
        }
        const restored = validateDatabaseFile(deps.paths.dbPath, {
          requireNoSidecars: false,
          allowOlder: true
        })
        if (!restored.ok) {
          deps.fatal(`恢复失败，且 rollback 也无法通过校验。请保留现场并联系支持。错误：${restored.reason ?? '未知'}`)
          return { restarting: false, message: '恢复失败，应用需要人工处理' }
        }
        setTimeout(deps.relaunch, 300)
        return {
          restarting: true,
          message: `恢复失败，已回滚到原数据库：${error instanceof Error ? error.message : String(error)}`
        }
      } catch (rollbackError) {
        deps.fatal(
          `恢复失败，回滚也失败。请保留 ${deps.paths.userDataDir} 并联系支持。${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`
        )
        return { restarting: false, message: '恢复失败，需要人工处理' }
      }
    }
  }

  return { prepare, restore }
}

export type RestoreService = ReturnType<typeof createRestoreService>
