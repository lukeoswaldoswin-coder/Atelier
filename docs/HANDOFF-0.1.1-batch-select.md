# 交接归档：0.1.1（P6.5 工时记录批量选择）（2026-11-15）

> 用途：把本轮的工作、决策、验证证据和交付物完整交给新对话，避免重复调查。
> 新对话可直接读本文件，再按「十二、新对话开场提示词」继续。

## 一、项目与环境

| 项 | 值 |
|---|---|
| 项目目录 | `D:\Atelier\project` |
| 技术栈 | Electron 44.7 + React 19 + TypeScript + better-sqlite3 |
| 版本 | **0.1.1**（未进入 P7） |
| 当前 HEAD | `975bb43` 发布: 版本号升级到 0.1.1 |
| P6 基线 | 注解标签 `p6-baseline` → `f50060e`（**未移动**） |
| 标签总数 | 13 个（本轮未新建） |
| 工作区 | 干净 |

构建命令（`pnpm` 不在 PATH 时用 DSH 自带 node/pnpm）：

```
node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json
node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node_modules/vitest/vitest.mjs run <路径>
node_modules/electron-vite/bin/electron-vite.js build
node_modules/electron-builder/cli.js --win --dir
# 安装包（注意：package-inno.mjs 在本环境会因 pnpm.cmd 缺失失败，见八.7）
"C:\Program Files\Inno Setup 7\ISCC.exe" /DAppVersion=0.1.1 build\atelier.iss
```

## 二、不可变约束（非用户明确批准不得改）

- 中文名：画师工坊；完整展示：Atelier 画师工坊
- AppId：`com.atelier.desktop`；Inno AppId：`{7C0D2B9E-4A3F-4E8A-9C61-2D5B8F1A6E30}`
- 数据目录：`%APPDATA%\atelier`；数据库 `%APPDATA%\atelier\atelier.db`
- IPC 通道、数据库 schema、迁移记录
- 备份 / 恢复 / CSV 导出逻辑
- 已有 Git 历史与 `p6-baseline` 标签

## 三、本轮做了什么（P6.5 + P6.5.1 + 发布）

用户验收通过的三个增量，均为**工时记录页**的批量选择体验：

### 3.1 P6.5：批量选择（commit `3f0e3c7`）

1. **一键全选未分配**：按钮置于日期范围右侧、实际工时统计左侧。
2. **拖拽矩形框选**：Pointer Events 原生实现，无新依赖。

关键实现（`src/renderer/src/pages/time/time-page.tsx`）：

- 复用原有 `selected: Set<string>`，未引入第二套选择状态
- `MARQUEE_THRESHOLD_PX = 4`：小于该值视为普通点击，不改选择
- `boxFromPoints()` / `intersects()`：矩形与行 `getBoundingClientRect()` 相交判定
- 拖动期间在 `window` 上监听 `pointermove` / `pointerup` / `pointercancel` / `blur`，
  并在 `pointermove` 里用 `event.buttons === 0` 兜底（鼠标在窗口外松开时收不到 up）
- 行上打 `data-entry-id` / `data-assigned`，框选只收 `assigned=false`
- `useEffect` 在 `entries.rows` 变化时丢弃已不在当前结果里的选择（切日期/筛选后不残留）

### 3.2 P6.5.1：三项体验修订（commit `f4b5a61`）

1. **文字区域无法起手框选**
   - 根因：`select-none` 原本只在 `dragging === true` 时应用，而它是 React state，
     异步渲染；`pointerdown` 后浏览器已抢先启动文本选择。
   - 修复：列表容器**常驻** `select-none`（仅 `[data-testid="time-list"]` 内），
     配合 `event.preventDefault()`。不影响其他页面文字选择。
2. **全选按钮改全选/取消切换**
   - 新增 `allUnassignedSelected`：当前查询范围内未分配记录是否**全部**选中
   - 状态 A「全选未分配」→ 选中全部未分配
   - 状态 B「取消全选」→ `setSelected(new Set())` 清空**全部**（含手动勾选的已归属），
     不留残余；这是用户明确要求的行为
   - 无未分配记录时禁用
3. **按钮视觉强化**
   - 去掉 `variant="outline"`，用默认 primary 样式 + `size="default"`
   - 实测背景 `oklch(0.66 0.13 277)`、文字 `oklch(0.16 0.01 286)`、高度 36px
     （对比「合并」按钮 32px），均取自现有主题变量，未引入新颜色

### 3.3 发布 0.1.1（commit `975bb43`）

| 文件 | 改动 |
|---|---|
| `package.json` | version `0.1.0` → `0.1.1`（`app.getVersion()` 自动读取，界面同步） |
| `build/atelier.iss` | 默认 `AppVersion` → `0.1.1`，产物名 `画师工坊-Setup-0.1.1` |
| `画师工坊-使用教程与功能说明.txt` | 教程内版本号与安装包名同步 |

## 四、验证证据

### 4.1 自动化

