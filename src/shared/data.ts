import { z } from 'zod'

/** P6 数据备份/恢复/导出在渲染进程与主进程之间的契约。 */

export const backupInfoSchema = z.object({
  path: z.string().min(1),
  fileName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  schemaVersion: z.string().nullable(),
  kind: z.enum(['manual', 'pre-restore'])
})
export type BackupInfo = z.infer<typeof backupInfoSchema>

export const dataInfoSchema = z.object({
  appVersion: z.string().min(1),
  dbPath: z.string().min(1),
  backupDir: z.string().min(1),
  recoveryArchiveDir: z.string().min(1),
  dbSizeBytes: z.number().int().nonnegative(),
  schemaVersion: z.string().nullable(),
  backupCount: z.number().int().nonnegative(),
  userDataDir: z.string().min(1)
})
export type DataInfo = z.infer<typeof dataInfoSchema>

export const restoreCandidateSchema = z.object({
  token: z.string().min(1),
  fileName: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.string().min(1),
  schemaVersion: z.string().nullable()
})
export type RestoreCandidate = z.infer<typeof restoreCandidateSchema>

export const restoreOutcomeSchema = z.object({
  restarting: z.boolean(),
  message: z.string().min(1)
})
export type RestoreOutcome = z.infer<typeof restoreOutcomeSchema>

export const exportFileResultSchema = z.object({
  name: z.string().min(1),
  rows: z.number().int().nonnegative()
})
export type ExportFileResult = z.infer<typeof exportFileResultSchema>

export const exportResultSchema = z.object({
  folder: z.string().min(1),
  files: z.array(exportFileResultSchema),
  totalRows: z.number().int().nonnegative()
})
export type ExportResult = z.infer<typeof exportResultSchema>

export const restoreTokenInputSchema = z.strictObject({
  token: z.string().min(1).max(200)
})
export type RestoreTokenInput = z.infer<typeof restoreTokenInputSchema>
