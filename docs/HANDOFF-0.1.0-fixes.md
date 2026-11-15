# 交接归档：0.1.0 正式版问题修复（2026-11-15）

> 用途：把本轮的排查结论、改动、验证证据和交付物完整交给新对话，避免重复调查。
> 新对话可直接读本文件，再按「十二、新对话开场提示词」继续。

## 一、项目与环境

| 项 | 值 |
|---|---|
| 项目目录 | `D:\Atelier\project` |
| 技术栈 | Electron 44.7 + React 19 + TypeScript + better-sqlite3 |
| 版本 | 0.1.0（未进入 P7） |
| 当前 HEAD | `c086b88` 修复: 自动监测识别优动漫 PAINT（CSP 中文版）的进程名 |
| P6 基线 | 注解标签 `p6-baseline` → `f50060e`（**未移动**） |
| 工作区 | 干净（本轮提交后 `git status` 无改动） |

构建命令（`pnpm` 不在 PATH 时用 DSH 自带 node/pnpm 调用）：

```
pnpm typecheck
pnpm test
pnpm build
pnpm package:dir
pnpm package:inno     # 约 3–4 分钟，产出 dist + %LOCALAPPDATA%\Atelier\release 交付副本
```

## 二、不可变约束（非用户明确批准不得改）

- 中文名：画师工坊；完整展示：Atelier 画师工坊
- AppId：`com.atelier.desktop`；package name：`atelier`
- 数据目录：`%APPDATA%\atelier`；数据库：`%APPDATA%\atelier\atelier.db`
- IPC 通道、数据库 schema、迁移记录
- 备份 / 恢复 / CSV 导出逻辑
- 已有 Git 历史与 `p6-baseline` 标签

## 三、用户反馈的两个问题

1. 工时自动检测疑似未工作，使用绘画软件时没有自动工时记录。
2. 软件没有最小化到后台的能力，关闭窗口后计时统计停止。

后续补充：用户实际使用的绘画软件是 **优动漫 PAINT**（Clip Studio Paint 中文版）。

## 四、根因与修复

### 4.1 CPS/优动漫 进程名不匹配（自动监测完全失效）

- 白名单原本是 `clipstudio.exe`（这是 CLIP STUDIO 管理程序）。
- 国际版 CSP 绘画主程序是 `ClipStudioPaint.exe`。
- 优动漫 PAINT 实测为 `C:\Program Files (x86)\Unicorn\UDMPaint\UDMPaintPRO.exe`（EX 版），另有标准版 `UDMPaint.exe`。
- 修复：`src/shared/activity-apps.ts`
  - 增加 `clipstudiopaint.exe`
  - 按 `^udmpaint[a-z0-9]*\.exe$` 前缀识别优动漫（兼容后续版本改名）
  - 设置页标签改为「Clip Studio Paint（含优动漫）」，appKey 仍为 `clipstudio`（统计口径不变）
- Commit：`219de96`、`c086b88`

### 4.2 空闲毫秒 32 位回绕（开机 49.7 天后恒判空闲）

- `GetLastInputInfo.dwTime` 是 32 位 tick，却与 64 位 `GetTickCount64()` 直接相减。
- 开机超过 49.7 天后差值变成约 49.7 天，监测一直认为用户空闲，从此不再累计。
- 修复：`src/main/activity/win32-probe.ts` 新增 `computeIdleMs()`，按 32 位无符号差值计算。
- Commit：`219de96`

### 4.3 关闭窗口 = 退出程序（计时中断）

- 原本 `window-all-closed → app.quit()`，且没有托盘，点 X 就退出。
- 修复：
  - 新增 `src/main/tray.ts`：托盘图标、菜单（显示主界面 / 退出）、首次收进托盘的气球提示
  - `src/main/index.ts`：关窗改为隐藏；`before-quit` / `win.on('session-end')` 放行真正退出；二次启动唤回已隐藏窗口；`will-quit` 销毁托盘
  - 图标不可用时回退为「关闭即退出」，避免窗口消失后找不到程序
  - `package.json` 增加 `build/icon.png` 到打包文件（托盘图标在 asar 内）