- `tsc --noEmit`（node + web）均通过
- `time-page.test.tsx`：**27 条全通过**（原 16 + P6.5.1 新增 11）
- 相关回归：`src/renderer/src/pages/time` + `src/main/ipc` + `src/shared` = **132 条全通过**

### 4.2 实机验证（CDP 真实鼠标事件，非 jsdom 模拟）

方式：Medium 副本 + `ATELIER_USER_DATA_DIR` 临时 userData + `--remote-debugging-port=9222`
+ `Input.dispatchMouseEvent` 派发真实鼠标事件。截图存 `docs/verify-p6.5/`。

**P6.5 结果**：全选 5 条未分配、已归属勾选 0；框选实时勾选 3 条；复选框/归属/删除起手均不启动框选；
列表外松开正常收尾；切筛选后按钮状态正确。

**P6.5.1 关键证据** —— 从文字起手拖拽时 `window.getSelection()` 返回**空字符串**：

| 起点 | 文字 | 框选 | 浏览器选中文字 |
|---|---|---|---|
| 时间文字 | `09:59 – 09:59` | ✅ | `""` |
| 工时长度 | `2 秒` | ✅ | `""` |
| 卡片普通文本 | `未分配` | ✅ | `""` |

按钮切换实测：`全选未分配` → 点一次 `取消全选`(5条) → 手动勾已归属(6条，仍显示取消全选)
→ 点击清空全部(0条) → 手动勾1条又回 `全选未分配`。

**框选视觉像素级验证**：矩形 755×157 px，边框 RGB `(83,90,145)`（主题 primary 紫调），
内部 `(28,30,44)` vs 底色 `(10,10,12)`，确认为半透明叠加。

### 4.3 安装包验证

- 临时目录静默安装 → 退出码 0 → 启动 → UA `atelier/0.1.1` → 按钮切换与文字框选正常 → 卸载成功
- 安装版实测：6 条记录、按钮切换、时间文字拖拽出矩形且 `getSelection()` 为空

### 4.4 数据安全

- 所有测试用临时 userData 副本；操作前后逐字段对比临时库与真实库：**12 条、差异 0**
- 真实库 `atelier.db` 135,168 bytes，mtime 全程保持 `2026-11-15 11:22:36` 未变
- 升级前备份：`%APPDATA%\atelier\atelier.db.bak-before-0.1.1-2026-11-15T12-10-49`（135,168 bytes）

## 五、交付物

**安装包**
```
%LOCALAPPDATA%\Atelier\release\画师工坊-Setup-0.1.1.exe
125,963,717 bytes
SHA256: AE1A39D35EA31DCD1A4F022770D12D1E7218FD547D7D620F921C869E5E2B33FD
完整性: Medium（无 Low Mandatory Level 标签）
未签名：SmartScreen 会提示
```

**用户设备已安装版本**
```
C:\Users\11415\AppData\Local\Programs\Atelier\
Atelier.exe 版本 0.1.1
```
桌面 + 开始菜单「画师工坊」快捷方式均指向该路径。

## 六、Git 提交记录（本轮）

```
975bb43 发布: 版本号升级到 0.1.1
f4b5a61 体验: 框选支持文字起手，全选按钮改为全选/取消全选并强化视觉
b0a45be 文档: 补充 P6.5 批量选择的实机验证证据
3f0e3c7 功能: 工时记录支持一键全选未分配与拖拽框选
93fe022 文档: 归档 0.1.0 正式版问题修复的交接说明   ← 本轮起点
```

`p6-baseline` 仍是 `f50060e`，历史未改写、未 amend，未新建 baseline 标签。

## 七、本轮改动文件清单

```
src/renderer/src/pages/time/time-page.tsx        框选 + 全选切换 + 按钮样式（+329/-76 区域）
src/renderer/src/pages/time/time-page.test.tsx   新增 11 条用例（共 27 条）
build/atelier.iss                                默认 AppVersion → 0.1.1
package.json                                     version → 0.1.1
画师工坊-使用教程与功能说明.txt                    版本号与安装包名同步
docs/verify-p6.5/**                              实机验证证据（7+6 张截图 + 说明）
```

未触碰：数据库 schema/迁移、IPC、数据模型、批量归属/合并业务逻辑、备份/恢复/CSV/安装逻辑。

## 八、环境坑（务必记住，本轮新增 3 条）

1. 启动打包后的 Electron 前必须清除 `ELECTRON_RUN_AS_NODE`，否则静默退出且退出码 0。
2. `D:\Atelier\project` 及 `dist` 带 Low Integrity：直接跑 `dist` 内安装包会报
   「无法创建临时目录 / 错误 5」。实机验证用 `%LOCALAPPDATA%\Atelier\release` 的 Medium 副本。
