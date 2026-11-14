import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from './database'
import { applyMigrations, getAppliedMigrations } from './migrator'
import { MIGRATIONS, type Migration } from './migrations'
import { assertNoForeignKeyViolations } from './integrity'

const firstFour = MIGRATIONS.slice(0, 4) as Migration[]

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const COMMISSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const TASK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function seedTask(db: AppDatabase): void {
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
     ) VALUES (?, ?, '委托', NULL, '插画', 'active', 3, 'none', NULL, NULL, NULL,
       10000, 0, 'unpaid', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`
  ).run(COMMISSION_ID, CLIENT_ID)

  db.prepare(
    `INSERT INTO tasks (
       id, commission_id, title, description, stage, status,
       estimated_minutes, sort_order, completed_at, created_at, updated_at, archived_at
     ) VALUES (?, ?, '任务', NULL, 'draft', 'todo', NULL, 0, NULL,
       '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`
  ).run(TASK_ID, COMMISSION_ID)
}

function insertEntry(
  db: AppDatabase,
  overrides: Partial<{
    id: string
    source: string
    status: string
    taskId: string | null
    endedAt: string | null
    appKey: string | null
  }> = {}
): void {
  const value = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    source: 'manual',
    status: 'running',
    taskId: TASK_ID,
    endedAt: null,
    appKey: null,
    ...overrides
  }

  db.prepare(
    `INSERT INTO time_entries (
       id, task_id, source, status, started_at, ended_at, elapsed_seconds,
       last_heartbeat_at, app_key, merged_into_id, note, clock_skew_seconds,
       deleted_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, '2026-11-14T10:00:00.000Z', ?, 0,
       '2026-11-14T10:00:00.000Z', ?, NULL, NULL, NULL, NULL,
       '2026-11-14T10:00:00.000Z', '2026-11-14T10:00:00.000Z')`
  ).run(value.id, value.taskId, value.source, value.status, value.endedAt, value.appKey)
}

describe('迁移 005：工时记录与应用设置', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = openDatabase(':memory:')
  })

  it('新库包含 time_entries、app_settings 与索引', () => {
    applyMigrations(db)

    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name)
    expect(tables).toContain('time_entries')
    expect(tables).toContain('app_settings')

    const indexes = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='time_entries' ORDER BY name"
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name)
    expect(indexes).toEqual(
      expect.arrayContaining([
        'idx_time_entries_started',
        'idx_time_entries_task',
        'ux_time_entries_manual_active',
        'ux_time_entries_auto_active'
      ])
    )
    expect(getAppliedMigrations(db).map((row) => row.id)).toContain('005-time-entries')
    db.close()
  })

  it('从 004 升级保留既有客户、委托与任务', () => {
    applyMigrations(db, firstFour)
    seedTask(db)

    applyMigrations(db)

    expect((db.prepare('SELECT COUNT(*) AS c FROM clients').get() as { c: number }).c).toBe(1)
    expect((db.prepare('SELECT COUNT(*) AS c FROM commissions').get() as { c: number }).c).toBe(1)
    expect((db.prepare('SELECT COUNT(*) AS c FROM tasks').get() as { c: number }).c).toBe(1)
    assertNoForeignKeyViolations(db, '测试')
    db.close()
  })

  it('约束：暂停只属于手动、应用标识只属于自动、完成必须有结束时间', () => {
    applyMigrations(db)
    seedTask(db)

    expect(() => insertEntry(db, { source: 'auto', status: 'paused' })).toThrow(/CHECK/)
    expect(() =>
      insertEntry(db, { source: 'manual', status: 'running', appKey: 'photoshop' })
    ).toThrow(/CHECK/)
    expect(() =>
      insertEntry(db, { source: 'manual', status: 'completed', endedAt: null })
    ).toThrow(/CHECK/)
    db.close()
  })

  it('部分唯一索引保证同一时刻只有一个手动计时、一个自动片段', () => {
    applyMigrations(db)
    seedTask(db)

    insertEntry(db, { id: '11111111-1111-4111-8111-111111111111', source: 'manual' })
    expect(() =>
      insertEntry(db, { id: '22222222-2222-4222-8222-222222222222', source: 'manual' })
    ).toThrow(/UNIQUE/)

    insertEntry(db, {
      id: '33333333-3333-4333-8333-333333333333',
      source: 'auto',
      status: 'running',
      taskId: null,
      appKey: 'photoshop'
    })
    expect(() =>
      insertEntry(db, {
        id: '44444444-4444-4444-8444-444444444444',
        source: 'auto',
        status: 'running',
        taskId: null,
        appKey: 'krita'
      })
    ).toThrow(/UNIQUE/)
    db.close()
  })
})
