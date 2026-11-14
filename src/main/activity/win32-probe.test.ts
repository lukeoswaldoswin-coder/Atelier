import { describe, expect, it } from 'vitest'
import { createWin32Probe } from './win32-probe'

const isWindows = process.platform === 'win32'

describe.skipIf(!isWindows)('Win32 活动探测', () => {
  it('能读取前台进程名与系统空闲毫秒', () => {
    const probe = createWin32Probe()
    try {
      const sample = probe.sample()
      expect(sample.idleMs).toBeGreaterThanOrEqual(0)
      if (sample.processName) {
        expect(sample.processName.toLowerCase()).toMatch(/\.exe$/)
      }
    } finally {
      probe.dispose()
    }
  })
})
