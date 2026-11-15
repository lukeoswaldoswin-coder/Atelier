import { derivePaymentStatus } from '@shared/payment'
import type { AppDatabase } from './database'
import { assertNoForeignKeyViolations } from './integrity'

/**
 * 数据库迁移定义。
 *
 * 规则：
 * - 每个迁移只追加，不修改已发布的迁移内容（否则老数据库会和代码不一致）；
 * - id 必须按字典序递增，迁移按此顺序执行；
 * - 每个迁移在一个事务里执行，失败则整体回滚。
 *
 * P1.1.5 的 002 迁移重建 commissions 表：
 * - 截止时间拆成三态：none / date / datetime；
 * - quote_amount_cents 改为可空（NULL = 未报价，0 = 免费）；
 * - payment_status 增加 unquoted / not_required，并由金额推导后回填；
 * - 增加“金额与付款状态自洽”的 CHECK，等价于禁止超额收款。
 */
export interface MigrationContext {
  /** 执行迁移时的系统时区（用于回填历史 datetime 数据） */
  readonly timeZone: string
  /** 执行迁移时的 UTC 时间 */
  readonly now: string
}

export interface Migration {
  readonly id: string
  readonly name: string
  /** 纯 SQL 迁移（与 run 二选一） */
  readonly sql?: string
  /** 需要程序逻辑时使用（与 sql 二选一） */
  readonly run?: (db: AppDatabase, context: MigrationContext) => void
}

/**
 * 校验“UTC ISO 8601 文本”的 SQL 片段。
 * 注意：SQLite 的 GLOB 用 * 和 ? 作通配符（不是 LIKE 的 _ 和 %），
 * 字符类 [0-9] 用来限定日期数字，末尾的 Z 保证是 UTC 而不是本地时间。
 * GLOB 只检查形状；真实日历合法性与时区合法性由应用层 Zod 负责。
 */
const UTC_GLOB = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'"

/** 002 重建后的 commissions 表结构。 */
const COMMISSIONS_V2_DDL = `
  CREATE TABLE commissions_new (
    id                TEXT PRIMARY KEY NOT NULL,
    client_id         TEXT NOT NULL REFERENCES clients (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    title             TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description       TEXT,
    type              TEXT NOT NULL CHECK (length(trim(type)) > 0),
    status            TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
    priority          INTEGER NOT NULL DEFAULT 3
                        CHECK (typeof(priority) = 'integer' AND priority BETWEEN 1 AND 5),

    deadline_kind     TEXT NOT NULL DEFAULT 'none'
                        CHECK (deadline_kind IN ('none', 'date', 'datetime')),
    deadline_date     TEXT,
    deadline_at       TEXT,
    deadline_timezone TEXT,

    quote_amount_cents INTEGER,
    paid_amount_cents  INTEGER NOT NULL DEFAULT 0,
    payment_status     TEXT NOT NULL DEFAULT 'unquoted'
                         CHECK (payment_status IN ('unquoted', 'not_required', 'unpaid', 'partial', 'paid')),

    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    archived_at       TEXT,

    CHECK (quote_amount_cents IS NULL
           OR (typeof(quote_amount_cents) = 'integer' AND quote_amount_cents >= 0)),
    CHECK (typeof(paid_amount_cents) = 'integer' AND paid_amount_cents >= 0),

    -- 截止时间三态互斥；IS TRUE 防止 NULL 被 SQLite 当成“通过”
    CHECK ((
        (deadline_kind = 'none'
          AND deadline_date IS NULL AND deadline_at IS NULL AND deadline_timezone IS NULL)
        OR (deadline_kind = 'date'
          AND deadline_date IS NOT NULL
          AND deadline_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
          AND date(deadline_date) IS NOT NULL
          AND date(deadline_date) = deadline_date
          AND deadline_at IS NULL AND deadline_timezone IS NULL)
        OR (deadline_kind = 'datetime'
          AND deadline_at IS NOT NULL
          AND deadline_at GLOB ${UTC_GLOB}
          AND deadline_timezone IS NOT NULL
          AND length(trim(deadline_timezone)) BETWEEN 1 AND 64
          AND deadline_date IS NULL)
      ) IS TRUE),

    -- 金额与付款状态自洽；等价于禁止超额收款
    CHECK ((
        (quote_amount_cents IS NULL AND paid_amount_cents = 0
          AND payment_status = 'unquoted')
        OR (quote_amount_cents IS NOT NULL AND quote_amount_cents = 0
          AND paid_amount_cents = 0 AND payment_status = 'not_required')
        OR (quote_amount_cents IS NOT NULL AND quote_amount_cents > 0
          AND paid_amount_cents = 0 AND payment_status = 'unpaid')
        OR (quote_amount_cents IS NOT NULL AND quote_amount_cents > 0
          AND paid_amount_cents > 0 AND paid_amount_cents < quote_amount_cents
          AND payment_status = 'partial')
        OR (quote_amount_cents IS NOT NULL AND quote_amount_cents > 0
          AND paid_amount_cents = quote_amount_cents AND payment_status = 'paid')
      ) IS TRUE),

    CHECK (created_at GLOB ${UTC_GLOB}),
    CHECK (updated_at GLOB ${UTC_GLOB}),
    CHECK (archived_at IS NULL OR archived_at GLOB ${UTC_GLOB})
  )
`

