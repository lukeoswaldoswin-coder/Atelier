import type { Commission, CreateCommissionInput, UpdateCommissionInput } from '@shared/domain'
import { getAtelierApi } from '@/lib/ipc'

/** 委托写操作。错误由调用方捕获并用 formatIpcError 展示。 */
export function createCommission(input: CreateCommissionInput): Promise<Commission> {
  return getAtelierApi().commissions.create(input)
}

export function updateCommission(input: UpdateCommissionInput): Promise<Commission | null> {
  return getAtelierApi().commissions.update(input)
}
