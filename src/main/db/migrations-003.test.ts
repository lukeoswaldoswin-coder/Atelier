import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from './database'
import { applyMigrations, getAppliedMigrations } from './migrator'
import { MIGRATIONS, type Migration } from './migrations'
import { assertNoForeignKeyViolations } from './integrity'

const m001 = MIGRATIONS[0] as Migration
const m002 = MIGRATIONS[1] as Migration
const m003 = MIGRATIONS[2] as Migration

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const COMMISSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function columnsOf(db: AppDatabase, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (row) => row.name
  )
}

function indexesOf(db: AppDatabase, table: string): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name"
      )
      .all(table) as Array<{ name: string }>
  ).map((row) => row.name)
}

function seedLegacyCommission(db: AppDatabase, status: 'active' | 'completed'): void {
  db.prepare(
    `INSERT INTO clients (id, name, contact, note, created_at, updated_at, archived_at)
     VALUES (?, '客户', NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`
  ).run(CLIENT_ID)

  db.prepare(
    `INSERT INTO commissions (
       id, client_id, title, description, type, status, priority,
       deadline_kind, deadline_date, deadline_at, deadline_timezone,
       quote_amount_cents, paid_amount_cents, payment_status,
       created_at, updated_at, archived_at
     ) VALUES (
       @id, @clientId, '旧委托', NULL, '插画', @status, 3,
       'none', NULL, NULL, NULL,
       120000, 0, 'unpaid',
       '2026-01-01T00:00:00.000Z', '2026-03-05T09:00:00.000Z', NULL
     )`
  ).run({ id: COMMISSION_ID, clientId: CLIENT_ID, status })
}

describe('迁移 003：绘画任务表与委托完成时间', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = openDatabase(':memory:')
  })

  it('全新库包含 tasks 表、索引与 completed_at 列', () => {
    applyMigrations(db)

    expect(columnsOf(db, 'tasks')).toEqual(
      expect.arrayContaining([
        'id',
        'commission_id',
        'title',
        'description',
        'stage',
        'status',
        'estimated_minutes',
        'sort_order',
        'completed_at',
        'created_at',
        'updated_at',
        'archived_at'
      ])
    )
    expect(indexesOf(db, 'tasks')).toEqual([
      'idx_tasks_archived',
      'idx_tasks_commission_stage_sort',
      'idx_tasks_commission_status'
    ])
    expect(columnsOf(db, 'commissions')).toContain('completed_at')
    expect(getAppliedMigrations(db).map((row) => row.id)).toContain('003-tasks')
    assertNoForeignKeyViolations(db, '测试')
    db.close()
  })

  it('从 002 升级：已完成委托用 updated_at 回填完成时间，其它状态保持 NULL', () => {
    applyMigrations(db, [m001, m002])
    seedLegacyCommission(db, 'completed')

    applyMigrations(db, [m001, m002, m003])

    const completed = db
      .prepare('SELECT completed_at AS completedAt FROM commissions WHERE id = ?')
      .get(COMMISSION_ID) as { completedAt: string | null }
    expect(completed.completedAt).toBe('2026-03-05T09:00:00.000Z')

    db.prepare(
      `INSERT INTO commissions (
         id, client_id, title, description, type, status, priority,
         deadline_kind, deadline_date, deadline_at, deadline_timezone,
         quote_amount_cents, paid_amount_cents, payment_status,
         created_at, updated_at, archived_at
       ) VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ?, '进行中', NULL, '插画', 'active', 3,
         'none', NULL, NULL, NULL, NULL, 0, 'unquoted',
         '2026-01-01T00:00:00.000Z', '2026-03-05T09:00:00.000Z', NULL)`
    ).run(CLIENT_ID)

    const active = db
      .prepare("SELECT completed_at AS completedAt FROM commissions WHERE title = '进行中'")
      .get() as { completedAt: string | null }
    expect(active.completedAt).toBeNull()
    db.close()
  })

  it('任务表约束：阶段、状态、预计工时、完成时间一致性', () => {
    applyMigrations(db)

    const insert = db.prepare(
      `INSERT INTO tasks (
         id, commission_id, title, description, stage, status,
         estimated_minutes, sort_order, completed_at, created_at, updated_at, archived_at
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, 0, ?, ?, ?, NULL)`
    )

    expect(() =>
      insert.run('t1', COMMISSION_ID, 'x', 'draft', 'todo', null, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    ).toThrow(/FOREIGN KEY/)

    // 先建委托
    db.prepare(
      `INSERT INTO clients (id, name, contact, note, created_at, updated_at, archived_at)
       VALUES (?, '客户', NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`
    ).run(CLIENT_ID)
    db.prepare(
      `INSERT INTO commissions (
         id, client_id, title, description, type, status, priority,
         deadline_kind, deadline_date, deadline_at, deadline_timezone,
         quote_amount_cents, paid_amount_cents, payment_status,
         created_at, updated_at, archived_at
       ) VALUES (?, ?, '委托', NULL, '插画', 'draft', 3, 'none', NULL, NULL, NULL,
         120000, 0, 'unpaid', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`
    ).run(COMMISSION_ID, CLIENT_ID)

    // 未知阶段
    expect(() =>
      insert.run('t2', COMMISSION_ID, 'x', 'sketch', 'todo', null, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    ).toThrow(/CHECK/)
    // 负数预计工时
    expect(() =>
      insert.run('t3', COMMISSION_ID, 'x', 'draft', 'todo', -1, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    ).toThrow(/CHECK/)
    // done 但没有完成时间
    expect(() =>
      insert.run('t4', COMMISSION_ID, 'x', 'draft', 'done', null, null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    ).toThrow(/CHECK/)
    // 非 done 但有完成时间
    expect(() =>
      insert.run('t5', COMMISSION_ID, 'x', 'draft', 'todo', null, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    ).toThrow(/CHECK/)

    // 合法写入
    insert.run('t6', COMMISSION_ID, 'x', 'draft', 'done', 30, '2026-01-02T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
    expect(db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE status = 'done'").get()).toEqual({ c: 1 })
    db.close()
  })
})
