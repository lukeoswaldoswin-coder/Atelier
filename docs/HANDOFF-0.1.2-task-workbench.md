# 交接归档：0.1.2（P6.6 绘画任务工作台与任务关联计时）（2026-11-15）

> 用途：把本轮的工作、决策、验证证据和交付物完整交给新对话，避免重复调查。
> 新对话可直接读本文件，再按「十二、新对话开场提示词」继续。

## 一、项目与环境

| 项 | 值 |
|---|---|
| 项目目录 | `D:\Atelier\project` |
| 技术栈 | Electron 44.7 + React 19 + TypeScript + better-sqlite3 |
| 版本 | **0.1.2**（未进入 P7） |
| 当前 HEAD | `271e2d1` 发布: 版本号升级到 0.1.2（P6.6 绘画任务工作台） |
| P6 基线 | 注解标签 `p6-baseline` → `8139ff7`（**未移动**） |
| P6.6 基线 | 注解标签 `p6.6-baseline` → `271e2d1`（本轮新建，用户验收后创建） |
| 标签总数 | **14 个**（上轮 13 + `p6.6-baseline`） |
| 工作区 | 干净 |

构建命令（`pnpm` 不在 PATH 时用 DSH 自带 node）：

```powershell
$node = "C:\Users\11415\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node .\node_modules\typescript\bin\tsc --noEmit -p tsconfig.node.json
& $node .\node_modules\typescript\bin\tsc --noEmit -p tsconfig.json
& $node .\node_modules\vitest\vitest.mjs run
& $node .\node_modules\electron-vite\bin\electron-vite.js build
& $node .\node_modules\electron-builder\cli.js --win --dir
# 安装包（package-inno.mjs 在本环境会因 pnpm.cmd 缺失失败，见八.7）
& "C:\Program Files\Inno Setup 7\ISCC.exe" "/DAppVersion=0.1.2" "build\atelier.iss"
```

## 二、不可变约束（非用户明确批准不得改）

- 中文名：画师工坊；完整展示：Atelier 画师工坊
- AppId：`com.atelier.desktop`；Inno AppId：`{7C0D2B9E-4A3F-4E8A-9C61-2D5B8F1A6E30}`
- 数据目录：`%APPDATA%\atelier`；数据库 `%APPDATA%\atelier\atelier.db`
- IPC 通道、数据库 schema、迁移记录
- 备份 / 恢复 / CSV 导出逻辑
- 已有 Git 历史与 `p6-baseline` 标签

## 三、本轮做了什么（P6.6）

用户需求：恢复独立「绘画任务」侧边栏入口，建立轻量绘画任务工作台，
支持「手动开启会话 + 自动累计绘画软件活跃时间 + 手动结束会话」。

**核心结论：本阶段不需要任何数据库迁移。**
`time_entries.task_id` 自迁移 005 起就是指向 `tasks(id)` 的可空外键，
`TimeEntry.taskId` 早已在领域模型中，`taskContext()` 已做任务/委托状态校验。

### 3.1 页面与入口

- 侧边栏新增「绘画任务」，位于「委托管理」之后、「日历」之前
- 页面布局：标题与筛选 → 当前计时任务卡片 → 待处理任务列表
- 当前卡片区分「实际累计工时」（大号）与「会话持续时间」（辅助）
- 四种状态文案：正在累计 / 暂停累计 / 手动暂停 / 会话进行中
- 已完成任务折叠展示，默认不占主区域
- 顶栏指示器优先级：手动计时 > 任务会话 > 自动监测

### 3.2 计时机制（本阶段最重要的设计）

任务计时会话**本身就是一条 `time_entries` 记录**：

```
source = 'auto'  AND  task_id IS NOT NULL  AND  status = 'running'
```

普通自动片段是 `source = 'auto' AND task_id IS NULL`。两者共用同一张表，
因此天然受迁移 005 已有的唯一索引约束：

```sql
CREATE UNIQUE INDEX ux_time_entries_auto_active ON time_entries (source)
  WHERE source = 'auto' AND status = 'running' AND deleted_at IS NULL;
```

**同一时刻数据库只允许一条 `running` 的 auto 记录。**
任务会话与普通自动片段在数据库层面互斥——重复累计不是靠应用层自觉，
而是被约束拒绝。

配套改动：

1. `findActiveAuto()` 改为只取 `task_id IS NULL` 的行；
   新增 `findActiveTaskSession()` 只取 `task_id IS NOT NULL` 的行。
2. 监测 `evaluate()` 中任务会话优先：有会话时只调
   `applyTaskActivity(active, appKey)` 并 `closeAuto()`，绝不创建独立自动记录。
