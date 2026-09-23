# hermes-pet M0 独立核验报告

> 审查人：杠精🔍（苛察）｜性质：**只审不改**｜核验时刻：2026-09-23（codex 尚未产出任何 JS 文件）
> 核验对象：`docs/M0-CODEX-BRIEF.md`（本轮唯一权威任务书，重点）、`docs/M0-features.md`、`docs/M0-sprite-map.md`、`docs/_recon/*`、`hermes-pet-product-design.md`（按需）、以及截至核验时刻的已交付产物
> 本报告只写这一个文件，未修改任何其它文件、未写任何实现代码。

---

## 0. 证据基础（以下都是我实测过的，不是转述任务书）

| # | 命令 | 实测结果 | 对 task 的意义 |
|---|---|---|---|
| E1 | `Get-ChildItem -Recurse -File` （排除 node_modules/.venv/.git） | `src/` 下 **0 个 .js**；`package.json`、`启动hermes-pet.cmd`、`HANDOFF.md`、`.hermes-docker.md`、`tools/sprite_preview.html`、`tests/*.test.js` **全部不存在**；`dist/` 为空目录 | codex 产物为 0 → 本轮审查是**任务书级**审查，代码级审查缺条件（见 §10） |
| E2 | `Test-Path docs\M0-spec.md` | **不存在**（只有 `M0-spec-request.md`，即派给包工头的那张单子） | brief §0.2 与派单书都引用它 → 引用悬空，见 P1-1 |
| E3 | `docker ps` / `docker exec hermes-pet-dev node --version` | 容器 `hermes-pet-dev` Up，镜像 `nikolaik/python-nodejs:python3.11-nodejs20`，容器内 **Node v20.20.2**，`/workspace` 已挂载项目目录 | `node --test tests/` 在 Node 20 下可用 ✅ brief §4.1 成立 |
| E4 | `& 'D:\SoftwareDownload\node.exe' --version` | v24.19.0；`node`/`npm`/`npx` 均在 PATH（`npm.ps1`/`npx.ps1`/`npm.cmd`/`npx.cmd` 都在） | 双击 .cmd 走 cmd.exe 需要 `npm.cmd`/`npx.cmd` → 都在 ✅ |
| E5 | `%TEMP%\electron-prewarm\node_modules\electron` | `package.json` → `^44.4.5`，实装 **44.4.5**，`dist\electron.exe` **存在** | brief §1 的 Electron 预装属实，兜底配方大概率用不上 ✅ |
| E6 | 逐行比对 `docs/_recon/oneko-ref.js` 的 `spriteSets` 与 `M0-sprite-map.md` 第 2 节 | 17 组索引**逐字节一致**（idle `[-3,-3]`、alert `[-7,-3]`、tired `[-3,-2]`、sleeping `[-2,0],[-2,-1]` …） | 映射表转抄无误 ✅ 但缺 3 组状态，见 P0-3 |
| E7 | `git check-ignore -v data/sprites/oneko.gif` / `git ls-files data/` | 命中 `.gitignore:45:data/`；`git ls-files data/` → **空** | 素材从未被跟踪，`git add -A` 会静默跳过 → 见 P0-4 |
| E8 | `git log --oneline` / `git status --short` | 最近提交是产品设计文档；`?? docs/`、`?? tools/` 未跟踪；`.git/hooks` 下**无 pre-commit 钩子**（.pre-commit-config.yaml 未 install） | `git commit` 不会被钩子拦 ✅ |
| E9 | `docs/_asset-report.json` + 素材体积 | oneko.gif 3316 B、sheet 256x128、frame_count=1；icon/tray 6 张 png 均存在 | 网格贴图（非多帧 GIF）判断正确 ✅ |
| E10 | `hermes-pet-product-design.md` 4.x 标题与色值 | 4.1–4.8 存在，4.2 有夜间色板（`#1A202C`/`#D69E2E`/`#2D3748`/`#E2E8F0`）、主色 `#2D3748`、辅色 `#ECC94B`、底色 `#F7FAFC` | F8「用 4.2 夜间色板」可落地 ✅ |
| E11 | `.env.example` | `HERMES_GATEWAY_URL=http://localhost:8642`、`HERMES_API_KEY=your_api_key_here` | brief 只提 URL、未提 API_KEY 与协议 → 见 P1-2 |

**一句话结论先行**：brief 的方向、技术选型、运行时事实（E3/E4/E5）全部经得起实测，**不是打回级**；但它有 4 处「照抄就会翻车」的硬缺口（P0），以及 14 处必须补明确的 P1。现在是改任务书最便宜的时刻（codex 还没产出任何文件）。

---

## 1. 结论

**修订后放行。**

- 修订对象是 `docs/M0-CODEX-BRIEF.md`（补 P0 的 4 条 + P1 按序），**不是**让 codex 先跑起来再补；
- 未通过「放行」的原因是：按现版 brief 直接开工，F3（点猫→对话）这条主链路在验收现场大概率肉眼可见地失败（P0-1/P0-2），且提交里会缺素材（P0-4）；
- 未到「打回」的原因是：无方向性错误、无越界风险、禁止清单完整、运行时事实已核实，缺口全部是「补一句就能救」的规格缺失。

---

## 2. P0（阻塞交付，交付前必须补进 brief）

### P0-1 窗口尺寸与气泡尺寸互斥，且从未定义「气泡画在哪里」

- **问题**：F1 写「窗口尺寸随『显示大小』设置变化（60–180px）」，F3 写气泡「最大宽 320px / 最大高 400px（超出滚动）」，F7 还要塞一个设置面板。全篇没有任何一句定义**窗口实际尺寸**，也没说气泡相对窗口如何定位。
- **为什么是问题**：两条规定互相排斥——按 60–180px 建窗口，320px 宽的气泡必然被窗口裁掉（Electron 窗口不会因为内容溢出而自动变大），验收时「单击猫→气泡+输入框升起」当场失败；反过来为了气泡把窗口放到 360x440，那么 F1 的「窗口尺寸随显示大小变化」就是假话，且窗口退化成一块 360x440 的挡板（叠加 P0-2 会直接招投诉）。codex 无论选哪边都会违反 brief 的另一条，而且这是**验收第一眼**能看到的东西。
- **具体修法**（补进 F1，写明三句硬规定）：
  1. 窗口尺寸**固定** `360 x 440`（= 猫最大 180px 宽 + 气泡最大 320~400px 的包络 + 8px 余量），**不随显示大小变化**；
  2. 「显示大小 60–180px」只作用于**猫元素自身的 CSS 尺寸**（`#cat{width:var(--cat-size);height:var(--cat-size)}`），不是窗口尺寸；
  3. 布局写死：猫 `position:absolute; bottom:0; left:50%; transform:translateX(-50%)`；气泡 `position:absolute; bottom:calc(var(--cat-size) + 8px); left:50%; transform:translateX(-50%); max-width:320px; max-height:400px; overflow:auto`；输入框在气泡内底部。位置持久化与 clamp **按窗口矩形**（`win.getBounds()`）算，按猫矩形算会漂。
  - 若站长要求「窗口必须很小」，则必须同步把气泡改成 `max-width:160px` 并把设置面板做成独立窗口——**二选一，不能两条都留着**。

