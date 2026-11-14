/**
 * electron-vite 启动包装器。
 *
 * 先做 Electron 运行时自检，再启动开发服务器 / 预览。
 * 这样无论项目目录本身能否运行 Electron，`pnpm dev` 和 `pnpm start` 都能直接工作。
 *
 * 用法：node scripts/electron-vite.mjs dev
 *       node scripts/electron-vite.mjs preview
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { cleanEnv, ensureElectronRuntime, EXE_NAME, projectRoot } from './electron-runtime.mjs'

const mode = process.argv[2] === 'preview' ? 'preview' : 'dev'
const bin = join(projectRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')

if (!existsSync(bin)) {
  console.error('未找到 electron-vite，请先运行 pnpm install')
  process.exit(1)
}

let runtime
try {
  runtime = ensureElectronRuntime()
} catch (error) {
  console.error(String(error instanceof Error ? error.message : error))
  process.exit(1)
}

if (runtime.distPath) {
  console.log(`[atelier] ${runtime.message}`)
}

// electron-vite 通过 ELECTRON_EXEC_PATH 定位 Electron 可执行文件；
// ELECTRON_OVERRIDE_DIST_PATH 则让 electron 包本身也指向同一份运行时。
const overrides = runtime.distPath
  ? {
      ELECTRON_EXEC_PATH: join(runtime.distPath, EXE_NAME),
      ELECTRON_OVERRIDE_DIST_PATH: runtime.distPath
    }
  : {}

const child = spawn(process.execPath, [bin, mode], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: cleanEnv(overrides)
})

child.on('error', (error) => {
  console.error(`[atelier] 启动失败：${error.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1))
})
