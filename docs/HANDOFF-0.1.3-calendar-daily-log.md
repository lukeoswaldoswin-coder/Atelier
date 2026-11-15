# 交接归档：0.1.3（P6.7 日历每日创作记录与跨模块联动）（2026-11-15）

> 用途：把本轮的工作、决策、验证证据和交付物完整交给新对话，避免重复调查。
> 新对话可直接读本文件，再按「十二、新对话开场提示词」继续。

## 一、项目与环境

| 项 | 值 |
|---|---|
| 项目目录 | `D:\Atelier\project` |
| 技术栈 | Electron 44.7 + React 19 + TypeScript + better-sqlite3 |
| 版本 | **0.1.3**（未进入 P7） |
| 当前 HEAD | `edf3145` 发布: 版本号升级到 0.1.3（P6.7 日历每日创作记录） |
| P6 基线 | 注解标签 `p6-baseline` → `f50060e`（**未移动**） |
| P6.6 基线 | 注解标签 `p6.6-baseline` → `271e2d1`（**未移动**） |
| P6.7 基线 | **尚未创建**（本轮用户已验收功能，但未要求打标签） |
| 标签总数 | **14 个**（未新增、未移动） |
| 工作区 | 干净 |

构建命令（`pnpm` 不在 PATH 时用 DSH 自带 node）：

```powershell
$node = "C:\Users\11415\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
& $node .\node_modules\typescript\bin\tsc --noEmit -p tsconfig.node.json
& $node .\node_modules\typescript\bin\tsc --noEmit -p tsconfig.json
& $node .\node_modules\vitest\vitest.mjs run
& $node .\node_modules\electron-vite\bin\electron-vite.js build
& $node .\node_modules\electron-builder\cli.js --win --dir
& "C:\Program Files\Inno Setup 7\ISCC.exe" "/DAppVersion=0.1.3" "build\atelier.iss"
```

## 二、不可变约束（非用户明确批准不得改）

- 中文名：画师工坊；完整展示：Atelier 画师工坊
- AppId：`com.atelier.desktop`；Inno AppId：`{7C0D2B9E-4A3F-4E8A-9C61-2D5B8F1A6E30}`
- 数据目录：`%APPDATA%\atelier`；数据库 `%APPDATA%\atelier\atelier.db`
- IPC 通道、数据库 schema、迁移记录
- 备份 / 恢复 / CSV 导出逻辑
- 已有 Git 历史与 `p6-baseline`、`p6.6-baseline` 标签

## 三、本轮做了什么（P6.7）

用户需求：让日历不仅能看计划，还能回顾每天实际画了多久、推进了哪些任务。

**核心结论：本阶段需要一次数据库迁移（006），但只新增明细表，不动任何既有数据。**

### 3.1 执行前核查发现的关键问题（本轮最重要的判断）

需求要求「跨午夜工时正确拆分到两天」。核查 P6.6 的实际代码后发现：

- `time_entries` 只有 `started_at` / `ended_at` / `elapsed_seconds`；
- **不存在任何活跃片段表**；
- 任务会话的 `segmentStartedMono` 只存在内存里（`time-service.ts`）。

因此对于「开始 → 暂停 → 继续 → 结束」且跨越午夜的一次会话，
数据库里只有总时长和会话首尾，**中间活跃片段落在哪一天不可还原**。
这正是需求 §5.2 明确禁止伪造的情形。

真实库实测（只读副本）：6 条已完成记录中 1 条跨本地午夜
（23:38→00:06，墙钟差 10 秒，属连续片段），0 条属于「跨午夜且不可知」。
即当时用户数据尚未受损害，但继续按原结构记录必然产生不可还原的记录。

### 3.2 迁移 006（只追加）

```sql
CREATE TABLE time_entry_segments (
  id         TEXT PRIMARY KEY NOT NULL,
  entry_id   TEXT NOT NULL REFERENCES time_entries (id)
               ON UPDATE CASCADE ON DELETE CASCADE,
  started_at TEXT NOT NULL CHECK (started_at GLOB <UTC>),
  ended_at   TEXT NOT NULL CHECK (ended_at   GLOB <UTC>),
  seconds    INTEGER NOT NULL CHECK (typeof(seconds)='integer' AND seconds >= 0),
  created_at TEXT NOT NULL CHECK (created_at GLOB <UTC>),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB <UTC>)
);
CREATE INDEX idx_time_entry_segments_entry ON time_entry_segments (entry_id, started_at);
```