- Commit：`1607bf0`、`cd828ff`

## 五、验证证据

### 5.1 自动化

- `tsc --noEmit`（`tsconfig.node.json`、`tsconfig.json`）均通过
- 相关测试 22 条全部通过：
  - `src/shared/activity-apps.test.ts`（6）
  - `src/main/activity/win32-probe.test.ts`（4）
  - `src/main/activity/activity-monitor.test.ts`（12）
  - `src/main/bootstrap.test.ts`（托盘、关窗隐藏、退出放行、关机放行、托盘销毁）

### 5.2 实机（打包产物，临时 userData）

| 验证项 | 结果 |
|---|---|
| 应用启动 | 窗口标题 `Atelier 画师工坊` |
| 点 X 关窗 | 进程存活（`ALIVE_AFTER_CLOSE=True`）、窗口隐藏（`HANDLE=0`） |
| 二次启动 | 第二实例退出，已隐藏窗口被唤回 |
| 托盘日志 | `[atelier] 系统托盘已启用，关闭窗口后计时继续运行` |

### 5.3 端到端自动工时（优动漫进程名）

以 `UDMPaintPRO.exe` 为前台窗口（拷贝系统 GUI 程序作替身）运行打包产物，数据库中产生：

```
{"app_key":"clipstudio","source":"auto","status":"completed","elapsed_seconds":1}
```

只有 1 秒是因为 Atelier 窗口随后抢走前台；证明「探测 → 进程名识别 → 建自动记录」全链路可用。

### 5.4 覆盖安装测试（临时安装目录 + 临时 userData）

| 步骤 | 结果 |
|---|---|
| 首次静默安装 | 退出码 0，应用启动，关窗后仍存活 |
| 写入标记 `verify.marker` | 成功，5 个迁移 |
| 同目录覆盖安装 | 退出码 0，应用正常启动 |
| 覆盖后检查 | 标记保留、迁移 5 个、表 6 张（用户数据未受影响） |
| 卸载 | 退出码 0，userData 保留 |
| 真实 `%APPDATA%\atelier\atelier.db` | 修改时间未变，全程未触碰 |

## 六、交付安装包

- 路径：`%LOCALAPPDATA%\Atelier\release\画师工坊-Setup-0.1.0.exe`
- 大小：125,958,328 bytes
- SHA256：`95FE4E2EA922102BFB7C54620EC28446142927DB4F0299CD4D2776C7BE9C9FDD`
- 完整性：Medium（无 Low Mandatory Level 标签）
- 未签名：Windows SmartScreen 会提示；不提供云同步 / 自动更新 / CSV 导入

## 七、Git 提交记录（本轮）

```
c086b88 修复: 自动监测识别优动漫 PAINT（CSP 中文版）的进程名
cd828ff 修复: 关机/注销时放行窗口关闭，避免托盘常驻拦截系统关机
5af4719 文档: 补充关闭窗口收进托盘、后台继续计时的说明
1607bf0 修复: 关闭窗口收进系统托盘，计时在后台继续
219de96 修复: 自动监测改用 Clip Studio Paint 真实进程名，并修正空闲毫秒回绕换算
```

`p6-baseline` 仍是 `f50060e`，历史未改写、未 amend。

## 八、环境坑（务必记住）

1. 启动打包后的 Electron 前必须清除 `ELECTRON_RUN_AS_NODE`，否则静默退出且退出码 0。
2. `D:\Atelier\project` 及 `dist` 带 Low Integrity 标签：直接运行 `dist` 里的安装包会报「无法创建临时目录 / 错误 5」，Low IL 的 `Atelier.exe` 也无法创建 Chromium 缓存目录。
3. 实机验证要用 Medium 副本：
   - 安装包：`%LOCALAPPDATA%\Atelier\release\画师工坊-Setup-0.1.0.exe`
   - 未安装验证：把 `dist\win-unpacked` 复制到 `%LOCALAPPDATA%` 下再运行
