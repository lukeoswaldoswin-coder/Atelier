import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSenderGuard, getRendererAllowedEntries } from './security'

describe('createSenderGuard', () => {
  it('接受同一 origin 下的页面', () => {
    const guard = createSenderGuard(['http://localhost:5173'])
    expect(guard('http://localhost:5173/')).toBe(true)
    expect(guard('http://localhost:5173/index.html?x=1')).toBe(true)
    expect(guard('HTTP://LOCALHOST:5173/')).toBe(true)
  })

  it('拒绝前缀相似但 origin 不同的地址', () => {
    const guard = createSenderGuard(['http://localhost:5173'])
    expect(guard('http://localhost:5173.evil.com/')).toBe(false)
    expect(guard('http://localhost:5174/')).toBe(false)
    expect(guard('https://localhost:5173/')).toBe(false)
  })

  it('接受本地打包页面，拒绝远程地址', () => {
    const guard = createSenderGuard(['file://'])
    expect(guard('file:///D:/Atelier/project/out/renderer/index.html')).toBe(true)
    expect(guard('https://evil.example.com/')).toBe(false)
    expect(guard('about:blank')).toBe(false)
  })

  it('异常输入一律拒绝', () => {
    const guard = createSenderGuard(['file://', 'http://localhost:5173'])
    expect(guard(null)).toBe(false)
    expect(guard(undefined)).toBe(false)
    expect(guard('')).toBe(false)
    expect(guard('not a url')).toBe(false)
  })
})

describe('getRendererAllowedEntries', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('开发模式放行 Vite 开发服务器地址', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    expect(getRendererAllowedEntries()).toEqual(['http://localhost:5173'])
  })

  it('打包模式只放行本地文件', () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '')
    expect(getRendererAllowedEntries()).toEqual(['file://'])
  })
})
