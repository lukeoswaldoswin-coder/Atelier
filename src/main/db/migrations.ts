/**
 * 数据库迁移定义。
 *
 * 规则：
 * - 每个迁移只追加，不修改已发布的迁移内容（否则老数据库会和代码不一致）；
 *   P1.1 的 001 仍在开发中，尚未发布给任何用户数据，因此可以直接修正；
 * - id 必须按字典序递增，迁移按此顺序执行；
 * - 每个迁移在一个事务里执行，失败则整体回滚。
 *
 * 结构设计要点（P1.1）：
 * - 主键为 UUID 文本；
 * - 时间统一存 UTC ISO 8601 文本（以 Z 结尾）；
 * - 金额存整数分，并用 CHECK 约束防止写入小数；
 * - 归档使用 archived_at 软删除，不物理删除历史记录；
 * - 委托对客户使用外键 RESTRICT，避免误删客户导致委托失去归属。
 */
export interface Migration {
  readonly id: string
  readonly name: string
  readonly sql: string
}

/**
 * 校验“UTC ISO 8601 文本”的 SQL 片段。
 * 注意：SQLite 的 GLOB 用 * 和 ? 作通配符（不是 LIKE 的 _ 和 %），
 * 字符类 [0-9] 用来限定日期数字，末尾的 Z 保证是 UTC 而不是本地时间。
 */
const UTC_GLOB = "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'"

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
        deadline_at        TEXT CHECK (deadline_at IS NULL OR deadline_at GLOB ${UTC_GLOB}),
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
  }
]
