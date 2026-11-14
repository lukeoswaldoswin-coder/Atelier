import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from './database'
import { applyMigrations, getAppliedMigrations } from './migrator'
import { MIGRATIONS, type Migration } from './migrations'
import { assertNoForeignKeyViolations } from './integrity'

const m001 = MIGRATIONS[0] as Migration
const m002 = MIGRATIONS[1] as Migration

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'

function tableColumns(db: AppDatabase, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (row) => row.name
  )
}

function indexNames(db: AppDatabase, table: string): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name"
    )
    .all(table) as Array<{ name: string }>
  return rows.map((row) => row.name)
}

function tableExists(db: AppDatabase, name: string): boolean {
  const row = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  return row !== undefined
}

interface LegacyRow {
  id: string
  clientId: string
  title: string
  quote: number
  paid: number
  paymentStatus: string
  deadlineAt?: string | null
  archivedAt?: string | null
}

function insertLegacyCommission(db: AppDatabase, row: LegacyRow): void {
  db.prepare(
    `INSERT INTO commissions (
       id, client_id, title, description, type, status, priority, deadline_at,
       quote_amount_cents, paid_amount_cents, payment_status, created_at, updated_at, archived_at
     ) VALUES (
       @id, @clientId, @title, NULL, '插画', 'draft', 3, @deadlineAt,
       @quote, @paid, @paymentStatus, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', @archivedAt
     )`
  ).run({
    id: row.id,
    clientId: row.clientId,
    title: row.title,
    deadlineAt: row.deadlineAt ?? null,
    quote: row.quote,
    paid: row.paid,
    paymentStatus: row.paymentStatus,
    archivedAt: row.archivedAt ?? null
  })
}

function seedClient(db: AppDatabase): void {
  db.prepare(
    `INSERT INTO clients (id, name, contact, note, created_at, updated_at, archived_at)
     VALUES (?, '客户', NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`
  ).run(CLIENT_ID)
}