- 001-005 一字未动；不回填、不修改任何既有数据；
- 老记录没有片段，走「老记录规则」（见 3.4），不伪造精度。

### 3.3 片段写入路径（防止重复记账）

| 来源 | 落片段时机 |
|---|---|
| 任务会话 | `closeActiveSegment()` 结算出一段活跃时间时 |
| 手动计时 | `stop()` / `pause()` / `tick()` 24 小时超时暂停 |
| 自动监测 | `closeAuto()` 结算时 |

统一规则：`seconds <= 0` 一律不写；写入失败只 warn/记 error，
**绝不影响 `elapsed_seconds` 的权威语义**。

### 3.4 每日归属算法（`src/shared/calendar-activity.ts`）

- 有片段：每个片段按真实墙钟起止独立归属日期；
- 日界定位用**二分查找**「本地日发生变化的第一个瞬间」，
  不依赖「本地 00:00 转 UTC」——某些时区在夏令时切换当天的本地 00:00 并不存在；
- 老记录（无片段）：墙钟跨度与累计差 ≤120 秒视为连续，按占比拆分；
  超出则说明中间有暂停，**不伪造分布**，整笔归到会话开始日；
- **硬不变量：各日合计严格等于 `elapsed_seconds`**。

### 3.5 实现中自己发现并修复的缺陷

用户手工改工时起止时间（`updateCompleted` 会重算 `elapsed_seconds`，
但不改写历史片段）后，片段合计可能**大于** `elapsed_seconds`。
若直接采用片段，日历会比工时记录页多算，造成重复累计。

修复：`elapsed_seconds` 始终权威。超量时按比例缩放各片段、保持相对分布、
余数补给最长的一天，保证合计严格等于 `elapsed_seconds`。

### 3.6 日历页面（增强，未重建）

- 月视图日期格子：实际工时 + 「推进 N 项」+ 左侧色条标识；
  **没有记录的日期不渲染任何工时数字**（不出现「0 小时」）；
- 点击日期 → 右侧「当天详情」四分区：
  A 当天统计 / B 当天创作记录（按任务）/ C 未关联任务工时 / D 当天计划安排；
- 「计划」与「实际」用标题 hint 明确分区；
- 原有月/周视图、上一月/下一月/今天、未安排、排期建议、改计划日期全部保留。

### 3.7 跨模块跳转（zustand 一次性意图，消费后清空）

| 入口 | 目标 |
|---|---|
| 定位任务 | 绘画任务页，高亮该任务（已完成任务自动展开分组） |
| 查看工时 | 工时记录页，自动设日期筛选；按任务工时时再收窄到该任务 |
| 查看委托 | 委托管理页，打开对应委托详情 |

选中日期放在 store，从别的页面切回日历仍停在同一天。

### 3.8 新增 IPC（受控、Zod 校验）

| 通道 | 输入 | 输出 |
|---|---|---|
| `calendar:activity` | `{from,to}`，跨度 ≤62 天 | `{days:[{date,seconds,taskCount,commissionCount,unassignedSeconds}]}` |
| `calendar:day-detail` | `{date}` | `{date,totalSeconds,unassignedSeconds,tasks[],unassignedEntryIds[],commissions[]}` |

- `strictObject` 校验，多余字段直接拒绝；
- 月视图**一次请求整个 42 天网格**，不逐格发 IPC；
- 只统计 `completed AND deleted_at IS NULL AND merged_into_id IS NULL`；
- 区间取数用**墙钟交集**（`started_at < to AND ended_at > from`），
  否则跨午夜记录次日查不到；
- 片段表不存在时两级降级，日历不会整页崩。

## 四、验证证据

### 4.1 自动化

- `tsc --noEmit`（node + web）均通过
- `electron-vite build` 通过
- `electron-builder --win --dir` 通过
- Vitest：**68 个文件 / 616 条全通过**（起点 63/536，新增 5 文件 / 80 条）

