/**
 * 把 Electron IPC 包装后的错误还原成可读文本。
 *
 * 渲染进程收到的 rejection 形如：
 *   Error invoking remote method 'clients:create': Error: 客户名称不能为空
 * 界面上只应该显示最后那段业务信息。
 */
export function formatIpcError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const marker = 'Error: '
  const index = raw.lastIndexOf(marker)
  return index >= 0 ? raw.slice(index + marker.length) : raw
}
