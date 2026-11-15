import { beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from './database'
import { applyMigrations, getAppliedMigrations } from './migrator'
import { MIGRATIONS, type Migration } from './migrations'
import { assertNoForeignKeyViolations } from './integrity'

const throughFive = MIGRATIONS.slice(0, 5) as Migration[]

const ENTRY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER_ENTRY_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SEGMENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'

const T0 = '2026-11-15T15:50:00.000Z'
const T1 = '2026-11-15T16:10:00.000Z'

/** 插入一条已完成的手动工时记录（task_id 允许为空，便于隔离测试）。 */
function insertEntry(db: AppDatabase, id = ENTRY_ID): void {
  db.prepare(
    `INSERT INTO time_entries (
       id, task_id, source, status, started_at, ended_at, elapsed_seconds,
       last_heartbeat_at, app_key, merged_into_id, note, clock_skew_seconds,
       deleted_at, created_at, updated_at
     ) VALUES (?, NULL, 'manual', 'completed', ?, ?, 1200, ?, NULL, NULL, NULL, 0, NULL, ?, ?)`
  ).run(id, T0, T1, T1, T0, T1)
}

interface SegmentOverrides {
  id?: string
  entryId?: string
  startedAt?: string
  endedAt?: string
  seconds?: unknown
  createdAt?: string
  updatedAt?: string
}

function insertSegment(db: AppDatabase, overrides: SegmentOverrides = {}): void {
  const value = {
    id: SEGMENT_ID,
    entryId: ENTRY_ID,
    startedAt: T0,
    endedAt: T1,
    seconds: 1200,
    createdAt: T0,
    updatedAt: T1,
    ...overrides
  }

  db.prepare(
    `INSERT INTO time_entry_segments (
       id, entry_id, started_at, ended_at, seconds, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    value.id,
    value.entryId,
    value.startedAt,
    value.endedAt,
    value.seconds as number,
    value.createdAt,
    value.updatedAt
  )
}

describe('迁移 006：工时活跃片段明细表', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = openDatabase(':memory:')
  })

  it('新库包含 time_entry_segments 表与 (entry_id, started_at) 索引', () => {
    applyMigrations(db)

    const tables = (
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name)
    expect(tables).toContain('time_entry_segments')

    const columns = (
      db.prepare('PRAGMA table_info(time_entry_segments)').all() as Array<{
        name: string
        notnull: number
        pk: number
      }>
    ).map((row) => row.name)
    expect(columns).toEqual([
      'id',
      'entry_id',
      'started_at',
      'ended_at',
      'seconds',
      'created_at',
      'updated_at'
    ])

    const indexInfo = (
      db.prepare('PRAGMA index_info(idx_time_entry_segments_entry)').all() as Array<{
        seqno: number
        name: string
      }>
    )
      .sort((a, b) => a.seqno - b.seqno)
      .map((row) => row.name)
    expect(indexInfo).toEqual(['entry_id', 'started_at'])

    expect(getAppliedMigrations(db).map((row) => row.id)).toContain('006-time-entry-segments')
    db.close()
  })

  it('全部列 NOT NULL，主键是 id', () => {
    applyMigrations(db)

    const info = db.prepare('PRAGMA table_info(time_entry_segments)').all() as Array<{
      name: string
      notnull: number
      pk: number
    }>
    for (const column of info) {
      expect(column.notnull, `${column.name} 应为 NOT NULL`).toBe(1)
    }
    expect(info.filter((column) => column.pk === 1).map((column) => column.name)).toEqual(['id'])
    db.close()
  })

  it('CHECK 拒绝非 UTC 时间戳与非整数/负秒数', () => {
    applyMigrations(db)
    insertEntry(db)

    // 本地时间、缺 Z、日期形状不对都要拒绝
    expect(() => insertSegment(db, { startedAt: '2026-11-15T15:50:00.000+08:00' })).toThrow(/CHECK/)
    expect(() => insertSegment(db, { startedAt: '2026-11-15T15:50:00.000' })).toThrow(/CHECK/)
    expect(() => insertSegment(db, { endedAt: '2026-11-15 16:10:00Z' })).toThrow(/CHECK/)
    expect(() => insertSegment(db, { createdAt: 'not-a-time' })).toThrow(/CHECK/)
    expect(() => insertSegment(db, { updatedAt: '2026-11-15T16:10:00.000' })).toThrow(/CHECK/)

    // 负秒、浮点秒、无法转成整数的文本都不满足 typeof(seconds) = 'integer' AND seconds >= 0
    expect(() => insertSegment(db, { seconds: -1 })).toThrow(/CHECK/)
    expect(() => insertSegment(db, { seconds: 1.5 })).toThrow(/CHECK/)
    // 注意：INTEGER 亲和性会把 '1200' 存成整数，只有无法转换的文本才会留下 typeof = 'text'
    expect(() => insertSegment(db, { seconds: 'abc' })).toThrow(/CHECK/)

    // 合法值可以写入（含 0 秒边界）
    insertSegment(db)
    insertSegment(db, { id: '11111111-1111-4111-8111-111111111111', seconds: 0 })
    expect((db.prepare('SELECT COUNT(*) AS c FROM time_entry_segments').get() as { c: number }).c).toBe(
      2
    )
    db.close()
  })

  it('外键：不存在的 entry_id 被拒绝', () => {
    applyMigrations(db)
    insertEntry(db)

    expect(() =>
      insertSegment(db, { entryId: '99999999-9999-4999-8999-999999999999' })
    ).toThrow(/FOREIGN KEY/)

    insertSegment(db)
    expect((db.prepare('SELECT COUNT(*) AS c FROM time_entry_segments').get() as { c: number }).c).toBe(
      1
    )
    db.close()
  })

  it('外键级联：删除工时记录会一并删除片段', () => {
    applyMigrations(db)
    insertEntry(db)
    insertEntry(db, OTHER_ENTRY_ID)
    insertSegment(db)
    insertSegment(db, {
      id: '22222222-2222-4222-8222-222222222222',
      entryId: OTHER_ENTRY_ID
    })

    db.prepare('DELETE FROM time_entries WHERE id = ?').run(ENTRY_ID)

    const remaining = db
      .prepare('SELECT entry_id AS entryId FROM time_entry_segments')
      .all() as Array<{ entryId: string }>
    expect(remaining).toEqual([{ entryId: OTHER_ENTRY_ID }])
    assertNoForeignKeyViolations(db, '测试')
    db.close()
  })

  it('外键级联：工时记录改主键时片段 entry_id 跟随更新', () => {
    applyMigrations(db)
    insertEntry(db)
    insertSegment(db)

    const newId = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    db.prepare('UPDATE time_entries SET id = ? WHERE id = ?').run(newId, ENTRY_ID)

    const row = db
      .prepare('SELECT entry_id AS entryId FROM time_entry_segments WHERE id = ?')
      .get(SEGMENT_ID) as { entryId: string }
    expect(row.entryId).toBe(newId)
    db.close()
  })

  it('从 005 升级：不回填、不修改既有工时数据', () => {
    applyMigrations(db, throughFive)
    insertEntry(db)

    const before = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(ENTRY_ID)

    applyMigrations(db)

    const after = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(ENTRY_ID)
    expect(after).toEqual(before)
    // 老数据不回填片段
    expect((db.prepare('SELECT COUNT(*) AS c FROM time_entry_segments').get() as { c: number }).c).toBe(
      0
    )
    expect(getAppliedMigrations(db).map((row) => row.id)).toContain('006-time-entry-segments')
    assertNoForeignKeyViolations(db, '测试')
    db.close()
  })

  it('迁移幂等：重复执行不报错，既有片段保留', () => {
    applyMigrations(db)
    insertEntry(db)
    insertSegment(db)

    const second = applyMigrations(db)
    expect(second.applied).toEqual([])
    expect(getAppliedMigrations(db)).toHaveLength(6)

    expect((db.prepare('SELECT COUNT(*) AS c FROM time_entry_segments').get() as { c: number }).c).toBe(
      1
    )
    assertNoForeignKeyViolations(db, '测试')
    db.close()
  })
})
