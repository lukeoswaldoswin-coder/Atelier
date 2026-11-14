import { describe, expect, it } from 'vitest'
import { IpcChannel, ipcChannelNames, isIpcChannelName } from '@shared/channels'
import { appInfoSchema, ipcContracts } from '@shared/contracts'

const validAppInfo = {
  name: 'atelier',
  version: '0.1.0',
  electron: '40.0.0',
  chrome: '140.0.0.0',
  node: '24.0.0',
  platform: 'win32',
  arch: 'x64',
  isDev: true
}

describe('IPC 通道定义', () => {
  it('通道名唯一，且都带命名空间前缀', () => {
    expect(new Set(ipcChannelNames).size).toBe(ipcChannelNames.length)
    for (const name of ipcChannelNames) {
      expect(name).toMatch(/^[a-z-]+:[a-z-]+$/)
    }
  })

  it('isIpcChannelName 只接受已登记的通道', () => {
    expect(isIpcChannelName(IpcChannel.appGetInfo)).toBe(true)
    expect(isIpcChannelName('app:unknown')).toBe(false)
  })

  it('契约表覆盖全部通道，没有漏登记的通道', () => {
    expect(Object.keys(ipcContracts).sort()).toEqual([...ipcChannelNames].sort())
  })
})

describe('AppInfo 契约', () => {
  it('接受完整合法的运行时信息', () => {
    expect(appInfoSchema.parse(validAppInfo)).toEqual(validAppInfo)
  })

  it('拒绝缺字段的运行时信息', () => {
    const { chrome: _chrome, ...missing } = validAppInfo
    expect(() => appInfoSchema.parse(missing)).toThrow()
  })

  it('拒绝类型错误的字段', () => {
    expect(() => appInfoSchema.parse({ ...validAppInfo, isDev: 'yes' })).toThrow()
    expect(() => appInfoSchema.parse({ ...validAppInfo, version: '' })).toThrow()
  })

  it('无参数通道拒绝多余入参', () => {
    const noInput = ipcContracts[IpcChannel.appGetInfo].input
    expect(() => noInput.parse(undefined)).not.toThrow()
    expect(() => noInput.parse({ unexpected: true })).toThrow()
  })
})
