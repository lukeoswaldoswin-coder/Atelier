import type { Client, Commission, Task } from '@shared/domain'

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
    completedAt: null,
    taskCount: 0,
    doneTaskCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides
  }
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    commissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: '任务',
    description: null,
    stage: 'draft',
    status: 'todo',
    estimatedMinutes: null,
    plannedDate: null,
    sortOrder: 0,
    completedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    ...overrides
  }
}
