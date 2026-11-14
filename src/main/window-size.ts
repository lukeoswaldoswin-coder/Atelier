const PREFERRED_WIDTH = 1280
const PREFERRED_HEIGHT = 840
const MIN_WIDTH = 1024
const MIN_HEIGHT = 680
/** 窗口四周留出的桌面空间，避免窗口贴边或被任务栏遮挡。 */
const SCREEN_MARGIN = 72

export interface WindowSize {
  width: number
  height: number
  minWidth: number
  minHeight: number
}

/**
 * 按显示器可用区域计算窗口尺寸。
 * 大屏幕上使用 1280×840，小屏幕（如 1366×768 笔记本）自动缩小到可用区域内，
 * 避免窗口超出屏幕导致内容显示不全。
 */
export function computeWindowSize(areaWidth: number, areaHeight: number): WindowSize {
  const width = Math.max(800, Math.min(PREFERRED_WIDTH, areaWidth - SCREEN_MARGIN))
  const height = Math.max(600, Math.min(PREFERRED_HEIGHT, areaHeight - SCREEN_MARGIN))
  return {
    width,
    height,
    minWidth: Math.min(MIN_WIDTH, width),
    minHeight: Math.min(MIN_HEIGHT, height)
  }
}
