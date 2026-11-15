import { describe, expect, it } from 'vitest'
import { resolveAppKey, SUPPORTED_APPS } from './activity-apps'

describe('绘画软件进程名识别', () => {
  it('识别 Clip Studio Paint 的真实进程名 ClipStudioPaint.exe', () => {
    // CSP 安装目录里的可执行文件是 CLIPStudioPaint.exe，
    // 早期版本只有 clipstudio.exe（管理程序），导致自动监测对 CSP 完全无效。
    expect(resolveAppKey('ClipStudioPaint.exe')).toBe('clipstudio')
    expect(resolveAppKey('CLIPSTUDIOPAINT.EXE')).toBe('clipstudio')
    expect(resolveAppKey('clipstudiopaint.exe')).toBe('clipstudio')
  })

  it('保留原有的受支持应用识别', () => {
    expect(resolveAppKey('Photoshop.exe')).toBe('photoshop')
    expect(resolveAppKey('clipstudio.exe')).toBe('clipstudio')
    expect(resolveAppKey('sai.exe')).toBe('sai')
    expect(resolveAppKey('sai2.exe')).toBe('sai')
    expect(resolveAppKey('krita.exe')).toBe('krita')
    expect(resolveAppKey('blender.exe')).toBe('blender')
  })

  it('忽略首尾空白', () => {
    expect(resolveAppKey('  ClipStudioPaint.exe  ')).toBe('clipstudio')
  })

  it('未支持的进程与空值返回 null', () => {
    expect(resolveAppKey('chrome.exe')).toBeNull()
    expect(resolveAppKey('clipstudiopaint')).toBeNull()
    expect(resolveAppKey('')).toBeNull()
    expect(resolveAppKey(null)).toBeNull()
    expect(resolveAppKey(undefined)).toBeNull()
  })

  it('每个应用的可执行名都指向唯一应用', () => {
    const seen = new Map<string, string>()
    for (const app of SUPPORTED_APPS) {
      for (const exe of app.executables) {
        expect(exe).toBe(exe.toLowerCase())
        expect(seen.has(exe)).toBe(false)
        seen.set(exe, app.key)
      }
    }
  })
})