### P0-2 透明窗口的「看不见的挡板」全篇未处理

- **问题**：brief 规定了 `transparent:true` / `frame:false` / `skipTaskbar` / 拖拽方案，也正确警告了「不要整窗 `-webkit-app-region: drag`」，但**完全没规定透明区域的鼠标命运**：既没写 `setIgnoreMouseEvents`，也没写命中测试。
- **为什么是问题**：Windows 上 Electron 的透明窗口仍是**整矩形接收鼠标事件**（alpha=0 的像素照样吃点击，Windows 不像 macOS 那样按 alpha 透传）。360x440 的枚举一摆，桌面右下角一块看不见的方块就永久挡住下面的图标、文件和按钮，站长第一分钟就会遇到「桌面文件点不动」；这是最直观的验收事故。更糟的是常见「修法」——无脑 `setIgnoreMouseEvents(true)`——会让猫自己点不动，F3 直接失效，而这恰好是 brief 反复强调要验证的那条链路。
- **具体修法**（补进 F1，附伪码，要求 codex 照抄结构）：
  1. 主进程建窗后：`win.setIgnoreMouseEvents(true, { forward: true })`（Windows 支持 `forward`，鼠标移动事件仍会送到渲染进程）；
  2. 渲染进程每帧 mousemove 做命中测试：
     `const hit = document.elementFromPoint(e.clientX, e.clientY); const interactive = !!(hit && hit.closest('#cat, #bubble, #bubble *, .panel, .panel *, button')); window.pet.setIgnoreMouse(!interactive);`
  3. 拖拽期间用 `dragLock=true` 强制保持不穿透，`mouseup` 后按上一条重判一次；
  4. 验收标准写死两条：「把猫移到桌面图标上，透明区域能点到图标」「点猫能出气泡」，两条都要在 §4.2 冒烟里至少验到第二条。

### P0-3 F2 状态机没有可执行定义（3 个状态无帧映射 + 打盹节拍自相矛盾 + 无转移表）

- **问题**：三件事叠在一起。
  a) F2 下令「帧映射**照抄** `docs/M0-sprite-map.md`」，但该文件只有 idle/alert/tired/sleeping/scratchSelf/scratchWallN·S·E·W/8 个方向组——**没有 `talk` / `listen` / `drag` 三组**，而 F2 的状态列表里明确有这三个（实测 E6 已确认）。
  b) sprite-map 第 4 节抄 oneko 节拍，写着 `sleeping` 分支「超过 192 帧后复位回 idle」（192 帧 @30fps ≈ 6.4 秒），而 F5 要求「空闲 ≥30 分钟才进 tired→sleeping」并一直睡到用户回来。两条直接冲突。
  c) brief 只给了状态名清单，**没有转移表**：打盹中被点击能不能醒（§4.1 却要求测这条）、说话时被打断怎么处理、拖拽结束后回哪个状态——全都没写。
- **为什么是问题**：codex 被明令「不要自己猜索引」，但 talk/listen/drag 不猜就写不出来，只能自创；同时它极可能把「睡 6.4 秒自动醒」抄进主循环，做出「打盹形同虚设」或（若改成永不自动醒）「睡死叫不醒」两种事故之一。而 §4.1 要求写的三条测试（打盹→点击唤醒、说话→打断、跨天重置）在没有转移表的情况下，测试与实现对不上，验收现场只能靠嘴吵。
- **具体修法**：
  1. 在 `docs/M0-sprite-map.md` **末尾追加**「M0 状态补充映射（复用，不改原始表）」：`talk` → `alert` 帧 `[-7,-3]` + CSS `@keyframes talk-tilt{0%,100%{translateY(0)}50%{translateY(-2px)}}`（0.6s 循环）；`listen` → `idle` 帧 + 呼吸缩放 CSS；`drag` → `SE [-5,-1]` / `SW [-5,-3]` 各 4 帧交替；并注明依据与「不改动原始 17 组」。
  2. 在 brief F2 明确：sprite-map 的「192 帧复位 idle」**只适用于 oneko 式 idle 小动作（那一次概率触发的睡觉）**；30 分钟打盹是独立状态 `nap`，**只由用户交互或显式唤醒退出**，任何计时器都不得自动退出。
  3. 在 brief F2 补一张最小转移表（事件 × 当前状态 → 目标状态），至少覆盖：`sleeping|nap + click → alert（播 8 帧唤醒）→ talk`；`talk + click → talk`（重置 10 秒消失计时，不重复弹）；`talk|listen + dragStart → drag`；`drag + mouseup → 恢复 dragStart 前的状态`（**对话中的猫被拖一下不能丢对话**）；`alert + 鼠标离开 3s → idle`；`任意状态 + 用户交互 → idle 计时器归零`；`主动行为在 sleeping/nap 中到点 → 先播唤醒动画再开口`（禁止「睡着说话」）。
  4. 补一句优先级：「用户交互 > 主动行为 > 装饰动画；同级直接覆盖，不排队」。

### P0-4 `.gitignore` 会静默吞掉全部精灵素材（最阴的一颗雷）

- **问题**：项目现有 `.gitignore` 第 45 行是 `data/`，第 46–47 行还有 `sprites/*.png`、`sprites/*.gif`。brief §2 只写了 `.gitignore # node_modules / *.log / .env / HANDOFF-*.tmp 等`，没有一句「必须放行 data/sprites」；而 §6 又要求 `git add -A && git commit`。
- **为什么是问题**：实测（E7）`git check-ignore -v data/sprites/oneko.gif` → 命中 `.gitignore:45:data/`；`git ls-files data/` → **空**，即当前仓库**一个素材都没被跟踪**。codex 若按最省事的做法「往现有 .gitignore 追加几行」，`git add -A` 会一声不响跳过 `oneko.gif` + 5 张 `icon-*.png` + `tray.png`。因为磁盘上文件还在，本机照样跑得起来、站长验收**会通过**；等克隆、换机、或调度者 push 之后，跑起来只有一只白框/无图标托盘——排障成本极高，且完全不符合「交付物 = 仓库提交」的定义。
- **具体修法**：
  1. brief §2 把要求改成「**重写** .gitignore，并在末尾追加例外：`!data/`、`!data/sprites/`、`!data/sprites/**`、`!data/sprites/*.png`、`!data/sprites/*.gif`；同时保留 `node_modules/`、`*.log`、`.env`、`HANDOFF-*.tmp`」；
  2. 若例外行顺序导致仍被忽略，兜底 `git add -f data/sprites/`；
  3. §4/§6 增加一条自证命令：提交后运行 `git ls-files data/`，**必须列出 8 项**（oneko.gif、icon-256/128/64/32/night、tray.png、.gitkeep），输出原文贴进 HANDOFF.md。
---

## 3. P1（必修：不补就会返工 / 会做出假绿灯）

