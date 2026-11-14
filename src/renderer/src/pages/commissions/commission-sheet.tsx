import { useState } from 'react'
import type { Client, Commission, Deadline } from '@shared/domain'
import { formatDateTimeInZone, zonedDateTimeToUtc } from '@shared/time'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import { createCommission, updateCommission } from '@/data/commission-actions'
import { formatIpcError } from '@/lib/ipc-error'
import { PARSE_YUAN_ERROR_MESSAGES, centsToYuanInput, parseYuanToCents } from '@/lib/money'

type DeadlineMode = 'none' | 'date' | 'datetime'
type QuoteMode = 'unquoted' | 'free' | 'amount'

const DEADLINE_OPTIONS = [
  { value: 'none' as const, label: '无截止' },
  { value: 'date' as const, label: '仅日期' },
  { value: 'datetime' as const, label: '日期 + 时间' }
]

const QUOTE_OPTIONS = [
  { value: 'unquoted' as const, label: '未报价' },
  { value: 'free' as const, label: '免费' },
  { value: 'amount' as const, label: '指定金额' }
]

/** 新建时未暴露优先级，使用与数据库默认值一致的中等优先级。 */
const DEFAULT_PRIORITY = 3

const COMMON_TYPES = ['插画', '漫画', '头像', '立绘', '封面', '设计']

interface FieldErrors {
  client?: string
  title?: string
  type?: string
  deadline?: string
  quote?: string
  form?: string
}

interface CommissionSheetProps {
  mode: 'create' | 'edit'
  commission: Commission | null
  /** 只包含未归档客户（调用方负责过滤） */
  clients: readonly Client[]
  /** 新建时的默认时区；编辑时优先沿用原委托的创建时区 */
  timeZone: string
  onClose: () => void
  onSaved: () => void
}

function initialDeadlineState(deadline: Deadline | undefined, fallbackTimeZone: string) {
  if (!deadline || deadline.kind === 'none') {
    return { mode: 'none' as DeadlineMode, date: '', time: '', timeZone: fallbackTimeZone }
  }
  if (deadline.kind === 'date') {
    return { mode: 'date' as DeadlineMode, date: deadline.date, time: '', timeZone: fallbackTimeZone }
  }
  const formatted = formatDateTimeInZone(deadline.at, deadline.timeZone)
  return {
    mode: 'datetime' as DeadlineMode,
    date: formatted.slice(0, 10),
    time: formatted.slice(11, 16),
    timeZone: deadline.timeZone
  }
}

/**
 * 委托新建 / 编辑面板。
 *
 * 严格区分三态报价（未报价 / 免费 / 指定金额）与三态截止时间（无 / 仅日期 / 日期+时间）。
 * 金额用字符串解析成整数分；日期型截止不换算时区；时刻型保存 UTC + 创建时区。
 */
