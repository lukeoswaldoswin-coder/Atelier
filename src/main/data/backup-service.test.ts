import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDatabaseService, type DatabaseService } from '../db/service'
import { createClientInputSchema } from '@shared/domain'
import { createClientsRepository } from '../db/repositories/clients'
import { createBackupService } from './backup-service'
import { createDataPaths } from './data-paths'
import { validateDatabaseFile } from './backup-validation'

describe('数据备份服务', () => {
  let dir: string
  let database: DatabaseService
  let paths: ReturnType<typeof createDataPaths>
  let fixedNow: Date

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atelier-backup-'))
    database = createDatabaseService(join(dir, 'atelier.db'))
    paths = createDataPaths(dir)
    fixedNow = new Date('2026-11-14T12:00:00.000Z')
  })

  afterEach(() => {
    database.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function service() {
    return createBackupService({ paths, getDb: () => database.db, now: () => fixedNow })
  }

  it('创建完整备份并校验 schema 与数据', () => {
    createClientsRepository(database.db).create(createClientInputSchema.parse({ name: '三狼' }))

    const backup = service().createManual()

    expect(backup.fileName).toMatch(/^Atelier-backup-\d{8}-\d{6}-\d{3}\.db$/)
    expect(backup.kind).toBe('manual')
    expect(backup.schemaVersion).toBe('005-time-entries')
    expect(existsSync(backup.path)).toBe(true)
    expect(backup.sizeBytes).toBeGreaterThan(0)

    const validation = validateDatabaseFile(backup.path, { requireNoSidecars: true })
    expect(validation.ok).toBe(true)
    expect(validation.appliedMigrations).toContain('005-time-entries')

    const copy = createDatabaseService(backup.path)
    expect(createClientsRepository(copy.db).list({ includeArchived: true })).toHaveLength(1)
    copy.close()
  })

  it('WAL 中有未合并数据时仍能取得一致快照', () => {
    const clients = createClientsRepository(database.db)
    clients.create(createClientInputSchema.parse({ name: 'WAL 客户' }))

    const walPath = `${database.filePath}-wal`
    expect(existsSync(walPath)).toBe(true)
    expect(statSync(walPath).size).toBeGreaterThan(0)

    const backup = service().createManual()
    const copy = createDatabaseService(backup.path)
    expect(createClientsRepository(copy.db).list({ includeArchived: true })[0]?.name).toBe('WAL 客户')
    copy.close()
  })

  it('同一时间重复备份自动追加后缀，不覆盖', () => {
    const instance = service()
    const first = instance.createManual()
    const second = instance.createManual()

    expect(first.path).not.toBe(second.path)
    expect(existsSync(first.path)).toBe(true)
    expect(existsSync(second.path)).toBe(true)
    expect(readdirSync(paths.backupDir)).toHaveLength(2)
  })

  it('数据库未打开时失败且不留下文件', () => {
    const instance = createBackupService({ paths, getDb: () => null })

    expect(() => instance.createManual()).toThrow(/数据库未打开/)
    expect(existsSync(paths.backupDir) ? readdirSync(paths.backupDir) : []).toHaveLength(0)
  })

  it('列表按时间倒序返回备份与恢复前备份', () => {
    const instance = service()
    const manual = instance.createManual()
    const pre = instance.createPreRestore()

    const list = instance.list()
    expect(list.map((item) => item.path)).toEqual([pre.path, manual.path])
    expect(list.map((item) => item.kind)).toEqual(['pre-restore', 'manual'])
  })

  it('拒绝带非空 WAL 的“备份”作为独立恢复文件', () => {
    const backup = service().createManual()
    writeFileSync(`${backup.path}-wal`, Buffer.from([0x01, 0x02]))

    const validation = validateDatabaseFile(backup.path, { requireNoSidecars: true })
    expect(validation.ok).toBe(false)
    expect(validation.reason).toMatch(/WAL/)
  })

  it('拒绝损坏文件、缺少迁移表和未知迁移', () => {
    const random = join(dir, 'random.db')
    writeFileSync(random, Buffer.from('not a sqlite database'))
    expect(validateDatabaseFile(random).ok).toBe(false)

    const noMigrations = join(dir, 'empty.db')
    const empty = createDatabaseService(noMigrations)
    empty.db.exec('DROP TABLE schema_migrations')
    empty.close()
    expect(validateDatabaseFile(noMigrations).ok).toBe(false)

    const backup = service().createManual()
    const tampered = createDatabaseService(backup.path)
    tampered.db
      .prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)")
      .run('099-future', 'future', '2026-11-14T00:00:00.000Z')
    tampered.close()

    const validation = validateDatabaseFile(backup.path, { requireNoSidecars: true })
    expect(validation.ok).toBe(false)
    expect(validation.reason).toMatch(/更高|未知/)
  })

  it('允许但标记较旧 schema，strict 模式拒绝', () => {
    const backup = service().createManual()
    const copy = createDatabaseService(backup.path)
    copy.db.prepare("DELETE FROM schema_migrations WHERE id = '005-time-entries'").run()
    copy.close()

    const lenient = validateDatabaseFile(backup.path, { requireNoSidecars: true, allowOlder: true })
    expect(lenient.ok).toBe(true)
    expect(lenient.schemaVersion).toBe('004-task-planned-date')

    const strict = validateDatabaseFile(backup.path, { requireNoSidecars: true, allowOlder: false })
    expect(strict.ok).toBe(false)
  })
})