### P1-1 `docs/M0-spec.md` 引用悬空（brief §0.2 与派单书都指向它，实测不存在）
- **问题**：brief §0 第 2 步命令 codex「读 `docs/M0-spec.md`（架构设计）」，派单书也把它列为待审文件并说「与 brief 有出入处以 brief 为准」。实测（E2）`docs/` 下只有 `M0-spec-request.md`（派给包工头的单子），**没有 M0-spec.md**。
- **为什么是问题**：codex 会真去读、读不到、多烧一轮；更坏的情况是它据此以为「架构没定」而自行发挥，或停下来问人——一小时的交付窗口里这两种都很贵。同时派单书那句「指出出入点」在当前状态下无法执行，等于审查任务本身少了一半输入。
- **具体修法**：二选一，**现在决定**——(a) 把 brief §0.2 与派单书里的 `M0-spec.md` 删除/改成「本轮不设独立架构文档，架构以本 brief §1–§3 为准」；(b) 若要留 spec，由包工头在开工前补出（量级：把 brief §1–§3 的决策抽成一份 1 页 A4）。**不要留着悬空引用**。

### P1-2 网关适配器的协议与鉴权全未定义（会做出「永远降级」的假成功）
- **问题**：F4 只写「**从 `.env` 读 `HERMES_GATEWAY_URL`**；未配置/超时（10s）/5xx → 抛可识别错误」。没写端点路径（`/v1/chat/completions`？`/chat`？）、请求体形状、鉴权头、响应取值路径（`choices[0].message.content`？）。而实测 `.env.example`（E11）里还有一个 `HERMES_API_KEY`——brief 全篇没提它。
- **为什么是问题**：codex 只能猜协议；若它不带 `Authorization` 头，网关会一直 401 → 每次请求都「降级到 mock」→ 冒烟看起来全绿、`source` 永远 `local-mock`，站长会以为「接好了但没配」，实际上这条链路从未跑通过一次。
- **具体修法**：F4 补一段「网关协议（M0 冻结版）」：`POST {HERMES_GATEWAY_URL}/v1/chat/completions`，headers `{ 'Content-Type':'application/json', 'Authorization': 'Bearer '+HERMES_API_KEY }`，body `{ model:'default', messages:[{role:'user',content:text}], stream:false }`，取 `json.choices[0].message.content`，非字符串即抛 `GatewayError`。同时明确：`HERMES_API_KEY` 只从 `.env` 读、**只在主进程用**、绝不进渲染进程、绝不进日志。若今天不打算真联调，写「本期只保证适配器可被单测覆盖（用注入的假 fetch），不保证真网关连通」也远好过留白。

### P1-3 降级错误面太窄（4xx / 非 JSON / 缺字段 / 连不上 都会变成未捕获异常）
- **问题**：F4 只列了「未配置 / 超时 10s / 5xx」三种。漏掉：4xx、响应不是 JSON（网关挂掉时常返回 HTML 错误页 → `JSON.parse` 抛）、JSON 缺 `choices` 字段、URL 非法（缺协议）、`ECONNREFUSED`（本地 8642 没起）、DNS 失败。
- **为什么是问题**：这些都会在 `await fetch()` / `JSON.parse()` 处抛出**未被归类**的异常；若 `index.js` 只 catch 自己定义的错误类型，异常会冒泡到 IPC handler → 渲染进程 `await` 被 reject → 气泡要么不动、要么白屏，正撞 F9/降级路径的验收点（「不报错弹窗、说人话」）。
- **具体修法**：把降级条件改成「**除成功取值外的任何情况**」：`try { ... } catch (e) { throw new GatewayError(mapReason(e)) }`，`mapReason` 用 `e.name === 'AbortError'` / `e.code` / `e instanceof SyntaxError` / 字段缺失 四类归一；`index.js` 只 catch `GatewayError` 并降级，其它异常也兜一层「降级 + 记日志」。加一句「任何异常都不允许冒泡到渲染进程」。

### P1-4 10 秒超时期间气泡是什么样，没规定（会做出「卡 10 秒」）
- **问题**：F4 规定超时 10s 后降级，但没写这 10 秒气泡显示什么。
- **为什么是问题**：最省事的实现是「等结果回来再显示」→ 用户回车后 10 秒毫无反应，站长会当场判定「对话功能坏了」，而这 10 秒在验收现场一定会出现（本地网关没起时 100% 复现）。
- **具体修法**：F3/F4 补一句：发送后立刻把气泡切到 `listen`，1.5 秒内未返回则显示「在想…」（打字机省略号）；`GatewayError` 命中后**就地替换**为 mock 回复，并在后面追加一句人话（如「网关没连上，我先用自己的话答你」），禁止出现 HTTP 状态码与堆栈。

### P1-5 `.env` 的解析方式没规定（会引入违规依赖）
- **问题**：brief 禁止「除 electron 外任何 npm 依赖」，但要求读 `.env`，却没写怎么读。
- **为什么是问题**：codex 的自然反应是 `require('dotenv')` → 要么装包违反禁令（验收判违规），要么装不上直接崩在半路。项目 `.venv` 里恰好装着 python 版 `python-dotenv`，但那是 Python，帮不上 Node。
- **具体修法**：F4 明确「`.env` 由 `src/core/config.js` 提供的手写 parser 读取，约 10 行：按行 `trim`、跳过空行与 `#` 开头、按第一个 `=` 切分、去掉成对引号；不支持多行值与变量展开。路径由 main.js 用 `path.join(__dirname,'..','.env')` 传参，不得在 core/adapters 里 `require('electron')`（见 P1-6）」。顺手明确：`.env` 不存在时不算错误，直接走 mock。

### P1-6 `adapters/` 未被禁止 `require('electron')`，但 §4.1 又要求测它（容器里必崩）
- **问题**：§2 只对 `src/core/` 写了「禁止 require('electron')，必须能在容器里被 node --test 直接跑」，对 `src/adapters/` 没写；而 §4.1 明确要求 `node --test tests/` 覆盖 `src/adapters/`。
- **为什么是问题**：`hermes-gateway.js` 要读 `.env`，最自然的写法就是 `require('electron').app.getAppPath()`；一旦这么写，容器里的 `node --test` 会因 `electron` 模块不可 require 而整批测试挂掉（不是断言失败，是加载失败），codex 会被迫在「修测试」和「改依赖」之间来回烧时间。
- **具体修法**：§2 把禁令扩到 `src/adapters/`：「adapters 与 core 同为纯 Node 模块，一律禁止 `require('electron')`；`.env` 路径、fetch 实现、时钟均由 main.js 通过函数参数注入，便于单测注入假 fetch。」

