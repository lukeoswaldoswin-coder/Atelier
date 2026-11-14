/// <reference types="vite/client" />

import type { AtelierApi } from '@shared/api'

declare global {
  interface Window {
    /** 由 preload 通过 contextBridge 注入；渲染进程只能看到这些方法。 */
    readonly atelier: AtelierApi
  }
}

export {}