describe('迁移 002：截止时间三态 + 金额可空 + 付款状态推导', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = openDatabase(':memory:')
  })

  it('重建后的表结构、索引与外键都正确', () => {
    applyMigrations(db)

    const columns = tableColumns(db, 'commissions')
    expect(columns).toContain('deadline_kind')
    expect(columns).toContain('deadline_date')
    expect(columns).toContain('deadline_timezone')
    expect(columns).toContain('quote_amount_cents')

    const quoteColumn = (db.prepare('PRAGMA table_info(commissions)').all() as Array<{ name: string; notnull: number }>).find(
      (column) => column.name === 'quote_amount_cents'
    )
    expect(quoteColumn?.notnull).toBe(0)

    expect(indexNames(db, 'commissions')).toEqual([
      'idx_commissions_archived',
      'idx_commissions_client',
      'idx_commissions_deadline',
      'idx_commissions_payment_status',
      'idx_commissions_status'
    ])

    const foreignKeys = db.prepare('PRAGMA foreign_key_list(commissions)').all() as Array<{
      table: string
      on_delete: string
    }>
    expect(foreignKeys).toHaveLength(1)
    expect(foreignKeys[0]?.table).toBe('clients')
    expect(foreignKeys[0]?.on_delete).toBe('RESTRICT')

    expect(getAppliedMigrations(db).map((row) => row.id).slice(0, 2)).toEqual([
      '001-initial',
      '002-deadline-and-payment'
    ])
    db.close()
  })

  it('旧数据按约定回填：报价 0 视为未报价，已付金额与状态重新推导', () => {
    applyMigrations(db, [m001])
    seedClient(db)
    insertLegacyCommission(db, {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      clientId: CLIENT_ID,
      title: 'A 未填报价',
      quote: 0,
      paid: 0,
      paymentStatus: 'unpaid'
    })
    insertLegacyCommission(db, {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      clientId: CLIENT_ID,
      title: 'B 有截止与部分付款',
      quote: 50000,
      paid: 20000,
      paymentStatus: 'unpaid',
      deadlineAt: '2026-12-31T15:59:00.000Z'
    })
    insertLegacyCommission(db, {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      clientId: CLIENT_ID,
      title: 'C 异常数据：报价 0 但已收款',
      quote: 0,
      paid: 3000,
      paymentStatus: 'paid'
    })
    insertLegacyCommission(db, {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      clientId: CLIENT_ID,
      title: 'D 已归档',
      quote: 10000,
      paid: 0,
      paymentStatus: 'unpaid',
      archivedAt: '2026-06-01T00:00:00.000Z'
    })

    const result = applyMigrations(db, [m001, m002], { timeZone: 'Asia/Shanghai' })
    expect(result.applied).toEqual(['002-deadline-and-payment'])

    const rows = db
      .prepare(
        `SELECT id, deadline_kind AS kind, deadline_date AS d, deadline_at AS at,
                deadline_timezone AS tz, quote_amount_cents AS quote,
                paid_amount_cents AS paid, payment_status AS status, archived_at AS archived
           FROM commissions ORDER BY id`
      )
      .all() as Array<Record<string, unknown>>

    expect(rows).toHaveLength(4)

    // A：未填报价 → 未报价
    expect(rows[0]).toMatchObject({ kind: 'none', d: null, at: null, tz: null, quote: null, paid: 0, status: 'unquoted' })

    // B：截止时间保留为 datetime，时区取迁移上下文；状态按金额重算
    expect(rows[1]).toMatchObject({
      kind: 'datetime',
      d: null,
      at: '2026-12-31T15:59:00.000Z',
      tz: 'Asia/Shanghai',
      quote: 50000,
      paid: 20000,
      status: 'partial'
    })

    // C：异常数据（报价 0 有收款）→ 按“已收即报价”回填
    expect(rows[2]).toMatchObject({ kind: 'none', quote: 3000, paid: 3000, status: 'paid' })

    // D：归档状态保留
    expect(rows[3]).toMatchObject({
      quote: 10000,
      paid: 0,
      status: 'unpaid',
      archived: '2026-06-01T00:00:00.000Z'
    })

    db.close()
  })

  it('失败注入：002 中途失败时旧表、数据、索引与迁移记录全部保持原状', () => {
    applyMigrations(db, [m001])
    seedClient(db)
    insertLegacyCommission(db, {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      clientId: CLIENT_ID,
      title: '回滚测试',
      quote: 20000,
      paid: 5000,
      paymentStatus: 'partial',
      deadlineAt: '2027-01-01T00:00:00.000Z'
    })

    const broken: Migration = {
      ...m002,
      run: (target, context) => {
        // 先完整执行 002（含 DROP / RENAME / 建索引），再故意失败
        m002.run?.(target, context)
        throw new Error('注入的失败')
      }
    }

    expect(() => applyMigrations(db, [m001, broken])).toThrow(/注入的失败/)

    // 旧表结构还在（v1 有 deadline_at，没有 deadline_kind）
    const columns = tableColumns(db, 'commissions')
    expect(columns).toContain('deadline_at')
    expect(columns).not.toContain('deadline_kind')
    expect(tableExists(db, 'commissions_new')).toBe(false)

    // 数据原样保留
    const rows = db.prepare('SELECT id, title, quote_amount_cents AS quote FROM commissions').all() as Array<
      Record<string, unknown>
    >
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ quote: 20000 })

    // 索引仍是 v1 的四个（没有 payment_status 索引）
    expect(indexNames(db, 'commissions')).toEqual([
      'idx_commissions_archived',
      'idx_commissions_client',
      'idx_commissions_deadline',
      'idx_commissions_status'
    ])

    // 迁移记录只到 001
    expect(getAppliedMigrations(db).map((row) => row.id)).toEqual(['001-initial'])
    db.close()
  })

  it('外键校验会主动检查结果并抛错', () => {
    applyMigrations(db, [m001])
    db.pragma('foreign_keys = OFF')
    insertLegacyCommission(db, {
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      clientId: '99999999-9999-4999-8999-999999999999',
      title: '孤儿委托',
      quote: 0,
      paid: 0,
      paymentStatus: 'unpaid'
    })
    db.pragma('foreign_keys = ON')

    expect(() => assertNoForeignKeyViolations(db, '测试')).toThrow(/外键校验失败/)
    db.close()
  })

  it('存在外键违规时 002 不会提交，旧表与记录保持不变', () => {
    applyMigrations(db, [m001])
    seedClient(db)
    db.pragma('foreign_keys = OFF')
    insertLegacyCommission(db, {
      id: '12121212-1212-4212-8212-121212121212',
      clientId: '99999999-9999-4999-8999-999999999999',
      title: '孤儿委托',
      quote: 100,
      paid: 0,
      paymentStatus: 'unpaid'
    })
    db.pragma('foreign_keys = ON')

    expect(() => applyMigrations(db, [m001, m002])).toThrow()

    expect(tableColumns(db, 'commissions')).toContain('deadline_at')
    expect(getAppliedMigrations(db).map((row) => row.id)).toEqual(['001-initial'])
    db.close()
  })
})