### P1-7 调度器时钟基准未规定 + 睡眠唤醒 / 系统时间跳变无防护（会补发一串气泡）
- **问题**：F5 的四个触发源（每日问候 / 30 分钟打盹 / 40 分钟休息提醒 / 22:30 日落）都只写了「条件」，没写「用什么计时」。
- **为什么是问题**：若用 `setTimeout`/`setInterval` 累加（默认写法），笔记本合盖 3 小时或调系统时间后，定时器会漂移、并被唤醒瞬间集中触发 → 用户回来看到连弹 2–3 条气泡甚至 4 条，正是「陪伴感的命门」被击穿；改系统时间（验收时站长很可能手动调到 1:00 测深夜模式、调到早晨测问候）会让累计计时器彻底错乱。
- **具体修法**：F5 补三句硬规定：
  1. **唯一调度循环**：主进程 `setInterval(tick, 1000)`；每 tick 用 `Date.now()` **重算**每个候选是否满足，禁止用 `setTimeout` 累加计时；
  2. **唤醒/跳变检测**：若 `now - lastTickAt > 120000`（2 分钟），视为系统睡眠唤醒或时间跳变 → 重置活跃计数器、清空待发队列、把「当天只触发一次」的标记按新 `dayKey` 重算，**不补发任何过期内容**；若 `Math.abs(now - lastTickAt) > 300000` 或 `now < lastTickAtLastRecorded`，同样走这条路径；
  3. **窗口隐藏时暂停**：`win.on('hide')` 停 tick、`show` 恢复并从当前时间重算（防止隐藏 8 小时后恢复瞬间炸一串）。

### P1-8 同一 tick 多触发源同时到点的优先级、以及「额度是否被消耗」未定义
- **问题**：F5 只写了「护栏要在调度器一处集中判定」。但没说：22:30 恰好同时满足「40 分钟提醒」和「当天首次问候」时发哪条？被挡掉的那条是丢弃、还是顺延？丢弃时**算不算消耗了 2 小时额度**？「当天不再重复同一条」里的「同一条」如何识别？
- **为什么是问题**：① 不说优先级，`scheduler.js` 的实现顺序就成了事实上的优先级，测试写不出来（§4.1 只要求测「被多触发源绕过时仍只放行一次」，不覆盖「两条同时到点」）；② 不说额度语义，会出现「被挡掉的日落提醒把额度吃掉了，20 分钟后用户主动说话后 2 小时内再也听不到问候」；③ 没有稳定 ID，「当天不重复同一条」无法判定——代码只能退化成「当天完全不发主动消息」，陪伴感又没了。
- **具体修法**：F5 补一张表 + 一句语义：
  - 优先级 `greet(100) > rest(80) > sunset(60) > napAnimation(40)`；同 tick 只允许输出**一条**，取优先级最高者，其余**丢弃不排队、不消耗额度**；
  - 额度只在**真正弹出气泡并写入 state.json 之后**才消耗（`guard.lastSpokeAt = now; guard.lastSpokeId = id`）；
  - 每条主动消息的 ID 形如 `greet:2026-09-23` / `rest:2026-09-23T14:30` / `sunset:2026-09-23`；`state.json` 存 `dismissedIds: string[]`（只保留当天），被 10 秒无响应关闭的 ID 当天不再出现；
  - `scheduler.js` 保持纯函数：入参 `(clock, state, config)` → 出参 `{shouldSpeak, id, priority, text}`，**不做 IO**（这样 §4.1 的测试才能真正覆盖「多触发源 + 单出口」）。

### P1-9 「连续活跃 40 分钟」不可测（间隔 >5 分钟是清零还是保留？）
- **问题**：F5 写「连续活跃 40 分钟（活跃=有交互；间隔 >5 分钟视为新会话）」。这半句是歧义句：>5 分钟的空档是「把累计归零」，还是「只是分段但仍累计」？
- **为什么是问题**：两种解释的实现不同、测试期望不同；而 §4.1 明确要求测「跨天重置」，一旦「大间隔」和「跨天」两套语义混在一起，测试和实现对不上就是必然。
- **具体修法**：F5 改为可测的伪码级描述：「主进程维护 `activeSeconds` 与 `lastInteractionAt`；每 tick 若 `now - lastInteractionAt <= 60s` 则 `activeSeconds += 1`；任意交互事件把 `lastInteractionAt = now`；若 `now - lastInteractionAt > 5*60*1000` → `activeSeconds = 0`；`activeSeconds >= 40*60` 且额度可用 → 触发 `rest` 并 `activeSeconds = 0`。」（即：>5 分钟 = 归零 + 新会话，与 `activeSeconds` 的 60 秒窗口一致；写清楚就不会有两种实现）

### P1-10 「用户正在对话中绝不插话」的排队语义未定义
- **问题**：F5 只写「排到对话结束后再判断」。没说：排队项是否消耗额度？队列最多等多久？用户连续聊 30 分钟，队列里的日落提醒还发不发？
- **为什么是问题**：不写过期规则，最省事的实现会「9 点排队的 22:30 提醒在 23:10 突然弹出来」——深夜打扰，正是 F8「深夜模式是态度」的反面。
- **具体修法**：F5 补：「排队项带 `expireAt = queuedAt + 90_000`；tick 中若 `now > expireAt` → 丢弃（**不消耗额度、不写入 dismissedIds**）；用户关闭对话（气泡收起）后立即跑一次判定。」

### P1-11 22:30 日落提醒「错过是否补发」未定义
- **问题**：如果 22:30 时电脑关着/睡着了/被护栏挡掉，22:45 开机，当天还要不要补？
- **为什么是问题**：不定义 → 两种实现都可能，验收时「调时间到 1:00 测深夜模式」的操作会顺带把这条也测出分歧。而补发会造成「刚开机就被说教睡觉」。
- **具体修法**：F5 补：「日落提醒只在 `[22:30, 23:00)` 窗口内触发；超出窗口即当天作废，不补发、不跨天顺延；`lastSunsetDay = dayKey(now)` 写在 state.json，跨天自动失效。」同时把 `dayKey(now)` 定义为「本地时区 `YYYY-MM-DD` 字符串的统一工具函数，全项目只此一处实现」——「当天首次启动问候」「当天只触发一次」「当天不再重复同一条」三处必须共用它。

### P1-12 取帧的负索引期望值未定义（`frame % len` 在 JS 里会返回负数）
- **问题**：§4.1 要求测「取帧计算（含负索引）」，但没有给期望值。sprite-map 给的公式是 `spriteSets[name][frame % spriteSets[name].length]`——JS 的 `%` **保留符号**：`frame = -1`、长度 3 → `-1 % 3 = -1` → `spriteSets['scratchSelf'][-1]` 是 `undefined` → 读取 `undefined[0]` 抛 TypeError，或拼出 `NaNpx NaNpx` → **精灵整个消失**（不报错、只是白框，最难查的那种）。
- **为什么是问题**：这是「照抄原版公式 + 定时器抖动/动画帧回绕出现 -1」时必然踩的坑；一旦发生，表现是「猫偶尔消失一下」，冒烟测试（只看元素存在）根本抓不到。
- **具体修法**：sprite-map §2 补一句：「`frame` 必须先归一：`const safe = ((frame % len) + len) % len;`，禁止把负索引传给数组；测试断言 `setSprite('scratchSelf', -1)` 得到 `-224px 0px`（即 frame 归一为 2）」，并把这条作为 `sprite-frames.test.js` 的必测断言。另建议顺带断言 `idle → '-96px -96px'` 这种字面期望值（防把负号算丢、防自己换算成正列号）。

