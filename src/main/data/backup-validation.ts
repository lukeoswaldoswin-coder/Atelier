import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import Database from 'better-sqlite3'
import { MIGRATIONS } from '../db/migrations'
import { sidecarPath } from './data-paths'

export interface DatabaseValidation {
  ok: boolean
  reason: string | null
  schemaVersion: string | null
  appliedMigrations: string[]
  sizeBytes: number
}

export interface ValidateOptions {
  /** 要求源文件不带非空 WAL/SHM（用于外部备份） */
  requireNoSidecars?: boolean
  /** 允许比当前应用旧的 schema；默认允许，未知/更高版本拒绝 */
  allowOlder?: boolean
}

const KNOWN_MIGRATIONS = new Set(MIGRATIONS.map((migration) => migration.id))

function sidecarHasData(path: string): boolean {
  return existsSync(path) && statSync(path).size > 0
}

export function hashFile(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * 只读校验数据库文件。
 * 不打开正式库的写连接，不修改文件。
 */
export function validateDatabaseFile(
  path: string,
  options: ValidateOptions = {}
): DatabaseValidation {
  const sizeBytes = existsSync(path) ? statSync(path).size : 0
  if (!existsSync(path) || sizeBytes === 0) {
    return { ok: false, reason: '备份文件不存在或为空', schemaVersion: null, appliedMigrations: [], sizeBytes }
  }

  if (options.requireNoSidecars) {
    if (sidecarHasData(sidecarPath(path, '-wal'))) {
      return {
        ok: false,
        reason: '备份带有未合并的 WAL 数据，不是完整的单文件备份',
        schemaVersion: null,
        appliedMigrations: [],
        sizeBytes
      }
    }
    if (sidecarHasData(sidecarPath(path, '-shm'))) {
      return {
        ok: false,
        reason: '备份带有 -shm 旁文件，请使用 Atelier 创建的完整备份',
        schemaVersion: null,
        appliedMigrations: [],
        sizeBytes
      }
    }
  }

  let db: Database.Database | null = null
  try {
    db = new Database(path, { readonly: true, fileMustExist: true })
    const integrity = db.pragma('integrity_check') as Array<{ integrity_check: string }>
    const first = integrity[0]?.integrity_check
    if (first !== 'ok') {
      return { ok: false, reason: `完整性检查失败：${first ?? 'unknown'}`, schemaVersion: null, appliedMigrations: [], sizeBytes }
    }

    const foreignKeys = db.pragma('foreign_key_check') as Array<Record<string, unknown>>
    if (foreignKeys.length > 0) {
      return { ok: false, reason: `外键校验失败：${foreignKeys.length} 条违规`, schemaVersion: null, appliedMigrations: [], sizeBytes }
    }

    const hasMigrations = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get()
    if (!hasMigrations) {
      return { ok: false, reason: '不是 Atelier 数据库：缺少 schema_migrations', schemaVersion: null, appliedMigrations: [], sizeBytes }
    }

    const applied = (
      db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as Array<{ id: string }>
    ).map((row) => row.id)

    if (applied.length === 0) {
      return { ok: false, reason: '数据库没有任何迁移记录', schemaVersion: null, appliedMigrations: [], sizeBytes }
    }

    const unknown = applied.filter((id) => !KNOWN_MIGRATIONS.has(id))
    if (unknown.length > 0) {
      return {
        ok: false,
        reason: `备份来自更高或未知版本：${unknown.join(', ')}`,
        schemaVersion: applied.at(-1) ?? null,
        appliedMigrations: applied,
        sizeBytes
      }
    }

    if (!options.allowOlder) {
      const latest = MIGRATIONS.at(-1)?.id
      if (latest && applied.at(-1) !== latest) {
        return {
          ok: false,
          reason: '备份 schema 版本低于当前应用版本',
          schemaVersion: applied.at(-1) ?? null,
          appliedMigrations: applied,
          sizeBytes
        }
      }
    }

    return {
      ok: true,
      reason: null,
      schemaVersion: applied.at(-1) ?? null,
      appliedMigrations: applied,
      sizeBytes
    }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      schemaVersion: null,
      appliedMigrations: [],
      sizeBytes
    }
  } finally {
    db?.close()
  }
}
