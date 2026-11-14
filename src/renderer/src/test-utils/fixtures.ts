import type { Client, Commission } from '@shared/domain'

export function makeClient(overrides: Partial<Client> = {}): Client {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: '客户甲',
    contact: null,
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides
  }
}

export function makeCommission(overrides: Partial<Commission> = {}): Commission {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    clientId: '11111111-1111-4111-8111-111111111111',
    title: '委托',
    description: null,
    type: '插画',
    status: 'active',
    priority: 3,
    deadline: { kind: 'none' },
    quoteAmountCents: 120000,
    paidAmountCents: 0,
    paymentStatus: 'unpaid',
    outstandingCents: 120000,
    isSettled: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides
  }
}