### P1-13 持久化的 Windows 现实问题：rename 被占用、userData 目录不存在、写频率
- **问题**：F9 写了「先写 `*.tmp` 再 `fs.renameSync` 覆盖」「损坏回落默认值」。但没写：① Windows 上 `renameSync` 覆盖已存在目标时可能因杀软/索引占用抛 `EPERM`；② 首次启动 `app.getPath('userData')` 目录可能不存在（Electron 只在写东西时才建），`writeFileSync` 到不存在的目录会 `ENOENT`；③ 位置持久化的写入时机。
- **为什么是问题**：① 会让「保存设置」偶发失败且抛到 UI；② 会让首次启动就崩在写配置这一步（正是 F9 说的「不得崩溃」）；③ 若在 `mousemove` 里落盘，一次拖拽能触发几百次写盘（磁盘/SSD 寿命 + 卡顿），这是拖拽功能的经典坑。
- **具体修法**：F9 补三条：「① 写前 `fs.mkdirSync(dir,{recursive:true})`；② `renameSync` 包 try/catch，失败时 `unlinkSync(tmp)` + 回退 `writeFileSync(目标, json)`，仍失败则只记日志、保持内存态不崩；③ 位置只在 `mouseup`、`win.blur`、`before-quit` 三处保存，且 500ms 内合并；禁止在 mousemove/mousemove 派生的 IPC 里落盘。」

### P1-14 单击与双击冲突（双击必然先触发一次单击 → 气泡弹出来又开设置）
- **问题**：F3 规定「单击开对话、双击开设置」，没写去抖。DOM 里双击必然先派发一次 `click`（或两次 `mousedown/up`）。
- **为什么是问题**：验收动作「双击猫开设置」会先弹出一个气泡（可能还带打字机），设置面板同时打开 → 视觉混乱、且气泡的 10 秒计时器已经启动；反过来「单击」若用「250ms 内等第二次点击」实现，拖拽判定（>5px）和点击判定会互相干扰。
- **具体修法**：F3 写明状态判定合一的伪码：「`mousedown` 记录起点 → `mouseup` 时若位移 > 5px 判定为拖拽（走拖拽收尾）→ 否则计入点击计数：250ms 内第 2 次点击 → 打开设置并**取消挂起中的单击动作**；250ms 未等到第 2 次 → 执行单击（开/收气泡）。」并要求「双击开设置时若气泡已开启，先收起气泡再开面板」。

### P1-15 设置面板与 `alwaysOnTop` 主窗口的层级冲突（猫会盖住面板，用户点不到）
- **问题**：F7 允许「独立窗口或同窗口内的面板」。若选独立窗口，而主窗口是 `alwaysOnTop:true`（F1 强制），设置窗口默认不是置顶的。
- **为什么是问题**：站长双击猫，设置面板出现在**猫下面**，被 360x440 的透明窗口压住一块，拖又拖不动，直观感受是「设置面板坏了」。这类 z-order 问题在验收现场很难解释。
- **具体修法**：F7 二选一并写明：(a) **推荐**：设置做成同窗口内的面板（配合 P0-1 的 360x440 窗口），面板展开时猫切 `listen`，面板最大高 420px 内部滚动；(b) 若坚持独立窗口：`new BrowserWindow({ parent: mainWin, alwaysOnTop: true, modal: false })` 且在面板关闭前主窗口 `setAlwaysOnTop(false)`。禁止「独立窗口 + 不给 alwaysOnTop」这个组合。

### P1-16 `--smoke-test` 的证据力不足：`pet` 字段可硬编码，且「拖完还能点」没有任何机器证据
- **问题**：§4.2 让 `--smoke-test` 打印 `{"window":true,"tray":true,"pet":"<cat 元素是否渲染>"}`。`pet` 只有渲染进程知道，必然靠 IPC 回报；冒烟只说了「打印一行」。
- **为什么是问题**：这是 F1 里被明令要求「必须验证」的那条（拖完之后还能点开对话）在整个任务书里**唯一的潜在验证点**，而现版写法允许 codex 写死 `pet: true`（它甚至不需要故意作弊——回调没来就默认 true 是最自然的写法）。那么 §7 的「只认真实输出」就退化成了一句自我声明，而这正是派单书维度 7 要防的事。
- **具体修法**：§4.2 把命令与判定写死：
  1. 主进程 `--smoke-test` 启动后等 `did-finish-load` + 3 秒，用 `webContents.executeJavaScript` 取**实测值**回读：`({cats: document.querySelectorAll('#cat').length, w: document.getElementById('cat')?.getBoundingClientRect().width, bodyBg: getComputedStyle(document.body).backgroundColor})`，把它塞进 JSON 的 `pet` 字段（打印实测对象，而不是布尔）；
  2. **3 秒内没收到渲染进程回报 → `SMOKE_FAIL render-timeout`**（禁止默认 true）；
  3. 追加第二段 `--smoke-test-interact`：`executeJavaScript` 依次派发 `mousedown(x,y) → mousemove(x+8,y) → mouseup`，再派发 `click`，回读 `#bubble` 是否存在，打印 `INTERACT_OK`/`INTERACT_FAIL`。这是「拖拽后仍能点击」唯一可自动化的证据，成本约 20 行；
  4. §6 摘要里要求贴出这两条命令的**原始输出**（不是转述），并明确「未跑 `--smoke-test-interact` 视为 F1 未验证」。

### P1-17 派单书的「codex 自证栏」在 brief 里并不存在 → 双方没有共同的验收清单
- **问题**：派单书维度 7 要求审「`codex 自证`栏里有没有 codex 根本做不到却写进去的项」。实测 brief §4/§7 只有「必须跑的命令」和一段自我迭代条款，**没有任何自证表格**。
- **为什么是问题**：说明派单书与 brief 不是同一版认知——验收时站长/调度者手里若按「有自证表」去问，codex 给不出，来回扯皮；反之若 codex 自行发挥出一张表，也没人核对。
- **具体修法**：在 brief §4 末尾加一张最小自证表（列：验收项 / 命令 / 期望输出 / 是否机器可验 / 本轮是否已跑），把「机器可验」与「只能人工看」显式分开——人工项（拖拽手感、气泡美观、深夜配色）写明「由站长现场验收，codex 不得声称已验」。

### P1-18 范围与「一小时」时限不匹配，缺降级顺序
- **问题**：§2 清单 23 个文件 + §3 的 F1–F9 + §4 两套验证 + §6 收尾，还要求 `npm install electron`（百 MB 二进制，虽有 prewarm）。一小时做完这些的余量接近零。
- **为什么是问题**：没有降级顺序时，codex 的默认策略是「样样做一点、样样不完整」，最后 `--smoke-test` 都过不了；或者它选择「先写完所有文件再验证」，一旦 electron 安装出问题就没有回头路。
- **具体修法**：brief §3 顶部加一条**交付顺序**（并要求按序停在哪一步就如实写 HANDOFF）：
  P0 必做（缺一即失败）：窗口+猫+点击出气泡+输入框+mock 回复+托盘退出+`--smoke-test`/`--smoke-test-interact` 双绿+`node --test` 全绿；
  P1 尽力：捏脸/设置面板、深夜模式、40 分钟提醒、`tools/sprite_preview.html`；
  P2 明确可延期并写进 HANDOFF：22:30 日落、托盘右键全菜单、位置持久化的边缘 clamp。
  另加一句：「未完成项必须在 HANDOFF.md 的『没做完的』里列出，**不许把没跑过的命令写成已跑过**。」

