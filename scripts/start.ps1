# Atelier 启动器
# 作用：找到 Node.js 与 pnpm，缺依赖就自动安装，然后启动开发版窗口。
# 使用：双击项目根目录的「启动Atelier.cmd」，或在本文件所在目录运行它。

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host ''
Write-Host '======================================'
Write-Host '   Atelier 启动器'
Write-Host '======================================'
Write-Host ''

# 1. 查找 Node.js：优先使用系统安装的，其次使用 DSH 自带的运行时
$nodePath = $null
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $nodePath = $nodeCommand.Source
} else {
  $bundledNode = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
  if (Test-Path -LiteralPath $bundledNode) {
    $nodePath = $bundledNode
    Write-Host "未找到系统 Node.js，改用自带的 Node.js：$bundledNode"
  }
}

if (-not $nodePath) {
  Write-Host '启动失败：这台电脑上没有找到 Node.js。' -ForegroundColor Red
  Write-Host '请先安装 Node.js LTS 版本（https://nodejs.org/），安装完成后重新双击本启动器。'
  Write-Host ''
  Read-Host '按回车键关闭'
  exit 1
}

# 让 pnpm 启动的子命令（tsc、electron-vite、electron）能找到同一个 Node.js
$env:PATH = (Split-Path -Parent $nodePath) + ';' + $env:PATH

# 2. 查找 pnpm
$pnpmScript = $null
$bundledPnpm = Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
if (Test-Path -LiteralPath $bundledPnpm) {
  $pnpmScript = $bundledPnpm
} elseif (Get-Command pnpm -ErrorAction SilentlyContinue) {
  $pnpmScript = 'pnpm'
}

if (-not $pnpmScript) {
  Write-Host '启动失败：没有找到 pnpm。' -ForegroundColor Red
  Write-Host '可以在命令行执行 npm install -g pnpm 安装，然后重新双击本启动器。'
  Write-Host ''
  Read-Host '按回车键关闭'
  exit 1
}

function Invoke-Pnpm {
  param([string[]]$PnpmArguments)
  if ($pnpmScript -eq 'pnpm') {
    & pnpm @PnpmArguments
  } else {
    & $nodePath $pnpmScript @PnpmArguments
  }
}

$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:electron_config_cache = Join-Path $projectRoot '.electron-cache'

# 3. 首次运行自动安装依赖
$needInstall = -not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))
if (-not $needInstall) {
  $electronExe = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
  $needInstall = -not (Test-Path -LiteralPath $electronExe)
}

if ($needInstall) {
  Write-Host '首次启动，正在准备依赖，可能需要几分钟，请耐心等待…'
  Write-Host ''
  Invoke-Pnpm @('install', '--store-dir', '.pnpm-store')
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '依赖安装失败，请把上面的错误信息发给开发助手。' -ForegroundColor Red
    Read-Host '按回车键关闭'
    exit 1
  }
}

# 4. 启动开发版窗口
Write-Host '正在启动 Atelier 窗口…（关闭窗口即可退出，或在此按 Ctrl+C）'
Write-Host ''
Invoke-Pnpm @('run', 'dev')

if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '启动过程出现错误，请把上面的错误信息发给开发助手。' -ForegroundColor Red
  Read-Host '按回车键关闭'
  exit $LASTEXITCODE
}
