import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClientInputSchema } from '@shared/domain'
import { openDatabase } from '../db/database'
import { applyMigrations } from '../db/migrator'
import { MIGRATIONS } from '../db/migrations'
import { createDatabaseService, type DatabaseService } from '../db/service'
import { createClientsRepository } from '../db/repositories/clients'
import { createBackupService } from './backup-service'
import { createDataPaths } from './data-paths'
import { createRestoreService } from './restore-service'
import { readJournal } from './restore-journal'
import { validateDatabaseFile } from './backup-validation'

describe('数据恢复服务', () => {
  let dir: string
  let database: DatabaseService | null
  let paths: ReturnType<typeof createDataPaths>
  let backups: ReturnType<typeof createBackupService>
  let relaunch: ReturnType<typeof vi.fn<() => void>>
  let fatal: ReturnType<typeof vi.fn<(message: string) => void>>
  let settle: ReturnType<typeof vi.fn<() => { entryId: string; seconds: number } | null>>
  let monitorStart: ReturnType<typeof vi.fn<() => void>>
  let closeDatabase: ReturnType<typeof vi.fn<() => void>>
  let restore: ReturnType<typeof createRestoreService>
  let manual: unknown | null

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atelier-restore-'))
    database = createDatabaseService(join(dir, 'atelier.db'))
    paths = createDataPaths(dir)
    backups = createBackupService({ paths, getDb: () => database?.db ?? null })
    relaunch = vi.fn<() => void>()
    fatal = vi.fn<(message: string) => void>()
    settle = vi.fn<() => { entryId: string; seconds: number } | null>(() => null)
    monitorStart = vi.fn<() => void>()
    closeDatabase = vi.fn<() => void>(() => {
      database?.close()
      database = null
    })
    manual = null

    restore = createRestoreService({
      paths,
      getDb: () => database?.db ?? null,
      timeService: { status: () => ({ manual }) },
      monitor: { settleForRestore: settle, start: monitorStart },
      backups,
      stopTimeTicker: vi.fn(),
      startTimeTicker: vi.fn(),
      closeDatabase,
      relaunch,
      fatal
    })
  })

  afterEach(() => {
    database?.close()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  function seed(name: string): void {
    createClientsRepository(database!.db).create(createClientInputSchema.parse({ name }))
  }

  function clientNames(): string[] {
    return createClientsRepository(database!.db)
      .list({ includeArchived: true })
      .map((client) => client.name)
  }

  it('预检有效备份，并在恢复时替换数据、生成 pre-restore 备份', async () => {
    seed('备份内客户')
    const backup = backups.createManual()
    seed('恢复前新增客户')

    const candidate = restore.prepare(backup.path)
    const outcome = restore.restore(candidate.token)

    expect(outcome.restarting).toBe(true)
    expect(closeDatabase).toHaveBeenCalledTimes(1)
    expect(existsSync(paths.rollbackPath)).toBe(true)
    expect(
      backups.list().some((item) => item.kind === 'pre-restore')
    ).toBe(true)

    database = createDatabaseService(paths.dbPath)
    expect(clientNames()).toEqual(['备份内客户'])

    const journal = readJournal(paths.restoreStatePath)
    expect(journal?.phase).toBe('validated')
    const statuses = journal?.operations.map((operation) => operation.status)
    expect(statuses?.every((status) => status === 'completed')).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('预检后源文件变化会拒绝，且不关闭数据库', () => {
    seed('客户')
    const backup = backups.createManual()
    const candidate = restore.prepare(backup.path)

    writeFileSync(backup.path, Buffer.from('tampered'), 'utf8')

    expect(() => restore.restore(candidate.token)).toThrow(/发生变化/)
    expect(closeDatabase).not.toHaveBeenCalled()
    expect(validateDatabaseFile(paths.dbPath).ok).toBe(true)
  })

  it('令牌只能使用一次', () => {
    seed('客户')
    const backup = backups.createManual()
    const candidate = restore.prepare(backup.path)
    restore.restore(candidate.token)

    expect(() => restore.restore(candidate.token)).toThrow(/令牌无效/)
  })

  it('手动计时进行中拒绝恢复', () => {
    seed('客户')
    const backup = backups.createManual()
    const candidate = restore.prepare(backup.path)
    manual = { entry: { status: 'running' } }

    expect(() => restore.restore(candidate.token)).toThrow(/先结束当前计时/)
    expect(closeDatabase).not.toHaveBeenCalled()
    expect(settle).not.toHaveBeenCalled()
  })

  it('自动工时结算失败时中止，不关闭数据库并重启监测', () => {
    seed('客户')
    const backup = backups.createManual()
    const candidate = restore.prepare(backup.path)
    settle.mockImplementation(() => {
      throw new Error('探针异常')
    })

    expect(() => restore.restore(candidate.token)).toThrow(/自动工时结算失败/)
    expect(closeDatabase).not.toHaveBeenCalled()
    expect(monitorStart).toHaveBeenCalledTimes(1)
    expect(validateDatabaseFile(paths.dbPath).ok).toBe(true)
  })

  it('自动工时结算成功后才创建恢复前备份', () => {
    seed('客户')
    const backup = backups.createManual()
    const candidate = restore.prepare(backup.path)
    const preSpy = vi.spyOn(backups, 'createPreRestore')
    settle.mockReturnValue({ entryId: '11111111-1111-4111-8111-111111111111', seconds: 12 })

    const outcome = restore.restore(candidate.token)

    expect(preSpy).toHaveBeenCalledTimes(1)
    expect(outcome.message).toContain('12 秒')
    expect(settle.mock.invocationCallOrder[0]).toBeLessThan(preSpy.mock.invocationCallOrder[0] ?? 0)
  })

  it('旧 schema 备份在 staging 完成迁移和 WAL 收尾后恢复', () => {
    const oldDir = mkdtempSync(join(tmpdir(), 'atelier-old-'))
    const oldPath = join(oldDir, 'old.db')
    const oldDb = openDatabase(oldPath)
    applyMigrations(oldDb, MIGRATIONS.slice(0, 4))
    createClientsRepository(oldDb).create(createClientInputSchema.parse({ name: '旧版本客户' }))
    oldDb.close()

    const candidate = restore.prepare(oldPath)
    const outcome = restore.restore(candidate.token)
    expect(outcome.restarting).toBe(true)

    database = createDatabaseService(paths.dbPath)
    expect(clientNames()).toEqual(['旧版本客户'])
    expect(validateDatabaseFile(paths.dbPath).ok).toBe(true)
    rmSync(oldDir, { recursive: true, force: true })
  })

  it('源备份带非空 WAL 时预检拒绝', () => {
    seed('客户')
    const backup = backups.createManual()
    writeFileSync(`${backup.path}-wal`, Buffer.from([1, 2, 3]))

    expect(() => restore.prepare(backup.path)).toThrow(/WAL/)
  })

  it('pre-restore 备份创建失败时中止恢复，当前库不动', () => {
    seed('客户')
    const backup = backups.createManual()
    const candidate = restore.prepare(backup.path)
    vi.spyOn(backups, 'createPreRestore').mockImplementation(() => {
      throw new Error('磁盘空间不足')
    })

    expect(() => restore.restore(candidate.token)).toThrow(/恢复前自动备份失败/)
    expect(closeDatabase).not.toHaveBeenCalled()
    expect(monitorStart).toHaveBeenCalled()
    expect(validateDatabaseFile(paths.dbPath).ok).toBe(true)
    expect(existsSync(paths.rollbackPath)).toBe(false)
  })

  it('预检后源文件同大小内容变化也会拒绝', () => {
    seed('客户')
    const backup = backups.createManual()
    const candidate = restore.prepare(backup.path)
    const original = readFileSync(backup.path)
    const changed = Buffer.from(original)
    changed[changed.length - 1] = changed[changed.length - 1]! ^ 0xff
    writeFileSync(backup.path, changed)

    expect(() => restore.restore(candidate.token)).toThrow(/发生变化/)
    expect(closeDatabase).not.toHaveBeenCalled()
  })

  it('正式库 WAL checkpoint busy 时中止，不关闭也不替换', () => {
    seed('客户')
    const backup = backups.createManual()
    const candidate = restore.prepare(backup.path)

    const blocker = new Database(paths.dbPath)
    blocker.pragma('journal_mode = WAL')
    blocker.exec('BEGIN')
    blocker.prepare('SELECT COUNT(*) FROM clients').get()

    try {
      expect(() => restore.restore(candidate.token)).toThrow(/WAL 未能安全收尾/)
      expect(closeDatabase).not.toHaveBeenCalled()
      expect(existsSync(paths.rollbackPath)).toBe(false)
      expect(monitorStart).toHaveBeenCalled()
      expect(validateDatabaseFile(paths.dbPath).ok).toBe(true)
    } finally {
      blocker.exec('COMMIT')
      blocker.close()
    }
  }, 15000)

  it('staging 校验失败时清理暂存并中止', () => {
    seed('客户')
    const backup = backups.createManual()
    const candidate = restore.prepare(backup.path)
    // 让 staging 路径在复制前成为目录，触发复制/校验失败
    rmSync(paths.stagingPath, { force: true })
    mkdirSync(paths.stagingPath)

    expect(() => restore.restore(candidate.token)).toThrow()
    expect(closeDatabase).not.toHaveBeenCalled()
    expect(validateDatabaseFile(paths.dbPath).ok).toBe(true)
    expect(statSync(paths.dbPath).size).toBeGreaterThan(0)
  })
})