### P1-19 主进程缺全局异常兜底（双击没反应、连错误都没有）
- **问题**：brief 没写 `process.on('uncaughtException')` / `unhandledRejection`，也没要求对 `new BrowserWindow` / `new Tray(icon)` 做 try/catch。
- **为什么是问题**：主进程一旦未捕获异常，Electron 默认直接退出（窗口一瞬即消失），或卡在无窗口状态——用户看到的现象是「双击了没反应」，而这恰好是交付验收的第一动作，也是最难排的形态。
- **具体修法**：§2 的 `main.js` 职责里补：「① 入口先装 `uncaughtException` / `unhandledRejection` 处理器：写 `app.getPath('userData')/pet.log`（追加、单文件 ≤1MB 截断）并保持进程存活；② 托盘/窗口创建包 try/catch，失败时打印 `SMOKE_FAIL <原因>` 并在正常模式下退化为「只有窗口、无托盘」；③ 日志里不得写用户输入原文，只记长度与 source。」（最后半句同时是安全要求，见 SEC-009）

### P1-20 「显示大小」即时生效时的锚点未定义（改大小后猫会飘）
- **问题**：F7 要求「保存即时生效」，F1 要求「重启后窗口尺寸保持」，但没写改尺寸时窗口位置怎么调整。
- **为什么是问题**：若窗口尺寸随猫尺寸变（P0-1 若被写成那样），改大小时窗口以左上角为锚点扩展/收缩，猫看起来会往右下/左上跑，右下角贴边的猫可能直接移出屏幕；若窗口固定（推荐方案），这条自动消失——所以它是 P0-1 的连带条款。
- **具体修法**：F7 补：「显示大小只改 CSS 变量，不改窗口尺寸；若将来需要改窗口尺寸，必须以**右下角为锚点**（保持 `bounds.x + width` 与 `bounds.y + height` 不变）并重新 clamp。」

---

## 4. P2（建议：不改也能交付，改了更稳）

1. **walk 状态要明说不做**：F2 状态列表没有 walk，sprite-map 写了「walking 可选、M0 可只做静止」——请在 F2 加一句「M0 不做走动，8 方向组仅保留在 sprite-frames 表里备查、不接线」，否则 codex 可能顺手实现移动（多 8 组动画调试时间）。同时把「不做」写进 brief 的禁止清单，比留在 sprite-map 里靠人猜要省 token。
2. **alert 的「鼠标靠近」实现路径**：透明小窗口收不到窗口外的 mousemove。要真做「靠近 48px」得主进程 `screen.getCursorScreenPoint()` 轮询（约 10Hz）。建议 brief 直接降级为「指针进入猫上方区域（CSS `:hover` / mousemove 命中）→ alert」，并注明「真·靠近检测留给 M1」。
3. **窗口隐藏时暂停的两处**：F2 只写了「窗口被隐藏时暂停 rAF」。补一句：同时暂停调度 tick，并在 `visibilitychange` / `win.show()` 恢复（否则隐藏 8 小时后恢复会瞬间触发一串，见 P1-7）。
4. **首帧白闪**：`ready-to-show` 之外建议加 `backgroundColor:'#00000000'`，透明窗在 Windows 上偶发 1 帧灰底。
5. **`tools/` 的可动范围要写清**：禁止清单说「不改 `tools/*.py`」，但 brief 又要求新增 `tools/sprite_preview.html`——请明确「`tools/` 下只允许**新增** `sprite_preview.html`，三个 .py 一个字不改」，否则 codex 可能因为「tools/ 不受动」而把预览页放到别处（或反过来动了 .py）。
6. **schema 版本字段命名**：统一叫 `schemaVersion: 1`，别叫 `version`（会与 package.json 的 `version` 混淆，将来迁移脚本容易读错）。
7. **README 要写「配置不在项目目录」**：F9 要求存 `userData`，验收者很可能去项目目录找 `config.json` 找不到而判「持久化没做」。README 的「怎么验收」段落要写明 Windows 实际路径（`%APPDATA%\hermes-pet\`）以及「删掉该目录即可复现首次启动」。
8. **深夜模式「动画频率减半」实现方式择一**：「tick 间隔 ×2」还是「每帧概率 ÷2」——两种在 `node --test` 里的断言方式不同，写明一个。
9. **mock 测试补一条强度**：除「关键词命中」外，加「任意输入（含空串、纯 emoji、2000 字长串）都必须返回非空字符串」的断言，防出现空洞回复。
10. **取帧测试补字面期望值**：见 P1-12，同时补一条 256x128 边界断言（`[-7,-3] → '-224px -96px'`），防越界到第 5 行（不存在 → 白图）。
11. **HANDOFF.md 限制长度**：建议「≤120 行 / ≤1000 token」，只写做了什么、命令原文、遗留项；禁止把大段输出贴进去（`node --test` 只贴汇总行）。
12. **网关若为明文 http**：README 的「已知限制」里注明「M0 允许 `http://localhost`；换成远程地址时必须 https，否则对话内容会明文过网」。
13. **日志不含用户原文**：见 P1-19，`pet.log` 只记长度/source/时间。

---

## 5. 八大审查维度逐项结论