3. 开始任务会话时先 `closeActiveAuto()`，避免撞唯一索引。

### 3.3 自动监测关闭时仍能计时

原 `tick()` 与 `restartTimer()` 都被 `config.enabled` 卡死。改为：

- 采样条件：`config.enabled || timeService.hasTaskSession()`
- 会话活跃判定**不看** `config.enabled`
- 会话开始/结束通过 `onTaskSessionChanged` → `monitor.refreshTimer()` 按需启停

无会话且监测关闭时，仍完全不采样、不加载原生探测（保持 P4 行为）。

### 3.4 复用的既有能力（没有新建监测系统）

| 能力 | 复用方式 |
|---|---|
| 绘画软件识别 | `resolveAppKey()` + `config.apps` 白名单 |
| 空闲检测 | `idleMs < idleMinutes * 60 * 1000` |
| 活跃采样 | `ActivityMonitor` 每秒 `probe.sample()` |
| 检查点 | `repo.checkpoint()`，30 秒一次 |
| 休眠处理 | `powerMonitor` 的 `suspend` / `resume` |
| 崩溃恢复 | `TimeService` 启动恢复 |

### 3.5 任务完成与计时

计时中的任务不能直接标记完成，先提示结束计时并保存工时，成功后再完成。

## 四、验证证据

### 4.1 自动化

- `tsc --noEmit`（node + web）均通过
- `electron-vite build` 通过
- Vitest：**63 个文件 / 536 条全通过**（新增 29 条，其余 507 条为既有回归）

新增测试：

```
src/main/time/task-session.test.ts                13 条（真实 SQLite + 真实监测）
src/main/db/repositories/tasks-workbench.test.ts   5 条（聚合查询 + 唯一索引）
src/renderer/src/pages/tasks/tasks-page.test.tsx  11 条（页面行为）
```

### 4.2 实机验证（真实 Electron，非 jsdom）

`scripts/verify-p66.mjs` —— CDP 驱动真实窗口 + 临时 userData + 真实 IPC，
**15/15 通过**。关键项：

- 开始任务计时且累计为 0（非墙钟）
- 会话时长增长且实际工时不超过会话时长（识别到 `clipstudio`）
- 暂停期间不累计（before=3 after=3）
- 结束后工时归属正确任务，同一任务只有 1 条记录
- **自动监测关闭时仍累计**（`enabled:false` 仍 `accumulated:3`）
- 结束后出现 `taskId:null` 的独立自动片段 → **未分配工时功能未破坏**

### 4.3 数据库约束验证

`scripts/verify-p66-db.mjs` —— 真实文件数据库，**5/5 通过**：
第二条并行会话被拒、会话期间普通自动片段被拒、结算后可开新会话。

### 4.4 安装版验收

`scripts/verify-installed.mjs` —— 安装后 0.1.2 实机 **9/9 通过**：
版本号、侧边栏、页面渲染、空状态、读出真实任务数据、开始计时、
会话时长、结束无残留、监测关闭仍工作。

### 4.5 数据安全

- 所有测试用 `mkdtempSync()` 或 `%LOCALAPPDATA%\Atelier\P6.6-测试数据` 副本
- 真实库全程只读；升级前后 SHA256 与备份**完全一致**
- 备份：`%APPDATA%\atelier\atelier.db.bak-before-0.1.2-2026-11-15T14-45-12`（143,360 bytes）
- 数据完整：9 客户 / 4 委托 / 1 任务 / 18 条工时记录

## 五、交付物

**安装包**

```
%LOCALAPPDATA%\Atelier\release\画师工坊-Setup-0.1.2.exe
125,966,273 bytes
SHA256: 4F3C3DAA7BAEF1860C6E3ED8CA4801DBEF9860D57583DDA039EE25AAA1DE0AC1
完整性: Medium（无 Low Mandatory Level 标签）
未签名: SmartScreen 会提示
```

**用户设备已安装版本**

```
C:\Users\11415\AppData\Local\Programs\Atelier\
Atelier.exe 版本 0.1.2
```

桌面 + 开始菜单「画师工坊」快捷方式均指向该路径。

## 六、Git 提交记录（本轮）

```
271e2d1 发布: 版本号升级到 0.1.2（P6.6 绘画任务工作台）
552472f 文档: P6.6 绘画任务工作台与任务关联计时交付报告
72ef878 测试: P6.6 实机验证脚本与证据（真实 Electron + 真实数据库）
fb3f5ee 功能: 绘画任务页面与侧边栏入口（P6.6）
a4c5a6d 功能: 绘画任务工作台聚合查询（P6.6）
b75364f 功能: 任务计时复用绘画软件活跃时间，杜绝重复记账（P6.6）
3329842 功能: 任务计时会话契约与 IPC 通道（P6.6）
47cff77 文档: 归档 0.1.1 批量选择与体验修订的交接说明   ← 本轮起点
```

