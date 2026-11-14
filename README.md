# Atelier

面向独立画师的本地委托管理桌面软件（Windows）。数据只保存在本机，不上传云端。

> 当前进度：**P0 项目初始化 + P1.1 数据库 + P1.1.5 数据模型加固 + P1.2.1 委托列表 + P1.2.2 客户管理已完成并实际运行验证通过**。新建/编辑委托、详情与归档、搜索筛选尚未实现，界面中对应入口仍标注计划所属阶段。

## 一、技术栈

| 类别 | 选型 |
| --- | --- |
| 桌面框架 | Electron 44.7.0 |
| 界面 | React 19 + TypeScript 5.9 |
| 构建 | Vite 8 + electron-vite 6 |
| 样式 | Tailwind CSS 4 + shadcn/ui 风格组件 |
| 图标 | Lucide |
| 状态管理 | Zustand |
| 数据校验 | Zod |
| 数据存储 | SQLite（better-sqlite3 13.1.1，N-API 预编译二进制，无需本机编译） |
| 测试 | Vitest + Testing Library（jsdom） |

计划中的后续技术：FullCalendar（P3）、Playwright（P3 起）、electron-builder（P6）。**这些尚未安装**，避免提前引入未使用的依赖。

## 二、如何启动

### 最简单的方式（推荐）

双击项目根目录的 **`启动Atelier.cmd`**。

它会自动：找 Node.js → 找 pnpm → 首次运行时安装依赖 → 打开 Atelier 窗口。

### 命令行方式

```powershell
pnpm install      # 首次运行，安装依赖
pnpm dev          # 启动开发版窗口（带热更新）
```

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 启动开发版（热更新） |
| `pnpm build` | 构建生产版本到 `out/` |
| `pnpm start` | 预览已构建的生产版本 |
| `pnpm typecheck` | 检查 TypeScript 类型（主进程 + 渲染进程各一次） |
| `pnpm test` | 运行单元测试 |
| `pnpm smoke` | 启动自检：真正打开窗口，页面加载完成后自动退出 |

## 三、目录结构

```
project/
├─ 启动Atelier.cmd           双击启动
├─ package.json
├─ electron.vite.config.ts   三端构建配置（主进程 / 预加载 / 渲染进程）
├─ vitest.config.ts
├─ components.json           shadcn/ui 组件生成配置
├─ tsconfig.json             渲染进程 + 共享代码
├─ tsconfig.node.json        主进程 + 预加载 + 配置文件
├─ pnpm-workspace.yaml       pnpm 设置（扁平 node_modules、允许 electron 安装脚本）
├─ scripts/
│  ├─ start.ps1              启动器逻辑（双击入口会调用它）
│  ├─ electron-runtime.mjs   Electron 运行时自检与外部运行时选择
│  ├─ electron-vite.mjs      dev / preview 的启动包装器
│  ├─ smoke.mjs              启动自检脚本
│  └─ ensure-electron.mjs    postinstall：确保 Electron 二进制存在
└─ src/
   ├─ shared/                主进程与渲染进程共用的契约
   │  ├─ channels.ts         IPC 通道名唯一来源
   │  ├─ contracts.ts        Zod 输入/输出契约（每个通道一份）
   │  ├─ domain.ts           领域模型与输入校验（客户、委托、金额、时间）
   │  ├─ errors.ts           可回传渲染进程的业务错误
   │  └─ api.ts              渲染进程可用的 API 类型
   ├─ main/                  主进程（唯一能访问系统与数据库的地方）
   │  ├─ index.ts            应用生命周期、单实例锁、会话加固、数据库初始化
   │  ├─ window.ts           主窗口与安全基线
   │  ├─ window-size.ts      按屏幕可用区域计算窗口尺寸
   │  ├─ security.ts         来源校验、导航/新窗口拦截
   │  ├─ app-info.ts         运行时信息组装
   │  ├─ db/                 数据库层（只被主进程使用）
   │  │  ├─ database.ts      打开连接与 PRAGMA 设置
   │  │  ├─ migrations.ts    迁移清单（SQL）
   │  │  ├─ migrator.ts      执行迁移、事务回滚、幂等保证
   │  │  ├─ service.ts       数据库服务装配（连接 + 迁移 + 仓储）
   │  │  └─ repositories/    客户、委托的读写（clients.ts / commissions.ts）
   │  └─ ipc/
   │     ├─ handlers.ts      业务处理器（校验输入输出）
   │     └─ register.ts      注册到 ipcMain + 来源校验 + 错误隔离
   ├─ preload/
   │  └─ index.ts            contextBridge 白名单桥接
   └─ renderer/              界面
      ├─ index.html
      └─ src/
         ├─ App.tsx          应用外壳与页面切换
         ├─ config/          导航配置（含各页面所属阶段）
         ├─ components/
         │  ├─ layout/       侧边栏、顶栏、外壳（支持阅读宽 / 全宽两种布局）
         │  ├─ theme/        深浅色切换
         │  └─ ui/           shadcn 风格基础组件（Input/Textarea/Label/Sheet/Switch/ConfirmDialog/Skeleton）
         ├─ data/            IPC 数据读取 hook 与客户写操作
         ├─ pages/
         │  ├─ commissions/  委托/客户页签、列表、行、空状态、客户面板
         │  ├─ dashboard-page.tsx
         │  └─ coming-soon-page.tsx
         ├─ stores/          Zustand 状态（主题、当前页面、委托页界面状态）
         └─ lib/             格式化、委托查询、IPC 错误还原、主题应用、IPC 客户端
```