| # | 维度 | 结论 | 指向 |
|---|---|---|---|
| 1 | Electron 透明窗口可行性（拖拽 vs 点击自相矛盾） | ❌ 有阻塞问题：整窗 drag 已被正确禁止 ✅（这点写得好）；但**窗口几何未定义**、**透明区域鼠标策略缺失**、单击/双击未去抖 | P0-1、P0-2、P1-14、P1-20 |
| 2 | IPC / preload 安全 | ⚠️ 方向正确（明确禁止暴露 `ipcRenderer` 本体、要求白名单桥、要求 contextIsolation），但**没有要求显式写出四项开关**、没有 channel 枚举、没有说网关请求在哪个进程发 | SEC-001~004、P1-2 |
| 3 | 状态机自洽性 | ❌ 有阻塞问题：talk/listen/drag 无帧映射；打盹与 oneko「192 帧自动复位」冲突；无转移表（打盹被点击、说话被打断、拖拽结束回哪个状态都没写） | P0-3 |
| 4 | 主动行为计时器竞态 | ⚠️ 护栏集中判定 ✅ 写对了（这是 brief 最亮的一笔）；但时钟基准、睡眠唤醒、同 tick 优先级、额度消耗语义、内容 ID、排队过期、错过补发 全部缺失 | P1-7~P1-11 |
| 5 | 持久化 | ⚠️ userData ✅、原子写 ✅、schema 版本 ✅、损坏回落 ✅（四条都对）；缺 mkdir、rename EPERM 兜底、写频率、双文件一致性 | P1-13、P2-6、P2-7 |
| 6 | 降级路径 | ⚠️ 「未配置/超时/5xx → 降级 + 说人话」✅；漏了 4xx/非 JSON/缺字段/连不上/URL 非法，且超时期间无 UI 表现、协议与鉴权未定义 | P1-2、P1-3、P1-4、P1-19 |
| 7 | 验收清单可信度 | ❌ 有问题：**不存在「codex 自证栏」**（派单书假定有）；`--smoke-test` 的 `pet` 可硬编码；「拖完还能点」无机器证据；「配置持久化」不在任何自动化覆盖内 | P1-16、P1-17、P0-4 自证条款 |
| 8 | 范围 / 工具纪律 | ⚠️ 禁止清单完整 ✅（无构建工具/框架/额外依赖、不改文档素材、不碰 .env、不删 PySide6 骨架、禁 `D:\Jiayi\` 根目录建文件，都写到了；且实测 `npm.cmd`/`npx.cmd` 在位、无 pre-commit 钩子阻挡）；**但 `.gitignore` 会吞素材**、且一小时时限缺降级顺序 | P0-4、P1-18 |

**逐项写「无」的部分（明确无问题的子项）**
- 维度 1：`transparent:true`+`frame:false`+`skipTaskbar:true`+`hasShadow:false`+`show:false`+`ready-to-show` 这组参数本身在 Electron 44 / Windows 11 上无冲突 → **无问题**。
- 维度 2：`nodeIntegration` 是否被打开 → **无问题**（brief 从未要求打开，并明确禁止暴露 `ipcRenderer` 整体）。
- 维度 3：`idle/alert/tired/scratchSelf` 四态之间的转移 → **无问题**（oneko 节拍已给出，sprite-map 与 ref 逐字节一致，见 E6）。
- 维度 4：「护栏集中一处判定、不让 4 个触发源各自绕过」→ **无问题**（要求正确，只需补 §P1-8 的语义）。
- 维度 5：路径落 `app.getPath('userData')` 而非项目目录 → **无问题**（明确写了，且 .gitignore 已忽略 `.env`）。
- 维度 6：mock 是否真能兜住 → **无问题**（纯函数 + 单测覆盖，逻辑上兜得住；缺的只是 UI 表现与错误面）。
- 维度 8：误改产品设计文档 / `.env` 的风险 → **无问题**（禁止清单第 2、3 条已覆盖；`.env` 已被 .gitignore 忽略，实测 E7 同族规则生效）。

---

## 6. 🛡️ 安全审查（一票否决制）

**结论：当前 0 条已违规（因为还没有代码），但有 4 条必须在 brief 里写成硬规定，否则 codex 的默认写法就会踩中。**

- **SEC-001（一票否决级）气泡渲染必须用 `textContent`，禁止 `innerHTML`**：F3 要求「打字机逐字显示」，最流行的实现是 `el.innerHTML += ch` —— 一旦这么写，网关返回的文本或用户昵称里的 `<img src=x onerror=...>` 就是一次**真实 DOM 注入**（Electron 渲染进程虽 sandboxed，但仍能发起请求、读 `window.pet` 暴露的白名单 API）。**修法**：F3 写明「打字机用 `textContent` 累积（`el.textContent = full.slice(0, i)`），全项目禁止 `innerHTML`/`insertAdjacentHTML`/`document.write`；昵称一律走 `textContent`」。
- **SEC-002 网关请求只在主进程发，URL/KEY 不进渲染进程**：F4 未规定进程边界。**修法**：明确「`fetch` 在 `src/adapters/hermes-gateway.js`（主进程侧 require），渲染进程只经 `pet:ask` 白名单 channel 拿 `{text, source}`；渲染进程的 CSP 写 `connect-src 'none'`，从物理上禁止渲染进程发外部请求」。
- **SEC-003 preload 白名单要枚举 channel，且入参必须验型**：F1 的拖拽要求「通过 IPC 调 `win.setPosition()`」——渲染进程传进来的坐标若不校验，可传 `NaN/1e9/-1e9` 让窗口飞走或 `setPosition` 抛错；昵称、显示大小同理。**修法**：preload 只暴露 `{ pet: { setPosition(x,y), getConfig(), setConfig(patch), ask(text), setIgnoreMouse(bool) } }`，主进程每个 handler 首行做 `Number.isFinite` + `clamp(0, 屏幕宽高)`；`setConfig` 只接受白名单键（`nickname/size/remindersEnabled/autoLaunch/deepNight`）并逐键验型（size 限制 60–180 且取整）。
- **SEC-004 配置文件回读必须 schema 校验 + 已存在文件的写权限最小化**：损坏/被篡改的 `config.json` 若直接信任（`size: 1e9`、`nickname: <10 万字符>`），会造成渲染白屏或内存暴涨。**修法**：F9 写明「读入后逐字段验型 + 范围 clamp，多余字段丢弃，缺失字段取默认值；任何校验失败 → 整体回落默认值并备份原文件为 `config.json.bad`（不覆盖用户数据）」。
- **SEC-005 昵称长度与换行过滤**：`nickname` 进气泡与菜单 label，必须有上限。**修法**：≤16 字符、去换行/首尾空白、空则回落「琉斯」。
- **SEC-006 密钥**：brief「不打印密钥、不写进任何文件、日志与气泡不回显」✅ 已写到位（**无问题**）；建议再补一句「`.env` 只允许读 `HERMES_GATEWAY_URL` / `HERMES_API_KEY` 两个键，**任何情况下不得 `Get-Content .env` 全文输出到 stdout**」。
- **SEC-007 明文 http 网关**：见 P2-12，README 声明 + 仅允许 localhost。
- **SEC-008 单实例锁**：`requestSingleInstanceLock()` ✅ 已写（**无问题**），它同时避免了两个实例争写 `config.json` 的竞争。
- **SEC-009 日志不落用户对话原文**：见 P1-19 后半句。

---

## 7. ⛽ token / 上下文效率审查（省 token 规范）

- **TK-001 派单书要求 codex 读 1027 行的产品设计文档**：`hermes-pet-product-design.md` 共 1027 行，而 codex 真正需要的只有 4.2 色彩 / 4.4 尺寸 / 4.5 圆角的色值与尺寸表（实测 E10 确认这些确实在里面）。**建议**：brief 把「读产品设计文档」改成「只读 4.2/4.4/4.5 三节（其余无关，不要整篇读）」，并直接把色值抄进 brief（6 行表），可省下数千 token 与一轮探索。
- **TK-002 原始数据整包风险（`docs/_recon/`）**：该目录有 `oneko-ref.js`、`search_raw.txt`、`repos_raw.tsv`、`repos_cache.json`、`search1.json` 以及 10 个 `oga_*.html`（几十~几百 KB 不等）。brief 只说了「`M0-recon*` 不是给你的任务」，**没有说清 `_recon/` 下哪些能读**——codex 很可能把整个目录读一遍找映射依据。**建议**：brief 写明「`docs/_recon/` 默认不读；只允许读 `_recon/oneko-ref.js` 的 `spriteSets` 段落；`*.html`/`*_raw.*`/`*cache*.json` 禁止读」。
- **TK-003 输出无上限**：§4.2 要求「贴出输出」、§6 要求「给真实结果」，都没限长。**建议**：写明「`node --test` 只贴汇总行（`# pass N / # fail 0`），禁止贴全量 TAP；`--smoke-test` 只贴那 1–2 行 JSON；总摘要 ≤15 行」。
- **TK-004 HANDOFF.md 无长度约束**：见 P2-11（≤120 行 / ≤1000 token），并要求「结论引用命令输出片段，不复制整段」。
- **TK-005 重复探索（正面 + 一处待收窄）**：brief §1「运行时事实（已实测，别再探索）」写得好，直接掐掉了 Tauri/Rust/Ubuntu-GUI 三条探索分支 ✅。**唯一待收窄**：§4.3 的兜底配方要 codex 下载 ~100MB 的 electron zip —— 而我实测 `%TEMP%\electron-prewarm` 里 `dist\electron.exe` **已经在位**（E5）。**建议**：把兜底配方改成「**仅当 `node_modules\electron\dist\electron.exe` 不存在时才执行**」，避免白下 100MB（省时间也省带宽）。
- **TK-006 宽泛问法：无**（brief 把每个功能都收窄到了文件、函数、参数级，这是全文最强的一处 ✅）。
- **TK-007 密钥/无关文件接触**：brief 写了「不碰 .env」但没写「不读 .env 内容」；若 codex 为确认 URL 而 `Get-Content .env`，既烧 token 又触发密钥入上下文（与 SEC-006 同源）。**建议**：明确「只读 `.env.example`；`.env` 内两行由代码读、不进对话上下文」。另：`node_modules/`、`.venv/`（PySide6 全套，体积很大）、`.pytest_cache/` 均与任务无关，建议 brief 直接点名「禁止遍历 `node_modules/`、`.venv/`、`.pytest_cache/`」。

