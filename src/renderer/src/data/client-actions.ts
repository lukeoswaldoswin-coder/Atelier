import type { Client, CreateClientInput, UpdateClientInput } from '@shared/domain'
import { getAtelierApi } from '@/lib/ipc'

/** 客户写操作。错误由调用方捕获并用 formatIpcError 展示。 */
export function createClient(input: CreateClientInput): Promise<Client> {
  return getAtelierApi().clients.create(input)
}

export function updateClient(input: UpdateClientInput): Promise<Client | null> {
  return getAtelierApi().clients.update(input)
}

/** 归档（软删除）。 */
export function archiveClient(id: string): Promise<Client | null> {
  return getAtelierApi().clients.archive({ id })
}

/** 取消归档。 */
export function unarchiveClient(id: string): Promise<Client | null> {
  return getAtelierApi().clients.unarchive({ id })
}