## 四、安全架构

1. **进程隔离**：`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`。渲染进程拿不到 Node.js、文件系统或 `require`。
2. **受控 IPC**：渲染进程只能调用 preload 通过 `contextBridge` 暴露的具名方法（目前只有 `getAppInfo`），不能自行指定通道名或监听主进程事件。
3. **契约校验**：每个通道在 `src/shared/contracts.ts` 中声明输入/输出 Zod schema，主进程在边界处校验，错误数据不会流到界面。
4. **来源校验**：IPC 调用会检查发起方 frame 的地址，只接受本应用界面（开发时为 Vite 服务器 origin，打包后为本地 `file://`）。
5. **窗口加固**：禁止打开新窗口、禁止导航到外部地址、禁止挂载 `webview`、拒绝一切权限申请（摄像头、通知等）。
6. **错误隔离**：处理器异常只在主进程记录完整信息，回给渲染进程的是稳定错误信息，不泄露内部细节。
7. **CSP**：生产构建自动注入严格 Content-Security-Policy（`script-src 'self'` 等）。

开发模式下不注入 CSP，因为 Vite 需要内联脚本与 WebSocket；这是开发环境的已知取舍。

## 五、主题与窗口

- 默认深色，可在右上角切换到浅色；已实际点击验证两种主题都正常。
- 颜色令牌定义在 `src/renderer/src/index.css`，使用 oklch 保证感知均匀；强调色为低饱和蓝紫色，状态色用柔和绿/黄/红。
- 主题偏好暂存于 `localStorage`；P1 建立 `app_settings` 表后会改为由主进程持久化。
- 窗口尺寸按主显示器可用区域自动计算：大屏用 1280×840，小屏（如 1366×768 笔记本）自动缩小，避免内容显示不全。

## 六、数据库（P1.1 / P1.1.5）

### 存储位置

- **正式运行**：`%APPDATA%\atelier\atelier.db`（Electron 的用户数据目录，**不在项目源码目录**）。
- **自动化测试**：通过环境变量 `ATELIER_USER_DATA_DIR` 指向临时目录，不会碰真实数据。

WAL 模式下同目录还会出现 `atelier.db-wal`、`atelier.db-shm`，这是 SQLite 的正常伴生文件。

### 表结构

**clients（客户）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT 主键 | UUID |
| name | TEXT NOT NULL | 客户名，非空 |
| contact / note | TEXT | 联系方式、备注 |
| created_at / updated_at | TEXT NOT NULL | UTC ISO 8601 |
| archived_at | TEXT | 归档时间，NULL 表示未归档 |

