import { z } from 'zod'

/**
 * 领域模型与输入契约。
 *
 * 设计约定（P1.1）：
 * - 实体主键使用 UUID v4（文本存储）；
 * - 金额一律用整数“分”存储和传输，避免浮点误差；
 * - 时间统一用 UTC ISO 8601 字符串（带毫秒和 Z 后缀），展示时再由界面转本地时区；
 * - 归档用 archived_at 软删除，不物理删除历史记录。
 */

/** 标准 UUID 文本形式（含版本位与变体位校验）。 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const uuidSchema = z
  .string()
  .regex(UUID_PATTERN, '必须是合法的 UUID')

/**
 * UTC ISO 8601 时间。必须带 Z 后缀，明确表示这是 UTC 时间，
 * 避免“本地时间当 UTC 存”这类难以察觉的时区错误。
 */
export const utcIsoSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    '时间必须是 UTC ISO 8601 格式，例如 2026-11-14T04:00:00.000Z'
  )

/** 金额（整数分）。拒绝小数、负数和非数字。 */
export const centsSchema = z
  .number()
  .int('金额必须是整数分，不能带小数')
  .nonnegative('金额不能为负数')

const nameSchema = z.string().trim().min(1, '名称不能为空').max(200, '名称最长 200 个字符')
const shortTextSchema = z.string().trim().max(500, '内容过长（最多 500 个字符）')
const longTextSchema = z.string().trim().max(4000, '内容过长（最多 4000 个字符）')

/** 委托状态：草稿 / 进行中 / 已完成 / 已取消。 */
export const commissionStatusSchema = z.enum(['draft', 'active', 'completed', 'cancelled'])
export type CommissionStatus = z.infer<typeof commissionStatusSchema>

/** 付款状态：未付款 / 部分付款 / 已付清。 */
export const paymentStatusSchema = z.enum(['unpaid', 'partial', 'paid'])
export type PaymentStatus = z.infer<typeof paymentStatusSchema>

/** 优先级：1 最高，5 最低。 */
export const prioritySchema = z.number().int().min(1).max(5)

// ---------------------------------------------------------------------------
// 客户
// ---------------------------------------------------------------------------

export const clientSchema = z.object({
  id: uuidSchema,
  name: z.string().min(1),
  contact: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: utcIsoSchema,
  updatedAt: utcIsoSchema,
  archivedAt: utcIsoSchema.nullable()
})
export type Client = z.infer<typeof clientSchema>

export const createClientInputSchema = z.object({
  name: nameSchema,
  contact: shortTextSchema.nullish(),
  note: longTextSchema.nullish()
})
export type CreateClientInput = z.infer<typeof createClientInputSchema>

export const updateClientInputSchema = z.object({
  id: uuidSchema,
  name: nameSchema.optional(),
  contact: shortTextSchema.nullish(),
  note: longTextSchema.nullish()
})
export type UpdateClientInput = z.infer<typeof updateClientInputSchema>

export const listClientsInputSchema = z.object({
  includeArchived: z.boolean().default(false)
})
export type ListClientsInput = z.infer<typeof listClientsInputSchema>

// ---------------------------------------------------------------------------
// 委托
// ---------------------------------------------------------------------------

export const commissionSchema = z.object({
  id: uuidSchema,
  clientId: uuidSchema,
  title: z.string().min(1),
  description: z.string().nullable(),
  type: z.string().min(1),
  status: commissionStatusSchema,
  priority: prioritySchema,
  deadlineAt: utcIsoSchema.nullable(),
  quoteAmountCents: centsSchema,
  paidAmountCents: centsSchema,
  paymentStatus: paymentStatusSchema,
  createdAt: utcIsoSchema,
  updatedAt: utcIsoSchema,
  archivedAt: utcIsoSchema.nullable()
})
export type Commission = z.infer<typeof commissionSchema>

export const createCommissionInputSchema = z.object({
  clientId: uuidSchema,
  title: nameSchema,
  description: longTextSchema.nullish(),
  type: z.string().trim().min(1, '请填写委托类型').max(100, '委托类型最长 100 个字符'),
  priority: prioritySchema.default(3),
  deadlineAt: utcIsoSchema.nullish(),
  quoteAmountCents: centsSchema.default(0)
})
export type CreateCommissionInput = z.infer<typeof createCommissionInputSchema>

export const updateCommissionInputSchema = z.object({
  id: uuidSchema,
  title: nameSchema.optional(),
  description: longTextSchema.nullish(),
  type: z.string().trim().min(1).max(100).optional(),
  priority: prioritySchema.optional(),
  deadlineAt: utcIsoSchema.nullish(),
  quoteAmountCents: centsSchema.optional(),
  paidAmountCents: centsSchema.optional(),
  paymentStatus: paymentStatusSchema.optional(),
  status: commissionStatusSchema.optional()
})
export type UpdateCommissionInput = z.infer<typeof updateCommissionInputSchema>

export const listCommissionsInputSchema = z.object({
  clientId: uuidSchema.optional(),
  status: commissionStatusSchema.optional(),
  includeArchived: z.boolean().default(false)
})
export type ListCommissionsInput = z.infer<typeof listCommissionsInputSchema>

/** 通过 id 定位一条记录（查询 / 归档共用）。 */
export const byIdInputSchema = z.object({ id: uuidSchema })
export type ByIdInput = z.infer<typeof byIdInputSchema>
