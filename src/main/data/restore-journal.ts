import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export type RestorePhase =
  | 'prepared'
  | 'backup-complete'
  | 'old-moved'
  | 'new-installed'
  | 'validated'
  | 'completed'

export type FileOperationStatus = 'started' | 'completed' | 'failed'

export interface FileOperation {
  id: string
  kind: string
  from: string
  to: string
  status: FileOperationStatus
  fromExisted: boolean
  startedAt: string
  finishedAt: string | null
  error: string | null
}

export interface RestoreJournal {
  version: 1
  phase: RestorePhase
  startedAt: string
  updatedAt: string
  sourcePath: string
  sourceHash: string
  stagingPath: string
  rollbackPath: string
  preRestoreBackup: string | null
  operations: FileOperation[]
}

export function newJournal(input: {
  sourcePath: string
  sourceHash: string
  stagingPath: string
  rollbackPath: string
  now?: string
}): RestoreJournal {
  const now = input.now ?? new Date().toISOString()
  return {
    version: 1,
    phase: 'prepared',
    startedAt: now,
    updatedAt: now,
    sourcePath: input.sourcePath,
    sourceHash: input.sourceHash,
    stagingPath: input.stagingPath,
    rollbackPath: input.rollbackPath,
    preRestoreBackup: null,
    operations: []
  }
}

export function writeJournal(path: string, journal: RestoreJournal): void {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  journal.updatedAt = new Date().toISOString()
  writeFileSync(temp, JSON.stringify(journal, null, 2), 'utf8')
  renameSync(temp, path)
}

export function readJournal(path: string): RestoreJournal | null {
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as RestoreJournal
    if (parsed?.version !== 1 || !Array.isArray(parsed.operations)) return null
    return parsed
  } catch {
    return null
  }
}

export function setPhase(path: string, journal: RestoreJournal, phase: RestorePhase): void {
  journal.phase = phase
  writeJournal(path, journal)
}

/**
 * 移动一个文件并记录操作意图/完成状态。
 * 主文件缺失视为错误；sidecar 缺失可通过 optional 跳过。
 */
export function moveWithJournal(input: {
  journalPath: string
  journal: RestoreJournal
  from: string
  to: string
  kind: string
  optional?: boolean
}): boolean {
  const { journalPath, journal, from, to, kind, optional = false } = input
  const fromExisted = existsSync(from)
  const operation: FileOperation = {
    id: randomUUID(),
    kind,
    from,
    to,
    status: 'started',
    fromExisted,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null
  }
  journal.operations.push(operation)
  writeJournal(journalPath, journal)

  if (!fromExisted) {
    if (existsSync(to)) {
      operation.status = 'completed'
      operation.finishedAt = new Date().toISOString()
      writeJournal(journalPath, journal)
      return true
    }
    if (optional) {
      operation.status = 'completed'
      operation.finishedAt = new Date().toISOString()
      writeJournal(journalPath, journal)
      return false
    }
    operation.status = 'failed'
    operation.error = '源文件不存在'
    operation.finishedAt = new Date().toISOString()
    writeJournal(journalPath, journal)
    throw new Error(`恢复文件操作失败：源文件不存在 ${from}`)
  }

  try {
    renameSync(from, to)
    operation.status = 'completed'
    operation.finishedAt = new Date().toISOString()
    writeJournal(journalPath, journal)
    return true
  } catch (error) {
    operation.status = 'failed'
    operation.error = error instanceof Error ? error.message : String(error)
    operation.finishedAt = new Date().toISOString()
    writeJournal(journalPath, journal)
    throw new Error(`恢复文件操作失败：${from} → ${to}：${operation.error}`)
  }
}

/** 按主文件 + WAL + SHM 的集合移动，保持配对。 */
export function moveDatabaseSet(input: {
  journalPath: string
  journal: RestoreJournal
  fromMain: string
  toMain: string
  kindPrefix: string
}): void {
  const { journalPath, journal, fromMain, toMain, kindPrefix } = input
  moveWithJournal({ journalPath, journal, from: fromMain, to: toMain, kind: `${kindPrefix}-main` })
  moveWithJournal({
    journalPath,
    journal,
    from: `${fromMain}-wal`,
    to: `${toMain}-wal`,
    kind: `${kindPrefix}-wal`,
    optional: true
  })
  moveWithJournal({
    journalPath,
    journal,
    from: `${fromMain}-shm`,
    to: `${toMain}-shm`,
    kind: `${kindPrefix}-shm`,
    optional: true
  })
}
