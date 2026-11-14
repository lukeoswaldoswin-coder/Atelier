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
  it('全新数据库会建好结构与迁移记录表', () => {
    const db = openDatabase(':memory:')

    const result = applyMigrations(db)

    expect(result.applied).toEqual(['001-initial'])
    expect(result.previouslyApplied).toEqual([])
    expect(listTables(db)).toEqual(['clients', 'commissions', 'schema_migrations'])
    db.close()
  })

  it('重复执行是幂等的，不会重复建表或重复记录', () => {
    const db = openDatabase(':memory:')
    applyMigrations(db)

    const second = applyMigrations(db)

    expect(second.applied).toEqual([])
    expect(second.previouslyApplied).toEqual(['001-initial'])
    expect(getAppliedMigrations(db)).toHaveLength(1)
    db.close()
  })

  it('迁移记录里带名称和 UTC 时间', () => {
    const db = openDatabase(':memory:')
    applyMigrations(db)

    const [record] = getAppliedMigrations(db)
    expect(record?.id).toBe('001-initial')
    expect(record?.name).toContain('clients')
    expect(record?.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
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
    expect(() => assertValidMigrationList([{ ...base, id: '001-a', sql: '   ' }])).toThrow(/SQL 为空/)
    expect(() => assertValidMigrationList([{ ...base, id: '' }])).toThrow(/id 不能为空/)
    expect(() => assertValidMigrationList([{ ...base, id: '001-a' }])).not.toThrow()
  })

  it('迁移执行失败会整体回滚，不留下半截结构', () => {
    const db = openDatabase(':memory:')
    const broken: Migration[] = [
      { id: '001-initial', name: '正常迁移', sql: 'CREATE TABLE good (a TEXT)' },
      { id: '002-broken', name: '故意写错', sql: 'CREATE TABLE bad (a TEXT) STRANGE SYNTAX' }
    ]

    expect(() => applyMigrations(db, broken)).toThrow()

    // 第一个迁移的建表也应被回滚，且不留下任何迁移记录
    expect(listTables(db)).not.toContain('good')
    expect(getAppliedMigrations(db)).toEqual([])
    db.close()
  })

  it('迁移清单里的 001 已经包含 P1.1 需要的两张表', () => {
    expect(MIGRATIONS.map((migration) => migration.id)).toEqual(['001-initial'])
    const sql = MIGRATIONS[0]?.sql ?? ''
    expect(sql).toContain('CREATE TABLE clients')
    expect(sql).toContain('CREATE TABLE commissions')
  })
})