---

## 8. 建议追加到 brief §4 的验收命令（可直接抄）

```powershell
# 0) 环境自证（一条命令把三件事钉死，省掉后续扯皮）
docker exec hermes-pet-dev node --version                      # 期望 v20.x
& "$env:TEMP\electron-prewarm\node_modules\electron\dist\electron.exe" --version   # 期望 44.4.5
Get-Command npm.cmd,npx.cmd | Select-Object Name,Source

# 1) 纯逻辑（容器）
docker exec -w /workspace hermes-pet-dev node --test tests/     # 期望 # fail 0

# 2) GUI 冒烟（Windows 宿主）
npm install --registry=https://registry.npmmirror.com
npx electron . --smoke-test              # 期望 SMOKE_OK {...pet:{cats:1,w:180,...}}
npx electron . --smoke-test-interact     # 期望 INTERACT_OK（新增，见 P1-16）

# 3) 交付完整性（新增，见 P0-4）
git ls-files data/                       # 期望列出 8 项，非空
git log -1 --stat                        # 期望能看到 src/ tests/ package.json 等
```

---

## 9. 出入点汇总（派单书要求：一律以 brief 为准，但必须指出）

| # | brief | 其它文档 | 处置 |
|---|---|---|---|
| D1 | 休息提醒：连续活跃 **40 分钟** | features F6：连续活跃满 **2 小时** | 以 brief 为准；建议 brief 加一行「本条与 features F6 不一致，以本文件为准」，避免 codex 读 features 后回退 |
| D2 | 气泡 10 秒无回应消失 | features 2.2：问候 10s→变淡 40%→再 5s 消失；休息提醒 15s→变淡 5s→消失 | 以 brief 为准（10 秒）；「变淡 40%」建议采纳（视觉上比直接消失舒服，加 3 行 CSS） |
| D3 | 无「首次启动命名/入场动画」流程 | features F1：从屏幕右边缘探出 + 问名字 + 记住名字 | **以 brief 为准（不做）**，但这条是 features 里「第一印象决定一切」的条款，建议在 brief 的「不做」清单里显式写入「不做首次命名流程（M0 用默认昵称『琉斯』）」——写「不做」比留白好，否则站长可能按 features 验收 |
| D4 | F1–F9 编号 | features 是 F1–F11（编号含义完全不同） | 建议 codex 只认 brief 编号；HANDOFF 里引用功能时带文件名前缀，避免编号撞车 |
| D5 | 状态列表含 talk/listen/drag | sprite-map 无这三组帧 | 见 P0-3（必须补映射，否则「照抄」这条无从执行） |
| D6 | 打盹「30 分钟 → tired → sleeping，睡到用户回来」 | sprite-map 抄 oneko：sleeping 超 192 帧自动复位 idle | 见 P0-3(b) |
| D7 | 无 `walk` | sprite-map：walk「可选，M0 可只做静止，走动为 P1」 | 见 P2-1，明确不做 |
| D8 | 频率护栏：每 2 小时 ≤1 次 | features 2.1：另有「24 小时内 ≤6 次」硬上限、深夜放宽为每 4 小时 1 次 | 以 brief 为准；建议 brief 说明「24h 硬上限与深夜放宽为 M1 项」，避免 codex 自行加实现 |
| D9 | brief §0.2 引用 `docs/M0-spec.md` | 实测该文件不存在（只有 `M0-spec-request.md`） | 见 P1-1，二选一修掉 |
| D10 | 派单书假定存在「codex 自证栏」 | brief §4 无此表 | 见 P1-17，补一张最小自证表 |

---

## 10. 审查边界与待复验声明

1. **未修改任何文件**：本次核验只读了文件、跑了只读命令（`Get-Content` / `Get-ChildItem` / `git log|status|check-ignore|ls-files` / `docker ps|exec node --version` / `Test-Path`），**只新写了本报告** `docs/M0-review.md`；未创建任何其它文件或目录，未触碰 `D:\Jiayi\` 根目录，未读取 `.env` 内容（只读了 `.env.example`）。
2. **未做代码级审查**：核验时刻 `src/` 下 0 个 `.js`、`package.json` 不存在（E1），因此「实现是否符合 brief」这一层**本轮无法审**。codex 产物落地后，以下项必须复验（这几条是我认为最可能出问题、且假绿灯最可能发生的地方）：
   - `main.js` 的窗口参数与 `setIgnoreMouseEvents` 命中测试（P0-2）；
   - `state-machine.js` 的转移表与 `nap` 退出条件（P0-3）；
   - `scheduler.js` 是否真为纯函数、护栏是否只有一个出口（P1-8）；
   - `config.js` 的原子写与目录创建（P1-13）；
   - `hermes-gateway.js` 是否 `require('electron')`、是否有 `Authorization`（P1-2、P1-6）；
   - `renderer/*.js` 是否出现 `innerHTML`（SEC-001，一票否决）。
3. **最致命的一条**（如果只能改一处）：**P0-1 + P0-2 合并的「窗口几何与透明区域鼠标策略」**——它是唯一一个会让站长在验收现场**用鼠标一秒钟**就发现「点猫没反应 / 桌面点不动」的问题；排在它之后的 P0-4（.gitignore 吞素材）是**最阴的一条**，因为它能让验收通过、交付物却是残的。

**结论（重申）：修订后放行。**