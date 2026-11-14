import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createClientInputSchema,
  createCommissionInputSchema,
  createTaskInputSchema
} from '@shared/domain'
import { createDatabaseService, type DatabaseService } from '../db/service'
import { createClientsRepository } from '../db/repositories/clients'
import { createCommissionsRepository } from '../db/repositories/commissions'
import { createTasksRepository } from '../db/repositories/tasks'
import { createTimeEntriesRepository } from '../db/repositories/time-entries'
import { exportData } from './export-service'

describe('CSV 数据导出', () => {
  let dir: string
  let database: DatabaseService
  let taskId: string
  let commissionId: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atelier-export-'))
    database = createDatabaseService(join(dir, 'atelier.db'))

    const clients = createClientsRepository(database.db)
    const client = clients.create(
      createClientInputSchema.parse({
        name: '=1+1',
        contact: '  @cmd',
        note: '第一行\n=cmd'
      })
    )
    const commissions = createCommissionsRepository(database.db)
    const draft = commissions.create(
      createCommissionInputSchema.parse({
        clientId: client.id,
        title: '+委托',
        type: '@插画',
        priority: 2,
        deadline: { kind: 'date', date: '2026-11-20' },
        quoteAmountCents: 120000
      })
    )
    commissions.update({ id: draft.id, status: 'active' })
    commissionId = draft.id

    const tasks = createTasksRepository(database.db)
    taskId = tasks.create(
      createTaskInputSchema.parse({
        commissionId,
        title: '=SUM(A1)',
        stage: 'draft',
        estimatedMinutes: 90,
        plannedDate: '2026-11-18'
      })
    ).id

    const entries = createTimeEntriesRepository(database.db)
    entries.insert({
      id: '11111111-1111-4111-8111-111111111111',
      taskId,
      source: 'manual',
      status: 'completed',
      startedAt: '2026-11-14T02:00:00.000Z',
      endedAt: '2026-11-14T03:00:00.000Z',
      elapsedSeconds: 3600,
      lastHeartbeatAt: '2026-11-14T03:00:00.000Z',
      appKey: null,
      note: '\t=cmd'
    })
    entries.insert({
      id: '22222222-2222-4222-8222-222222222222',
      taskId,
      source: 'manual',
      status: 'completed',
      startedAt: '2026-11-15T02:00:00.000Z',
      endedAt: '2026-11-15T02:10:00.000Z',
      elapsedSeconds: 600,
      lastHeartbeatAt: '2026-11-15T02:10:00.000Z',
      appKey: null,
      note: '软删除'
    })
    database.db
      .prepare("UPDATE time_entries SET deleted_at = '2026-11-16T00:00:00.000Z' WHERE id = '22222222-2222-4222-8222-222222222222'")
      .run()
    entries.insert({
      id: '33333333-3333-4333-8333-333333333333',
      taskId,
      source: 'auto',
      status: 'completed',
      startedAt: '2026-11-16T02:00:00.000Z',
      endedAt: '2026-11-16T02:05:00.000Z',
      elapsedSeconds: 300,
      lastHeartbeatAt: '2026-11-16T02:05:00.000Z',
      appKey: 'photoshop',
      note: '被合并'
    })
    database.db
      .prepare("UPDATE time_entries SET merged_into_id = '11111111-1111-4111-8111-111111111111' WHERE id = '33333333-3333-4333-8333-333333333333'")
      .run()
  })

  afterEach(() => {
    database.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('生成四类 CSV、manifest 与 README，编码为 BOM+CRLF', () => {
    const result = exportData(dir, { dbPath: database.filePath, appVersion: '0.1.0', timeZone: 'Asia/Shanghai' })

    expect(result.files.map((file) => file.name)).toEqual([
      'clients.csv',
      'commissions.csv',
      'tasks.csv',
      'time_entries.csv'
    ])
    expect(result.totalRows).toBe(4)
    for (const file of result.files) {
      const content = readFileSync(join(result.folder, file.name))
      expect(content[0]).toBe(0xef)
      expect(content[1]).toBe(0xbb)
      expect(content[2]).toBe(0xbf)
      expect(content.includes(Buffer.from('\r\n'))).toBe(true)
    }
    expect(existsSync(join(result.folder, 'manifest.json'))).toBe(true)
    expect(existsSync(join(result.folder, 'README.txt'))).toBe(true)
  })

  it('对用户文本应用公式注入防护，金额同时输出分与元', () => {
    const result = exportData(dir, { dbPath: database.filePath, appVersion: '0.1.0', timeZone: 'Asia/Shanghai' })
    const clients = readFileSync(join(result.folder, 'clients.csv'), 'utf8')
    const commissions = readFileSync(join(result.folder, 'commissions.csv'), 'utf8')
    const tasks = readFileSync(join(result.folder, 'tasks.csv'), 'utf8')

    expect(clients).toContain("\"'=1+1\"")
    expect(clients).toContain("\"'@cmd\"")
    expect(clients).toContain("\"'第一行\n=cmd\"")
    expect(commissions).toContain("\"'+委托\"")
    expect(commissions).toContain("\"'@插画\"")
    expect(commissions).toContain('120000')
    expect(commissions).toContain('"1200.00"')
    expect(tasks).toContain("\"'=SUM(A1)\"")
    expect(tasks).toContain('2026-11-18')
  })

  it('工时只导出有效记录，排除软删除与已合并', () => {
    const result = exportData(dir, { dbPath: database.filePath, appVersion: '0.1.0', timeZone: 'Asia/Shanghai' })
    const content = readFileSync(join(result.folder, 'time_entries.csv'), 'utf8')
    const lines = content.trimEnd().split('\r\n')

    expect(lines).toHaveLength(2)
    expect(content).toContain('11111111-1111-4111-8111-111111111111')
    expect(content).not.toContain('22222222-2222-4222-8222-222222222222')
    expect(content).not.toContain('33333333-3333-4333-8333-333333333333')
    expect(content).toContain("\"'\t=cmd\"")
    expect(content).toContain('"1.00"')
  })

  it('四类数据与 manifest 来自同一快照：快照后新增数据不进入本次导出', () => {
    const result = exportData(dir, {
      dbPath: database.filePath,
      appVersion: '0.1.0',
      timeZone: 'Asia/Shanghai',
      afterSnapshot: () => {
        createClientsRepository(database.db).create(createClientInputSchema.parse({ name: '快照后客户' }))
      }
    })

    const clients = readFileSync(join(result.folder, 'clients.csv'), 'utf8')
    const manifest = JSON.parse(readFileSync(join(result.folder, 'manifest.json'), 'utf8')) as {
      files: Array<{ name: string; rows: number }>
    }

    expect(clients).not.toContain('快照后客户')
    expect(manifest.files.find((file) => file.name === 'clients.csv')?.rows).toBe(1)
    expect(createClientsRepository(database.db).list({ includeArchived: true })).toHaveLength(2)
  })

  it('空数据库只输出表头', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'atelier-export-empty-'))
    const emptyDb = createDatabaseService(join(emptyDir, 'empty.db'))
    try {
      const result = exportData(emptyDir, { dbPath: emptyDb.filePath, appVersion: '0.1.0' })
      expect(result.totalRows).toBe(0)
      for (const file of result.files) {
        const lines = readFileSync(join(result.folder, file.name), 'utf8').trimEnd().split('\r\n')
        expect(lines).toHaveLength(1)
      }
    } finally {
      emptyDb.close()
      rmSync(emptyDir, { recursive: true, force: true })
    }
  })

  it('写入失败时清理临时目录', () => {
    const badParent = join(dir, 'not-a-directory')
    writeFileSync(badParent, 'file')

    expect(() =>
      exportData(badParent, { dbPath: database.filePath, appVersion: '0.1.0' })
    ).toThrow()
    expect(() => readFileSync(join(badParent, 'clients.csv'))).toThrow()
  })
})