新增测试：

```
src/shared/calendar-activity.test.ts                     23 条（跨午夜/多片段/时区/夏令时/超量缩放）
src/main/db/repositories/calendar-activity.test.ts        13 条（真实临时 SQLite 文件）
src/main/db/repositories/calendar-activity-e2e.test.ts    11 条（真实库链路端到端一致性）
src/main/db/migrations-006.test.ts                         8 条（结构/CHECK/外键级联/幂等）
src/main/time/task-session-segments.test.ts               10 条（真实 SQLite + 真实 TimeService）
日历页 / 任务页 / 工时页                                  +15 条
```

**关键数据链路（非静态 mock）**：`calendar-activity-e2e.test.ts` 用真实临时 SQLite
建 2 委托 / 3 任务 / 5 笔工时（含跨午夜与未关联），断言：

- 日历两天合计 == 工时记录页同一区间合计（20700 秒，逐位相等）；
- 任务汇总 == 该任务各日之和；
- 23:40→00:20 拆成两天各 20 分钟，合计守恒；
- 同日同任务两笔工时正确合计（7800 + 1200 = 9000）；
- 未关联 30 分钟单列，不被塞进任何任务；
- 无记录日期不出现；已完成任务历史工时可见；软删除不计入。

### 4.2 真实库迁移验证（迁移前后一致）

用户正式库（只读副本操作）：

| 项目 | 迁移前 | 迁移后 |
|---|---|---|
| 客户 | 9 | 9 |
| 委托 | 4 | 4 |
| 任务 | 1 | 1 |
| 工时记录 | 23 | 23 |
| 工时总秒数 | 11159 | 11159 |
| 外键违规 | 0 | 0 |
| 迁移数 | 5 | 6 |

迁移前自动备份：`%APPDATA%\atelier\atelier.db.bak-2026-11-15T12-30-10-588Z`（143,360 bytes），
内容确认为 5 个迁移 + 23 条工时 + 11159 秒，与迁移后完全一致。

### 4.3 实机验收

用户在设备上安装 0.1.3 后实机检查通过（日历每日创作记录、当天详情、三类跳转）。

**未做 GUI 自动化验收**：本会话沙箱内 Electron 无法启动
（`ELECTRON_RUN_AS_NODE=1`，清除后 `0xC0000005` 崩溃，见八.3），
因此界面由用户人工确认。数据链路已用真实数据库测试覆盖。

## 五、交付物

**安装包**（两份 SHA256 一致）

```
%LOCALAPPDATA%\Atelier\release\画师工坊-Setup-0.1.3.exe
D:\Atelier\project\dist\画师工坊-Setup-0.1.3.exe
125,972,621 bytes
SHA256: C5DDEE98B0C7C5D52A414009349D1A78C87A8ADFBEF8920C8E82BDD6EDAE31C9
版本信息: 0.1.3.0 · Atelier 画师工坊 安装程序
完整性: Medium（release 副本；dist 副本带 Low Integrity）
未签名: SmartScreen 会提示
```

**用户设备已安装版本**

```
C:\Users\11415\AppData\Local\Programs\Atelier\Atelier.exe
ProductVersion 0.1.3.0 · FileVersion 0.1.3
桌面 + 开始菜单「画师工坊」快捷方式均指向该路径
```

**release 目录历史**

```
画师工坊-Setup-0.1.0.exe  125,958,328
画师工坊-Setup-0.1.1.exe  125,963,717
画师工坊-Setup-0.1.2.exe  125,966,273
画师工坊-Setup-0.1.3.exe  125,972,621
```

## 六、Git 提交记录（本轮）

```
edf3145 发布: 版本号升级到 0.1.3（P6.7 日历每日创作记录）
2846b19 测试: P6.7 实机检查启动器（隔离测试数据，不触碰正式库）
be2c3b4 文档: P6.7 日历每日创作记录与跨模块联动交付报告
d013954 功能: 日历每日创作记录与跨模块跳转（P6.7）
18e9e9b 功能: 日历每日工时聚合查询与两个新 IPC（P6.7）
100e577 功能: 活跃片段明细表与片段落库，支撑每日工时归属（P6.7）
f665075 功能: 每日工时按自然日归属的共享算法（P6.7）
fadc22e 文档: 归档 0.1.2 绘画任务工作台与任务关联计时的交接说明   ← 本轮起点
```

