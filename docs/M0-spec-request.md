# 派单任务书：hermes-pet M0 架构设计 + codex 执行任务书（给 包工头👷）

## 你是谁 / 任务性质
你是 blueprint（包工头），本轮的活是**技术架构裁定 + 写出让 codex 能自主完成的执行任务书**。上限要求：精细到 codex 能自己跑完，不要过度设计。

## 背景（自包含，不需要问）
站长（王嘉仪/阿斯兰）要开发「琉斯计划」桌宠前端 **hermes-pet**，一小时内验收一个**能跑起来、有陪伴感的 MVP**。
- 项目目录：`D:\Jiayi\Projects\hermes-pet`
- 产品设计文档 v0.1（1027 行）：`D:\Jiayi\Projects\hermes-pet\hermes-pet-product-design.md`
- 现有代码：PySide6 玩具骨架（会被本轮替换，不用兼容）
- 已定技术选型（**不要推翻，直接采纳**）：**Electron + 原生 HTML/CSS/JS，无构建步骤、无 UI 框架、除 electron 外无 npm 依赖**
- 宿主环境（已实测）：Windows 11，Node **v24.19.0** + npm 11.17（在 `D:\SoftwareDownload\node.exe`），**没有 Rust**（所以 Tauri 出局），Docker 29.6 可用
- 猫精灵图素材已下载：`$env:TEMP\oneko.gif`（3316 字节，oneko 猫 32x32 精灵表，8 行状态：idle / alert / tired / sleeping / scratch / wash / walk-N / walk-S 等）——codex 需要把它落到项目 `assets/oneko.gif`；同时要求一张备用自绘 SVG 猫（透明背景，深蓝 #2D3748 + 金色 #ECC94B，呼应设计文档 4.2 色彩系统）

## 本轮 M0 功能范围（已由调度者钉死，你照此设计，不要自己增删范围）
- F1 **桌宠窗口**：透明、无边框、置顶、不出现在任务栏、可鼠标拖拽移动、位置持久化、首次启动出现在右下角
- F2 **精灵动画状态机**：idle / walk / alert / tired / sleeping / scratch / wash；鼠标靠近触发 alert；长时间无操作进 tired→sleeping；动作频率可配
- F3 **点击对话**：单击猫 → 头顶气泡 + 输入框 → Enter 发送 / Esc 关闭；气泡打字机效果 + 出现/消失动画；双击猫 → 打开设置面板
- F4 **回复适配器（可插拔）**：定义 adapter 接口；① local-mock 实现（本地关键词回复，语气按琉斯人格：温柔带毒舌的损友）；② hermes-gateway 实现（从 `.env` 读 `HERMES_GATEWAY_URL`，没配就优雅降级到 mock 并在气泡里说明）
- F5 **主动行为**：① 当天首次启动的问候；② 空闲 ≥30 分钟 → 打盹；③ 连续工作 40 分钟 → 休息提醒（含「休息5分钟」按钮）；④ 每天 22:30 → 数字日落提醒；⑤ 主动说话总频率上限（每 2 小时 ≤1 次），用户不回应则气泡消失且不重复打扰
- F6 **托盘图标 + 右键菜单**：托盘（显示/隐藏、暂停动画、退出）；右键菜单（对话 / 设置 / 固定位置 / 重置位置 / 暂停 / 退出）
- F7 **设置面板**：昵称、显示大小（60-180px）、主动提醒总开关、开机自启开关、深夜模式开关；持久化
- F8 **深夜模式**：22:00-07:00 自动启用，降饱和 + 动画频率减半
- F9 **交付件**：`启动hermes-pet.cmd` 双击启动器（内容全 ASCII、幂等）、README、`.hermes-docker.md`

## 你的产出（两个文件，都要落盘）
1. `D:\Jiayi\Projects\hermes-pet\docs\M0-spec.md` —— 架构设计：
   - 目录/文件清单（明确每个文件的职责）
   - Electron 主进程 ↔ 渲染进程 IPC 契约（通道名 + payload 结构，逐条列）
   - 精灵动画状态机的状态转移表（触发条件 → 目标状态）
   - 持久化 schema（config.json / state 的字段与默认值）
   - 主动行为的计时器设计（谁持有计时器、怎么避免重复触发、跨天怎么处理）
   - 「视觉上怎么做出陪伴感」的 3-5 条具体实现要求（给 codex 的硬性视觉约束）
2. `D:\Jiayi\Projects\hermes-pet\docs\M0-task.md` —— **codex 执行任务书**，必须自包含：
   - 执行者=codex，工作目录 `D:\Jiayi\Projects\hermes-pet`
   - 逐文件要写什么（可给关键接口签名与行为要求，不必给完整代码）
   - **验收清单分两栏**：`codex 自证`（可脚本化：`node --check`、`node --test tests/` 纯逻辑单测、npm install 成功、GIF 精灵表尺寸断言、无外网依赖断言）和 `人工（站长）`（浏览器/桌面 GUI 项：窗口透明置顶、拖拽、动画、气泡、托盘、右键菜单、设置面板）
   - **明确的「不要做什么」清单**（不要引入构建工具/框架/依赖、不要改产品设计文档、不要碰 .env）
   - **已知坑要写进去**：① 容器是 Linux 且无显示器 → electron GUI 不在容器里跑，容器只跑零依赖的 `node --test`；② 宿主机 `npm install electron` 必须设镜像 `--registry=https://registry.npmmirror.com` 且 `$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"`（否则 electron 二进制从 github 下载会失败）；③ 透明窗口在 Windows 需 `transparent:true, frame:false, hasShadow:false, skipTaskbar:true`，拖拽用 CSS `-webkit-app-region: drag` 或 IPC + `win.setPosition`；④ 别用 `nodeIntegration:true` + `remote`，用 `contextIsolation:true` + `preload.js` 暴露白名单 API
   - 结尾给 codex 的自我迭代条款：写完必须自己跑全部可脚本化验收项、修自己引入的问题、不自证完不算完

## 硬约束
- 只设计，**不要写实现代码文件**（除上面两个 .md）
- 不要修改 `D:\Jiayi\Projects\hermes-pet\hermes-pet-product-design.md`
- **禁止在 `D:\Jiayi\` 根目录新建任何文件或文件夹**（站长铁律）
- 用 terminal 写文件（你没有 write_file），长中文用 PowerShell here-string + `[System.IO.File]::WriteAllText($p,$s,(New-Object System.Text.UTF8Encoding($false)))`；文本引号一律用「」，不要用半角双引号
- 写完只回 **≤12 行摘要**（架构要点 / 文件清单 / 验收口径 / 你判断的风险），不要把全文回在聊天里
