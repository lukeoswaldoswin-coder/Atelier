import type { AppInfo } from './contracts'

/**
 * 渲染进程可见的全部原生能力。
 * 这是 preload 通过 contextBridge 暴露、渲染进程通过 window.atelier 访问的唯一入口，
 * 新增能力必须先在这里声明，再到主进程注册同名通道。
 */
export interface AtelierApi {
  /** 读取应用与运行时版本信息（主进程提供，渲染进程无法伪造）。 */
  getAppInfo(): Promise<AppInfo>
}