`p6-baseline` 仍是 `f50060e`、`p6.6-baseline` 仍是 `271e2d1`，
历史未改写、未 amend。**`p6.7-baseline` 尚未创建**。

## 七、本轮改动文件清单

```
新增：
  src/shared/calendar-activity.ts                          每日归属算法
  src/shared/calendar-activity.test.ts
  src/main/db/repositories/calendar-activity.ts             每日聚合查询
  src/main/db/repositories/calendar-activity.test.ts
  src/main/db/repositories/calendar-activity-e2e.test.ts    端到端一致性
  src/main/db/migrations-006.test.ts
  src/main/time/task-session-segments.test.ts
  src/renderer/src/data/calendar-activity.ts
  src/renderer/src/pages/calendar/calendar-day-detail.tsx
  scripts/start-p67-test.cmd                                实机检查启动器
  scripts/start-p67-test-说明.txt
  scripts/publish-0.1.3.cmd                                 发布与升级脚本
  docs/P6.7-REPORT.md

修改：
  src/main/db/migrations.ts                    追加 006
  src/main/db/repositories/time-entries.ts      appendSegment / listSegments / listSegmentsForRange
  src/main/time/time-service.ts                 片段落库
  src/main/activity/activity-monitor.ts         自动片段落库
  src/main/ipc/handlers.ts / src/main/index.ts  新 IPC 与装配
  src/shared/domain.ts                          片段与日历 schema
  src/shared/channels.ts / contracts.ts / api.ts
  src/preload/index.ts
  src/renderer/src/pages/calendar/calendar-page.tsx / calendar-views.tsx
  src/renderer/src/pages/tasks/tasks-page.tsx   定位高亮
  src/renderer/src/pages/time/time-page.tsx     消费筛选意图
  src/renderer/src/stores/navigation-store.ts
  src/renderer/src/lib/calendar.ts
  src/renderer/src/data/time-entries.ts
  build/atelier.iss                             AppVersion → 0.1.3
  package.json                                  version → 0.1.3
  画师工坊-使用教程与功能说明.txt                新增日历创作记录三节
  既有断言同步（5 个）：migrator / persistence / backup / backup-service / bootstrap
```

未触碰：备份/恢复/CSV 导出逻辑、委托与任务的既有业务规则、
P4 手动计时与自动监测的原有行为、其他页面视觉设计。

## 八、环境坑（务必记住）

1. 启动打包后的 Electron 前必须清除 `ELECTRON_RUN_AS_NODE`，否则静默退出且退出码 0。
2. `D:\Atelier\project` 及 `dist` 带 Low Integrity：直接跑 `dist` 内安装包会报
   「无法创建临时目录 / 错误 5」。实机验证用 `%LOCALAPPDATA%\Atelier\release` 的 Medium 副本。
3. DSH 沙箱会拦 Electron 命名管道（`mojo platform_channel` 0x5），沙箱内无法启动 GUI。
   本轮实测：`ELECTRON_RUN_AS_NODE=1` 被设置，清除后 Electron 立即 `0xC0000005` 崩溃。
4. 所有测试必须用 `ATELIER_USER_DATA_DIR` 指向临时 userData；真实库只读。
5. 安装测试加 `/NOCLOSEAPPLICATIONS`，避免 Inno 的 Restart Manager 关掉用户运行中的实例。
6. `node_modules` 里没有 `ws`/`playwright`，但 Node 24 自带全局 `WebSocket`，
   可直接连 CDP 做真实鼠标验证，无需新依赖。
7. `scripts/package-inno.mjs` 在本环境会失败：它内部 `spawnSync('pnpm.cmd')`
   报 `EINVAL`（pnpm.cmd 不在 PATH）。绕法：手动依次跑
   `electron-vite build` → `electron-builder --win --dir` → `ISCC.exe /DAppVersion=X build\atelier.iss`，
   再手动复制到 release 目录并校验 SHA256 / 完整性标签。
   （`electron-builder` 自身也会因为找不到 `pnpm` 打一条 `spawn EPERM` 警告，
   但会自动回退到 node_modules 遍历，**不影响产物**。）
