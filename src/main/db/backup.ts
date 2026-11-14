import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppDatabase } from './database'
import { MIGRATIONS, type Migration } from './migrations'
import { getAppliedMigrations } from './migrator'

/**
 * 在应用待执行迁移之前，为文件数据库创建一致性快照。
 *
 * - 使用 `VACUUM INTO`：WAL 下也能得到完整、一致的副本；
 * - 全新空库（没有业务表、没有迁移记录）不需要备份；
 * - `:memory:` 测试库跳过；
 * - 没有待执行迁移时不产生文件。
 *
 * 迁移是前向不可逆的，这个备份就是恢复手段。备份不会自动删除。
 */
export function backupBeforeMigrations(
  filePath: string,
  db: AppDatabase,
  migrations: readonly Migration[] = MIGRATIONS
): string | null {
  if (filePath === ':memory:' || !existsSync(filePath)) return null

  const hasMigrationsTable =
    db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get() !== undefined

  const applied = new Set(hasMigrationsTable ? getAppliedMigrations(db).map((row) => row.id) : [])
  const pending = migrations.filter((migration) => !applied.has(migration.id))
  if (pending.length === 0) return null

  const tableCount = db
    .prepare(
      "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
    )
    .get() as { c: number }
  if (!hasMigrationsTable && tableCount.c === 0) return null

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = join(dirname(filePath), `atelier.db.bak-${stamp}`)
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  console.info(`[atelier] 迁移前备份: ${target}`)
  return target
}
