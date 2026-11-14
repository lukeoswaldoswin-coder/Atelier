import type { AppDatabase } from './database'

/**
 * 主动检查外键完整性。
 *
 * 注意：`PRAGMA foreign_key_check` 只把违规记录作为结果返回，**不会**自己抛错。
 * 迁移里必须调用本函数，否则违规数据会静默通过，事务也不会回滚。
 */
export function assertNoForeignKeyViolations(db: AppDatabase, label: string): void {
  const violations = db.pragma('foreign_key_check') as Array<Record<string, unknown>>
  if (Array.isArray(violations) && violations.length > 0) {
    throw new Error(
      `${label} 外键校验失败：发现 ${violations.length} 条违规记录 ${JSON.stringify(
        violations.slice(0, 3)
      )}`
    )
  }
}
