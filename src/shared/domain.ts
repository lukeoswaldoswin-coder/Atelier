import { z } from 'zod'
import { isRealDateString, isValidTimeZone } from './time'

/**
 * 领域模型与输入契约。
 *
 * 设计约定（P1.1.5）：
 * - 实体主键使用 UUID v4（文本存储）；
 * - 金额一律用整数“分”存储和传输：null = 未报价，0 = 免费，正数 = 报价；
 * - 付款状态由金额推导，输入契约里**没有** paymentStatus 字段；
 * - 时间统一用 UTC ISO 8601 字符串（带毫秒和 Z 后缀）；
 * - 截止时间区分「无」「仅日期」「精确时刻」三种语义，日期型永不参与时区换算；
 * - 归档用 archived_at 软删除，不物理删除历史记录。
 */

/** 标准 UUID 文本形式（含版本位与变体位校验）。 */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const uuidSchema = z.string().regex(UUID_PATTERN, '必须是合法的 UUID')

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

/** 付款状态：未报价 / 无需付款 / 未付款 / 部分付款 / 已付清。 */
export const paymentStatusSchema = z.enum(['unquoted', 'not_required', 'unpaid', 'partial', 'paid'])
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
// 截止时间（三态）
// ---------------------------------------------------------------------------

/** 仅日期：纯日历概念，不绑定时区、不做任何时区换算。 */
export const deadlineDateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式必须是 YYYY-MM-DD')
  .refine(isRealDateString, '日期无效（例如 2 月 30 日不存在）')

/** 精确时刻：UTC 瞬间 + 创建时使用的 IANA 时区。 */
export const timeZoneStringSchema = z
  .string()
  .min(1, '时区不能为空')
  .max(64, '时区名过长')
  .refine(isValidTimeZone, '无效的 IANA 时区')

export const deadlineSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({ kind: z.literal('date'), date: deadlineDateStringSchema }),
  z.strictObject({ kind: z.literal('datetime'), at: utcIsoSchema, timeZone: timeZoneStringSchema })
])
export type Deadline = z.infer<typeof deadlineSchema>

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
  deadline: deadlineSchema,
  /** null = 未报价；0 = 免费；>0 = 报价金额（整数分） */
  quoteAmountCents: centsSchema.nullable(),
  paidAmountCents: centsSchema,
  /** 由金额推导，只读 */
  paymentStatus: paymentStatusSchema,
  /** 未收金额：未报价为 null，免费/已付清为 0，其余为欠款（派生字段，不入库） */
  outstandingCents: z.number().int().nonnegative().nullable(),
  /** 是否已结清（paid / not_required） */
  isSettled: z.boolean(),
  /** 完成时间（进入已完成时写入，离开时清空；派生自状态，不入库以外的地方） */
  completedAt: utcIsoSchema.nullable(),
  /** 未归档任务总数（派生字段，不入库） */
  taskCount: z.number().int().nonnegative(),
  /** 未归档且已完成的任务数（派生字段，不入库） */
  doneTaskCount: z.number().int().nonnegative(),
  createdAt: utcIsoSchema,
  updatedAt: utcIsoSchema,
  archivedAt: utcIsoSchema.nullable()
})
export type Commission = z.infer<typeof commissionSchema>

/**
 * 新建委托输入。
 * 使用 strictObject：任何未知字段（尤其是 paymentStatus）都会被拒绝，
 * 防止渲染进程绕过金额推导直接指定付款状态。
 */
export const createCommissionInputSchema = z.strictObject({
  clientId: uuidSchema,
  title: nameSchema,
  description: longTextSchema.nullish(),
  type: z.string().trim().min(1, '请填写委托类型').max(100, '委托类型最长 100 个字符'),
  priority: prioritySchema.default(3),
  deadline: deadlineSchema.optional(),
  /** 省略或 null 表示未报价；传 0 表示明确免费 */
  quoteAmountCents: centsSchema.nullish()
})
export type CreateCommissionInput = z.infer<typeof createCommissionInputSchema>