**commissions（委托）**

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT 主键 | UUID |
| client_id | TEXT NOT NULL → clients(id) | 外键，`ON DELETE RESTRICT` |
| title / description / type | TEXT | 标题、需求说明、委托类型 |
| status | TEXT | `draft` / `active` / `completed` / `cancelled` |
| priority | INTEGER | 1（最高）– 5（最低） |
| deadline_kind | TEXT | `none` / `date` / `datetime` |
| deadline_date | TEXT | 仅 date 型使用，`YYYY-MM-DD` |
| deadline_at | TEXT | 仅 datetime 型使用，UTC ISO |
| deadline_timezone | TEXT | 仅 datetime 型使用，创建时的 IANA 时区 |
| quote_amount_cents | INTEGER | **可空**：NULL 未报价，0 免费，>0 报价 |
| paid_amount_cents | INTEGER NOT NULL | 已收金额（整数分） |
| payment_status | TEXT | 由金额推导：`unquoted` / `not_required` / `unpaid` / `partial` / `paid` |
| created_at / updated_at | TEXT NOT NULL | UTC ISO 8601 |
| archived_at | TEXT | 归档时间 |

**schema_migrations（迁移记录）**：`id`、`name`、`applied_at`。

数据库层用 CHECK 约束兜底：日期形状与真实日历合法性、截止时间三态互斥、金额为整数且非负、金额与付款状态自洽（等价于禁止超额收款）。

### 截止时间的三种形态

| 形态 | 存储 | 显示 | 用途 |
| --- | --- | --- | --- |
| none | 三个截止字段全为 NULL | “未设置” | 还没约定交稿时间 |
| date | 只存 `YYYY-MM-DD`，**不存时区** | 原样显示，**绝不做时区换算** | “某月某日前交稿” |
| datetime | UTC 瞬间 + 创建时 IANA 时区 | 默认按**创建时区**显示，不随系统时区漂移 | “某日 18:00 交稿” |

- 日期型不把 23:59 写入数据库；排期需要“当天结束”时按基准时区实时计算。
- 日期型的逾期基准是**当前系统本地日期**（`today > deadline_date` 即逾期）；P6 引入“工作时区”设置后改为按工作时区判断。
- 时刻型的时区换算只允许在 `src/shared/time.ts` 里实现，并处理夏令时：不存在的时间（春季跳变）拒绝，重复的时间（秋季回拨）取较早的一次。

### 金额与付款状态

| quote_amount_cents | 含义 | 允许收款 | 派生状态 |
| --- | --- | --- | --- |
| NULL | 未报价 | 否 | `unquoted` |
| 0 | 免费委托 | 否 | `not_required` |
| > 0 | 正常报价 | 0 ≤ 已收 ≤ 报价 | `unpaid` / `partial` / `paid` |

规则：

- 付款状态**只由金额推导**，输入契约里没有 `paymentStatus`，渲染进程提交该字段会被 `.strict()` 拒绝；
- 超额收款拒绝（错误码 `OVERPAY`）；报价降到已收金额以下拒绝（`QUOTE_BELOW_PAID`）；未报价/免费委托登记收款拒绝（`PAYMENT_REQUIRES_QUOTE`）；
- 输出附带两个派生字段（不入库）：`outstandingCents`（未收金额）与 `isSettled`（是否已结清）；
- 列表可用 `paymentStatus` 过滤；`completed` 允许尚有尾款，**未结清**即 `paymentStatus ∈ {unpaid, partial}`。

### 迁移机制

迁移写在 `src/main/db/migrations.ts`，按 id 递增排列。每次启动 `applyMigrations()` 会：

1. 确保 `schema_migrations` 表存在；
2. 只执行尚未记录的迁移，且全部放在**同一个事务**里，任一失败整体回滚；
3. 重复启动幂等，不会重复建表；
4. 迁移清单本身会被校验（id 唯一、递增、必须有 SQL 或执行函数）。

现有迁移：

