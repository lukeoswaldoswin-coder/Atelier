import { describe, expect, it } from 'vitest'
import type { Client } from '@shared/domain'
import { buildClientFilterOptions } from './commission-filter-options'
import { makeClient, makeCommission } from '@/test-utils/fixtures'

const active = makeClient({ id: '11111111-1111-4111-8111-111111111111', name: '小夏' })
const archived = makeClient({
  id: '22222222-2222-4222-8222-222222222222',
  name: '余温',
  archivedAt: '2026-06-01T00:00:00.000Z'
})
const clientsById = new Map<string, Client>([
  [active.id, active],
  [archived.id, archived]
])

describe('客户筛选选项', () => {
  it('只包含被委托引用到的客户，已归档客户带标注', () => {
    const options = buildClientFilterOptions(
      [
        makeCommission({ clientId: active.id }),
        makeCommission({ clientId: archived.id, archivedAt: '2026-06-02T00:00:00.000Z' })
      ],
      clientsById
    )

    expect(options).toEqual([
      { id: active.id, label: '小夏', archived: false },
      { id: archived.id, label: '余温（已归档）', archived: true }
    ])
  })

  it('同一客户的多条委托只产生一个选项，并按名称排序', () => {
    const options = buildClientFilterOptions(
      [
        makeCommission({ clientId: active.id }),
        makeCommission({ clientId: active.id }),
        makeCommission({ clientId: archived.id })
      ],
      clientsById
    )

    expect(options.map((option) => option.label)).toEqual(['小夏', '余温（已归档）'])
  })

  it('没有委托时没有选项', () => {
    expect(buildClientFilterOptions([], clientsById)).toEqual([])
  })

  it('客户数据缺失时给出可读占位，而不是空白', () => {
    const options = buildClientFilterOptions(
      [makeCommission({ clientId: '33333333-3333-4333-8333-333333333333' })],
      new Map()
    )
    expect(options[0]?.label).toBe('未知客户')
  })
})
