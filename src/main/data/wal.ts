import type Database from 'better-sqlite3'
import { existsSync, statSync } from 'node:fs'
import { sidecarPath } from './data-paths'

export interface WalCheckpointResult {
  busy: number
  log: number
  checkpointed: number
  ok: boolean
}

/** 执行 TRUNCATE checkpoint 并解析实际返回，不只依赖 SQL 成功。 */
export function truncateWal(db: Database.Database): WalCheckpointResult {
  const raw = db.pragma('wal_checkpoint(TRUNCATE)') as unknown
  const row = (Array.isArray(raw) ? raw[0] : raw) as Record<string, unknown> | undefined
  const busy = Number(row?.['busy'] ?? 1)
  const log = Number(row?.['log'] ?? -1)
  const checkpointed = Number(row?.['checkpointed'] ?? -1)
  return { busy, log, checkpointed, ok: busy === 0 && log === 0 }
}

export function walFileIsEmpty(mainPath: string): boolean {
  const path = sidecarPath(mainPath, '-wal')
  return !existsSync(path) || statSync(path).size === 0
}