- `001-initial`：clients / commissions 基础表；
- `002-deadline-and-payment`：重建 commissions（截止时间三态、金额可空、付款状态五态），并回填旧数据：
  - 旧的 `quote_amount_cents = 0` 一律视为**未报价**（旧默认 0 只代表“没填”，不代表免费）；
  - 旧的截止时间一律迁移为 `datetime`，时区取迁移执行时的系统时区（旧表未存时区，只能近似）；
  - 旧状态按金额重新推导，忽略原值。

表重建走标准流程（建新表 → 复制 → 删旧表 → 改名 → 重建索引 → 主动执行 `PRAGMA foreign_key_check`），全程在迁移事务内；外键违规会让整个迁移回滚。`PRAGMA foreign_key_check` 只返回结果、不会自动抛错，因此 `src/main/db/integrity.ts` 会主动检查并抛错。

内置行为：主进程在启动时用 try/catch 包住数据库初始化，打不开或迁移失败会弹出错误提示并退出，不会带着坏连接继续运行。

### 数据访问链路

```
渲染进程 → window.atelier（preload 白名单）→ IPC → Zod 校验 → 仓储 → SQLite
```

- 渲染进程**没有任何 SQLite 句柄**，也没有 `require`；
- 共 10 个受控通道：`clients:create|list|get|update|archive`、`commissions:create|list|get|update|archive`；
- 每个通道都有输入与输出的 Zod 契约，脏数据不会越过进程边界；
- 业务错误（“客户不存在”“超额收款”等）回传可读信息，其他异常只记在主进程日志；
- 归档 = 写 `archived_at` 软删除，不物理删除；有委托的客户被外键 `RESTRICT` 阻止删除。

### 时间与金额约定

- 时间统一存 **UTC ISO 8601**（形如 `2026-11-14T05:07:27.533Z`）；
- 时刻型截止按创建时区显示；日期型截止是纯日历日期，永不换算；
- 金额一律 **整数分**，数据库用 `typeof(...) = 'integer'` 约束，Zod 同时拒绝小数与负数。

## 七、Electron 运行时问题与处理（重要）

**现象**：在这台电脑的 `D:\Atelier\project` 目录下直接运行 Electron 二进制时，进程会在启动瞬间崩溃（退出码 `0x80000003`）。同一份文件复制到工作区之外的普通目录则完全正常，与项目代码无关。

排查结论：不是 Electron 版本、不是代码、不是显卡驱动，也不是数字签名——官方安装包 SHA256 校验一致，Electron 44、45 都会崩；通过目录联接、修改权限、清空环境变量都无法解决，判断与该目录在此环境中被特殊挂载/重定向有关。

**处理方式**（已自动化，无需手动操作）：
`scripts/electron-runtime.mjs` 在每次 `pnpm dev` / `pnpm start` / `pnpm smoke` 前做自检：
1. 先尝试直接用 `node_modules` 里的 Electron；
2. 启动失败时，把 Electron 复制到工作区之外的 `D:\Atelier\atelier-electron-runtime`，通过官方支持的 `ELECTRON_EXEC_PATH` / `ELECTRON_OVERRIDE_DIST_PATH` 指向它。

换到正常的电脑上，第 1 步就会成功，不会产生任何额外副本，也不会改变项目行为。该外部目录约 360 MB，删除后下次启动会自动重建。

## 八、已执行的验证

| 项目 | 结果 |
| --- | --- |
| `pnpm typecheck`（主进程 + 渲染进程） | ✅ 0 错误 |
| `pnpm test` | ✅ 23 个测试文件、162 个测试全部通过 |
| `pnpm build` | ✅ 成功；产物含严格 CSP 与编译后的 Tailwind 样式 |
| `pnpm smoke`（真实启动） | ✅ `SMOKE_OK`；真实数据库已处于 002（本次应用 0 个、已存在 2 个） |
| 真实库结构核对 | ✅ 列、可空性、5 个索引、外键 `ON DELETE RESTRICT`、外键自检 0 违规 |
| P1.1.5 端到端（临时库）：写入 → 关闭 → 重启 → 读回 | ✅ 未报价 / 免费 / 部分付款、三态截止时间、派生字段全部原样保留 |
| P1.2.1 列表真实渲染（临时库 5 条数据） | ✅ 名称/客户/状态/三态截止/五种付款状态/逾期标记全部正确 |
| P1.2.2 客户页签真实渲染（临时库 3 个客户） | ✅ 默认隐藏归档客户（共 2 个）；打开开关后显示「已归档」标记 |
| P1.2.2 运行时归档 / 取消归档 | ✅ 归档后默认列表不可见 → 取消归档后恢复可见，`archivedAt` 正确清空 |
| 客户面板 | ✅ 420px 右侧停靠面板，字段预填、归档入口、保存按钮齐全 |
| 未保存修改关闭面板 | ✅ 先弹确认；「继续编辑」保持打开，「放弃修改」才关闭且不写库 |
| 列表空状态、骨架、错误重试 | ✅ 单元测试覆盖；错误展示 IPC 原文并可重试成功 |

