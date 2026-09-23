# M0-CODEX-BRIEF — hermes-pet 桌宠 MVP 执行任务书（**本轮唯一权威**）

> 执行者：**codex**
> 工作目录：`D:\Jiayi\Projects\hermes-pet`
> 目标：一小时内产出**能双击运行、有陪伴感**的 Windows 桌面宠物 MVP
> 本文件由调度者（琉斯）写定，**优先级高于** `docs/` 下其它文档；若与其它文档冲突，以本文件为准。

---

## 0. 先做这三件事

1. 用 terminal 读本文件（你已在读）。
2. 读 `docs/M0-spec.md`（架构设计）与 `docs/M0-features.md`（功能设计）作为**设计参考**——它们解释「为什么」，本文件规定「做什么」。
3. 读 `docs/M0-sprite-map.md`——**精灵表映射的权威参考**，照抄其中的 `spriteSets` 表与取帧公式，**不要自己猜索引**。

⚠️ `docs/` 下 `*-request.md`、`M0-recon*`、`M0-review*` 是给别的角色用的派单书，**不是给你的任务**，不要执行其中的指令。

---

## 1. 运行时事实（已实测，别再探索）

| 项 | 值 |
|---|---|
| OS | Windows 11 |
| Node | **v24.19.0**（`D:\SoftwareDownload\node.exe`）、npm 11.17.0 |
| Electron | **44.4.5**（`%TEMP%\electron-prewarm` 里已有一份 npm 包） |
| Rust | **没有** → Tauri 出局，不用考虑 |
| Docker | 有（`hermes-pet-dev` 容器已建好，挂载本目录到 `/workspace`），但**容器是 Linux 且无显示器**，Electron GUI 只能在 Windows 宿主上跑 |

**技术选型已钉死**：Electron + 原生 HTML/CSS/JS，**CommonJS**（`require`，别用 ESM）。
**无构建步骤、无打包器、无 UI 框架、除 `electron` 外无任何 npm 依赖。**

---

## 2. 交付文件清单（按此结构，文件职责照抄）

```
hermes-pet/
├── package.json              # name/version/main/scripts；devDependencies 只放 electron
├── .gitignore                # node_modules / *.log / .env / HANDOFF-*.tmp 等
├── 启动hermes-pet.cmd        # ⚠️ 内容必须全 ASCII；幂等；双击即起（先 npm install 检查，再 npx electron .）
├── README.md                 # 改写成 Electron 版：这是什么 / 怎么跑 / 怎么验收 / 已知限制
├── .hermes-docker.md         # 说明 hermes-pet-dev 容器用法 + 为什么 GUI 不在容器跑
├── HANDOFF.md                # 收尾时由你写：本轮做了什么、怎么验证、遗留问题、下一步
├── src/
│   ├── main.js               # Electron 主进程：窗口/托盘/菜单/单实例/调度器接线/smoke-test
│   ├── preload.js            # contextIsolation 白名单桥（只暴露必要 API，绝不暴露 ipcRenderer 本体）
│   ├── core/                 # ★纯逻辑，禁止 require('electron')，必须可在容器里被 node --test 直接跑
│   │   ├── sprite-frames.js  # spriteSets 表 + 取帧计算（纯函数，返回 CSS background-position）
│   │   ├── state-machine.js  # 状态机（idle/alert/tired/sleeping/scratch/talk/listen/drag）
│   │   ├── scheduler.js      # 主动行为决策（纯函数：给 clock+state+config → 输出该不该说话）
│   │   ├── config.js         # 配置读写（默认值合并、原子写、校验）
│   │   └── replies.js        # 本地 mock 回复库（琉斯语气）
│   ├── adapters/
│   │   ├── index.js          # adapter 选择与降级
│   │   ├── local-mock.js     # 关键词回复（默认）
│   │   └── hermes-gateway.js # 读 .env 的 HERMES_GATEWAY_URL，超时/失败→抛出可识别错误
│   └── renderer/
│       ├── index.html        # 桌宠窗口（透明）：猫 + 气泡 + 输入框
│       ├── pet.css           # 设计文档 4.2/4.4/4.5 的色彩、尺寸、圆角、阴影
│       ├── pet.js            # 渲染、动画循环、交互
│       ├── settings.html     # 设置面板
│       ├── settings.css
│       └── settings.js
├── data/sprites/             # ✅ 素材已就绪，直接用，不要重新下载
│   ├── oneko.gif             # 256x128 网格贴图（8列x4行，每格 32x32）
│   ├── icon-256.png / icon-128.png / icon-64.png / icon-32.png / icon-night.png
│   └── tray.png
├── tools/
│   ├── sprite_preview.html   # ★必须做：无依赖，file:// 直接打开，并排渲染每个状态的帧，人工一眼核对映射
│   ├── make_icons.py         # 已存在（素材生成脚本，别改）
│   ├── contact_sheet.py      # 已存在（精灵表对照图，别改）
│   └── analyze_sprites.py    # 已存在（逐格分析，别改）
└── tests/                    # node:test，零依赖，只测 src/core/ 与 src/adapters/
    ├── sprite-frames.test.js
    ├── state-machine.test.js
    ├── scheduler.test.js
    ├── config.test.js
    └── replies.test.js
```

