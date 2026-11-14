import { applyMigrations, type MigrationRunResult } from './migrator'
import { openDatabase, type AppDatabase } from './database'
import { backupBeforeMigrations } from './backup'
import { createClientsRepository, type ClientsRepository } from './repositories/clients'
import { createCommissionsRepository, type CommissionsRepository } from './repositories/commissions'
import { createTasksRepository, type TasksRepository } from './repositories/tasks'
import { createTimeEntriesRepository, type TimeEntriesRepository } from './repositories/time-entries'
import { createSettingsRepository, type SettingsRepository } from './repositories/settings'

export interface DatabaseService {
  readonly filePath: string
  readonly db: AppDatabase
  readonly clients: ClientsRepository
  readonly commissions: CommissionsRepository
  readonly tasks: TasksRepository
  readonly timeEntries: TimeEntriesRepository
  readonly settings: SettingsRepository
  readonly migration: MigrationRunResult
  /** 本次启动是否在迁移前创建了备份 */
  readonly backupPath: string | null
  /** 幂等关闭：重复调用不会报错。 */
  close(): void
}

/**
 * 创建数据库服务：打开文件、设置参数、迁移前备份、执行迁移、装配仓储。
 *
 * 数据库文件由调用方决定（正式运行时是用户数据目录），
 * 因此测试可以指向临时目录或 :memory:，不会污染真实数据。
 */
export function createDatabaseService(filePath: string): DatabaseService {
  const db = openDatabase(filePath)
  const backupPath = backupBeforeMigrations(filePath, db)
  const migration = applyMigrations(db)

  return {
    filePath,
    db,
    migration,
    backupPath,
    clients: createClientsRepository(db),
    commissions: createCommissionsRepository(db),
    tasks: createTasksRepository(db),
    timeEntries: createTimeEntriesRepository(db),
    settings: createSettingsRepository(db),
    close(): void {
      if (db.open) db.close()
    }
  }
}
