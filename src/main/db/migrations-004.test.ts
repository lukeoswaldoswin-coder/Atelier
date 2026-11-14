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
const TASK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function seed003(db: AppDatabase): void {
  db.prepare(
    `INSERT INTO clients (id, name, contact, note, created_at, updated_at, archived_at)
     VALUES (?, '客户', NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`
  ).run(CLIENT_ID)

  db.prepare(
    `INSERT INTO commissions (
       id, client_id, title, description, type, status, priority,
       deadline_kind, deadline_date, deadline_at, deadline_timezone,
       quote_amount_cents, paid_amount_cents, payment_status,
       completed_at, created_at, updated_at, archived_at
     ) VALUES (?, ?, '委托', NULL, '插画', 'active', 3, 'none', NULL, NULL, NULL,
       120000, 0, 'unpaid', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`
  ).run(COMMISSION_ID, CLIENT_ID)

  db.prepare(
    `INSERT INTO tasks (
       id, commission_id, title, description, stage, status,
       estimated_minutes, sort_order, completed_at, created_at, updated_at, archived_at
     ) VALUES (?, ?, '既有任务', NULL, 'draft', 'todo', 60, 0, NULL,
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`
  ).run(TASK_ID, COMMISSION_ID)
}

describe('迁移 004：任务计划日期', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = openDatabase(':memory:')
  })

  it('新库包含 planned_date 列与索引', () => {
    applyMigrations(db)

    const columns = (db.prepare('PRAGMA table_info(tasks)').all() as Array<{ name: string }>).map(
      (row) => row.name
    )
    expect(columns).toContain('planned_date')

    const indexes = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks' ORDER BY name"
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name)
    expect(indexes).toEqual(
      expect.arrayContaining(['idx_tasks_planned_date', 'idx_tasks_unscheduled'])
    )
    expect(getAppliedMigrations(db).map((row) => row.id)).toContain('004-task-planned-date')
    db.close()
  })

  it('SQL CHECK 拒绝不存在的日历日期，接受闰年日期', () => {
    applyMigrations(db)
    seed003(db)

    const insert = db.prepare(
      `INSERT INTO tasks (
         id, commission_id, title, description, stage, status,
         estimated_minutes, sort_order, completed_at, planned_date,
         created_at, updated_at, archived_at
       ) VALUES (?, ?, 't', NULL, 'draft', 'todo', NULL, 0, NULL, ?,
         '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`
    )

    expect(() => insert.run('t1', COMMISSION_ID, '2026-02-30')).toThrow(/CHECK/)
    expect(() => insert.run('t2', COMMISSION_ID, '2026-04-31')).toThrow(/CHECK/)
    expect(() => insert.run('t3', COMMISSION_ID, '2026-13-01')).toThrow(/CHECK/)

    insert.run('t4', COMMISSION_ID, '2024-02-29')
    insert.run('t5', COMMISSION_ID, null)
    expect((db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c).toBe(3)
    db.close()
  })

  it('从 003 升级保留既有任务，planned_date 为 NULL', () => {
    applyMigrations(db, [m001, m002, m003])
    seed003(db)

    applyMigrations(db, [m001, m002, m003, MIGRATIONS[3] as Migration])

    const task = db.prepare('SELECT id, planned_date AS plannedDate FROM tasks WHERE id = ?').get(TASK_ID) as {
      id: string
      plannedDate: string | null
    }
    expect(task.id).toBe(TASK_ID)
    expect(task.plannedDate).toBeNull()
    expect((db.prepare('SELECT COUNT(*) AS c FROM commissions').get() as { c: number }).c).toBe(1)
    assertNoForeignKeyViolations(db, '测试')
    db.close()
  })
})