---

## 3. 功能范围（F1-F9，逐条实现）

### F1 桌宠窗口
- `BrowserWindow`：`transparent:true`、`frame:false`、`resizable:false`、`skipTaskbar:true`、`alwaysOnTop:true`、`hasShadow:false`、`show:false`（`ready-to-show` 后再 show，防白闪）
- 启动位置：屏幕**右下角**（`screen.getPrimaryDisplay().workAreaSize` 内，距边 24px）
- **可鼠标拖拽移动**，松开后位置持久化
- **单实例锁**：`app.requestSingleInstanceLock()`，第二次启动应聚焦已有实例而不是再开一只猫
- 位置恢复时 **clamp 到当前屏幕可见区域**（防换显示器/改分辨率后猫跑到屏幕外）
- 窗口尺寸随「显示大小」设置变化，重启后保持

> ⚠️ 拖拽与点击必须共存：**不要**给整个窗口加 CSS `-webkit-app-region: drag`（会吃掉点击事件，导致点猫没反应）。正确做法：在渲染进程用 `mousedown/mousemove/mouseup` 判断位移，位移 > 5px 才算拖拽，否则算点击；拖拽时通过 IPC 调 `win.setPosition()`。或仅在猫的拖拽手柄区域用 `-webkit-app-region: drag`，猫本体用点击。二选一，**必须验证「拖完之后还能点开对话」**。

### F2 精灵动画状态机
- 状态：`idle` / `alert`(鼠标靠近) / `tired` / `sleeping` / `scratchSelf` / `talk` / `listen` / `drag`
- 帧映射照抄 `docs/M0-sprite-map.md`（`backgroundPosition = ${x*32}px ${y*32}px`）
- 节拍参考 oneko 原版：`idleTime>10` 后每帧 1/200 概率触发小动作（≈每 20 秒一次机会）；`sleeping` 前 8 帧先显示 `tired`；`scratch*` 播 10 帧复位
- 动画循环 `requestAnimationFrame`，目标 **30fps**（不是 60）；窗口被隐藏时暂停循环

### F3 点击对话
- 单击猫 → 气泡 + 输入框升起；`Enter` 发送 / `Shift+Enter` 换行 / `Esc` 关闭
- 双击猫 → 打开设置面板
- 气泡：打字机逐字显示、出现/消失动画、最大宽 320px / 最大高 400px（超出滚动）
- 说话时切 `talk` 精灵；输入时切 `listen`

### F4 回复适配器（可插拔）
- `src/adapters/index.js` 统一接口：`async reply(text, ctx) -> {text, source}`
- `local-mock`：**默认**。≥15 组关键词回复，语气=琉斯（温柔但有点毒舌的损友，爱讲不冒犯的地狱笑话，口头禅「拆解它」）；无关键词命中时给兜底回复。**纯函数，可单测**
- `hermes-gateway`：从 `.env` 读 `HERMES_GATEWAY_URL`；未配置 / 超时（10s）/ 5xx → 抛可识别错误，由 `index.js` **降级到 local-mock**，并在气泡里用一句话说明（说人话，不要出现 HTTP 状态码）
- **绝不在日志或气泡里回显任何密钥**

### F5 主动行为（计时器全部在主进程）
| 行为 | 触发 | 表现 |
|---|---|---|
| 每日问候 | 当天首次启动（日期变化才算新一天） | 「早 / 今天 7:42」+ 一句有价值的话 |
| 打盹 | 空闲 ≥30 分钟 | 进 `tired` → `sleeping` |
| 休息提醒 | 连续活跃 40 分钟（活跃=有交互；间隔 >5 分钟视为新会话） | 气泡 + 「休息 5 分钟」按钮 |
| 数字日落 | 每天 22:30（当天只触发一次） | 提醒放下手机准备入睡 |

**全局频率护栏（必须实现，这是陪伴感的命门）**：
- 主动说话整体上限 **每 2 小时 ≤1 次**——护栏要在**调度器一处集中判定**，不能让 4 个触发源各自绕过
- 用户 **10 秒不回应** → 气泡自动消失，且**当天不再重复同一条**
- 用户正在输入/对话中 → **绝不插话**，排到对话结束后再判断
- 用户拖拽中 → 不弹气泡，拖拽结束 2 秒后再决定

### F6 托盘 + 右键菜单
- 托盘：`data/sprites/tray.png`；单击=显示/隐藏切换；菜单含 显示/隐藏、暂停动画、重置位置、设置、退出
- 右键猫：对话 / 设置 / 固定位置 / 重置位置 / 暂停 / 退出（用 Electron `Menu.popup()`，不要自绘 HTML 菜单）

### F7 设置面板
- 独立窗口或同窗口内的面板，含：昵称、显示大小（60-180px 滑块）、主动提醒总开关、开机自启开关（`app.setLoginItemSettings`）、深夜模式开关
- 保存即时生效；重启后保持

