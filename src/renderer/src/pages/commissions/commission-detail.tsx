import { useMemo, useState } from 'react'
import type { Commission, CommissionStatus } from '@shared/domain'
import { allowedNextStatuses, COMMISSION_STATUS_LABELS } from '@shared/status'
import { formatDateTimeInZone, resolveSystemTimeZone } from '@shared/time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet } from '@/components/ui/sheet'
import {
  archiveCommission,
  unarchiveCommission,
  updateCommission
} from '@/data/commission-actions'
import {
  formatDeadlineDate,
  formatDeadlineDateTime,
  paymentPresentation,
  statusLabel,
  type PaymentTone
} from '@/lib/format'
import { formatIpcError } from '@/lib/ipc-error'
import { PARSE_YUAN_ERROR_MESSAGES, centsToYuanInput, parseYuanToCents } from '@/lib/money'
import { formatYuanFromCents } from '@/lib/format'
import { CommissionTasks } from './commission-tasks'

const STATUS_BADGE: Record<CommissionStatus, 'muted' | 'default' | 'success' | 'outline'> = {
  draft: 'muted',
  active: 'default',
  completed: 'success',
  cancelled: 'outline'
}

/** 付款颜色语义 → 徽标样式（付款的 primary 对应徽标的 default 主色）。 */
const PAYMENT_BADGE: Record<PaymentTone, 'muted' | 'default' | 'success' | 'warning'> = {
  muted: 'muted',
  warning: 'warning',
  primary: 'default',
  success: 'success'
}

const TRANSITION_LABELS: Partial<Record<`${CommissionStatus}->${CommissionStatus}`, string>> = {
  'draft->active': '开始进行',
  'draft->cancelled': '取消委托',
  'active->completed': '标记完成',
  'active->cancelled': '取消委托',
  'completed->active': '重新打开',
  'cancelled->draft': '恢复为草稿'
}

interface CommissionDetailProps {
  commission: Commission
  clientName: string
  onClose: () => void
  onEdit: () => void
  /** 数据变化后刷新列表（详情内容会随列表刷新自动更新） */
  onChanged: () => void
  /** 归档或取消归档成功后关闭详情 */
  onArchived: () => void
}

/**
 * 委托详情面板（420px 右侧停靠）。
 *
 * - 付款状态由主进程根据金额推导，前端只提交已收金额；
 * - 状态流转按 shared/status.ts 的约定展示，后端同样会校验；
 * - 归档 / 取消归档都不删除历史数据。
 */