`p6-baseline` 仍是 `8139ff7`，历史未改写、未 amend。
`p6.6-baseline` 本轮新建，指向 `271e2d1`。

## 七、本轮改动文件清单

```
新增：
  src/main/time/task-session.test.ts
  src/main/db/repositories/tasks-workbench.test.ts
  src/renderer/src/data/workbench.ts
  src/renderer/src/pages/tasks/tasks-page.tsx
  src/renderer/src/pages/tasks/tasks-page.test.tsx
  scripts/verify-p66.mjs
  scripts/verify-p66-db.mjs
  scripts/verify-installed.mjs
  docs/verify-p66/report.json
  docs/P6.6-REPORT.md

修改：
  src/shared/domain.ts                    任务会话/工作台 schema
  src/shared/channels.ts                  新增 5 个 IPC 通道
  src/shared/contracts.ts                 通道契约登记
  src/shared/api.ts                       渲染进程接口
  src/preload/index.ts                    桥接
  src/main/time/time-service.ts           任务会话状态机 + 恢复 + 落库
  src/main/db/repositories/time-entries.ts 区分会话与自动片段
  src/main/activity/activity-monitor.ts   会话优先、监测关闭仍采样、休眠不结束会话
  src/main/db/repositories/tasks.ts       workbench 聚合查询
  src/main/ipc/handlers.ts                5 个新处理器 + onTaskSessionChanged
  src/main/index.ts                       接线 refreshTimer
  src/renderer/src/config/navigation.ts   侧边栏入口
  src/renderer/src/App.tsx                路由渲染
  src/renderer/src/stores/time-store.ts   任务会话操作
  src/renderer/src/data/time-polling.ts   useLiveTaskSession
  src/renderer/src/components/layout/time-indicator.tsx
  build/atelier.iss                       AppVersion → 0.1.2
  package.json                            version → 0.1.2
  画师工坊-使用教程与功能说明.txt           新增「六、绘画任务工作台」整章
```

未触碰：数据库 schema/迁移、备份/恢复/CSV 导出逻辑、委托与任务既有业务规则、
P4 手动计时与自动监测的原有行为。

## 八、环境坑（务必记住，本轮新增 3 条）

1. 启动打包后的 Electron 前必须清除 `ELECTRON_RUN_AS_NODE`，否则静默退出且退出码 0。
2. `D:\Atelier\project` 及 `dist` 带 Low Integrity：直接跑 `dist` 内安装包会报
   「无法创建临时目录 / 错误 5」。实机验证用 `%LOCALAPPDATA%\Atelier\release` 的 Medium 副本。
3. DSH 沙箱会拦 Electron 命名管道（`mojo platform_channel` 0x5），沙箱内无法启动 GUI。
4. 所有测试必须用 `ATELIER_USER_DATA_DIR` 指向临时 userData；真实库只读。
5. 安装测试加 `/NOCLOSEAPPLICATIONS`，避免 Inno 的 Restart Manager 关掉用户运行中的实例。
6. `node_modules` 里没有 `ws`/`playwright`，但 Node 24 自带全局 `WebSocket`，
   可直接连 CDP 做真实鼠标验证，无需新依赖。
7. `scripts/package-inno.mjs` 在本环境会失败：它内部 `spawnSync('pnpm.cmd')`
   报 `EINVAL`（pnpm.cmd 不在 PATH）。绕法：手动依次跑
   `electron-vite build` → `electron-builder --win --dir` → `ISCC.exe /DAppVersion=X build\atelier.iss`，
   再手动复制到 release 目录并校验 SHA256 / 完整性标签。
   （`electron-builder` 自身也会因为找不到 `pnpm` 打一条警告，但会自动回退到
   node_modules 遍历，**不影响产物**。）
8. PowerShell `Set-Content` 会破坏 UTF-8 中文。改含中文的源码/测试必须用编辑工具，
   或 `[System.IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false))`。
9. **（新）项目目录内的 Electron 二进制无法启动**：直接运行
   `node_modules/electron/dist/electron.exe` 会立刻崩溃。仓库自带的
   `scripts/electron-runtime.mjs` 已有自检，会自动使用工作区外的副本
   `D:\Atelier\atelier-electron-runtime`。实机脚本应复用 `ensureElectronRuntime()`，
   不要手工指定 `ATELIER_ELECTRON_BIN`。