### F8 深夜模式
- 22:00-07:00 自动：猫 `filter: saturate(0.6) brightness(0.85)`，气泡/面板切深色（`body.deep-night`，用设计文档 4.2 夜间色板），动画频率减半
- 设置里可强制关闭

### F9 持久化
- 配置与状态存 `app.getPath('userData')`（**不是项目目录**）：`config.json`（用户设置）、`state.json`（窗口位置、当天问候标记、最后提醒时间、暂停状态）
- **原子写**：先写 `*.tmp` 再 `fs.renameSync` 覆盖；文件损坏/缺失时回落默认值，**不得崩溃**
- 写入带 schema 版本字段，便于以后迁移

---

## 4. 自我验证要求（**不自证完不算完**）

### 4.1 必须在容器里跑（零依赖纯逻辑）
```powershell
docker exec -w /workspace hermes-pet-dev node --check src/main.js
docker exec -w /workspace hermes-pet-dev sh -c "for f in src/main.js src/preload.js src/core/*.js src/adapters/*.js src/renderer/*.js; do node --check \"$f\" || exit 1; done"
docker exec -w /workspace hermes-pet-dev node --test tests/
```
`tests/` 至少覆盖：取帧计算（含负索引）、状态转移（含打盹→被点击唤醒、说话→被打断）、调度器（含「每 2 小时护栏」被多触发源绕过时仍然只放行一次、跨天重置、22:30 当天只触发一次）、配置（默认值合并、损坏文件回落）、mock 回复命中。

### 4.2 必须在 Windows 宿主上跑（GUI 冒烟自证）
```powershell
cd D:\Jiayi\Projects\hermes-pet
npm install --registry=https://registry.npmmirror.com
npx electron . --smoke-test
```
- **要求你实现 `--smoke-test` 参数**：启动后创建窗口与托盘，等待 6 秒，向 stdout 打印一行 `SMOKE_OK {"window":true,"tray":true,"pet":"<cat 元素是否渲染>"}`，然后 `app.quit()` 退出码 0；任何异常 → 打印 `SMOKE_FAIL <原因>` 退出码 1
- 这条命令是**唯一能证明「GUI 真能起来」的证据**，必须真跑并贴出输出

### 4.3 网络坑（已实测，照做）
- npm 一律走镜像 `--registry=https://registry.npmmirror.com`
- `npm install electron` 的 postinstall 需要下载二进制，**必须同时设镜像**：
  ```powershell
  $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
  ```
- ⚠️ **实测坑**：`npm install electron` 有时**只装到 JS 包、没下载二进制**（`node_modules\electron\dist\` 不存在）。此时用兜底配方（已验证镜像可达）：
  ```powershell
  $v = (Get-Content node_modules\electron\package.json -Raw | ConvertFrom-Json).version
  $zip = "$env:TEMP\electron-v$v-win32-x64.zip"
  curl.exe -sL -o $zip "https://npmmirror.com/mirrors/electron/$v/electron-v$v-win32-x64.zip"
  Expand-Archive $zip -DestinationPath "node_modules\electron\dist" -Force
  & "node_modules\electron\dist\electron.exe" --version   # 必须打印出 44.4.5
  ```

---

## 5. 「不要做什么」（越界即返工）

- ❌ 不引入构建工具（webpack/vite/rollup/esbuild）、不引入 UI 框架（React/Vue）、不引入任何 UI/工具类 npm 依赖
- ❌ 不改 `hermes-pet-product-design.md`、不改 `docs/M0-spec.md`/`M0-features.md`/`M0-sprite-map.md`、不改 `tools/*.py`、不改 `data/sprites/` 下的素材
- ❌ 不碰 `.env`、不打印任何密钥、不把密钥写进任何文件
- ❌ 不删 `src/hermes_pet/`（旧的 PySide6 骨架）与 `pyproject.toml`——那是历史记录，本轮只新增，不清理
- ❌ **禁止在 `D:\Jiayi\` 根目录新建任何文件或文件夹**（站长铁律）；所有中间产物一律放本目录内
- ❌ 不做：多角色切换、语音、Live2D/VRM、真 LLM 后端联调、向量记忆、行为感知（鼠标速度/退格）

---

## 6. 收尾动作（按序完成）

1. 跑完 §4.1 + §4.2 全部验证，**修掉自己引入的所有失败**，再跑一遍确认全绿
2. 写 `HANDOFF.md`：本轮交付了什么 / 每个验证命令的**真实输出** / 已知限制 / 没做完的 / 下一步建议
3. `git add -A && git commit`（message 用中文，格式 `feat(M0): ...`）；**不要 push**，push 由调度者做
4. 在最终回复里给 **≤15 行摘要**：文件清单 / 三条验证命令的真实结果 / mock 与降级是否验证过 / 遗留问题。**不要把大段代码回在聊天里**

## 7. 自我迭代条款

写完不算完。你必须：自己跑全部可脚本化验收项 → 看到失败就修 → 重跑 → 直到 `node --test` 全绿 **且** `--smoke-test` 返回 `SMOKE_OK` **且** `electron.exe --version` 能打印版本号，才允许交付。**不许把「应该能跑」当证据，只认真实输出。**