const COMMISSIONS_V2_INDEXES = `
  CREATE INDEX idx_commissions_client ON commissions (client_id);
  CREATE INDEX idx_commissions_status ON commissions (status);
  CREATE INDEX idx_commissions_deadline ON commissions (deadline_at);
  CREATE INDEX idx_commissions_archived ON commissions (archived_at);
  CREATE INDEX idx_commissions_payment_status ON commissions (payment_status);
`

interface LegacyCommissionRow {
  id: string
  client_id: string
  title: string
  description: string | null
  type: string
  status: string
  priority: number
  deadline_at: string | null
  quote_amount_cents: number
  paid_amount_cents: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

/** 003：绘画任务表。 */
const TASKS_V1_DDL = `
  CREATE TABLE tasks (
    id                TEXT PRIMARY KEY NOT NULL,
    commission_id     TEXT NOT NULL REFERENCES commissions (id) ON UPDATE CASCADE ON DELETE RESTRICT,
    title             TEXT NOT NULL CHECK (length(trim(title)) > 0),
    description       TEXT,
    stage             TEXT NOT NULL DEFAULT 'draft'
                        CHECK (stage IN ('draft', 'lineart', 'color', 'final', 'other')),
    status            TEXT NOT NULL DEFAULT 'todo'
                        CHECK (status IN ('todo', 'doing', 'done')),
    estimated_minutes INTEGER
                        CHECK (estimated_minutes IS NULL
                               OR (typeof(estimated_minutes) = 'integer' AND estimated_minutes >= 0)),
    sort_order        INTEGER NOT NULL DEFAULT 0
                        CHECK (typeof(sort_order) = 'integer' AND sort_order >= 0),
    completed_at      TEXT CHECK (completed_at IS NULL OR completed_at GLOB ${UTC_GLOB}),
    created_at        TEXT NOT NULL CHECK (created_at GLOB ${UTC_GLOB}),
    updated_at        TEXT NOT NULL CHECK (updated_at GLOB ${UTC_GLOB}),
    archived_at       TEXT CHECK (archived_at IS NULL OR archived_at GLOB ${UTC_GLOB}),

    -- 完成状态与完成时间必须一致
    CHECK ((status = 'done') = (completed_at IS NOT NULL))
  );

  CREATE INDEX idx_tasks_commission_stage_sort ON tasks (commission_id, stage, sort_order);
  CREATE INDEX idx_tasks_commission_status ON tasks (commission_id, status);
  CREATE INDEX idx_tasks_archived ON tasks (archived_at);
`

export const MIGRATIONS: readonly Migration[] = [
  {
    id: '001-initial',
    name: '创建 clients 与 commissions 基础表',
    sql: `
      CREATE TABLE clients (
        id          TEXT PRIMARY KEY NOT NULL,
        name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
        contact     TEXT,
        note        TEXT,
        created_at  TEXT NOT NULL CHECK (created_at GLOB ${UTC_GLOB}),
        updated_at  TEXT NOT NULL CHECK (updated_at GLOB ${UTC_GLOB}),
        archived_at TEXT CHECK (archived_at IS NULL OR archived_at GLOB ${UTC_GLOB})
      );

      CREATE INDEX idx_clients_archived ON clients (archived_at);

      CREATE TABLE commissions (
        id                 TEXT PRIMARY KEY NOT NULL,
        client_id          TEXT NOT NULL REFERENCES clients (id) ON UPDATE CASCADE ON DELETE RESTRICT,
        title              TEXT NOT NULL CHECK (length(trim(title)) > 0),
        description        TEXT,
        type               TEXT NOT NULL CHECK (length(trim(type)) > 0),
        status             TEXT NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
        priority           INTEGER NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
        deadline_at        TEXT,
        quote_amount_cents INTEGER NOT NULL DEFAULT 0
                             CHECK (typeof(quote_amount_cents) = 'integer' AND quote_amount_cents >= 0),
        paid_amount_cents  INTEGER NOT NULL DEFAULT 0
                             CHECK (typeof(paid_amount_cents) = 'integer' AND paid_amount_cents >= 0),
        payment_status     TEXT NOT NULL DEFAULT 'unpaid'
                             CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
        created_at         TEXT NOT NULL CHECK (created_at GLOB ${UTC_GLOB}),
        updated_at         TEXT NOT NULL CHECK (updated_at GLOB ${UTC_GLOB}),
        archived_at        TEXT CHECK (archived_at IS NULL OR archived_at GLOB ${UTC_GLOB})
      );

      CREATE INDEX idx_commissions_client ON commissions (client_id);
      CREATE INDEX idx_commissions_status ON commissions (status);
      CREATE INDEX idx_commissions_deadline ON commissions (deadline_at);
      CREATE INDEX idx_commissions_archived ON commissions (archived_at);
    `
  },
  {
    id: '002-deadline-and-payment',
    name: '截止时间三态 + 金额可空 + 付款状态推导',
    run(db: AppDatabase, context: MigrationContext): void {
      const legacyRows = db
        .prepare(
          `SELECT id, client_id, title, description, type, status, priority, deadline_at,
                  quote_amount_cents, paid_amount_cents, created_at, updated_at, archived_at
             FROM commissions`
        )
        .all() as LegacyCommissionRow[]

      db.exec(COMMISSIONS_V2_DDL)

      const insert = db.prepare(
        `INSERT INTO commissions_new (
           id, client_id, title, description, type, status, priority,
           deadline_kind, deadline_date, deadline_at, deadline_timezone,
           quote_amount_cents, paid_amount_cents, payment_status,
           created_at, updated_at, archived_at
         ) VALUES (
           @id, @clientId, @title, @description, @type, @status, @priority,
           @deadlineKind, @deadlineDate, @deadlineAt, @deadlineTimeZone,
           @quoteAmountCents, @paidAmountCents, @paymentStatus,
           @createdAt, @updatedAt, @archivedAt
         )`
      )

      for (const row of legacyRows) {
        // 截止时间：旧表只有 datetime 或空
        const hasDeadline = row.deadline_at !== null
        const deadlineKind = hasDeadline ? 'datetime' : 'none'
        const deadlineTimeZone = hasDeadline ? context.timeZone : null

        // 金额回填：旧默认 0 只代表“没填”，一律转成未报价；明确免费从 002 起才有
        let quoteCents: number | null = row.quote_amount_cents
        let paidCents = row.paid_amount_cents

        if (quoteCents === 0) {
          if (paidCents > 0) {
            // 理论上不该出现（旧代码不会这样写），保守按“已收金额即报价”处理并告警
            console.warn(
              `[migration 002] 委托 ${row.id} 报价为 0 但已收 ${paidCents} 分，按已付清回填`
            )
            quoteCents = paidCents
          } else {
            quoteCents = null
          }
        }

        if (quoteCents !== null && paidCents > quoteCents) {
          console.warn(
            `[migration 002] 委托 ${row.id} 已收 ${paidCents} 分超过报价 ${quoteCents} 分，按报价=已收回填`
          )
          quoteCents = paidCents
        }

        insert.run({
          id: row.id,
          clientId: row.client_id,
          title: row.title,
          description: row.description,
          type: row.type,
          status: row.status,
          priority: row.priority,
          deadlineKind,
          deadlineDate: null,
          deadlineAt: row.deadline_at,
          deadlineTimeZone,
          quoteAmountCents: quoteCents,
          paidAmountCents: paidCents,
          paymentStatus: derivePaymentStatus(quoteCents, paidCents),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          archivedAt: row.archived_at
        })
      }

      db.exec('DROP TABLE commissions')
      db.exec('ALTER TABLE commissions_new RENAME TO commissions')
      db.exec(COMMISSIONS_V2_INDEXES)

      const afterCount = db.prepare('SELECT COUNT(*) AS c FROM commissions').get() as { c: number }
      if (afterCount.c !== legacyRows.length) {
        throw new Error(
          `迁移 002 数据量不一致：迁移前 ${legacyRows.length} 行，迁移后 ${afterCount.c} 行`
        )
      }

      // PRAGMA foreign_key_check 只返回结果、不会抛错，必须主动检查
      assertNoForeignKeyViolations(db, '迁移 002')
    }
  },
  {
    id: '003-tasks',
    name: '绘画任务表 + 委托完成时间',
    run(db: AppDatabase): void {
      // 已完成委托没有真实完成时间，用 updated_at 近似回填（在 README 中注明）
      db.exec(
        `ALTER TABLE commissions ADD COLUMN completed_at TEXT
           CHECK (completed_at IS NULL OR completed_at GLOB ${UTC_GLOB})`
      )
      const backfilled = db
        .prepare(
          `UPDATE commissions SET completed_at = updated_at
            WHERE status = 'completed' AND completed_at IS NULL`
        )
        .run()

      db.exec(TASKS_V1_DDL)

      // PRAGMA foreign_key_check 只返回结果、不会抛错，必须主动检查
      assertNoForeignKeyViolations(db, '迁移 003')

      if (backfilled.changes > 0) {
        console.info(
          `[migration 003] 回填 ${backfilled.changes} 个已完成委托的完成时间（使用 updated_at 近似）`
        )
      }
    }
  },
  {
    id: '004-task-planned-date',
    name: '任务计划日期',
    run(db: AppDatabase): void {
      // 仅追加列：既有任务升级后 planned_date 为 NULL（未安排）
      db.exec(
        `ALTER TABLE tasks ADD COLUMN planned_date TEXT
           CHECK (
             planned_date IS NULL
             OR (
               planned_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
               AND date(planned_date) IS NOT NULL
               AND date(planned_date) = planned_date
             )
           )`
      )

      db.exec(`
        CREATE INDEX idx_tasks_planned_date ON tasks (planned_date);
        CREATE INDEX idx_tasks_unscheduled ON tasks (commission_id)
          WHERE planned_date IS NULL AND archived_at IS NULL AND status <> 'done';
      `)

      assertNoForeignKeyViolations(db, '迁移 004')
    }
  },
  {
    id: '005-time-entries',
    name: '工时记录与应用设置',
    run(db: AppDatabase): void {
      db.exec(`
        CREATE TABLE time_entries (
          id                 TEXT PRIMARY KEY NOT NULL,
          task_id            TEXT REFERENCES tasks (id) ON UPDATE CASCADE ON DELETE RESTRICT,
          source             TEXT NOT NULL CHECK (source IN ('manual', 'auto')),
          status             TEXT NOT NULL CHECK (status IN ('running', 'paused', 'completed')),
          started_at         TEXT NOT NULL CHECK (started_at GLOB ${UTC_GLOB}),
          ended_at           TEXT CHECK (ended_at IS NULL OR ended_at GLOB ${UTC_GLOB}),
          elapsed_seconds    INTEGER NOT NULL DEFAULT 0
                               CHECK (typeof(elapsed_seconds) = 'integer' AND elapsed_seconds >= 0),
          last_heartbeat_at  TEXT CHECK (last_heartbeat_at IS NULL OR last_heartbeat_at GLOB ${UTC_GLOB}),
          app_key            TEXT CHECK (app_key IS NULL OR (length(app_key) BETWEEN 1 AND 40)),
          merged_into_id     TEXT REFERENCES time_entries (id) ON DELETE SET NULL,
          note               TEXT,
          clock_skew_seconds INTEGER,
          deleted_at         TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB ${UTC_GLOB}),
          created_at         TEXT NOT NULL CHECK (created_at GLOB ${UTC_GLOB}),
          updated_at         TEXT NOT NULL CHECK (updated_at GLOB ${UTC_GLOB}),

          -- 完成状态必须有结束时间；未完成不得有
          CHECK ((status = 'completed') = (ended_at IS NOT NULL)),
          -- 只有手动计时允许暂停
          CHECK (source = 'manual' OR status <> 'paused'),
          -- 应用标识只属于自动记录
          CHECK (source = 'auto' OR app_key IS NULL)
        );

        CREATE INDEX idx_time_entries_started ON time_entries (started_at);
        CREATE INDEX idx_time_entries_task ON time_entries (task_id);
        CREATE INDEX idx_time_entries_merged ON time_entries (merged_into_id);

        -- 同一时刻最多一个手动计时、一个自动片段
        CREATE UNIQUE INDEX ux_time_entries_manual_active ON time_entries (source)
          WHERE source = 'manual' AND status IN ('running', 'paused') AND deleted_at IS NULL;
        CREATE UNIQUE INDEX ux_time_entries_auto_active ON time_entries (source)
          WHERE source = 'auto' AND status = 'running' AND deleted_at IS NULL;

        CREATE TABLE app_settings (
          key        TEXT PRIMARY KEY NOT NULL,
          value      TEXT NOT NULL,
          updated_at TEXT NOT NULL CHECK (updated_at GLOB ${UTC_GLOB})
        );
      `)

      assertNoForeignKeyViolations(db, '迁移 005')
    }
  },
  {
    id: '006-time-entry-segments',
    name: '工时活跃片段明细表',
    run(db: AppDatabase): void {
      // 只新增明细表，不回填、不修改任何既有数据：
      // 老记录没有片段，由应用层（shared/calendar-activity）按老记录规则尽力还原。
      db.exec(`
        CREATE TABLE time_entry_segments (
          id         TEXT PRIMARY KEY NOT NULL,
          entry_id   TEXT NOT NULL REFERENCES time_entries (id) ON UPDATE CASCADE ON DELETE CASCADE,
          started_at TEXT NOT NULL CHECK (started_at GLOB ${UTC_GLOB}),
          ended_at   TEXT NOT NULL CHECK (ended_at GLOB ${UTC_GLOB}),
          seconds    INTEGER NOT NULL CHECK (typeof(seconds) = 'integer' AND seconds >= 0),
          created_at TEXT NOT NULL CHECK (created_at GLOB ${UTC_GLOB}),
          updated_at TEXT NOT NULL CHECK (updated_at GLOB ${UTC_GLOB})
        );

        CREATE INDEX idx_time_entry_segments_entry ON time_entry_segments (entry_id, started_at);
      `)

      assertNoForeignKeyViolations(db, '迁移 006')
    }
  }
]
