import { describe, expect, it } from 'vitest'
import { IpcChannel, ipcChannelNames } from '@shared/channels'
import type { AppInfo } from '@shared/contracts'
import type { Client, Commission } from '@shared/domain'
import { applyMigrations } from '../db/migrator'
import { openDatabase, type AppDatabase } from '../db/database'
import { createClientsRepository, type ClientsRepository } from '../db/repositories/clients'
import { createCommissionsRepository, type CommissionsRepository } from '../db/repositories/commissions'
import { createIpcHandlers, type IpcHandlers } from './handlers'

const info: AppInfo = {
  name: 'atelier',
  version: '0.1.0',
  electron: '44.7.0',
  chrome: '152.0.0.0',
  node: '24.0.0',
  platform: 'win32',
  arch: 'x64',
  isDev: true
}

const newClientId = '3f2b8c4e-1a2b-4c5d-8e9f-0a1b2c3d4e5f'

interface HandlersFixture {
  db: AppDatabase
  handlers: IpcHandlers
  clients: ClientsRepository
  commissions: CommissionsRepository
}

function setup(): HandlersFixture {
  const db = openDatabase(':memory:')
  applyMigrations(db)
  const clients = createClientsRepository(db)
  const commissions = createCommissionsRepository(db)
  const handlers = createIpcHandlers({ getAppInfo: () => info, clients, commissions })
  return { db, handlers, clients, commissions }
}

describe('createIpcHandlers', () => {
  it('覆盖全部已声明通道', () => {
    const { handlers, db } = setup()
    expect(Object.keys(handlers).sort()).toEqual([...ipcChannelNames].sort())
    db.close()
  })

  it('app:get-info 返回主进程提供的运行时信息，入参不符合契约时拒绝', async () => {
    const { handlers, db } = setup()

    await expect(handlers[IpcChannel.appGetInfo](undefined)).resolves.toEqual(info)
    await expect(handlers[IpcChannel.appGetInfo]({ injected: true })).rejects.toThrow()
    db.close()
  })

  it('clients:create 写入数据库并返回通过输出契约校验的对象', async () => {
    const { handlers, clients, db } = setup()

    const created = (await handlers[IpcChannel.clientsCreate]({ name: '小夏' })) as Client

    expect(created.name).toBe('小夏')
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(clients.get({ id: created.id })?.name).toBe('小夏')
    db.close()
  })

  it('clients:create 拒绝空白名称，不写库', async () => {
    const { handlers, clients, db } = setup()

    await expect(handlers[IpcChannel.clientsCreate]({ name: '   ' })).rejects.toThrow()
    expect(clients.list({ includeArchived: true })).toHaveLength(0)
    db.close()
  })

  it('clients:list 不传参数也能工作，clients:get 不存在时返回 null', async () => {
    const { handlers, db } = setup()
    await handlers[IpcChannel.clientsCreate]({ name: 'A' })

    const list = (await handlers[IpcChannel.clientsList](undefined)) as Client[]
    expect(list).toHaveLength(1)

    const missing = await handlers[IpcChannel.clientsGet]({ id: newClientId })
    expect(missing).toBeNull()
    db.close()
  })

  it('commissions:create 默认按“未报价”处理', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client

    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: '半身立绘',
      type: '插画'
    })) as Commission

    expect(commission.quoteAmountCents).toBeNull()
    expect(commission.paymentStatus).toBe('unquoted')
    expect(commission.outstandingCents).toBeNull()
    expect(commission.deadline).toEqual({ kind: 'none' })
    db.close()
  })

  it('commissions:create 带报价时为未付款', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client

    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: '半身立绘',
      type: '插画',
      quoteAmountCents: 12800
    })) as Commission

    expect(commission.paymentStatus).toBe('unpaid')
    expect(commission.outstandingCents).toBe(12800)
    db.close()
  })

  it('渲染进程提交 paymentStatus 会被拒绝', async () => {
    const { handlers, commissions, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client

    await expect(
      handlers[IpcChannel.commissionsCreate]({
        clientId: client.id,
        title: 'x',
        type: 'y',
        paymentStatus: 'paid'
      })
    ).rejects.toThrow()

    expect(commissions.list({ includeArchived: true })).toHaveLength(0)
    db.close()
  })

  it('付款更新：部分付款后状态与未收金额正确，超额被拒绝', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client
    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: 'x',
      type: 'y',
      quoteAmountCents: 10000
    })) as Commission

    const partial = (await handlers[IpcChannel.commissionsUpdate]({
      id: commission.id,
      paidAmountCents: 4000
    })) as Commission
    expect(partial.paymentStatus).toBe('partial')
    expect(partial.outstandingCents).toBe(6000)

    await expect(
      handlers[IpcChannel.commissionsUpdate]({ id: commission.id, paidAmountCents: 20000 })
    ).rejects.toThrow(/不能超过报价/)
    db.close()
  })

  it('commissions:create 在客户不存在时给出可读错误', async () => {
    const { handlers, db } = setup()

    await expect(
      handlers[IpcChannel.commissionsCreate]({ clientId: newClientId, title: '委托', type: '插画' })
    ).rejects.toThrow(/客户不存在/)
    db.close()
  })

  it('commissions 全流程：创建、列表、更新、归档', async () => {
    const { handlers, db } = setup()
    const client = (await handlers[IpcChannel.clientsCreate]({ name: '客户' })) as Client

    const commission = (await handlers[IpcChannel.commissionsCreate]({
      clientId: client.id,
      title: '半身立绘',
      type: '插画',
      quoteAmountCents: 12800,
      deadline: { kind: 'date', date: '2026-12-31' }
    })) as Commission
    expect(commission.deadline).toEqual({ kind: 'date', date: '2026-12-31' })

    const updated = (await handlers[IpcChannel.commissionsUpdate]({
      id: commission.id,
      status: 'active'
    })) as Commission
    expect(updated.status).toBe('active')

    const archived = (await handlers[IpcChannel.commissionsArchive]({ id: commission.id })) as Commission
    expect(archived.archivedAt).not.toBeNull()

    const visible = (await handlers[IpcChannel.commissionsList]({})) as Commission[]
    expect(visible).toHaveLength(0)

    const all = (await handlers[IpcChannel.commissionsList]({ includeArchived: true })) as Commission[]
    expect(all).toHaveLength(1)
    db.close()
  })

  it('输出不符合契约时不会把脏数据交给渲染进程', async () => {
    const dirtyClients = {
      create: () => ({ id: 'not-a-uuid' }),
      list: () => [],
      get: () => null,
      update: () => null,
      archive: () => null
    } as unknown as ClientsRepository

    const handlers = createIpcHandlers({
      getAppInfo: () => info,
      clients: dirtyClients,
      commissions: {} as CommissionsRepository
    })

    await expect(handlers[IpcChannel.clientsCreate]({ name: 'x' })).rejects.toThrow()
  })
})
