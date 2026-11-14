# Atelier

面向独立画师的本地委托管理桌面软件（Windows）。数据只保存在本机，不上传云端。

> 当前进度：**P0 项目初始化 + P1.1 数据库基础架构已完成并实际运行验证通过**。委托管理界面、工作流、任务、日历、工时与排期尚未实现，界面中对应页面会明确标注计划所属阶段。

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
         │  ├─ layout/       侧边栏、顶栏、外壳
         │  ├─ theme/        深浅色切换
         │  └─ ui/           shadcn 风格基础组件
         ├─ pages/           概览页、未实现页面占位
         ├─ stores/          Zustand 状态（主题、当前页面）
         └─ lib/             工具函数、主题应用、IPC 客户端
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

## 六、数据库（P1.1）

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
| contact | TEXT | 联系方式 |
| note | TEXT | 备注 |
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
| deadline_at | TEXT | 交稿时间，UTC |
| quote_amount_cents / paid_amount_cents | INTEGER | **金额以整数分存储**，有 CHECK 防止写入小数 |
| payment_status | TEXT | `unpaid` / `partial` / `paid` |
| created_at / updated_at | TEXT NOT NULL | UTC ISO 8601 |
| archived_at | TEXT | 归档时间 |

**schema_migrations（迁移记录）**：`id`、`name`、`applied_at`。

### 迁移机制

迁移写在 `src/main/db/migrations.ts`，按 id 递增排列。每次启动 `applyMigrations()` 会：

1. 确保 `schema_migrations` 表存在；
2. 只执行尚未记录的迁移，且全部放在**同一个事务**里，任一失败整体回滚；
3. 重复启动幂等，不会重复建表；
4. 迁移清单本身会被校验（id 唯一、递增、SQL 非空）。

内置行为：主进程在启动时用 try/catch 包住数据库初始化，打不开或迁移失败会弹出错误提示并退出，不会带着坏连接继续运行。

### 数据访问链路

```
渲染进程 → window.atelier（preload 白名单）→ IPC → Zod 校验 → 仓储 → SQLite
```

- 渲染进程**没有任何 SQLite 句柄**，也没有 `require`；
- 共 10 个受控通道：`clients:create|list|get|update|archive`、`commissions:create|list|get|update|archive`；
- 每个通道都有输入与输出的 Zod 契约，脏数据不会越过进程边界；
- 业务错误（如“客户不存在”“客户已归档”）回传可读信息，其他异常只记在主进程日志；
- 归档 = 写 `archived_at` 软删除，不物理删除；有委托的客户被外键 `RESTRICT` 阻止删除，历史记录不会断链。

### 时间与金额约定

- 时间统一存 **UTC ISO 8601**（形如 `2026-11-14T05:07:27.533Z`），界面展示时再转本地时区，避免时区错位；
- 金额一律 **整数分**：数据库用 `typeof(...) = 'integer'` 约束，Zod 同时拒绝小数与负数。

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
| `pnpm test` | ✅ 15 个测试文件、75 个测试全部通过 |
| `pnpm build` | ✅ 成功；产物含严格 CSP 与编译后的 Tailwind 样式 |
| `pnpm smoke`（真实启动） | ✅ `SMOKE_OK`：窗口创建、数据库初始化、页面加载、正常退出 |
| 真实应用端到端：IPC 写入 → 关闭 → 重启 → 读回 | ✅ 客户与委托数据完整，UUID / UTC 时间 / 整数分金额原样保留 |
| 数据库位置检查 | ✅ 真实路径 `%APPDATA%\atelier\atelier.db`；项目源码目录内无 `.db` 文件 |
| 非法输入（不存在的客户 ID） | ✅ 被 IPC 拒绝并返回可读错误，不写库 |
| 金额存储类型 | ✅ `typeof(quote_amount_cents) = 'integer'` |

测试覆盖：迁移机制（幂等、顺序校验、失败回滚）、客户与委托仓储（增删改查、归档、外键保护）、关闭重开后数据持久化、IPC 契约与处理器、主进程启动流程（含数据库初始化）。

## 九、已知限制

1. **P1.2 才做界面**：P1.1 只提供数据能力，界面上还看不到客户与委托；对应页面仍标注“计划在 P1 阶段实现”。
2. 真实数据目录里的库目前是空库（只完成了迁移），端到端测试使用的是临时目录，没有污染真实数据。
3. 依赖缓存目录 `.pnpm-store/`、`.electron-cache/` 位于项目内（已加入 `.gitignore`），可安全删除，删除后下次安装会重新下载。
4. GitHub 直连不通，依赖与 Electron 二进制使用国内镜像（`.npmrc` 与启动器中已配置）。
5. 系统未安装全局 Node.js 时，启动器会回退使用 DSH 自带的运行时；长期建议自行安装 Node.js LTS。
6. 尚未引入路由库：页面切换用 Zustand 状态实现，等页面变多、需要历史记录时再引入。

## 十、下一阶段建议（P1.2）

P1.2 内容：委托管理界面（不涉及工作流、日历、排期）。

1. 委托列表：按状态 / 客户筛选，显示交稿日期与金额，默认隐藏归档；
2. 新建与编辑委托：客户选择、标题、类型、优先级、交稿时间（本地时间 ↔ UTC 转换）、金额（元 ↔ 分转换）、付款状态；
3. 客户管理的最小闭环：新建客户、客户详情、归档；
4. 空状态与错误提示：直接展示 IPC 返回的可读错误（如“客户不存在”）；
5. 补充界面层测试。

**按约定，未获确认前不会开始 P1.2。**