测试覆盖：迁移机制、客户与委托仓储、客户归档/取消归档、金额与付款状态矩阵、截止时间三态、时区与 DST、严格输入契约、持久化、IPC 契约与处理器、主进程启动流程、金额与日期格式化、五种付款状态展示、委托查询、列表页四种渲染状态、客户页签（列表/开关/新建/归档/取消归档/未保存确认）。

## 九、已知限制

1. **还不能在界面上新建或编辑委托**（P1.2.3）；委托列表目前是只读的。
2. 真实数据目录里的库仍无业务数据；所有界面验证使用临时数据目录，未污染真实库。
3. 搜索框、筛选器与排序切换的界面在 P1.2.5 接入；查询模块已就绪，当前只使用默认排序。
4. 日期型截止的逾期基准是“当前系统本地日期”，跨时区旅行时边界可能有一天的差异；P6 引入工作时区后固定基准。
5. 时刻型截止在创建时会记录作者时区；旧数据（002 之前）没有时区，只能按迁移时系统时区近似。
6. 第一版不支持多次收款流水、退款与超额收款。
7. 依赖缓存目录 `.pnpm-store/`、`.electron-cache/` 位于项目内（已加入 `.gitignore`），可安全删除。
8. GitHub 直连不通，依赖与 Electron 二进制使用国内镜像。
9. 系统未安装全局 Node.js 时，启动器会回退使用 DSH 自带的运行时；长期建议自行安装 Node.js LTS。
10. 尚未引入路由库：页面切换用 Zustand 状态实现。

## 十、委托管理界面（P1.2.1 / P1.2.2）

**委托页签（P1.2.1）**

- 列表四列：委托（名称为主、客户名为次）、状态、截止、付款。
- 金额统一 `¥1,200.00`；五种付款状态用不同文字标签与颜色区分。
- 日期型截止原样显示、时刻型按创建时区显示，逾期加「逾期」标记。
- 加载骨架、IPC 错误（可重试）、空库、筛选无结果四种状态分别呈现。

**客户页签（P1.2.2）**

- 「委托 / 客户」页签，状态保存在 store。
- 客户列表显示名称与联系方式，归档客户默认隐藏，可打开「显示已归档」查看并带「已归档」标记。
- 新建 / 编辑客户走右侧 420px 面板；字段：名称（必填）、联系方式、备注。
- 归档 / 取消归档都在面板内操作，且需要二次确认。
- 关闭面板前若有未保存修改，先弹出「放弃修改」确认；Esc、遮罩、关闭按钮都走同一路径。
- 已归档客户仍用于历史委托的名称解析，但从后续委托表单的客户下拉中消失。
- 两个页签的滚动位置分别保存在页面级 store，切换后恢复。

## 十一、下一阶段建议（P1.2.3）

新建与编辑委托：

1. 420px 右侧表单（客户下拉来自真实客户数据，过滤掉已归档客户）；
2. 三态报价：未报价 / 免费 / 金额（元 ↔ 分转换）；
3. 三态截止时间：无 / 仅日期 / 日期 + 时刻（时刻型记录创建时区）；
4. 提交后列表即时更新；服务端错误映射到字段；
5. 未保存关闭仍需确认（复用 P1.2.2 的确认逻辑）。

**按约定，未获确认前不会开始 P1.2.3。**