8. PowerShell `Set-Content` 会破坏 UTF-8 中文。改含中文的源码/测试必须用编辑工具，
   或 `[System.IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false))`。
9. 项目目录内的 Electron 二进制无法启动：直接运行
   `node_modules/electron/dist/electron.exe` 会立刻崩溃。仓库自带的
   `scripts/electron-runtime.mjs` 已有自检，会自动使用工作区外的副本
   `D:\Atelier\atelier-electron-runtime`。实机脚本应复用 `ensureElectronRuntime()`。
10. 沙箱内 `spawn` 用管道捕获子进程输出会 `EPERM`。实机脚本要把
    Electron 输出重定向到临时日志文件，或用 `stdio: 'inherit'` / `'ignore'`。
11. PowerShell 中 `git rev-parse 'tag^{commit}'` 会被当成转义，
    必须用单引号包裹整个参数。
12. **（新）本机 PowerShell 执行策略是 `Restricted`**：双击 `.ps1` 会被系统拒绝
    （`PSSecurityException`）。给用户的启动器必须用 `.cmd`，不要用 `.ps1`，
    也不要要求用户改系统策略。
13. **（新）`.cmd` 批处理按 GBK 读取**：文件里出现中文会被切断、命令错乱。
    给用户的 `.cmd` 必须**纯 ASCII**；需要显示中文时用 `%%~nxF` 通配符定位含中文的
    文件名，中文说明放到单独的 `.txt`。
14. **（新）`%~dp0..` 不会被规范化**，`set "PROJECT=%~dp0.."` 之后
    `%PROJECT%\out\main\index.js` 找不到。必须先 `pushd` 再 `set "PROJECT=%CD%"`。
15. **（新）沙箱只能写 `D:\Atelier\project`**：无法写 `%LOCALAPPDATA%`，
    因此「复制安装包到 release」「静默安装」这两步必须由用户在沙箱外执行，
    交付时提供 `.cmd` 一键脚本。
16. **（新）Atelier 运行中时主库文件被独占**，且迁移结果可能还在 WAL 里未 checkpoint。
    只复制 `atelier.db` 会读到旧状态；必须连同 `atelier.db-wal` / `atelier.db-shm`
    一起复制才能看到真实状态。

## 九、当前边界 / 已知非阻塞问题

- **老记录（0.1.3 之前）没有活跃片段**：中间有暂停且跨午夜的老记录，
  每日分布不可还原，整笔归到会话开始日。用户当前库此类记录 0 条。
- **合并产生的工时记录**（`time:merge`）没有片段，按日精度可能退化（不丢秒、不重复）。
- **手工修改工时起止时间**后片段不同步，靠超量缩放保证合计守恒，但跨日精度退化。
- **重启恢复**：恢复前那段累计没有片段，余量归到会话开始日。
- 日历右侧详情在 80 宽侧栏里内容较长时需要滚动，未做专门视觉压缩。
- 日期数字由 `<span>` 改为 `<button>`（为「点击日期」提供可访问名称），视觉未变。
- 任务页「定位」只高亮并滚动到可见区，不改变用户当前筛选条件。
- 安装包未签名，SmartScreen 会提示。
- 不提供云同步 / 自动更新 / CSV 导入。
- 排期建议不使用每日容量、工作日、任务依赖。

## 十、遗留 / 待确认

1. **`p6.7-baseline` 标签尚未创建**。用户已验收 0.1.3，但未明确要求打标签；
   如需要，应指向 `edf3145`。
2. `%LOCALAPPDATA%\Atelier\P6.7-test-data` 如存在，是本轮实机检查的测试副本，
   可删除，不影响已安装正式版。
3. 上轮遗留的 `P6.6-测试数据`、`P6.5.1-测试版`、`P6.5.1-测试数据` 目录同样仍在。
4. 用户朋友那边尚未验证 0.1.3 覆盖安装（数据应自动保留，但未实测）。
5. 任务计时若长期不结束，目前只能手动收尾。

