/**
 * Electron 运行时选择器。
 *
 * 背景（已实测）：在这台机器的 D:\Atelier\project 目录下直接运行 Electron 二进制时，
 * 浏览器进程会在启动瞬间崩溃（退出码 0x80000003）；把同一份二进制复制到工作区之外的
 * 普通目录就完全正常。因此这里做运行时自检：
 *
 *   1. 先尝试直接用 node_modules 里的 Electron；
 *   2. 如果跑不起来，就把 Electron 复制到工作区之外（默认 ..\atelier-electron-runtime），
 *      通过 Electron 官方支持的 ELECTRON_OVERRIDE_DIST_PATH 指向它。
 *
 * 换一台正常的电脑时第 1 步就会成功，不会产生任何额外副本。
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

export const EXE_NAME = process.platform === 'win32' ? 'electron.exe' : 'electron'

export function getLocalDistDir() {
  return join(projectRoot, 'node_modules', 'electron', 'dist')
}

export function getRuntimeDir() {
  return process.env['ATELIER_ELECTRON_RUNTIME'] ?? join(dirname(projectRoot), 'atelier-electron-runtime')
}

/** 构造一个干净的子进程环境：去掉会把 Electron 变成普通 Node 的变量。 */
export function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  delete env['ELECTRON_RUN_AS_NODE']
  return env
}

/** 用 --version 实际跑一次，确认这个目录里的 Electron 能启动。 */
export function canRun(distDir) {
  const exe = join(distDir, EXE_NAME)
  if (!existsSync(exe)) return false

  try {
    const result = spawnSync(exe, ['--version'], {
      timeout: 30_000,
      encoding: 'utf8',
      env: cleanEnv(),
      windowsHide: true
    })
    if (result.error || result.status !== 0) return false
    return /\d+\.\d+\.\d+/.test(String(result.stdout) + String(result.stderr))
  } catch {
    return false
  }
}

function readVersion(distDir) {
  const file = join(distDir, 'version')
  if (!existsSync(file)) return null
  return readFileSync(file, 'utf8').trim()
}

/**
 * 返回需要设置给 ELECTRON_OVERRIDE_DIST_PATH 的目录；不需要覆盖时返回 null。
 */
export function ensureElectronRuntime() {
  const localDist = getLocalDistDir()

  if (canRun(localDist)) {
    return { distPath: null, message: '直接使用 node_modules 中的 Electron。' }
  }

  const version = readVersion(localDist)
  if (!version) {
    throw new Error('未找到 node_modules/electron/dist，请先运行 pnpm install')
  }

  const target = getRuntimeDir()
  const targetExe = join(target, EXE_NAME)

  if (readVersion(target) !== version || !existsSync(targetExe)) {
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    cpSync(localDist, target, { recursive: true })
  }

  if (!canRun(target)) {
    throw new Error(
      `Electron 从项目目录和 ${target} 都无法启动。请把完整错误信息发给开发助手。`
    )
  }

  return {
    distPath: target,
    message: `项目目录中的 Electron 无法启动，已使用工作区外的运行时：${target}`
  }
}

export { projectRoot, require }
