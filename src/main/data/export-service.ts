import Database from 'better-sqlite3'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ExportFileResult, ExportResult } from '@shared/data'
import { APP_KEY_LABELS } from '@shared/activity-apps'
import { TASK_STAGE_LABELS, TASK_STATUS_LABELS } from '@shared/tasks'
import { TIME_SOURCE_LABELS, TIME_STATUS_LABELS } from '@shared/time-entries'
import { formatDateTimeInZone, resolveSystemTimeZone } from '@shared/time'
import { csvNumber, csvTable, csvText, centsToYuan } from './csv'

export interface ExportServiceDeps {
  dbPath: string
  appVersion: string
  now?: () => Date
  timeZone?: string
  /** 测试钩子：快照读取完成、写文件之前触发 */
  afterSnapshot?: () => void
}

interface RawRow extends Record<string, unknown> {}

function stamp(date: Date): string {
  const iso = date.toISOString()
  const compact = iso.slice(0, 19).replace(/[-:T]/g, '')
  return `${compact.slice(0, 8)}-${compact.slice(8, 14)}`
}

function text(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function number(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value)
}

function deadlineText(row: RawRow): { kind: string; date: string; time: string; timeZone: string } {
  const kind = text(row['deadlineKind'])
  const date = text(row['deadlineDate'])
  const at = text(row['deadlineAt'])
  const timeZone = text(row['deadlineTimeZone'])
  if (kind === 'date') return { kind: '日期', date, time: '', timeZone: '' }
  if (kind === 'datetime') {
    return {
      kind: '日期+时间',
      date: at.slice(0, 10),
      time: timeZone ? formatDateTimeInZone(at, timeZone) : at,
      timeZone
    }
  }
  return { kind: '无', date: '', time: '', timeZone: '' }
}

/**
 * 导出四类 CSV 到用户选择的父目录。
 *
 * 所有查询在同一个只读事务中完成，确保四个文件与 manifest 来自同一 WAL 快照。
 */
