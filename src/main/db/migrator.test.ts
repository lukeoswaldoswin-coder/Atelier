import { describe, expect, it } from 'vitest'
import { openDatabase } from './database'
import { applyMigrations, assertValidMigrationList, getAppliedMigrations } from './migrator'
import { MIGRATIONS, type Migration } from './migrations'

function listTables(db: ReturnType<typeof openDatabase>): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>
  return rows.map((row) => row.name)
}

describe('数据库迁移机制', () => {
  it('全新数据库会按顺序应用全部迁移', () => {
    const db = openDatabase(':memory:')

    const result = applyMigrations(db)

    expect(result.applied).toEqual([
      '001-initial',
      '002-deadline-and-payment',
      '003-tasks'
    ])
    expect(result.previouslyApplied).toEqual([])
    expect(listTables(db)).toEqual(['clients', 'commissions', 'schema_migrations', 'tasks'])
    db.close()
  })

  it('重复执行是幂等的，不会重复建表或重复记录', () => {
    const db = openDatabase(':memory:')
    applyMigrations(db)

    const second = applyMigrations(db)

    expect(second.applied).toEqual([])
    expect(second.previouslyApplied).toEqual([
      '001-initial',
      '002-deadline-and-payment',
      '003-tasks'
    ])
    expect(getAppliedMigrations(db)).toHaveLength(3)
    db.close()
  })

  it('迁移记录里带名称和 UTC 时间', () => {
    const db = openDatabase(':memory:')
    applyMigrations(db)

    const records = getAppliedMigrations(db)
    expect(records.map((row) => row.id)).toEqual([
      '001-initial',
      '002-deadline-and-payment',
      '003-tasks'
    ])
    expect(records[0]?.name).toContain('clients')
    expect(records[1]?.name).toContain('付款')
    for (const record of records) {
      expect(record.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    }
    db.close()
  })

  it('迁移清单本身不合法时直接报错', () => {
    const base = { name: 'x', sql: 'CREATE TABLE t (a TEXT)' }

    expect(() => assertValidMigrationList([{ ...base, id: '002-b' }, { ...base, id: '001-a' }])).toThrow(
      /递增/
    )
    expect(() => assertValidMigrationList([{ ...base, id: '001-a' }, { ...base, id: '001-a' }])).toThrow(
      /重复/
    )
    expect(() => assertValidMigrationList([{ ...base, id: '001-a', sql: '   ' }])).toThrow(/既没有 SQL/)
    expect(() => assertValidMigrationList([{ ...base, id: '' }])).toThrow(/id 不能为空/)
    expect(() => assertValidMigrationList([{ ...base, id: '001-a' }])).not.toThrow()
    expect(() =>
      assertValidMigrationList([{ id: '001-a', name: 'x', run: () => undefined }])
    ).not.toThrow()
  })

  it('迁移执行失败会整体回滚，不留下半截结构', () => {
    const db = openDatabase(':memory:')
    const broken: Migration[] = [
      { id: '001-initial', name: '正常迁移', sql: 'CREATE TABLE good (a TEXT)' },
      { id: '002-broken', name: '故意写错', sql: 'CREATE TABLE bad (a TEXT) STRANGE SYNTAX' }
    ]

    expect(() => applyMigrations(db, broken)).toThrow()

    expect(listTables(db)).not.toContain('good')
    expect(getAppliedMigrations(db)).toEqual([])
    db.close()
  })

  it('迁移清单覆盖 P1.1 / P1.1.5 / P2 的结构', () => {
    expect(MIGRATIONS.map((migration) => migration.id)).toEqual([
      '001-initial',
      '002-deadline-and-payment',
      '003-tasks'
    ])
    const first = MIGRATIONS[0]?.sql ?? ''
    expect(first).toContain('CREATE TABLE clients')
    expect(first).toContain('CREATE TABLE commissions')
    expect(typeof MIGRATIONS[1]?.run).toBe('function')
    expect(typeof MIGRATIONS[2]?.run).toBe('function')
  })
})
