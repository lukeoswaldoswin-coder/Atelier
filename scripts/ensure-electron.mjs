/**
 * 确保 Electron 二进制已下载。
 *
 * 背景：pnpm / npm 的安装脚本在某些环境下会被跳过或受限，
 * 这时 node_modules/electron/dist 不存在，应用启动时会直接报错。
 * 这个脚本在 postinstall 阶段检查并补下载，使用国内镜像保证可访问。
 *
 * 可手动执行：node scripts/ensure-electron.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const electronDir = join(projectRoot, 'node_modules', 'electron')
const electronExe = join(electronDir, 'dist', 'electron.exe')

if (!existsSync(electronDir)) {
  console.log('[ensure-electron] 尚未安装 electron 依赖，跳过。')
  process.exit(0)
}

if (existsSync(electronExe)) {
  console.log('[ensure-electron] Electron 二进制已就绪。')
  process.exit(0)
}

console.log('[ensure-electron] 未检测到 Electron 二进制，开始下载（使用国内镜像）…')

const env = {
  ...process.env,
  ELECTRON_MIRROR: process.env['ELECTRON_MIRROR'] ?? 'https://npmmirror.com/mirrors/electron/',
  electron_config_cache: process.env['electron_config_cache'] ?? join(projectRoot, '.electron-cache')
}

const result = spawnSync(process.execPath, [join(electronDir, 'install.js')], {
  cwd: projectRoot,
  stdio: 'inherit',
  env
})

if (result.status !== 0 || !existsSync(electronExe)) {
  console.error('[ensure-electron] Electron 二进制下载失败，请检查网络后重试：node scripts/ensure-electron.mjs')
  process.exit(1)
}

console.log('[ensure-electron] Electron 二进制下载完成。')
