import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createClientInputSchema } from '@shared/domain'
import { createDatabaseService } from '../db/service'
import { createClientsRepository } from '../db/repositories/clients'
import { createDataPaths } from './data-paths'
import { recoverRestoreState, quarantineOrphanSidecars } from './startup-recovery'
import { validateDatabaseFile } from './backup-validation'
import { readJournal, writeJournal, newJournal, setPhase } from './restore-journal'

describe('启动恢复现场', () => {
  let dir: string
  let paths: ReturnType<typeof createDataPaths>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atelier-recovery-'))
    paths = createDataPaths(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function createDb(path: string, clientName: string): void {
    const database = createDatabaseService(path)
    createClientsRepository(database.db).create(createClientInputSchema.parse({ name: clientName }))
    database.close()
  }

  function clientName(path: string): string | null {
    const validation = validateDatabaseFile(path, { allowOlder: true })
    if (!validation.ok) return null
    const db = createDatabaseService(path)
    const name = createClientsRepository(db.db).list({ includeArchived: true })[0]?.name ?? null
    db.close()
    return name
  }

  it('正式库与 rollback 同时存在且正式库有效：归档 rollback，不误删正式库', () => {
    createDb(paths.dbPath, '正式库客户')
    createDb(paths.rollbackPath, '旧客户')

    const result = recoverRestoreState(paths)

    expect(result.status).toBe('ok')
    expect(clientName(paths.dbPath)).toBe('正式库客户')
    expect(existsSync(paths.rollbackPath)).toBe(false)
    expect(
      readdirSync(paths.backupDir).some((name) => name.startsWith('Atelier-recovered-'))
    ).toBe(true)
  })

  it('正式库损坏、rollback 有效：保留失败新库并恢复 rollback', () => {
    writeFileSync(paths.dbPath, Buffer.from('broken current database'))
    createDb(paths.rollbackPath, '可恢复客户')

    const result = recoverRestoreState(paths)

    expect(result.status).toBe('recovered')
    expect(clientName(paths.dbPath)).toBe('可恢复客户')
    const failed = readdirSync(dir).filter((name) => name.includes('restore-failed-'))
    expect(failed).toHaveLength(1)
    expect(validateDatabaseFile(join(dir, failed[0] as string), { allowOlder: true }).ok).toBe(false)
  })

  it('正式库不存在、rollback 有效：只读验证后恢复', () => {
    rmSync(paths.dbPath, { force: true })
    createDb(paths.rollbackPath, 'rollback 客户')

    const result = recoverRestoreState(paths)

    expect(result.status).toBe('recovered')
    expect(clientName(paths.dbPath)).toBe('rollback 客户')
    expect(existsSync(paths.rollbackPath)).toBe(false)
  })

  it('两套数据库都无效：保留全部现场，不创建空库', () => {
    writeFileSync(paths.dbPath, Buffer.from('broken current'))
    writeFileSync(paths.rollbackPath, Buffer.from('broken rollback'))

    const result = recoverRestoreState(paths)

    expect(result.status).toBe('fatal')
    expect(existsSync(paths.dbPath)).toBe(true)
    expect(existsSync(paths.rollbackPath)).toBe(true)
    expect(readFileSync(paths.dbPath, 'utf8')).toBe('broken current')
    expect(readFileSync(paths.rollbackPath, 'utf8')).toBe('broken rollback')
  })

  it('正式库不存在且没有 rollback/staging：按全新安装处理', () => {
    expect(recoverRestoreState(paths).status).toBe('ok')
    expect(existsSync(paths.dbPath)).toBe(false)
  })

  it('只有 staging 残留、没有正式库：致命错误，不自动建空库', () => {
    writeFileSync(paths.stagingPath, Buffer.from('partial'))

    const result = recoverRestoreState(paths)

    expect(result.status).toBe('fatal')
    expect(existsSync(paths.dbPath)).toBe(false)
    expect(existsSync(paths.stagingPath)).toBe(true)
  })

  it('正式库有效、staging 残留：删除未完成 staging', () => {
    createDb(paths.dbPath, '正式库')
    writeFileSync(paths.stagingPath, Buffer.from('partial'))

    const result = recoverRestoreState(paths)

    expect(result.status).toBe('ok')
    expect(existsSync(paths.stagingPath)).toBe(false)
    expect(clientName(paths.dbPath)).toBe('正式库')
  })

  it('主文件缺失时隔离旧 WAL，避免与新恢复的主文件组合', () => {
    rmSync(paths.dbPath, { force: true })
    writeFileSync(`${paths.dbPath}-wal`, Buffer.from('orphan wal'))
    createDb(paths.rollbackPath, 'rollback 客户')

    const result = recoverRestoreState(paths)

    expect(result.status).toBe('recovered')
    expect(
      existsSync(`${paths.dbPath}-wal`) ? statSync(`${paths.dbPath}-wal`).size : 0
    ).toBe(0)
    expect(readdirSync(paths.orphanDir).some((name) => name.endsWith('-wal'))).toBe(true)
    expect(clientName(paths.dbPath)).toBe('rollback 客户')
  })

  it('正式库有效但 rollback 损坏：rollback 移入专用恢复归档，不进入普通备份', () => {
    createDb(paths.dbPath, '正式库')
    writeFileSync(paths.rollbackPath, Buffer.from('broken rollback'))

    const result = recoverRestoreState(paths)

    expect(result.status).toBe('ok')
    expect(clientName(paths.dbPath)).toBe('正式库')
    expect(existsSync(paths.rollbackPath)).toBe(false)
    expect(readdirSync(paths.recoveryArchiveDir).length).toBeGreaterThan(0)
    expect(
      existsSync(paths.backupDir) &&
        readdirSync(paths.backupDir).some((name) => name.startsWith('Atelier-recovered-'))
    ).toBe(false)
  })

  it('根据逐文件日志与实际文件位置处理 old-moved 中断（主文件已移、WAL 未移）', () => {
    createDb(paths.rollbackPath, '旧库客户')
    // 模拟 current 主文件已移动，但旧 WAL 仍留在 current 路径
    writeFileSync(`${paths.dbPath}-wal`, Buffer.from('old wal'))
    const journal = newJournal({
      sourcePath: 'backup.db',
      sourceHash: 'hash',
      stagingPath: paths.stagingPath,
      rollbackPath: paths.rollbackPath
    })
    journal.phase = 'old-moved'
    journal.operations.push({
      id: 'op-1',
      kind: 'current-to-rollback-main',
      from: paths.dbPath,
      to: paths.rollbackPath,
      status: 'completed',
      fromExisted: true,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: null
    })
    writeJournal(paths.restoreStatePath, journal)

    const result = recoverRestoreState(paths)

    expect(result.status).toBe('recovered')
    expect(clientName(paths.dbPath)).toBe('旧库客户')
    expect(existsSync(`${paths.dbPath}-wal`)).toBe(false)
  })

  it('日志与文件不一致时仍以实际文件验证结果为准', () => {
    createDb(paths.dbPath, '正式库')
    createDb(paths.rollbackPath, '旧库')
    const journal = newJournal({
      sourcePath: 'backup.db',
      sourceHash: 'hash',
      stagingPath: paths.stagingPath,
      rollbackPath: paths.rollbackPath
    })
    setPhase(paths.restoreStatePath, journal, 'new-installed')

    const result = recoverRestoreState(paths)

    expect(result.status).toBe('ok')
    expect(clientName(paths.dbPath)).toBe('正式库')
    expect(existsSync(paths.rollbackPath)).toBe(false)
  })

  it('无主 sidecar 隔离到 restore-orphans', () => {
    writeFileSync(`${paths.dbPath}-shm`, Buffer.from('orphan'))
    quarantineOrphanSidecars(paths)

    expect(existsSync(`${paths.dbPath}-shm`)).toBe(false)
    expect(readdirSync(paths.orphanDir).some((name) => name.endsWith('-shm'))).toBe(true)
  })

  it('日志可读取且保留逐文件操作', () => {
    const journal = newJournal({
      sourcePath: 'a.db',
      sourceHash: 'hash',
      stagingPath: paths.stagingPath,
      rollbackPath: paths.rollbackPath
    })
    writeJournal(paths.restoreStatePath, journal)
    expect(readJournal(paths.restoreStatePath)?.operations).toEqual([])
  })
})
