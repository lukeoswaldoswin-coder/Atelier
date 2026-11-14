import type { Client, Commission } from '@shared/domain'

export interface ClientFilterOption {
  id: string
  /** 展示文案；已归档客户带「（已归档）」后缀 */
  label: string
  archived: boolean
}

/**
 * 客户筛选选项。
 *
 * 与「新建委托的客户下拉」是两套独立规则：
 * - 这里包含当前归档范围内**被委托引用到**的所有客户，已归档也保留（带标注）；
 * - 新建下拉只列未归档客户（在表单侧过滤）。
 *
 * 基准集合应在应用搜索/状态/付款/逾期筛选**之前**，避免选项随筛选抖动。
 */
export function buildClientFilterOptions(
  commissions: readonly Commission[],
  clientsById: ReadonlyMap<string, Client>
): ClientFilterOption[] {
  const ids = new Set(commissions.map((commission) => commission.clientId))

  const entries = [...ids].map((id) => {
    const client = clientsById.get(id)
    const archived = client ? client.archivedAt !== null : false
    return { id, name: client?.name ?? '未知客户', archived }
  })

  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))

  return entries.map((entry) => ({
    id: entry.id,
    label: entry.archived ? `${entry.name}（已归档）` : entry.name,
    archived: entry.archived
  }))
}
