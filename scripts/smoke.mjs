/**
 * 冒烟测试：真实启动 Electron 主进程，等渲染进程页面加载完成后自动退出。
 * 用于验证「项目能跑起来」，而不是只验证代码看起来正确。
 *
 * 用法：先 pnpm build，再 pnpm smoke
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { cleanEnv, ensureElectronRuntime } from './electron-runtime.mjs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const mainEntry = join(projectRoot, 'out', 'main', 'index.js')
if (!existsSync(mainEntry)) {
  console.error('SMOKE_FAIL 未找到构建产物 out/main/index.js，请先运行 pnpm build')
  process.exit(1)
}

let runtime
try {
  runtime = ensureElectronRuntime()
} catch (error) {
  console.error(`SMOKE_FAIL ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

if (runtime.distPath) {
  console.log(`[atelier] ${runtime.message}`)
}

// Electron 的二进制路径：优先用自检通过的运行时目录，否则用 electron 包解析出的路径。
const electronBinary = runtime.distPath
  ? join(runtime.distPath, process.platform === 'win32' ? 'electron.exe' : 'electron')
  : require('electron')

const child = spawn(electronBinary, ['.'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: cleanEnv({ ATELIER_SMOKE_TEST: '1' })
})

const killer = setTimeout(() => {
  console.error('SMOKE_FAIL 启动超时（60 秒），强制结束进程')
  child.kill()
  process.exit(1)
}, 60_000)
killer.unref()

child.on('error', (error) => {
  console.error('SMOKE_FAIL 无法启动 Electron：', error.message)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  clearTimeout(killer)
  if (signal) {
    console.error(`SMOKE_FAIL Electron 被信号终止：${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})
