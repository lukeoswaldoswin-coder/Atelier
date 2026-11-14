import { MIGRATIONS, type Migration } from './migrations'
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

/**
 * 校验迁移清单本身是否合法：
 * id 非空且唯一，并且按字典序严格递增（保证执行顺序确定、可复现）。
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
    if (!migration.sql || migration.sql.trim().length === 0) {
      throw new Error(`迁移 ${migration.id} 的 SQL 为空`)
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
  migrations: readonly Migration[] = MIGRATIONS
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
    const insertRecord = db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')

    const runAll = db.transaction((list: readonly Migration[]) => {
      for (const migration of list) {
        db.exec(migration.sql)
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