export function exportData(parentDir: string, deps: ExportServiceDeps): ExportResult {
  const timeZone = deps.timeZone ?? resolveSystemTimeZone()
  const now = deps.now?.() ?? new Date()
  const baseName = `Atelier-export-${stamp(now)}`
  let folderName = baseName
  let suffix = 1
  while (existsSync(join(parentDir, folderName))) {
    folderName = `${baseName}-${suffix}`
    suffix += 1
  }
  const tempDir = join(parentDir, `.${folderName}.tmp`)
  const finalDir = join(parentDir, folderName)

  let clients: RawRow[] = []
  let commissions: RawRow[] = []
  let tasks: RawRow[] = []
  let entries: RawRow[] = []
  let schemaVersion: string | null = null

  const db = new Database(deps.dbPath, { readonly: true, fileMustExist: true })
  try {
    db.pragma('query_only = ON')
    db.pragma('busy_timeout = 5000')
    db.exec('BEGIN')

    clients = db
      .prepare(
        `SELECT id, name, contact, note, archived_at AS archivedAt, created_at AS createdAt, updated_at AS updatedAt
           FROM clients ORDER BY name COLLATE NOCASE, created_at, id`
      )
      .all() as RawRow[]

    commissions = db
      .prepare(
        `SELECT c.id, c.client_id AS clientId, cl.name AS clientName, c.title, c.description, c.type,
                c.status, c.priority, c.deadline_kind AS deadlineKind, c.deadline_date AS deadlineDate,
                c.deadline_at AS deadlineAt, c.deadline_timezone AS deadlineTimeZone,
                c.quote_amount_cents AS quoteAmountCents, c.paid_amount_cents AS paidAmountCents,
                c.payment_status AS paymentStatus, c.completed_at AS completedAt,
                c.archived_at AS archivedAt, c.created_at AS createdAt, c.updated_at AS updatedAt
           FROM commissions c LEFT JOIN clients cl ON cl.id = c.client_id
          ORDER BY c.created_at, c.id`
      )
      .all() as RawRow[]

    tasks = db
      .prepare(
        `SELECT t.id, t.commission_id AS commissionId, c.title AS commissionTitle, cl.name AS clientName,
                t.title, t.description, t.stage, t.status, t.estimated_minutes AS estimatedMinutes,
                t.planned_date AS plannedDate, t.sort_order AS sortOrder, t.completed_at AS completedAt,
                t.archived_at AS archivedAt, t.created_at AS createdAt, t.updated_at AS updatedAt
           FROM tasks t
           JOIN commissions c ON c.id = t.commission_id
           LEFT JOIN clients cl ON cl.id = c.client_id
          ORDER BY c.created_at, t.stage, t.sort_order, t.created_at, t.id`
      )
      .all() as RawRow[]

    entries = db
      .prepare(
        `SELECT e.id, e.task_id AS taskId, t.title AS taskTitle, c.title AS commissionTitle,
                cl.name AS clientName, e.source, e.status, e.started_at AS startedAt, e.ended_at AS endedAt,
                e.elapsed_seconds AS elapsedSeconds, e.app_key AS appKey, e.note, e.clock_skew_seconds AS clockSkewSeconds
           FROM time_entries e
           LEFT JOIN tasks t ON t.id = e.task_id
           LEFT JOIN commissions c ON c.id = t.commission_id
           LEFT JOIN clients cl ON cl.id = c.client_id
          WHERE e.deleted_at IS NULL AND e.merged_into_id IS NULL
          ORDER BY e.started_at, e.id`
      )
      .all() as RawRow[]

    const migrationRow = db
      .prepare('SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1')
      .get() as { id: string } | undefined
    schemaVersion = migrationRow?.id ?? null

    db.exec('COMMIT')
  } catch (error) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // 事务可能已结束
    }
    throw error
  } finally {
    db.close()
  }

  const clientRows = clients.map((row) => [
    csvText(text(row['id'])),
    csvText(text(row['name'])),
    csvText(text(row['contact'])),
    csvText(text(row['note'])),
    csvText(text(row['archivedAt'])),
    csvText(text(row['createdAt'])),
    csvText(text(row['updatedAt']))
  ])

  const commissionRows = commissions.map((row) => {
    const deadline = deadlineText(row)
    const quote = number(row['quoteAmountCents'])
    const paid = number(row['paidAmountCents'])
    const outstanding = quote === null ? null : Math.max(0, quote - (paid ?? 0))
    return [
      csvText(text(row['id'])),
      csvText(text(row['clientId'])),
      csvText(text(row['clientName'])),
      csvText(text(row['title'])),
      csvText(text(row['type'])),
      csvText(text(row['status'])),
      csvNumber(number(row['priority'])),
      csvText(deadline.kind),
      csvText(deadline.date),
      csvText(deadline.time),
      csvText(deadline.timeZone),
      csvNumber(quote),
      csvText(centsToYuan(quote)),
      csvNumber(paid),
      csvText(centsToYuan(paid)),
      csvNumber(outstanding),
      csvText(centsToYuan(outstanding)),
      csvText(text(row['paymentStatus'])),
      csvText(text(row['completedAt'])),
      csvText(text(row['archivedAt'])),
      csvText(text(row['createdAt'])),
      csvText(text(row['updatedAt']))
    ]
  })

  const taskRows = tasks.map((row) => {
    const estimated = number(row['estimatedMinutes'])
    return [
      csvText(text(row['id'])),
      csvText(text(row['commissionId'])),
      csvText(text(row['commissionTitle'])),
      csvText(text(row['clientName'])),
      csvText(text(row['title'])),
      csvText(TASK_STAGE_LABELS[text(row['stage']) as keyof typeof TASK_STAGE_LABELS] ?? text(row['stage'])),
      csvText(TASK_STATUS_LABELS[text(row['status']) as keyof typeof TASK_STATUS_LABELS] ?? text(row['status'])),
      csvNumber(estimated),
      csvText(estimated === null ? '' : (estimated / 60).toFixed(2)),
      csvText(text(row['plannedDate'])),
      csvNumber(number(row['sortOrder'])),
      csvText(text(row['completedAt'])),
      csvText(text(row['archivedAt'])),
      csvText(text(row['createdAt'])),
      csvText(text(row['updatedAt']))
    ]
  })

  const entryRows = entries.map((row) => {
    const startedAt = text(row['startedAt'])
    const endedAt = text(row['endedAt'])
    const seconds = number(row['elapsedSeconds']) ?? 0
    const appKey = text(row['appKey'])
    return [
      csvText(text(row['id'])),
      csvText(text(row['taskId'])),
      csvText(text(row['taskTitle'])),
      csvText(text(row['commissionTitle'])),
      csvText(text(row['clientName'])),
      csvText(TIME_SOURCE_LABELS[text(row['source']) as keyof typeof TIME_SOURCE_LABELS] ?? text(row['source'])),
      csvText(TIME_STATUS_LABELS[text(row['status']) as keyof typeof TIME_STATUS_LABELS] ?? text(row['status'])),
      csvText(startedAt),
      csvText(endedAt),
      csvText(startedAt ? formatDateTimeInZone(startedAt, timeZone) : ''),
      csvText(endedAt ? formatDateTimeInZone(endedAt, timeZone) : ''),
      csvText(timeZone),
      csvNumber(seconds),
      csvText((seconds / 3600).toFixed(2)),
      csvText(appKey ? APP_KEY_LABELS[appKey] ?? appKey : ''),
      csvText(text(row['note'])),
      csvNumber(number(row['clockSkewSeconds']))
    ]
  })

  const files: Array<{ name: string; content: string; rows: number }> = [
    {
      name: 'clients.csv',
      content: csvTable(
        ['客户ID', '客户名称', '联系方式', '备注', '归档时间', '创建时间', '更新时间'],
        clientRows
      ),
      rows: clientRows.length
    },
    {
      name: 'commissions.csv',
      content: csvTable(
        [
          '委托ID', '客户ID', '客户名称', '委托标题', '类型', '状态', '优先级',
          '截止类型', '截止日期', '截止时间', '截止时区',
          '报价（分）', '报价（元）', '已收（分）', '已收（元）', '未收（分）', '未收（元）',
          '付款状态', '完成时间', '归档时间', '创建时间', '更新时间'
        ],
        commissionRows
      ),
      rows: commissionRows.length
    },
    {
      name: 'tasks.csv',
      content: csvTable(
        [
          '任务ID', '委托ID', '委托标题', '客户名称', '任务标题', '阶段', '状态',
          '预计工时（分钟）', '预计工时（小时）', '计划日期', '排序号',
          '完成时间', '归档时间', '创建时间', '更新时间'
        ],
        taskRows
      ),
      rows: taskRows.length
    },
    {
      name: 'time_entries.csv',
      content: csvTable(
        [
          '记录ID', '任务ID', '任务标题', '委托标题', '客户名称', '来源', '状态',
          '开始时间（UTC）', '结束时间（UTC）', '开始时间（本地）', '结束时间（本地）', '时区',
          '实际工时（秒）', '实际工时（小时）', '应用', '备注', '时钟偏差（秒）'
        ],
        entryRows
      ),
      rows: entryRows.length
    }
  ]

  const totalRows = files.reduce((total, file) => total + file.rows, 0)
  deps.afterSnapshot?.()

  const manifest = {
    app: 'Atelier',
    appVersion: deps.appVersion,
    schemaVersion,
    exportedAt: now.toISOString(),
    timeZone,
    note: 'CSV 为结构化数据导出，不能用于恢复；完整数据库请使用备份。文本中可能带前导单引号以防止 Excel 公式注入。',
    files: files.map((file) => ({ name: file.name, rows: file.rows })),
    totalRows
  }

  try {
    mkdirSync(tempDir, { recursive: true })
    for (const file of files) writeFileSync(join(tempDir, file.name), file.content, 'utf8')
    writeFileSync(join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    writeFileSync(
      join(tempDir, 'README.txt'),
      [
        'Atelier 数据导出',
        '',
        '本目录是结构化数据导出，供 Excel 查看/归档，不能用于恢复数据库。',
        '完整数据库备份请使用 Atelier 设置页的“立即备份”。',
        '',
        '编码：UTF-8（带 BOM），换行：CRLF，便于中文 Windows Excel 打开。',
        '为防止 Excel 公式注入，部分用户文本可能带前导单引号（例如 \'=...），这是有意的安全处理。',
        '工时 CSV 只包含未被软删除、未合并的有效记录；完整历史见数据库备份。',
        `导出时间：${now.toISOString()}`,
        `应用版本：${deps.appVersion}`,
        `数据库版本：${schemaVersion ?? '未知'}`
      ].join('\r\n'),
      'utf8'
    )
    renameSync(tempDir, finalDir)
  } catch (error) {
    rmSync(tempDir, { recursive: true, force: true })
    throw error
  }

  return {
    folder: finalDir,
    files: files.map((file) => ({ name: file.name, rows: file.rows })) as ExportFileResult[],
    totalRows
  }
}

export function listExportFiles(folder: string): string[] {
  try {
    return readdirSync(folder)
  } catch {
    return []
  }
}
