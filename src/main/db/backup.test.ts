import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './database'
import { applyMigrations } from './migrator'
import { MIGRATIONS, type Migration } from './migrations'
import { createDatabaseService } from './service'
import { backupBeforeMigrations } from './backup'

const m001 = MIGRATIONS[0] as Migration
const m002 = MIGRATIONS[1] as Migration

describe('迁移前自动备份', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atelier-backup-'))
  })

  afterEach(() => {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows 上偶尔句柄未释放，不影响断言结果
    }
  })

  function backups(): string[] {
    return readdirSync(dir).filter((name) => name.startsWith('atelier.db.bak-'))
  }

  it('从 002 升级到 003 前会生成备份，且备份里没有 tasks 表', () => {
    const filePath = join(dir, 'atelier.db')
    const legacy = openDatabase(filePath)
    applyMigrations(legacy, [m001, m002])
    legacy.close()

    const service = createDatabaseService(filePath)

    expect(service.migration.applied).toEqual(['003-tasks', '004-task-planned-date',  '005-time-entries'])
    expect(service.backupPath).not.toBeNull()
    expect(existsSync(service.backupPath as string)).toBe(true)
    expect(backups()).toHaveLength(1)

    // 备份是可用的 SQLite 文件，且停留在 002
    const backup = openDatabase(service.backupPath as string)
    const tables = (
      backup
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name)
    const migrations = (
      backup.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as Array<{ id: string }>
    ).map((row) => row.id)

    expect(tables).not.toContain('tasks')
    expect(migrations).toEqual(['001-initial', '002-deadline-and-payment'])
    backup.close()
    service.close()
  })

  it('没有待执行迁移时不会重复备份', () => {
    const filePath = join(dir, 'atelier.db')
    const first = createDatabaseService(filePath)
    first.close()

    const second = createDatabaseService(filePath)
    expect(second.migration.applied).toEqual([])
    expect(second.backupPath).toBeNull()
    expect(backups()).toHaveLength(0)
    second.close()
  })

  it('全新空库不需要备份；内存库跳过', () => {
    const filePath = join(dir, 'fresh.db')
    const service = createDatabaseService(filePath)
    expect(service.backupPath).toBeNull()
    service.close()

    const memory = openDatabase(':memory:')
    expect(backupBeforeMigrations(':memory:', memory)).toBeNull()
    memory.close()
  })
})