/** 更新委托输入。paymentStatus 不在其中，状态由主进程根据金额推导。 */
export const updateCommissionInputSchema = z.strictObject({
  id: uuidSchema,
  title: nameSchema.optional(),
  description: longTextSchema.nullish(),
  type: z.string().trim().min(1).max(100).optional(),
  priority: prioritySchema.optional(),
  deadline: deadlineSchema.optional(),
  quoteAmountCents: centsSchema.nullish(),
  paidAmountCents: centsSchema.optional(),
  status: commissionStatusSchema.optional()
})
export type UpdateCommissionInput = z.infer<typeof updateCommissionInputSchema>

export const listCommissionsInputSchema = z.object({
  clientId: uuidSchema.optional(),
  status: commissionStatusSchema.optional(),
  paymentStatus: paymentStatusSchema.optional(),
  includeArchived: z.boolean().default(false)
})
export type ListCommissionsInput = z.infer<typeof listCommissionsInputSchema>

/** 通过 id 定位一条记录（查询 / 归档共用）。 */
export const byIdInputSchema = z.object({ id: uuidSchema })
export type ByIdInput = z.infer<typeof byIdInputSchema>

// ---------------------------------------------------------------------------
// 绘画任务（P2）
// ---------------------------------------------------------------------------

/** 任务阶段：固定顺序 草稿→线稿→上色→完稿→其他。 */
export const taskStageSchema = z.enum(['draft', 'lineart', 'color', 'final', 'other'])
export type TaskStage = z.infer<typeof taskStageSchema>

/** 任务状态：待开始 / 进行中 / 已完成。 */
export const taskStatusSchema = z.enum(['todo', 'doing', 'done'])
export type TaskStatus = z.infer<typeof taskStatusSchema>

/** 预计工时的上限（30 天），防止误输入极端值。 */
export const MAX_ESTIMATED_MINUTES = 60 * 24 * 30

const estimatedMinutesSchema = z
  .number()
  .int('预计工时必须是整数分钟')
  .nonnegative('预计工时不能为负数')
  .max(MAX_ESTIMATED_MINUTES, '预计工时不能超过 30 天')

export const taskSchema = z.object({
  id: uuidSchema,
  commissionId: uuidSchema,
  title: z.string().min(1),
  description: z.string().nullable(),
  stage: taskStageSchema,
  status: taskStatusSchema,
  /** null = 未估；单位分钟 */
  estimatedMinutes: z.number().int().nonnegative().nullable(),
  sortOrder: z.number().int().nonnegative(),
  /** 与 status 联动：done 时必填，其余为 null */
  completedAt: utcIsoSchema.nullable(),
  createdAt: utcIsoSchema,
  updatedAt: utcIsoSchema,
  archivedAt: utcIsoSchema.nullable()
})
export type Task = z.infer<typeof taskSchema>

export const createTaskInputSchema = z.strictObject({
  commissionId: uuidSchema,
  title: nameSchema,
  description: longTextSchema.nullish(),
  stage: taskStageSchema.default('draft'),
  estimatedMinutes: estimatedMinutesSchema.nullish()
})
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>

/**
 * 更新任务。
 * completedAt 不在输入里：完成时间由 status 推导，防止渲染进程伪造。
 */
export const updateTaskInputSchema = z.strictObject({
  id: uuidSchema,
  title: nameSchema.optional(),
  description: longTextSchema.nullish(),
  stage: taskStageSchema.optional(),
  status: taskStatusSchema.optional(),
  estimatedMinutes: estimatedMinutesSchema.nullish()
})
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>

export const listTasksInputSchema = z.object({
  commissionId: uuidSchema,
  includeArchived: z.boolean().default(false)
})
export type ListTasksInput = z.infer<typeof listTasksInputSchema>

export const reorderTasksInputSchema = z.strictObject({
  commissionId: uuidSchema,
  stage: taskStageSchema,
  orderedIds: z.array(uuidSchema).max(500, '单个阶段的任务过多')
})
export type ReorderTasksInput = z.infer<typeof reorderTasksInputSchema>
