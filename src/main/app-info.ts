import { appInfoSchema, type AppInfo } from '@shared/contracts'

/** 主进程可获得的运行时信息原始来源。 */
export interface AppInfoSource {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  isDev: boolean
}

/**
 * 把运行时信息整理成对外契约的形状，并在跨进程边界前用 Zod 校验一次，
 * 避免主进程悄悄返回不符合契约的对象让渲染进程拿到 undefined。
 */
export function buildAppInfo(source: AppInfoSource): AppInfo {
  return appInfoSchema.parse(source)
}