4. DSH 沙箱会拦 Electron 的命名管道（`mojo platform_channel` 0x5），沙箱内无法启动 GUI；需要 danger-full-access。
5. 所有测试必须用 `ATELIER_USER_DATA_DIR` 指向临时 userData；真实库 `%APPDATA%\atelier` 只读、禁止写入/恢复/迁移/删除。
6. 安装测试加 `/NOCLOSEAPPLICATIONS`，避免 Inno 的 Restart Manager 关掉用户正在运行的实例。

## 九、当前边界 / 已知非阻塞问题

- 从旧版升级时，开始菜单文件夹名可能仍显示旧 Atelier（外观问题）。
- 0.1.1 只验证过安装器升级流程，应用载荷仍是 0.1.0。
- 自动监测默认关闭，需在设置里手动开启；默认空闲阈值 3 分钟，数位笔输入可能不被系统识别为空闲，可在设置里关闭「空闲检测」。
- 自动监测仅作为参考，不保证等同真实绘画时间。
- 排期建议不使用每日容量、工作日、任务依赖。

## 十、本轮遗留 / 待确认

1. 优动漫 PAINT 的自动记录只在替身进程上做过端到端验证，用户装新包后需实际画几分钟确认。
2. 建议新对话先向用户确认：安装新包后是否出现「未分配」自动记录；若仍无记录，需要「设置页当前前台」显示情况与停止时机。
3. 未做安装器覆盖用户现有实例的测试（机器上有一个运行中的 Atelier 实例，避免打扰）。

## 十一、本轮改动文件清单

```
src/shared/activity-apps.ts              进程名白名单 + 优动漫前缀识别
src/shared/activity-apps.test.ts         新增：进程名识别测试
src/main/activity/win32-probe.ts         空闲毫秒 32 位回绕换算
src/main/activity/win32-probe.test.ts    新增：回绕换算测试
src/main/activity/activity-monitor.test.ts  新增：CSP 进程名用例
src/main/tray.ts                         新增：系统托盘
src/main/index.ts                        关窗隐藏、退出放行、二次启动唤回、托盘生命周期
src/main/bootstrap.test.ts               托盘/关窗/退出/关机放行断言
package.json                             打包包含 build/icon.png
画师工坊-使用教程与功能说明.txt           托盘说明、支持软件补充优动漫、FAQ
```

## 十二、新对话开场提示词（可直接粘贴）

```
你继续负责 Windows 桌面应用「Atelier 画师工坊」的正式版问题反馈与修复。

项目位置：D:\Atelier\project
先读 docs/HANDOFF-0.1.0-fixes.md 了解上一轮已完成的修复、验证与交付物。

当前状态：
- 版本 0.1.0，HEAD c086b88，工作区干净
- p6-baseline 标签指向 f50060e，不得移动
- 不进入 P7，只处理用户明确反馈的正式版问题

不可变：AppId com.atelier.desktop、%APPDATA%\atelier 数据目录、schema/迁移、
备份恢复与 CSV 导出逻辑、已有 Git 历史。

数据安全：真实库禁止写入/恢复/迁移/删除；复现必须复制数据库到临时目录，
用 ATELIER_USER_DATA_DIR 指向临时 userData。

环境坑：启动前清除 ELECTRON_RUN_AS_NODE；dist 带 Low Integrity，
实机验证用 %LOCALAPPDATA%\Atelier\release 的 Medium 交付副本；
沙箱内无法启动 Electron（命名管道被拦），需 danger-full-access。

上一轮已修复：
1. 自动监测进程名（ClipStudioPaint.exe / UDMPaintPRO.exe）
2. 空闲毫秒 32 位回绕
3. 关闭窗口收进托盘、后台继续计时
4. 关机/注销放行关闭

当前交付包：
%LOCALAPPDATA%\Atelier\release\画师工坊-Setup-0.1.0.exe
125,958,328 bytes
SHA256 95FE4E2EA922102BFB7C54620EC28446142927DB4F0299CD4D2776C7BE9C9FDD

请先执行 git status 确认干净，然后告诉我你要处理的问题（版本、复现步骤、
期望、实际、截图/错误文本、是否影响数据）。只做最小修复，不重构、不扩需求。
```