## 十一、本轮踩过的坑（复盘）

1. **差点按旧报告假设数据结构**。P6.6 报告写「会话本身是一条 time_entries 记录」，
   听起来似乎片段信息齐全；实际读代码才发现只有总时长与首尾，片段只在内存里。
   教训：涉及「能否精确还原」的判断，必须以当前 schema 为准，不能读报告推断。
2. **写测试时把跨午夜时间戳写错**：把 23:40→00:20 写成跨越 24 小时 40 分，
   导致 4 条断言失败。算法本身是对的，是测试数据错了。
   教训：跨午夜用例要显式用本地时间字符串换算，不要手算 UTC 偏移。
3. **自己写的算法有重复计数缺陷**：片段合计可能大于 `elapsed_seconds`，
   原实现只处理「不足」不处理「超出」。已加超量缩放并补测试。
4. **给用户的启动脚本连错三次**：先用 `.ps1`（被 Restricted 策略拒绝），
   再在 `.cmd` 里写中文（GBK 误读切断命令），再因 `%~dp0..` 未规范化找不到构建产物。
   教训：交付给用户的 Windows 脚本，先在本机实际跑通再交付。
5. **读正式库时差点得出错误结论**：只复制 `atelier.db` 读到 5 个迁移、
   无 segments 表，一度以为迁移没执行；实际是迁移结果还在 WAL 里。
   教训：运行中的 SQLite 必须连 WAL/SHM 一起复制。

## 十二、新对话开场提示词（可直接粘贴）

```
你继续负责 Windows 桌面应用「Atelier 画师工坊」的开发与问题修复。

项目位置：D:\Atelier\project
先读 docs/HANDOFF-0.1.3-calendar-daily-log.md 了解上一轮完成的 P6.7
日历每日创作记录、跨模块联动与 0.1.3 发布情况。

当前状态：
- 版本 0.1.3，HEAD edf3145，工作区干净
- p6-baseline 指向 f50060e，p6.6-baseline 指向 271e2d1，两者都不得移动
- p6.7-baseline 尚未创建（用户已验收功能，如需打标签指向 edf3145）
- 数据库已有迁移 006（time_entry_segments 活跃片段明细表）
- 不进入 P7，只处理用户明确反馈的问题

不可变：AppId com.atelier.desktop、%APPDATA%\atelier 数据目录、schema/迁移、
备份恢复与 CSV 导出逻辑、已有 Git 历史。

数据安全：真实库禁止写入/恢复/迁移/删除；复现必须把 atelier.db
（连同 -wal / -shm）复制到临时目录，用 ATELIER_USER_DATA_DIR 指向临时 userData。

环境坑（详见交接文档第八节，本轮新增 5 条，务必看）：
- 启动前清除 ELECTRON_RUN_AS_NODE
- 项目目录内的 Electron 无法启动，用 scripts/electron-runtime.mjs 的自检
- dist 带 Low Integrity，实机验证用 %LOCALAPPDATA%\Atelier\release 的 Medium 副本
- 沙箱内 spawn 管道捕获会 EPERM，输出要重定向到文件
- 沙箱只能写项目目录，写 %LOCALAPPDATA% 会被拒
- 本机 PowerShell 是 Restricted 策略，给用户的脚本要用 .cmd 且纯 ASCII
- package-inno.mjs 在本机会因 pnpm.cmd 缺失失败，需手动 build → package:dir → ISCC
- 改中文源码用编辑工具，别用 PowerShell Set-Content
- 读运行中的数据库必须连 WAL/SHM 一起复制

当前交付包：
%LOCALAPPDATA%\Atelier\release\画师工坊-Setup-0.1.3.exe
125,972,621 bytes
SHA256 C5DDEE98B0C7C5D52A414009349D1A78C87A8ADFBEF8920C8E82BDD6EDAE31C9

请先执行 git status 确认干净，然后告诉我你要处理的问题（版本、复现步骤、
期望、实际、截图/错误文本、是否影响数据）。只做最小修复，不重构、不扩需求。
```
