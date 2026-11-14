# Atelier

面向独立画师的本地委托管理桌面软件（Windows）。数据只保存在本机，不上传云端。

> 当前进度：**P0 项目初始化已完成并实际运行验证通过**。委托、工作流、任务、日历、工时与排期尚未实现，界面中对应页面会明确标注计划所属阶段。

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
| 测试 | Vitest + Testing Library（jsdom） |

计划中的后续技术：better-sqlite3（P1）、FullCalendar（P3）、Playwright（P3 起）、electron-builder（P6）。**这些尚未安装**，避免提前引入未使用的依赖。

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
   │  ├─ contracts.ts        Zod 输入/输出契约
   │  └─ api.ts              渲染进程可用的 API 类型
   ├─ main/                  主进程（唯一能访问系统与数据库的地方）
   │  ├─ index.ts            应用生命周期、单实例锁、会话加固
   │  ├─ window.ts           主窗口与安全基线
   │  ├─ window-size.ts      按屏幕可用区域计算窗口尺寸
   │  ├─ security.ts         来源校验、导航/新窗口拦截
   │  ├─ app-info.ts         运行时信息组装
   │  └─ ipc/
   │     ├─ handlers.ts      业务处理器（可单元测试）
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

## 六、Electron 运行时问题与处理（重要）

**现象**：在这台电脑的 `D:\Atelier\project` 目录下直接运行 Electron 二进制时，进程会在启动瞬间崩溃（退出码 `0x80000003`）。同一份文件复制到工作区之外的普通目录则完全正常，与项目代码无关。

排查结论：不是 Electron 版本、不是代码、不是显卡驱动，也不是数字签名——官方安装包 SHA256 校验一致，Electron 44、45 都会崩；通过目录联接、修改权限、清空环境变量都无法解决，判断与该目录在此环境中被特殊挂载/重定向有关。

**处理方式**（已自动化，无需手动操作）：
`scripts/electron-runtime.mjs` 在每次 `pnpm dev` / `pnpm start` / `pnpm smoke` 前做自检：
1. 先尝试直接用 `node_modules` 里的 Electron；
2. 启动失败时，把 Electron 复制到工作区之外的 `D:\Atelier\atelier-electron-runtime`，通过官方支持的 `ELECTRON_EXEC_PATH` / `ELECTRON_OVERRIDE_DIST_PATH` 指向它。

换到正常的电脑上，第 1 步就会成功，不会产生任何额外副本，也不会改变项目行为。该外部目录约 360 MB，删除后下次启动会自动重建。

## 七、已执行的验证

| 项目 | 结果 |
| --- | --- |
| `pnpm typecheck`（主进程 + 渲染进程） | ✅ 0 错误 |
| `pnpm test` | ✅ 11 个测试文件、41 个测试全部通过 |
| `pnpm build` | ✅ 成功；产物含严格 CSP 与编译后的 Tailwind 样式 |
| `pnpm smoke`（真实启动） | ✅ `SMOKE_OK`：窗口创建、页面加载完成、正常退出 |
| `pnpm dev` 真实运行 | ✅ Electron 4 个进程正常运行，窗口标题 `Atelier` |
| 界面截图核对 | ✅ 侧边栏、概览页、运行环境信息（Electron 44.7.0 / Chromium 152 / Node 24.21）显示正确 |
| 主题切换 | ✅ 点击后浅色主题生效，按钮图标与提示文字同步更新 |

测试覆盖：IPC 通道与契约、处理器输入输出校验、来源校验与错误隔离、主进程启动流程（窗口安全参数、加载路径、权限拒绝）、窗口尺寸计算、主题状态与持久化、侧边栏导航、概览页真实数据渲染与失败提示。

## 八、已知限制

1. 依赖缓存目录 `.pnpm-store/`、`.electron-cache/` 位于项目内（已加入 `.gitignore`），可安全删除，删除后下次安装会重新下载。
2. GitHub 直连不通，依赖与 Electron 二进制使用国内镜像（`.npmrc` 与启动器中已配置）。
3. 系统未安装全局 Node.js 时，启动器会回退使用 DSH 自带的运行时；长期建议自行安装 Node.js LTS。
4. 尚未引入路由库：页面切换用 Zustand 状态实现，等页面变多、需要历史记录时再引入。

## 九、下一阶段建议（P1）

P1 内容：SQLite 数据库、迁移机制、委托与客户管理。

建议顺序：

1. 接入 better-sqlite3 并确认 Windows 原生模块编译环境。
2. 建立 `schema_migrations` 与第一批表（clients、commissions）。
3. 在主进程建立数据库服务，通过新增 IPC 通道暴露委托读写，渲染进程不直接接触数据库。
4. 把 `app_settings` 接入主题偏好，替换当前的 localStorage 方案。
5. 实现委托列表、新建/编辑、详情与归档。

**按约定，未获确认前不会开始 P1。**