10. **（新）沙箱内 `spawn` 用管道捕获子进程输出会 `EPERM`**。实机脚本要把
    Electron 输出重定向到临时日志文件（`openSync(logPath,'w')` 传给 stdio），
    或用 `stdio: 'inherit'` / `'ignore'`。
11. **（新）PowerShell 中 `git rev-parse 'tag^{commit}'` 会被当成转义**，
    必须用单引号包裹整个参数。

## 九、当前边界 / 已知非阻塞问题

- 绘画任务工作台**不提供**任务排序、编辑、归档入口，这些仍在委托详情里完成
- 「查看委托」会切到委托管理页，但**不自动定位**到该委托
- 任务计时**没有 24 小时自动暂停**（手动计时有）；因为累计的是活跃时间而非墙钟
- 会话只在用户手动结束时结束，忘记结束会一直保持 running（重启后恢复为进行中）
- 自动监测默认关闭，需在设置里手动开启；默认空闲阈值 3 分钟
- 自动监测仅作参考，不保证等同真实绘画时间
- 排期建议不使用每日容量、工作日、任务依赖
- 安装包未签名，SmartScreen 会提示
- 不提供云同步 / 自动更新 / CSV 导入

## 十、遗留 / 待确认

1. `%LOCALAPPDATA%\Atelier\P6.6-测试数据` 目录仍留在用户机器上（本轮实机验证用的
   真实库副本），确认无用后可删除，不影响已安装正式版。
2. 上轮遗留的 `P6.5.1-测试版` 与 `P6.5.1-测试数据` 两个目录同样仍在。
3. 用户朋友那边尚未验证 0.1.2 覆盖安装（数据应自动保留，但未实测）。
4. 任务计时若长期不结束，目前只能手动收尾；如需自动兜底需另行设计。

## 十一、本轮踩过的两个坑（复盘）

1. **实机验证脚本断言写错**：最初断言「等待 3 秒后实际工时应为 0」，
   但用户机器上正开着优动漫 PAINT（`UDMPaintPRO`），监测真实识别为 `clipstudio`
   并累计了 3 秒。**代码是对的，断言错了**。已改为
   「累计 <= 会话时长」并额外增加「暂停期间不累计」用例。
   教训：实机环境不可假设为「无活跃软件」。
2. **重启恢复丢 30 秒**：任务会话重启前若未落检查点，恢复出来会少于用户看到的数字。
   已加 `persistTaskSessionProgress()`，在 `monitor.stop()` 时落库。

## 十二、新对话开场提示词（可直接粘贴）

```
你继续负责 Windows 桌面应用「Atelier 画师工坊」的开发与问题修复。

项目位置：D:\Atelier\project
先读 docs/HANDOFF-0.1.2-task-workbench.md 了解上一轮完成的 P6.6 绘画任务工作台、
任务关联计时与 0.1.2 发布情况。

当前状态：
- 版本 0.1.2，HEAD 271e2d1，工作区干净
- p6-baseline 指向 8139ff7，p6.6-baseline 指向 271e2d1，两者都不得移动
- 不进入 P7，只处理用户明确反馈的问题

不可变：AppId com.atelier.desktop、%APPDATA%\atelier 数据目录、schema/迁移、
备份恢复与 CSV 导出逻辑、已有 Git 历史。

数据安全：真实库禁止写入/恢复/迁移/删除；复现必须把 atelier.db 复制到临时目录，
用 ATELIER_USER_DATA_DIR 指向临时 userData。

环境坑（详见交接文档第八节）：
- 启动前清除 ELECTRON_RUN_AS_NODE
- 项目目录内的 Electron 无法启动，用 scripts/electron-runtime.mjs 的自检
- dist 带 Low Integrity，实机验证用 %LOCALAPPDATA%\Atelier\release 的 Medium 副本
- 沙箱内 spawn 管道捕获会 EPERM，输出要重定向到文件
- package-inno.mjs 在本机会因 pnpm.cmd 缺失失败，需手动 build → package:dir → ISCC
- 改中文源码用编辑工具，别用 PowerShell Set-Content

当前交付包：
%LOCALAPPDATA%\Atelier\release\画师工坊-Setup-0.1.2.exe
125,966,273 bytes
SHA256 4F3C3DAA7BAEF1860C6E3ED8CA4801DBEF9860D57583DDA039EE25AAA1DE0AC1

请先执行 git status 确认干净，然后告诉我你要处理的问题（版本、复现步骤、
期望、实际、截图/错误文本、是否影响数据）。只做最小修复，不重构、不扩需求。
```