export function CommissionDetail({
  commission,
  clientName,
  onClose,
  onEdit,
  onChanged,
  onArchived
}: CommissionDetailProps) {
  const systemTimeZone = useMemo(() => resolveSystemTimeZone(), [])
  const archived = commission.archivedAt !== null
  const payment = paymentPresentation(commission)
  const canRecordPayment = commission.quoteAmountCents !== null && commission.quoteAmountCents > 0
  const currentPaidText = centsToYuanInput(commission.paidAmountCents)

  const [paidDraft, setPaidDraft] = useState<string | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [savingPayment, setSavingPayment] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)

  const paidText = paidDraft ?? currentPaidText
  const paymentDirty = paidDraft !== null && paidDraft !== currentPaidText

  function requestClose() {
    if (paymentDirty) {
      setConfirmDiscard(true)
      return
    }
    onClose()
  }

  async function savePayment() {
    const parsed = parseYuanToCents(paidText)
    if (!parsed.ok) {
      setPaymentError(PARSE_YUAN_ERROR_MESSAGES[parsed.reason])
      return
    }
    if (commission.quoteAmountCents !== null && parsed.cents > commission.quoteAmountCents) {
      setPaymentError('已收金额不能超过报价金额')
      return
    }

    setSavingPayment(true)
    setPaymentError(null)
    try {
      await updateCommission({ id: commission.id, paidAmountCents: parsed.cents })
      setPaidDraft(null)
      onChanged()
    } catch (error) {
      setPaymentError(formatIpcError(error))
    } finally {
      setSavingPayment(false)
    }
  }

  async function changeStatus(next: CommissionStatus) {
    setBusy(true)
    setActionError(null)
    try {
      await updateCommission({ id: commission.id, status: next })
      onChanged()
    } catch (error) {
      setActionError(formatIpcError(error))
    } finally {
      setBusy(false)
    }
  }

  async function toggleArchive() {
    setConfirmArchive(false)
    setBusy(true)
    setActionError(null)
    try {
      if (archived) {
        await unarchiveCommission(commission.id)
      } else {
        await archiveCommission(commission.id)
      }
      onChanged()
      onArchived()
    } catch (error) {
      setActionError(formatIpcError(error))
    } finally {
      setBusy(false)
    }
  }

  const deadlineText =
    commission.deadline.kind === 'none'
      ? '未设置'
      : commission.deadline.kind === 'date'
        ? formatDeadlineDate(commission.deadline.date)
        : formatDeadlineDateTime(commission.deadline.at, commission.deadline.timeZone)

  const deadlineHint =
    commission.deadline.kind === 'date'
      ? '仅日期，不做时区换算'
      : commission.deadline.kind === 'datetime'
        ? `创建时区 ${commission.deadline.timeZone}`
        : ''

  return (
    <>
      <Sheet
        title={commission.title}
        description={clientName}
        onRequestClose={requestClose}
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmArchive(true)}
              disabled={busy}
            >
              {archived ? '取消归档' : '归档委托'}
            </Button>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={requestClose} disabled={busy}>
                关闭
              </Button>
              <Button type="button" size="sm" onClick={onEdit} disabled={busy}>
                编辑
              </Button>
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_BADGE[commission.status]}>{statusLabel(commission.status)}</Badge>
            <Badge variant={PAYMENT_BADGE[payment.tone]}>{payment.label}</Badge>
            {archived ? <Badge variant="outline">已归档</Badge> : null}
          </div>

          <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-2 text-xs">
            <dt className="text-muted-foreground">客户</dt>
            <dd className="text-foreground">{clientName}</dd>

            <dt className="text-muted-foreground">类型</dt>
            <dd className="text-foreground">{commission.type}</dd>

            <dt className="text-muted-foreground">优先级</dt>
            <dd className="text-foreground">P{commission.priority}</dd>

            <dt className="text-muted-foreground">截止</dt>
            <dd className="text-foreground">
              {deadlineText}
              {deadlineHint ? (
                <span className="ml-1 text-[11px] text-muted-foreground">（{deadlineHint}）</span>
              ) : null}
            </dd>

            <dt className="text-muted-foreground">创建</dt>
            <dd className="text-foreground">{formatDateTimeInZone(commission.createdAt, systemTimeZone)}</dd>

            <dt className="text-muted-foreground">更新</dt>
            <dd className="text-foreground">{formatDateTimeInZone(commission.updatedAt, systemTimeZone)}</dd>
          </dl>

          <section className="flex flex-col gap-1.5">
            <h3 className="text-xs font-medium text-muted-foreground">需求说明</h3>
            <p className="text-xs leading-relaxed whitespace-pre-wrap text-foreground">
              {commission.description && commission.description.length > 0 ? commission.description : '未填写'}
            </p>
          </section>

          <CommissionTasks commissionId={commission.id} onChanged={onChanged} />

          <section className="flex flex-col gap-2 border-t border-border/60 pt-4">
            <h3 className="text-xs font-medium text-muted-foreground">付款</h3>

            <dl className="grid grid-cols-[4.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">报价</dt>
              <dd className="text-foreground">
                {commission.quoteAmountCents === null
                  ? '未报价'
                  : commission.quoteAmountCents === 0
                    ? '免费'
                    : formatYuanFromCents(commission.quoteAmountCents)}
              </dd>

              <dt className="text-muted-foreground">已收</dt>
              <dd className="text-foreground">{formatYuanFromCents(commission.paidAmountCents)}</dd>

              <dt className="text-muted-foreground">未收</dt>
              <dd className="text-foreground">
                {commission.outstandingCents === null
                  ? '—'
                  : formatYuanFromCents(commission.outstandingCents)}
              </dd>

              <dt className="text-muted-foreground">结清</dt>
              <dd className="text-foreground">{commission.isSettled ? '已结清' : '未结清'}</dd>
            </dl>

            {canRecordPayment ? (
              <div className="flex flex-col gap-1.5 pt-1">
                <Label htmlFor="commission-paid">登记已收金额（元）</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">¥</span>
                  <Input
                    id="commission-paid"
                    value={paidText}
                    onChange={(event) => setPaidDraft(event.target.value)}
                    inputMode="decimal"
                    aria-label="已收金额（元）"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void savePayment()}
                    disabled={savingPayment || !paymentDirty}
                  >
                    {savingPayment ? '保存中…' : '保存'}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  付款状态由报价与已收金额自动推导，不能手动指定。
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {commission.quoteAmountCents === null
                  ? '未报价的委托不能登记收款，请先填写报价。'
                  : '免费委托不需要收款。'}
              </p>
            )}

            {paymentError ? (
              <p role="alert" className="text-xs text-destructive">
                {paymentError}
              </p>
            ) : null}
          </section>

          <section className="flex flex-col gap-2 border-t border-border/60 pt-4">
            <h3 className="text-xs font-medium text-muted-foreground">状态</h3>
            <div className="flex flex-wrap gap-2">
              {allowedNextStatuses(commission.status).map((next) => (
                <Button
                  key={next}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void changeStatus(next)}
                >
                  {TRANSITION_LABELS[`${commission.status}->${next}`] ?? '更改状态'}
                </Button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              当前：{COMMISSION_STATUS_LABELS[commission.status]}
            </p>
            {actionError ? (
              <p role="alert" className="text-xs text-destructive">
                {actionError}
              </p>
            ) : null}
          </section>
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmArchive}
        title={archived ? '取消归档这个委托？' : '归档这个委托？'}
        description={
          archived
            ? '取消归档后，这个委托会重新出现在默认列表中。'
            : '归档不会删除任何记录，只是从默认列表中隐藏，之后可以随时取消归档。'
        }
        confirmLabel={archived ? '取消归档' : '归档'}
        busy={busy}
        onConfirm={() => {
          void toggleArchive()
        }}
        onCancel={() => setConfirmArchive(false)}
      />

      <ConfirmDialog
        open={confirmDiscard}
        title="放弃未保存的收款修改？"
        description="已收金额还没有保存，关闭详情后这次修改会丢失。"
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        destructive
        onConfirm={() => {
          setConfirmDiscard(false)
          onClose()
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  )
}
