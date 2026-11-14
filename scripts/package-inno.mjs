import {
  copyFileSync,
  createHash,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const args = process.argv.slice(2)
const versionArg = args.find((arg) => arg.startsWith('--version='))
const version = versionArg ? versionArg.slice('--version='.length) : packageJson.version
const skipBuild = args.includes('--skip-build')

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`版本号必须是 X.Y.Z：${version}`)
}

const isccCandidates = [
  process.env['INNO_SETUP_ISCC'],
  'C:\\Program Files\\Inno Setup 7\\ISCC.exe',
  'C:\\Program Files (x86)\\Inno Setup 7\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe'
].filter(Boolean)

const iscc = isccCandidates.find((candidate) => existsSync(candidate))
if (!iscc) {
  throw new Error(
    '未找到 ISCC.exe。请安装 Inno Setup 6.3+（建议 7.x），或设置 INNO_SETUP_ISCC 环境变量。'
  )
}

function run(command, commandArgs, env = process.env) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`命令失败（退出码 ${result.status ?? 'unknown'}）：${command} ${commandArgs.join(' ')}`)
  }
}

function runPnpm(script) {
  const npmExecPath = process.env['npm_execpath']
  if (npmExecPath) {
    run(process.execPath, [npmExecPath, 'run', script])
  } else {
    run(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['run', script])
  }
}

if (!skipBuild) {
  console.log('[atelier-inno] 1/3 构建 Electron 应用')
  runPnpm('build')
  console.log('[atelier-inno] 2/3 生成 win-unpacked')
  runPnpm('package:dir')
} else {
  console.log('[atelier-inno] 跳过构建，使用现有 win-unpacked')
}

const unpacked = join(root, 'dist', 'win-unpacked')
const required = [
  'Atelier.exe',
  'resources/app.asar',
  'resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/win32-x64.node',
  'resources/app.asar.unpacked/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node'
]

for (const relative of required) {
  if (!existsSync(join(unpacked, relative))) {
    throw new Error(`win-unpacked 不完整，缺少：${relative}`)
  }
}

const mainBundle = readFileSync(join(root, 'out', 'main', 'index.js'), 'utf8')
for (const marker of ['ATELIER_DATAINFO_SMOKE_FILE', 'backup:create']) {
  if (!mainBundle.includes(marker)) {
    throw new Error(`out/main 不是当前 P6 代码，缺少标记：${marker}。请完整构建。`)
  }
}

console.log(`[atelier-inno] 3/3 使用 ISCC 编译（AppVersion=${version}）`)
run(iscc, [`/DAppVersion=${version}`, join(root, 'build', 'atelier.iss')])

const installer = join(root, 'dist', `Atelier-Setup-${version}.exe`)
if (!existsSync(installer)) {
  throw new Error(`未找到安装包：${installer}`)
}

// 项目工作区可能带 Low Integrity 标签；不能用 icacls 原地改（Access denied）。
// 复制到用户本地目录，新文件继承 Medium，作为最终交付 EXE；原始构建产物保留。
const releaseDir = join(process.env['LOCALAPPDATA'] ?? root, 'Atelier', 'release')
mkdirSync(releaseDir, { recursive: true })
const releaseInstaller = join(releaseDir, `Atelier-Setup-${version}.exe`)
copyFileSync(installer, releaseInstaller)

if (process.platform === 'win32') {
  const label = spawnSync('icacls', [releaseInstaller], { encoding: 'utf8' })
  if (label.stdout?.includes('Low Mandatory Level')) {
    throw new Error('交付安装包仍然是 Low Integrity，请检查 LOCALAPPDATA 的完整性标签')
  }
}

const size = statSync(releaseInstaller).size
const sha256 = createHash('sha256').update(readFileSync(releaseInstaller)).digest('hex')

console.log(`[atelier-inno] 构建产物：${installer}`)
console.log(`[atelier-inno] 交付副本：${releaseInstaller}`)
console.log(`[atelier-inno] 大小：${size} bytes`)
console.log(`[atelier-inno] SHA256：${sha256}`)
