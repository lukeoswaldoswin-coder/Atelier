import { describe, expect, it } from 'vitest'
import { computeWindowSize } from './window-size'

describe('computeWindowSize', () => {
  it('大屏幕使用首选尺寸 1280×840', () => {
    expect(computeWindowSize(2048, 1232)).toEqual({
      width: 1280,
      height: 840,
      minWidth: 1024,
      minHeight: 680
    })
  })

  it('小屏幕收缩到可用区域内，不会超出屏幕', () => {
    const size = computeWindowSize(1366, 728)
    expect(size.width).toBe(1280)
    expect(size.height).toBe(656)
    expect(size.width).toBeLessThanOrEqual(1366)
    expect(size.height).toBeLessThanOrEqual(728)
    expect(size.minHeight).toBeLessThanOrEqual(size.height)
  })

  it('极小分辨率下不会产生过小的窗口', () => {
    const size = computeWindowSize(1024, 600)
    expect(size.width).toBeGreaterThanOrEqual(800)
    expect(size.height).toBeGreaterThanOrEqual(528)
    expect(size.minWidth).toBeLessThanOrEqual(size.width)
    expect(size.minHeight).toBeLessThanOrEqual(size.height)
  })
})
