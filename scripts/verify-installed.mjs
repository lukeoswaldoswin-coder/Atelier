/**
 * 安装版 0.1.2 实机验收：确认打包后的应用里绘画任务工作台可用。
 * 只读为主，所有写入都发生在临时 userData 里。
 */
const port = 9444
const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function evaluate(expression) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = list.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  const id = Math.floor(Math.random() * 1e9)
  ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  const data = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP 超时')), 20000)
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.id === id) {
        clearTimeout(timer)
        ws.close()
        resolve(msg)
      }
    }
  })
  if (data.result?.exceptionDetails) throw new Error(JSON.stringify(data.result.exceptionDetails))
  return data.result?.result?.value
}

try {
  const version = await evaluate(`(async () => (await window.atelier.getAppInfo()).version)()`)
  record('安装版版本号为 0.1.2', version === '0.1.2', String(version))

  const nav = await evaluate(`(() => [...document.querySelectorAll('aside button')].map(b => b.textContent.trim()))()`)
  record('侧边栏含「绘画任务」', nav.includes('绘画任务'), JSON.stringify(nav))

  await evaluate(`(() => {
    const btn = [...document.querySelectorAll('aside button')].find(b => b.textContent.includes('绘画任务'))
    btn.click(); return true
  })()`)
  await new Promise((r) => setTimeout(r, 900))

  record('绘画任务页面渲染', (await evaluate(`Boolean(document.querySelector('[data-testid="tasks-page"]'))`)) === true)
  record('空状态不显示虚假计时', (await evaluate(`Boolean(document.querySelector('[data-testid="current-session-empty"]'))`)) === true)

  const wb = await evaluate(`(async () => {
    const v = await window.atelier.tasks.workbench({ includeDone: true, includeArchived: false })
    return { pending: v.pending.length, done: v.done.length,
             first: v.pending[0] ? { title: v.pending[0].task.title, commission: v.pending[0].commission.title, client: v.pending[0].clientName } : null }
  })()`)
  record('工作台读出真实任务数据', wb?.pending === 1, JSON.stringify(wb))

  // 真实链路：开始计时 → 等待 → 结束
  const started = await evaluate(`(async () => {
    const v = await window.atelier.tasks.workbench({ includeDone: true, includeArchived: false })
    const t = v.pending[0].task.id
    const s = await window.atelier.time.startTask({ taskId: t, replaceCurrent: false })
    return { taskId: s.taskSession?.taskId, accumulated: s.taskSession?.accumulatedSeconds, state: s.taskSession?.state }
  })()`)
  record('开始任务计时（累计从 0 起）', started?.accumulated === 0 && started?.state === 'running', JSON.stringify(started))

  await new Promise((r) => setTimeout(r, 3200))
  const waited = await evaluate(`(async () => {
    const s = await window.atelier.time.status()
    return { accumulated: s.taskSession?.accumulatedSeconds, session: s.taskSession?.sessionSeconds,
             accumulating: s.taskSession?.accumulating, appKey: s.taskSession?.activeAppKey }
  })()`)
  record('会话时长增长且实际工时不超过会话时长',
    waited?.session >= 3 && waited?.accumulated <= waited?.session, JSON.stringify(waited))

  const stopped = await evaluate(`(async () => {
    await window.atelier.time.stopTask()
    const list = await window.atelier.time.list({ from: '2020-01-01T00:00:00.000Z', to: '2030-01-01T00:00:00.000Z' })
    const v = await window.atelier.tasks.workbench({ includeDone: true, includeArchived: false })
    return { count: list.length, session: (await window.atelier.time.status()).taskSession }
  })()`)
  record('结束计时后无残留会话', stopped?.session === null, JSON.stringify(stopped))

  const monitorOff = await evaluate(`(async () => {
    await window.atelier.monitor.setEnabled({ enabled: false })
    const v = await window.atelier.tasks.workbench({ includeDone: true, includeArchived: false })
    const t = v.pending[0].task.id
    const s = await window.atelier.time.startTask({ taskId: t, replaceCurrent: false })
    return { enabled: (await window.atelier.monitor.status()).enabled, taskId: s.taskSession?.taskId }
  })()`)
  await new Promise((r) => setTimeout(r, 3200))
  const offResult = await evaluate(`(async () => {
    const s = await window.atelier.time.status()
    return { accumulated: s.taskSession?.accumulatedSeconds, accumulating: s.taskSession?.accumulating }
  })()`)
  record('自动监测关闭时任务计时仍工作',
    monitorOff?.enabled === false && (offResult?.accumulating === false || offResult?.accumulated > 0),
    JSON.stringify({ enabled: monitorOff?.enabled, ...offResult }))

  await evaluate(`(async () => {
    await window.atelier.time.stopTask()
    await window.atelier.monitor.setEnabled({ enabled: true })
  })()`)
} catch (error) {
  record('安装版验收执行', false, error instanceof Error ? error.message : String(error))
} finally {
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n结果：${results.length - failed}/${results.length} 通过`)
  process.exitCode = failed === 0 ? 0 : 1
}
