import { describe, expect, it } from 'vitest'
import { computeIdleMs, createWin32Probe } from './win32-probe'

const isWindows = process.platform === 'win32'
const TICK32_MOD = 0x1_0000_0000

describe('系统空闲时间换算', () => {
  it('同一 32 位周期内是普通差值', () => {
    expect(computeIdleMs(5_000, 2_000)).toBe(3_000)
    expect(computeIdleMs(2_000, 2_000)).toBe(0)
  })

  it('开机超过 49.7 天、dwTime 回绕后仍然正确', () => {
    // 当前时间已进入第 2 个 32 位周期，最后输入时间还在上一周期末尾
    expect(computeIdleMs(TICK32_MOD + 6_000, TICK32_MOD - 4_000)).toBe(10_000)
    // 多个周期之后（例如开机 200 天）依然正确
    expect(computeIdleMs(5 * TICK32_MOD + 1_000, 4 * TICK32_MOD + 500)).toBe(500)
  })

  it('异常的探测值返回 0，避免把用户误判为长时间空闲', () => {
    expect(computeIdleMs(Number.NaN, 0)).toBe(0)
    expect(computeIdleMs(1_000, Number.NaN)).toBe(0)
  })
})

describe.skipIf(!isWindows)('Win32 活动探测', () => {
  it('能读取前台进程名与系统空闲毫秒', () => {
    const probe = createWin32Probe()
    try {
      const sample = probe.sample()
      expect(sample.idleMs).toBeGreaterThanOrEqual(0)
      // 空闲值必须远小于 2^31，否则说明 tick 回绕换算有问题
      expect(sample.idleMs).toBeLessThan(2 ** 31)
      if (sample.processName) {
        expect(sample.processName.toLowerCase()).toMatch(/\.exe$/)
      }
    } finally {
      probe.dispose()
    }
  })
})