export function CommissionSheet({
  mode,
  commission,
  clients,
  timeZone,
  onClose,
  onSaved
}: CommissionSheetProps) {
  const deadlineInitial = initialDeadlineState(commission?.deadline, timeZone)
  const initial = {
    clientId: commission?.clientId ?? '',
    title: commission?.title ?? '',
    type: commission?.type ?? '',
    deadlineMode: deadlineInitial.mode,
    date: deadlineInitial.date,
    time: deadlineInitial.time,
    timeZone: deadlineInitial.timeZone,
    quoteMode: (commission
      ? commission.quoteAmountCents === null
        ? 'unquoted'
        : commission.quoteAmountCents === 0
          ? 'free'
          : 'amount'
      : 'unquoted') as QuoteMode,
    amountText:
      commission && commission.quoteAmountCents !== null && commission.quoteAmountCents > 0
        ? centsToYuanInput(commission.quoteAmountCents)
        : ''
  }

  const [clientId, setClientId] = useState(initial.clientId)
  const [title, setTitle] = useState(initial.title)
  const [type, setType] = useState(initial.type)
  const [deadlineMode, setDeadlineMode] = useState<DeadlineMode>(initial.deadlineMode)
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [deadlineTimeZone] = useState(initial.timeZone)
  const [quoteMode, setQuoteMode] = useState<QuoteMode>(initial.quoteMode)
  const [amountText, setAmountText] = useState(initial.amountText)

  const [errors, setErrors] = useState<FieldErrors>({})
  const [saving, setSaving] = useState(false)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)

  const dirty =
    clientId !== initial.clientId ||
    title !== initial.title ||
    type !== initial.type ||
    deadlineMode !== initial.deadlineMode ||
    date !== initial.date ||
    time !== initial.time ||
    quoteMode !== initial.quoteMode ||
    amountText !== initial.amountText

  function requestClose() {
    if (!dirty) {
      onClose()
      return
    }
    setCloseConfirmOpen(true)
  }

  function buildDeadline(nextErrors: FieldErrors): Deadline | null {
    if (deadlineMode === 'none') return { kind: 'none' }
    if (deadlineMode === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        nextErrors.deadline = '请选择截止日期'
        return null
      }
      // 日期型原样保存，不做任何时区换算
      return { kind: 'date', date }
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      nextErrors.deadline = '请选择截止日期'
      return null
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      nextErrors.deadline = '请填写截止时间'
      return null
    }

    const conversion = zonedDateTimeToUtc({ date, time, timeZone: deadlineTimeZone })
    if (!conversion.ok) {
      nextErrors.deadline =
        conversion.reason === 'nonexistent-time'
          ? '这个时间在该时区不存在（夏令时切换），请换一个时间'
          : '日期或时间不合法'
      return null
    }

    return { kind: 'datetime', at: conversion.utc, timeZone: deadlineTimeZone }
  }

  function buildQuote(nextErrors: FieldErrors): number | null {
    if (quoteMode === 'unquoted') return null
    if (quoteMode === 'free') return 0

    const parsed = parseYuanToCents(amountText)
    if (!parsed.ok) {
      nextErrors.quote = PARSE_YUAN_ERROR_MESSAGES[parsed.reason]
      return null
    }
    return parsed.cents
  }

  async function submit() {
    const nextErrors: FieldErrors = {}
    const trimmedTitle = title.trim()
    const trimmedType = type.trim()

    if (mode === 'create' && clientId.length === 0) nextErrors.client = '请选择客户'
    if (trimmedTitle.length === 0) nextErrors.title = '请填写委托名称'
    if (trimmedType.length === 0) nextErrors.type = '请填写委托类型'

    const deadline = buildDeadline(nextErrors)
    const quoteCents = buildQuote(nextErrors)

    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0 || deadline === null) return

    setSaving(true)
    try {
      if (mode === 'create') {
        await createCommission({
          clientId,
          title: trimmedTitle,
          type: trimmedType,
          priority: DEFAULT_PRIORITY,
          deadline,
          quoteAmountCents: quoteCents
        })
      } else if (commission) {
        await updateCommission({
          id: commission.id,
          title: trimmedTitle,
          type: trimmedType,
          deadline,
          quoteAmountCents: quoteCents
        })
      }

      onSaved()
      onClose()
    } catch (error) {
      const message = formatIpcError(error)
      if (message.includes('客户')) {
        setErrors({ client: message })
      } else if (message.includes('报价') || message.includes('金额') || message.includes('已收')) {
        setErrors({ quote: message })
      } else {
        setErrors({ form: message })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Sheet
        title={mode === 'create' ? '新建委托' : '编辑委托'}
        description={mode === 'edit' ? commission?.title : '客户与报价可以稍后再改'}
        onRequestClose={requestClose}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={requestClose} disabled={saving}>
              取消
            </Button>
            <Button type="button" size="sm" onClick={() => void submit()} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          noValidate
        >
          {mode === 'create' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="commission-client">客户 *</Label>
              <select
                id="commission-client"
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <option value="">选择客户</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              {clients.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  还没有可用客户，请先在「客户」页签创建。
                </p>
              ) : null}
              {errors.client ? <p className="text-xs text-destructive">{errors.client}</p> : null}
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label>客户</Label>
              <p className="text-sm text-foreground">
                {clients.find((client) => client.id === commission?.clientId)?.name ?? '未知客户'}
              </p>
              <p className="text-[11px] text-muted-foreground">委托归属的客户不可更改</p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="commission-title">委托名称 *</Label>
            <Input
              id="commission-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="例如：半身立绘"
              maxLength={200}
              autoFocus={mode === 'create'}
            />
            {errors.title ? <p className="text-xs text-destructive">{errors.title}</p> : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="commission-type">委托类型 *</Label>
            <Input
              id="commission-type"
              value={type}
              onChange={(event) => setType(event.target.value)}
              placeholder="例如：插画"
              maxLength={100}
              list="commission-type-options"
            />
            <datalist id="commission-type-options">
              {COMMON_TYPES.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
            {errors.type ? <p className="text-xs text-destructive">{errors.type}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label>截止时间</Label>
            <Segmented
              ariaLabel="截止时间类型"
              value={deadlineMode}
              options={DEADLINE_OPTIONS}
              onChange={setDeadlineMode}
            />

            {deadlineMode !== 'none' ? (
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  aria-label="截止日期"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="w-[150px]"
                />
                {deadlineMode === 'datetime' ? (
                  <Input
                    type="time"
                    aria-label="截止时间"
                    value={time}
                    onChange={(event) => setTime(event.target.value)}
                    className="w-[110px]"
                  />
                ) : null}
              </div>
            ) : null}

            {deadlineMode === 'datetime' ? (
              <p className="text-[11px] text-muted-foreground">
                按 {deadlineTimeZone} 记录，保存为 UTC 时间
              </p>
            ) : null}
            {deadlineMode === 'date' ? (
              <p className="text-[11px] text-muted-foreground">
                只保存日期，不随时区变化
              </p>
            ) : null}
            {errors.deadline ? <p className="text-xs text-destructive">{errors.deadline}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label>报价</Label>
            <Segmented
              ariaLabel="报价方式"
              value={quoteMode}
              options={QUOTE_OPTIONS}
              onChange={setQuoteMode}
            />

            {quoteMode === 'amount' ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">¥</span>
                <Input
                  aria-label="报价金额（元）"
                  value={amountText}
                  onChange={(event) => setAmountText(event.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                />
              </div>
            ) : null}

            {quoteMode === 'unquoted' ? (
              <p className="text-[11px] text-muted-foreground">价格还没谈定，暂不填写金额。</p>
            ) : null}
            {quoteMode === 'free' ? (
              <p className="text-[11px] text-muted-foreground">明确免费，不需要收款。</p>
            ) : null}
            {errors.quote ? <p className="text-xs text-destructive">{errors.quote}</p> : null}
          </div>

          {errors.form ? (
            <p role="alert" className="text-xs text-destructive">
              {errors.form}
            </p>
          ) : null}
        </form>
      </Sheet>

      <ConfirmDialog
        open={closeConfirmOpen}
        title="放弃未保存的修改？"
        description="这份委托的修改还没有保存，关闭后将会丢失。"
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        destructive
        onConfirm={() => {
          setCloseConfirmOpen(false)
          onClose()
        }}
        onCancel={() => setCloseConfirmOpen(false)}
      />
    </>
  )
}
