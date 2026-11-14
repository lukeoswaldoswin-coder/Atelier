import Database from 'better-sqlite3'

/** better-sqlite3 的数据库实例类型，供仓储层直接引用。 */
export type AppDatabase = Database.Database

/**
 * 打开数据库并设置运行参数。
 *
 * - journal_mode = WAL：读写并发更好，异常退出后也能自动恢复；
 * - foreign_keys = ON：SQLite 默认不强制外键，必须每个连接显式打开；
 * - busy_timeout：写锁冲突时最多等待 5 秒，而不是立刻抛错；
 * - synchronous = NORMAL：WAL 模式下兼顾数据安全与写入速度。
 */
export function openDatabase(filePath: string): AppDatabase {
  const db = new Database(filePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  db.pragma('synchronous = NORMAL')
  return db
}

/** 便于测试断言，确认外键约束真的生效。 */
export function isForeignKeysEnabled(db: AppDatabase): boolean {
  const row = db.pragma('foreign_keys', { simple: true })
  return row === 1
}
