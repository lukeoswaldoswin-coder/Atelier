import { resolveSystemTimeZone } from '@shared/time'
import { MIGRATIONS, type Migration, type MigrationContext } from './migrations'
import type { AppDatabase } from './database'

export interface AppliedMigration {
  readonly id: string
  readonly name: string
  readonly appliedAt: string
}

export interface MigrationRunResult {
  /** 本次实际执行的迁移 id */
  readonly applied: readonly string[]
  /** 本次之前就已存在的迁移 id */
  readonly previouslyApplied: readonly string[]
}

export interface MigrationOptions {
  /** 覆盖迁移上下文里的时区（测试用） */
  readonly timeZone?: string
  /** 覆盖迁移上下文里的时间（测试用） */
  readonly now?: string
}

/**
 * 校验迁移清单本身是否合法：
 * id 非空且唯一、按字典序严格递增（保证执行顺序确定、可复现），
 * 并且每个迁移必须提供 sql 或 run 之一。
 */
export function assertValidMigrationList(migrations: readonly Migration[]): void {
  let previousId = ''
  const seen = new Set<string>()

  for (const migration of migrations) {
    if (!migration.id || migration.id.trim().length === 0) {
      throw new Error('迁移 id 不能为空')
    }
    if (seen.has(migration.id)) {
      throw new Error(`迁移 id 重复：${migration.id}`)
    }
    if (migration.id <= previousId) {
      throw new Error(`迁移必须按 id 递增排列：${previousId} → ${migration.id}`)
    }

    const hasSql = typeof migration.sql === 'string' && migration.sql.trim().length > 0
    const hasRun = typeof migration.run === 'function'
    if (!hasSql && !hasRun) {
      throw new Error(`迁移 ${migration.id} 既没有 SQL 也没有执行函数`)
    }

    seen.add(migration.id)
    previousId = migration.id
  }
}

/** 读取已执行的迁移记录（按 id 排序）。 */
export function getAppliedMigrations(db: AppDatabase): AppliedMigration[] {
  return db
    .prepare('SELECT id, name, applied_at AS appliedAt FROM schema_migrations ORDER BY id')
    .all() as AppliedMigration[]
}

/**
 * 执行尚未应用的迁移。
 *
 * - 迁移记录表由本函数负责创建，因此新数据库无需手工初始化；
 * - 所有待执行的迁移在**同一个事务**里完成，任一失败则全部回滚；
 * - 重复调用是安全的（幂等），可反复执行而不会重复建表。
 */
export function applyMigrations(
  db: AppDatabase,
  migrations: readonly Migration[] = MIGRATIONS,
  options: MigrationOptions = {}
): MigrationRunResult {
  assertValidMigrationList(migrations)

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY NOT NULL,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `)

  const previouslyApplied = getAppliedMigrations(db).map((row) => row.id)
  const appliedSet = new Set(previouslyApplied)
  const pending = migrations.filter((migration) => !appliedSet.has(migration.id))

  if (pending.length > 0) {
    const appliedAt = new Date().toISOString()
    const context: MigrationContext = {
      timeZone: options.timeZone ?? resolveSystemTimeZone(),
      now: options.now ?? appliedAt
    }
    const insertRecord = db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')

    const runAll = db.transaction((list: readonly Migration[]) => {
      for (const migration of list) {
        if (typeof migration.run === 'function') {
          migration.run(db, context)
        } else {
          db.exec(migration.sql as string)
        }
        insertRecord.run(migration.id, migration.name, appliedAt)
      }
    })

    runAll(pending)
  }

  return {
    applied: pending.map((migration) => migration.id),
    previouslyApplied
  }
}
