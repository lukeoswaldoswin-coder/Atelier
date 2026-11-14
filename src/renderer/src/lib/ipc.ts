import type { AtelierApi } from '@shared/api'
import type { AppInfo } from '@shared/contracts'

/**
 * 渲染进程访问原生能力的唯一入口。
 * 组件不直接读 window，方便测试时注入替代实现。
 */
export function getAtelierApi(): AtelierApi {
  const api = window.atelier
  if (!api) {
    throw new Error('preload 桥接未加载，无法访问原生能力')
  }
  return api
}

export function getAppInfo(): Promise<AppInfo> {
  return getAtelierApi().getAppInfo()
}