3. DSH 沙箱会拦 Electron 命名管道（`mojo platform_channel` 0x5），沙箱内无法启动 GUI。
4. 所有测试必须用 `ATELIER_USER_DATA_DIR` 指向临时 userData；真实库只读。
5. 安装测试加 `/NOCLOSEAPPLICATIONS`，避免 Inno 的 Restart Manager 关掉用户运行中的实例。
6. **（新）`node_modules` 里没有 `ws`/`playwright`**，但 Node 24 自带全局 `WebSocket`，
   可直接连 CDP 做真实鼠标验证，无需新依赖。
7. **（新）`scripts/package-inno.mjs` 在本环境会失败**：它内部 `spawnSync('pnpm.cmd')`
   报 `EINVAL`（pnpm.cmd 不在 PATH）。绕法：手动依次跑
   `electron-vite build` → `electron-builder --win --dir` → `ISCC.exe /DAppVersion=X build\atelier.iss`，
   再手动复制到 release 目录并校验 SHA256 / 完整性标签。
8. **（新）PowerShell `Set-Content` 会破坏 UTF-8 中文**（本轮曾把测试文件写成乱码）。
   改含中文的源码/测试必须用编辑工具，或 `[System.IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false))`。
   `.ps1` 含中文必须带 **UTF-8 BOM**，`.cmd` 必须用 **CRLF**，否则 PowerShell 5.1 / cmd.exe 解析失败。

## 九、已安装版本的一个坑（本轮踩过，已解决）

旧 0.1.0 曾装在 `D:\Atelier\Atelier\Atelier`（非默认目录）。新安装包因
`UsePreviousAppDir=yes` 但读不到旧路径，装到了默认的 `%LOCALAPPDATA%\Programs\Atelier`，
造成**旧副本残留 443.5 MB**。

处理经过：跑旧 `unins000.exe` 清残留 → 但两个安装共用同一 Inno AppId，
旧卸载程序把**共享的注册表键和快捷方式一起删了** → 重装 0.1.1 恢复。

**教训**：同一 AppId 存在两份安装时，卸载其中一份会连带清掉另一份的注册表与快捷方式，
卸载后必须重装/修复一次。

## 十、当前边界 / 已知非阻塞问题

- 框选拖到列表边缘**不自动滚屏**，长列表需分段框选（未要求）。
- 工时记录列表内文字不再可选中（这是修复文字冲突的代价，用户已确认接受）；
  列表外文字选择不受影响。
- 自动监测默认关闭，需在设置里手动开启；默认空闲阈值 3 分钟。
- 自动监测仅作参考，不保证等同真实绘画时间。
- 排期建议不使用每日容量、工作日、任务依赖。
- 安装包未签名，SmartScreen 会提示。
- 不提供云同步 / 自动更新 / CSV 导入。

## 十一、遗留 / 待确认

1. 用户朋友那边尚未验证 0.1.1 覆盖安装（数据应自动保留，但未实测）。
2. `%LOCALAPPDATA%\Atelier\P6.5.1-测试版` 与 `P6.5.1-测试数据` 两个目录仍留在用户机器上，
   供用户自行复测；确认无用后可删除（不影响已安装正式版）。
3. 若后续要正式发布，建议补一次「已装 0.1.0 的机器直接装 0.1.1」的干净升级验证。

## 十二、新对话开场提示词（可直接粘贴）

```
你继续负责 Windows 桌面应用「Atelier 画师工坊」的开发与问题修复。

项目位置：D:\Atelier\project
先读 docs/HANDOFF-0.1.1-batch-select.md 了解上一轮已完成的 P6.5 批量选择、
P6.5.1 体验修订与 0.1.1 发布情况。

当前状态：
- 版本 0.1.1，HEAD 975bb43，工作区干净
- p6-baseline 标签指向 f50060e，不得移动
- 不进入 P7，只处理用户明确反馈的问题

不可变：AppId com.atelier.desktop、%APPDATA%\atelier 数据目录、schema/迁移、
备份恢复与 CSV 导出逻辑、已有 Git 历史。

数据安全：真实库禁止写入/恢复/迁移/删除；复现必须把 atelier.db 复制到临时目录，
用 ATELIER_USER_DATA_DIR 指向临时 userData。

环境坑（详见交接文档第八节）：
- 启动前清除 ELECTRON_RUN_AS_NODE
- dist 带 Low Integrity，实机验证用 %LOCALAPPDATA%\Atelier\release 的 Medium 副本
- 沙箱内无法启动 Electron（命名管道被拦），需 danger-full-access
- package-inno.mjs 在本机会因 pnpm.cmd 缺失失败，需手动 build → package:dir → ISCC
- 改中文源码用编辑工具，别用 PowerShell Set-Content

当前交付包：
%LOCALAPPDATA%\Atelier\release\画师工坊-Setup-0.1.1.exe
125,963,717 bytes
SHA256 AE1A39D35EA31DCD1A4F022770D12D1E7218FD547D7D620F921C869E5E2B33FD

请先执行 git status 确认干净，然后告诉我你要处理的问题（版本、复现步骤、
期望、实际、截图/错误文本、是否影响数据）。只做最小修复，不重构、不扩需求。
```
