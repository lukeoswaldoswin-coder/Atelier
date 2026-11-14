import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import type { BackupInfo } from '@shared/data'
import { validateDatabaseFile } from './backup-validation'
import type { DataPaths } from './data-paths'

export interface BackupServiceDeps {
  paths: DataPaths
  getDb: () => Database | null
  now?: () => Date
}

const BACKUP_PATTERN = /^Atelier-(backup|pre-restore)-(\d{8})-(\d{6})-(\d{3})\.db$/

function sqliteQuote(value: string): string {
  return value.replace(/'/g, "''")
}

export function createBackupService(deps: BackupServiceDeps) {
  const now = deps.now ?? (() => new Date())

  function ensureDir(): void {
    mkdirSync(deps.paths.backupDir, { recursive: true })
  }

  function stamp(date: Date): string {
    const iso = date.toISOString()
    const compact = iso.slice(0, 19).replace(/[-:T]/g, '')
    return `${compact.slice(0, 8)}-${compact.slice(8, 14)}-${iso.slice(20, 23)}`
  }

  function uniqueTarget(kind: 'backup' | 'pre-restore', date: Date): string {
    const base = `Atelier-${kind}-${stamp(date)}`
    let candidate = join(deps.paths.backupDir, `${base}.db`)
    let suffix = 1
    while (true) {
      try {
        statSync(candidate)
        candidate = join(deps.paths.backupDir, `${base}-${suffix}.db`)
        suffix += 1
      } catch {
        return candidate
      }
    }
  }

  function create(kind: 'manual' | 'pre-restore'): BackupInfo {
    const db = deps.getDb()
    if (!db) throw new Error('数据库未打开，无法备份')

    ensureDir()
    const date = now()
    const target = uniqueTarget(kind === 'manual' ? 'backup' : 'pre-restore', date)

    try {
      db.exec(`VACUUM INTO '${sqliteQuote(target)}'`)
    } catch (error) {
      try {
        unlinkSync(target)
      } catch {
        // 目标不存在或删除失败时不掩盖原始错误
      }
      throw new Error(`备份失败：${error instanceof Error ? error.message : String(error)}`)
    }

    const validation = validateDatabaseFile(target, { requireNoSidecars: true, allowOlder: true })
    if (!validation.ok) {
      try {
        unlinkSync(target)
      } catch {
        // 校验失败时尽量清理
      }
      throw new Error(`备份校验失败：${validation.reason ?? '未知原因'}`)
    }

    return {
      path: target,
      fileName: target.slice(target.lastIndexOf('\\') + 1),
      sizeBytes: statSync(target).size,
      createdAt: date.toISOString(),
      schemaVersion: validation.schemaVersion,
      kind
    }
  }

  function list(): BackupInfo[] {
    ensureDir()
    return readdirSync(deps.paths.backupDir)
      .filter((name) => BACKUP_PATTERN.test(name))
      .map((name) => {
        const path = join(deps.paths.backupDir, name)
        const stat = statSync(path)
        return {
          path,
          fileName: name,
          sizeBytes: stat.size,
          createdAt: stat.mtime.toISOString(),
          schemaVersion: null,
          kind: name.includes('pre-restore') ? ('pre-restore' as const) : ('manual' as const)
        }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  return {
    createManual: () => create('manual'),
    createPreRestore: () => create('pre-restore'),
    list,
    backupDir: deps.paths.backupDir
  }
}

export type BackupService = ReturnType<typeof createBackupService>
