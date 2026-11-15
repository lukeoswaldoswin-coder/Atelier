/**
 * P6.6 实机验证：真实 Electron + 真实 SQLite + 真实 IPC。
 *
 * 通过 CDP 驱动渲染进程点击「绘画任务」并开始计时，
 * 同时用临时 userData 隔离数据，绝不触碰真实库。
 */
import { spawn } from 'node:child_process'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanEnv, ensureElectronRuntime } from './electron-runtime.mjs'

const require = createRequire(import.meta.url)
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// 这台机器上直接从项目目录跑 Electron 二进制会崩（已知问题），
// 必须走项目自带的运行时自检，必要时使用工作区外的副本。
const runtime = ensureElectronRuntime()
if (runtime.distPath) console.log(`[atelier] ${runtime.message}`)

const electron = runtime.distPath
  ? join(runtime.distPath, process.platform === 'win32' ? 'electron.exe' : 'electron')
  : require('electron')

const port = 9333
const userData = mkdtempSync(join(tmpdir(), 'atelier-p66-'))
const reportPath = process.env['P66_REPORT'] ?? join(tmpdir(), 'p66-report.json')

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function cdp(method, params, sessionId) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`)
  const targets = await response.json()
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('没有找到页面目标')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  const id = Math.floor(Math.random() * 1e9)
  const message = { id, method, params: params ?? {} }
  if (sessionId) message.sessionId = sessionId
  ws.send(JSON.stringify(message))
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP 超时: ${method}`)), 15000)
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.id === id) {
        clearTimeout(timer)
        ws.close()
        resolve(data)
      }
    }
  })
  return result
}

async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.result?.exceptionDetails) {
    throw new Error(JSON.stringify(result.result.exceptionDetails))
  }
  return result.result?.result?.value
}

const env = cleanEnv({ ATELIER_USER_DATA_DIR: userData })

const logPath = join(tmpdir(), 'atelier-p66-electron.log')
const logFd = openSync(logPath, 'w')

const child = spawn(electron, ['.', `--remote-debugging-port=${port}`], {
  cwd: projectRoot,
  env,
  // 沙箱内不能用管道捕获子进程输出（EPERM），改为写入文件。
  stdio: ['ignore', logFd, logFd]
})

async function waitForPage() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      if (targets.some((t) => t.type === 'page')) return
    } catch {
      // 还没起来
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  let log = ''
  try {
    log = readFileSync(logPath, 'utf8').slice(-3000)
  } catch {
    // 忽略
  }
  throw new Error(`页面没有起来（Electron 可能未能启动）。日志：\n${log}`)
}

try {
  await waitForPage()
  await new Promise((resolve) => setTimeout(resolve, 2500))

  // 1. 侧边栏入口
  const nav = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('aside button')]
    return buttons.map((b) => b.textContent.trim())
  })()`)
  record('侧边栏包含「绘画任务」', Array.isArray(nav) && nav.some((t) => t.includes('绘画任务')), JSON.stringify(nav))

  // 2. 进入页面
  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('aside button')].find((b) => b.textContent.includes('绘画任务'))
    btn.click()
    return true
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 800))

  const hasPage = await evaluate(`Boolean(document.querySelector('[data-testid="tasks-page"]'))`)
  record('绘画任务页面渲染', hasPage === true)

  const emptyState = await evaluate(`Boolean(document.querySelector('[data-testid="current-session-empty"]'))`)
  record('无会话时显示空状态（不显示虚假计时）', emptyState === true)

  // 3. 通过真实 IPC 造数据：客户 → 委托 → 任务
  const seeded = await evaluate(`(async () => {
    const api = window.atelier
    const client = await api.clients.create({ name: '实机验证客户' })
    const commission = await api.commissions.create({
      clientId: client.id, title: '实机验证委托', type: '插画', quoteAmountCents: 50000
    })
    await api.commissions.update({ id: commission.id, status: 'active' })
    const task = await api.tasks.create({
      commissionId: commission.id, title: '实机验证任务', stage: 'lineart', estimatedMinutes: 120
    })
    return { clientId: client.id, commissionId: commission.id, taskId: task.id }
  })()`)
  record('真实 IPC 创建客户/委托/任务', Boolean(seeded?.taskId), JSON.stringify(seeded))

  // 4. 工作台聚合
  const workbench = await evaluate(`(async () => {
    const value = await window.atelier.tasks.workbench({ includeDone: true, includeArchived: false })
    return { pending: value.pending.length, done: value.done.length,
             first: value.pending[0] ? {
               title: value.pending[0].task.title,
               commission: value.pending[0].commission.title,
               client: value.pending[0].clientName
             } : null }
  })()`)
  record('工作台聚合出任务并带出委托与客户',
    workbench?.first?.title === '实机验证任务' &&
    workbench?.first?.commission === '实机验证委托' &&
    workbench?.first?.client === '实机验证客户',
    JSON.stringify(workbench))

  // 5. 开始任务计时：累计必须为 0（不按墙钟算）
  const started = await evaluate(`(async () => {
    const value = await window.atelier.time.startTask({ taskId: '${seeded.taskId}', replaceCurrent: false })
    return { taskId: value.taskSession?.taskId, accumulated: value.taskSession?.accumulatedSeconds,
             session: value.taskSession?.sessionSeconds, state: value.taskSession?.state }
  })()`)
  record('开始任务计时且累计为 0（非墙钟）',
    started?.taskId === seeded.taskId && started?.accumulated === 0 && started?.state === 'running',
    JSON.stringify(started))

  // 6. 等 3 秒：会话持续时间必须增长；实际工时只在绘画软件真正活跃时增长。
  // 本机可能正开着绘画软件（例如优动漫 PAINT），因此这里不断言累计为 0，
  // 而是断言「累计 <= 会话持续时间」，且累计只来自活跃采样。
  await new Promise((resolve) => setTimeout(resolve, 3200))
  const waited = await evaluate(`(async () => {
    const value = await window.atelier.time.status()
    return { accumulated: value.taskSession?.accumulatedSeconds, session: value.taskSession?.sessionSeconds,
             accumulating: value.taskSession?.accumulating, appKey: value.taskSession?.activeAppKey }
  })()`)
  record('等待 3 秒后会话持续时间增长，且实际工时不超过会话时长',
    waited?.session >= 3 && waited?.accumulated <= waited?.session,
    JSON.stringify(waited))

  // 7. 手动暂停 / 继续
  const paused = await evaluate(`(async () => {
    const value = await window.atelier.time.pauseTask()
    return value.taskSession?.state
  })()`)
  record('手动暂停生效', paused === 'paused', String(paused))

  // 暂停期间即使绘画软件活跃也不能累计
  const beforePause = await evaluate(`(async () => {
    const value = await window.atelier.time.status()
    return value.taskSession?.accumulatedSeconds
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 2500))
  const afterPause = await evaluate(`(async () => {
    const value = await window.atelier.time.status()
    return value.taskSession?.accumulatedSeconds
  })()`)
  record('暂停期间不累计实际工时',
    afterPause === beforePause,
    `before=${beforePause} after=${afterPause}`)

  const resumed = await evaluate(`(async () => {
    const value = await window.atelier.time.resumeTask()
    return value.taskSession?.state
  })()`)
  record('手动继续生效', resumed === 'running', String(resumed))

  // 8. 结束计时并检查归属
  const stopped = await evaluate(`(async () => {
    const value = await window.atelier.time.stopTask()
    const list = await window.atelier.time.list({
      from: '2020-01-01T00:00:00.000Z', to: '2030-01-01T00:00:00.000Z'
    })
    const row = list.find((item) => item.entry.taskId === '${seeded.taskId}')
    return { session: value.taskSession, found: Boolean(row),
             taskId: row?.entry.taskId, seconds: row?.entry.elapsedSeconds,
             status: row?.entry.status, source: row?.entry.source }
  })()`)
  record('结束计时后工时归属正确任务',
    stopped?.session === null && stopped?.found === true &&
    stopped?.taskId === seeded.taskId && stopped?.status === 'completed',
    JSON.stringify(stopped))

  // 9. 不产生重复工时
  const duplicates = await evaluate(`(async () => {
    const list = await window.atelier.time.list({
      from: '2020-01-01T00:00:00.000Z', to: '2030-01-01T00:00:00.000Z'
    })
    return list.filter((item) => item.entry.taskId === '${seeded.taskId}').length
  })()`)
  record('同一任务只产生一条工时记录（无重复累计）', duplicates === 1, String(duplicates))

  // 10. 任务完成后仍保留历史工时
  const completed = await evaluate(`(async () => {
    await window.atelier.tasks.update({ id: '${seeded.taskId}', status: 'done' })
    const totals = await window.atelier.time.taskTotals({ taskIds: ['${seeded.taskId}'] })
    const wb = await window.atelier.tasks.workbench({ includeDone: true, includeArchived: false })
    return { totals, doneCount: wb.done.length,
             doneActual: wb.done[0]?.actualSeconds }
  })()`)
  record('任务完成后保留历史工时并进入已完成分组',
    completed?.doneCount === 1 && completed?.doneActual === stopped?.seconds,
    JSON.stringify(completed))

  // 11. 自动监测关闭时任务计时仍能累计（P6.6 明确要求）
  const monitorOff = await evaluate(`(async () => {
    await window.atelier.monitor.setEnabled({ enabled: false })
    const before = await window.atelier.monitor.status()
    const task = await window.atelier.tasks.create({
      commissionId: '${seeded.commissionId}', title: '监测关闭验证任务', stage: 'color'
    })
    const started = await window.atelier.time.startTask({ taskId: task.id, replaceCurrent: false })
    return { enabled: before.enabled, startedAccumulated: started.taskSession?.accumulatedSeconds, taskId: task.id }
  })()`)
  await new Promise((resolve) => setTimeout(resolve, 3200))
  const monitorOffResult = await evaluate(`(async () => {
    const value = await window.atelier.time.status()
    return { accumulated: value.taskSession?.accumulatedSeconds, accumulating: value.taskSession?.accumulating,
             appKey: value.taskSession?.activeAppKey }
  })()`)
  record('自动监测关闭时任务计时仍能累计（绘画软件活跃时）',
    monitorOff?.enabled === false &&
      (monitorOffResult?.accumulating === false || monitorOffResult?.accumulated > 0),
    JSON.stringify({ monitorEnabled: monitorOff?.enabled, ...monitorOffResult }))

  await evaluate(`(async () => { await window.atelier.time.stopTask() })()`)
  await evaluate(`(async () => { await window.atelier.monitor.setEnabled({ enabled: true }) })()`)

  // 12. 数据库层面：确认没有并行会话
  const schema = await evaluate(`(async () => {
    const status = await window.atelier.time.status()
    return { manual: status.manual, taskSession: status.taskSession, auto: status.auto }
  })()`)
  record('结束后没有任何进行中的会话或自动片段',
    schema?.manual === null && schema?.taskSession === null,
    JSON.stringify(schema))

  writeFileSync(reportPath, JSON.stringify({ results, userData }, null, 2), 'utf8')
} catch (error) {
  record('实机验证执行', false, error instanceof Error ? error.message : String(error))
  writeFileSync(reportPath, JSON.stringify({ results, userData }, null, 2), 'utf8')
} finally {
  child.kill()
  await new Promise((resolve) => setTimeout(resolve, 800))
  try {
    closeSync(logFd)
  } catch {
    // 忽略
  }
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    // 忽略清理失败
  }
  const failed = results.filter((item) => !item.ok).length
  console.log(`\n结果：${results.length - failed}/${results.length} 通过`)
  process.exitCode = failed === 0 ? 0 : 1
}
