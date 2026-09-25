# M1-R1 执行任务书（codex）— hermes-pet 桌宠

> 版本：v3（依 docs/M1R1-review.md 与 docs/M1R1-decisions.md 修订）
> 执行者：codex ｜ 工作目录：`D:\Jiayi\Projects\hermes-pet`
> **本文件为本轮唯一权威**，冲突以本文件为准。
> 增补来源与站长原话：A7-A13 来自站长 2026-09-23 亲口指示——「总之在操作上要不断优化、人性化。」本轮最高指导原则即此句。
> 权威链（P2 采纳）：数字类冲突以 docs/M1R1-features.md 为准，架构类冲突以本文件（task）为准。
> v3 修订依据：杠精 docs/M1R1-review.md（P0×5/P1×7/P2×9）+ 代理裁定 docs/M1R1-decisions.md。代理三处改动：P0-4 A2 节拍、P1-2 Alt+M 语义、P1-3 全屏真探测。

## 0. 先做这些（【P2-7】按节读取，不整读大文件）
1. 读 docs/M1R1-spec.md（v3 架构唯一依据，含 P0/P1 修订对照索引）。
2. 读 docs/M1R1-features.md（v3，A1-A13 手感与精确数字，照抄常数）。
3. 读 docs/M1R1-supplement.md（A7-A13 增补原委 + 站长原话）。
4. 读 docs/M0-sprite-map.md 第 1-6 节（8 向帧组照抄，别猜索引）。
5. 【P2-7】HANDOFF.md 只读 §11/§12/§13：先用查找定位再只读该节，命令：
   `Select-String -Path HANDOFF.md -Pattern '^## 11|^## 12|^## 13'` 拿行号，再 `Get-Content HANDOFF.md | Select-Object -Skip <行-1> -First <n>`。并先把 §11-§13 摘成 docs/_m1r1/handoff-digest.md（中间产物，允许放 docs\_m1r1\）。
6. 读 docs/M0-CODEX-BRIEF.md §5「不要做什么」与 §4「自证要求」。

## 1. 运行时事实（实测，别再探索）
- Windows 11；Node v24（宿主 `node --test tests/*.test.js`）；容器 hermes-pet-dev（Node 20，`node --test tests/`）。
- Electron 44.4.5；CommonJS；无构建、除 electron 外零依赖。
- M0 现状：92 单测全绿；--self-check 18/18；--smoke-test SMOKE_OK 5/5。

## 2. 交付文件清单（逐文件）

### 2.1 src/core/sprite-frames.js（改）
direction8(dx,dy)（8 向量化，边界钉死）；spriteForWalk(direction)/spriteForLook(direction)（walk 2 帧、look 第 0 帧单帧）；STATE_SPRITES/PET_STATES 加 walk/look。

### 2.2 src/core/state-machine.js（改，【P1-1】）
- 新增 walk、look 状态；walkCadenceMs=250（深夜减半 500ms）。
- ALLOWED.walk=['idle','talk','listen','drag','walk','look']；ALLOWED.look=['idle','talk','listen','drag','walk','look']；其余状态只增不减。
- EVENT_TARGETS 加 walk:start/walk:step/walk:end/look:start/look:end；收到 talk/listen/drag 类事件先隐式 walk:end（用户主动优先）。
- 单测：walk 中 click→talk、walk 中 drag:start→drag。

### 2.3 src/core/walk.js（新增，【P0-4】）
WALK_COOLDOWN_MS=180000、WALK_CHANCE=1/300、WALK_SPEED_PX_S=40（深夜 20）、WALK_STOP_DIST_PX=120、WALK_MAX_DIST_PX=100、WALK_MAX_MS=3000、CURSOR_QUIET_MS=5000、CURSOR_QUIET_PX=120。删「50 秒」表述。加 1 小时虚拟时间断言散步次数∈[10,20]。光标安静规则、120px 停距、40px/s、≤100px/≤3s、四类禁止态保留不动。纯函数注入 now/random。
【复核补】上面那条 1 小时区间断言**必须用固定种子 / 注入确定随机序列**——均值 15、σ≈3.9，用真随机单次抽样有 ±1.3σ 落空的概率，会造成偶发红灯。

### 2.4 src/core/quiet.js（新增，【P1-3】）
shouldBeQuiet(signals)->bool，signals={foregroundFullscreen,typingBurst,dnd,paused,hidden,deepNight}。foregroundFullscreen 必须含且可注入、true/false 单测都覆盖。
【复核补】探测实现须**导出一个可单独调用的函数** `detectForegroundFullscreen()`（供 §3.1 第 6 条自测命令真跑一次），证明探测真的出结果，而不只是接口存在。

### 2.5 src/core/position.js（改，【P0-5】）
snapToEdge(bounds,workArea,threshold=20,breathe=4)：四边距离取最小、命中贴边留 4px；多边并列优先级 左>右>上>下。单测覆盖：四边内侧 10px/边界 20px、21px/已出屏 96px/窗口大于 workArea/多屏偏移。

### 2.6 src/core/scheduler.js（改，【P1-4】）
- RETURN_AFTER_ABSENCE_MS=30min；TRIGGERS 加 return；runtime 加 returnPending。
- markActivity 检测 30min 缺席→returnPending=true，置位必须在 guardTick 之后（回拨不置位；drift 允许置位一次，唤醒后允许一次「回来了」是预期）。
- pickTrigger 优先级 sunset>greeting>return>break；plan() 接入 quiet + 2h 降档（activeSessionMs≥2h 除 break 外不开口）；recordSpoken/recordIgnored 消费 returnPending。
- 单测：跨天重置/回拨不置位/2min 不置位/31min 置位。

### 2.7 src/core/config.js（改，【P0-2】+【P1-5】）
- DEFAULT_CONFIG 加 dnd:false、shortcuts 默认四键；DEFAULT_STATE 加 onboarded:false。
- migrateConfig(rawConfig, rawState)（独立纯函数，loadConfig/ensureConfig 层调用，不下沉 coerceNickname；**【复核补】签名必须同时拿到 config 与 state**——第三个条件要判 state 是否含 onboarded，或由调用方注入 hasOnboarded 布尔）：schemaVersion<2 且 nickname==='琉斯' 且 state 无 onboarded → nickname='你'、onboarded=false；schemaVersion 1→2。
- zoomSize(size,delta)、normaliseUserName(value)（先去 \u0000-\u001F 与 \r\n → trim → 截断 24 字，顺序写死）、coerceShortcuts(raw)。
- NICKNAME_DEFAULT 注释改「猫对用户的称呼（猫名『琉斯』写死在自我介绍，不进此字段）」。

### 2.8 src/core/window-guards.js（改，【P0-1】）
watchdogAction() 加 dnd 维度：dnd===true 无视 lastInteractive 一律 'force-ignore'；dnd 缺省/false 时 lastInteractive===true 仍 'noop'（8 组合穷举测试不改红，只追加 dnd 维度）。单测：dnd=true+lastInteractive=true→force-ignore。

### 2.9 src/main.js（改，最多）
- A5【P0-1】：setDnd(true) 无条件 reassertPassThrough('dnd-on')+lastInteractive=false；setDnd(false) reassertPassThrough('dnd-off')；applyIgnoreMouse 首行 dnd 短路；托盘 icon-night.png+tooltip。
- A7【P1-2】【P2-6】：globalShortcut 注册/冲突/注销；register false 或抛异常→settings 标红+托盘提示；改键先 unregister 旧再 register 新（失败回滚）；每次 register 前 unregister 同键；will-quit unregisterAll；SMOKE_TEST 跳过注册；Esc 不全局（渲染局部）。Alt+M=切换 config.proactiveEnabled（非 paused）。Alt+T 抢焦点写文档承认（触发后前台化窗口）；被占用列表放运行时内存+广播，不写 config.json。
- A12【P1-7】：applyAutoLaunch(options.injectSetLoginItem)；catch 里给用户可见提示（托盘 tooltip/气泡）。
- A13【P1-3】：采集 foregroundFullscreen（PowerShell 探测，节流~2s，失败降级 false，可注入/mock，本轮必做不许跳过）与 typingBurst（渲染 IPC 击键密度）。
- A1：onboard:complete/onboard:skip IPC（skip 落 nickname='你'）；A2：walkTimer（walkTick 100ms 步进 4px，每步同步 baseBounds【P2-4】）；A6：pet:drag-end 顺序 clampFullyInside→snapToEdge→兜底【P0-5】；走动中 pet:bubble-resize 先 walk:end 再 syncWindowBounds【P2-4】。
- pushConfig 加 dnd 广播；smokeOutcome 加 dnd 字段（probeMousePassThrough 光标无关模式）；runSelfCheckFlow 注入新能力。

### 2.10 src/preload.js（改，【P1-5】）
completeOnboarding/skipOnboarding/setDnd/setShortcut/copyText(text)。copyText：typeof==='string'、长度≤4096（超出截断+气泡说明）、只允许当前气泡可见文本。bubbleClosed→'bubble:closed' 死通道补 handler【P2-9】。

### 2.11 src/renderer/pet.js（改，【P1-5】【P2-1】【P2-2】）
- A1 onboarding（textContent）、A2 walk、A3 look（【P2-2】方向用主进程 catX/catY 修正，不用 window.screenX）、A4 wheel、A5 dnd（短路上报 ignore:true【P0-1】）。
- A8 dblclick→copyText+「已复制」1s 淡出（空文本不提示）；A9 ↑ 空回填历史；A10 长按≥1s 固定+图钉（打断优先）；A11 直接拖拽+半透明反馈。
- A13 位移>5px 判拖拽；原地 click 才开对话；【P2-1】保持 DOUBLE_CLICK_MS=320，只把单击动作延迟到该窗口之后。
- 【P1-5】所有含用户输入/AI 回复的 DOM 写入走 textContent/setText，onboarding 气泡/已复制/图钉标记禁用 innerHTML/insertAdjacentHTML。

### 2.12 src/renderer/settings.html/js（改，【P1-2】）
快捷键区块（列四绑定/改键/恢复默认/被占用标红）；「静音」项文案「静音（不主动说话）」绑 proactiveEnabled。

### 2.13 tools/selfcheck.js（改，【P1-6】补 4 条自证门）
新增（全确定性，不读真实光标；shortcut 用不常用测试键验完即注销），目标 **18 → 37 项**（计数口径经杠精复核修正）：
- 主线：walk-state-exists / look-state-exists / dnd-locks-passthrough / snap-to-edge / zoom-clamp / onboarded-field / return-trigger / shortcut-register / shortcut-occupied / shortcut-unregister-all / copy-bridge / history-↑ / bubble-pin。
- 【P1-6】quiet-blocks-proactive（六信号各一次→plan 不开口且 walk 不发）/ walk-guards（dnd/paused/对话中/拖后2s 四种 shouldWalk 假）/ config-migrate-nickname（喂 schemaVersion:1+nickname:'琉斯'→非「琉斯」）/ return-clock-guard（回拨不置位/跨天重置/合盖唤醒只判一次）。
- 【P1-5】copy 超长文本被截断/拒绝断言。
- 【P1-7 复核补】**autolaunch-failure-injected**（注入一个抛错的 setLoginItem 替身 → 断言 applyAutoLaunch 被调用一次、且产生了一条用户可见提示）。

### 2.14 tests/（改/增）
新增 walk.test.js、quiet.test.js；扩展 state-machine（walk/look 出口）/ sprite-frames（direction8）/ config（migrateConfig、shortcuts 校验）/ scheduler（quiet、2h、return、跨天回拨）/ position（snapToEdge 六场景）/ window-guards（dnd 维度）。
- **92 条旧用例一条不许红。**
## 3. 验收清单（两栏）

### 3.1 codex 自证（必须全绿才算完）
| # | 命令 | 期望 |
|---|---|---|
| 1 | `node --test tests/*.test.js`（宿主 Node 24） | 全绿，新增用例覆盖 A1-A13，92 旧用例零红 |
| 2 | `docker exec -w /workspace hermes-pet-dev node --test tests/`（容器 Node 20） | 同一批文件全绿 |
| 3 | `docker exec -w /workspace hermes-pet-dev sh -c '... node --check ...'`（语法体检 glob，含新增 walk.js/quiet.js） | ALL_JS_SYNTAX_OK |
| 4 | `npx electron . --smoke-test` | SMOKE_OK（含新 dnd 字段）退出码 0，连跑 5 次 5/5 |
| 5 | `npx electron . --self-check` | SELFCHECK_OK n/n（**n≥37**，与 §2.13 清单的 19 项新增自洽） |
| 6 | 【复核补】全屏探测自测（命令形式自定，须真跑一次，如 `node -e` 调 `detectForegroundFullscreen()` 打印结果） | 能打印出探测结果；**把真实输出贴进 HANDOFF**（证明探测真出结果，不只接口存在） |

【P2-8】证据贴法：只贴每轮 SMOKE_OK {...} 行 + 汇总行；完整日志落 docs/_m1r1/，正文只给路径。HANDOFF 追加节 ≤120 行。

### 3.2 人工（站长）验收
| 功能 | 站长怎么看 |
|---|---|
| A1 入场 | 首启猫探出+张望+跳到底部中央、问名字；答完改称名字；重启不再问；升级后第一条主动话术不出现「琉斯」 |
| A2 追鼠标 | 低频、慢（40px/s）、追不到（120px 停）、光标一动就停、忙时不走、安静陪伴；10 分钟内 2-3 次 |
| A3 悬停 | 停猫上 0.5s 看向光标；快速扫过不触发；离开 0.3s 回正 |
| A4 滚轮 | 猫上滚轮 ±10% 顺滑、不误触气泡滚动/拖拽/设置面板、重启保持 |
| A5 别烦我 | 托盘勾选后点猫穿透到桌面（含「鼠标压猫上时开 dnd」场景）、图标+tooltip 区分、可恢复、重启保持 |
| A6 吸附 | 拖到边缘松手吸附贴边（留 4px）；离开 >30 分钟回来有「回来了」 |
| A7 快捷键 | Alt+H 显示/隐藏、Alt+T 出输入框聚焦、Alt+S 出设置、Alt+M 静音（不主动说话）、Esc 仅猫聚焦时生效；改键旧键失效新键生效；被占用有提示；退出无幽灵占用 |
| A8 双击复制 | 双击气泡→记事本 Ctrl+V 得全文；「已复制」提示非系统通知；空文本不提示；超长被截断 |
| A9 ↑ 编辑 | 输入框空按 ↑ 回填上一条；非空不劫持 |
| A10 固定气泡 | 长按≥1s 固定且图钉可见；超 10s 仍在；再长按/Esc 解除 |
| A11 拖拽反馈 | 按住即拖无 1s 等待；拖拽中半透明+方向帧 |
| A12 开机自启 | 打开开关→系统登录项出现 hermes-pet（可脚本查 HKCU\Software\Microsoft\Windows\CurrentVersion\Run） |
| A13 打扰边界 | 全屏前台不主动说话/走动、退出恢复、全屏中点击仍能唤对话；高速打字不打扰；2h+ 更安静 |

## 4. 不要做什么
- 不引构建工具 / UI 框架 / 任何新 npm 依赖（除 electron；A13 全屏探测走 child_process 跑 PowerShell 属零 npm 依赖，可接受）。
- 不改 docs/M0-*.md、hermes-pet-product-design.md、data/sprites/、tools/*.py、src/adapters/、src/hermes_pet/、pyproject.toml。
- 【P0-3】不改 HANDOFF.md 第 1-13 节既有内容；只允许在文末追加 §14 M1-R1，追加不得修改任何已有行。
- 不改 docs/M1R1-spec.md、docs/M1R1-features.md、docs/M1R1-supplement.md、docs/M1R1-review.md、docs/M1R1-decisions.md（输入不是输出）。
- 不碰 .env、不打印/落盘任何密钥。
- **禁止在 D:\Jiayi\ 根目录新建任何文件/文件夹**；中间产物放 docs\_m1r1\。
- 不删任何既有文件、不改 M0 状态机已有转移条目（只增不减）。
- 【P1-5】所有含用户输入或 AI 回复的 DOM 写入必须走 textContent/setText；onboarding 气泡、「已复制」标记、固定图钉标记一律不得用 innerHTML/insertAdjacentHTML。
- A8 不改 user-select:none（气泡文字选不中是刻意，保留）；不弹系统通知。

## 5. 已知坑（务必照做）
1. 测试命令两套写法：宿主 Node 24 `node --test tests/*.test.js`（glob），容器 Node 20 `node --test tests/`（目录）——两套写同一批文件，都要跑。
2. 坐标一律 DIP：屏幕/窗口/光标/吸附全用逻辑像素，别混物理像素（HANDOFF §11：scaleFactor=2 时 288 物理窗口和 1440 逻辑屏混算得 1128/588）。
3. 验收门与物理环境解耦：selfcheck 新增项只读纯逻辑/状态机/config，别读会被光标合法改写的活状态（M0 第五轮教训）。
4. 改完必须重启 electron 再验：smoke/self-check 冷启动，先 Get-Process electron | Stop-Process -Force。
5. A7 globalShortcut：register false=被占用、register 抛异常都要 catch；Esc 绝不全局；will-quit unregisterAll；改键先 unregister 旧再 register 新（失败回滚）；每次 register 前 unregister 同键（幂等）。selfcheck 只用不常用测试键、验完即注销。
6. A13 全屏探测本轮必做：PowerShell 探测节流~2s、失败降级 false、做成可注入/mock；**不许「拿不准就跳过」**。
7. 新增 .js（walk.js/quiet.js）加进 §3.1 第 3 条语法体检 glob。

## 6. 自我迭代条款
写完不算完：你必须自己跑完 §3.1 全部命令 → 看到红就修 → 重跑 → 直到 node --test 两套全绿（92 旧用例零红）且 --smoke-test 5/5 SMOKE_OK 且 --self-check SELFCHECK_OK n/n，才允许交付。修自己的问题，不许把「应该能跑」当证据。完成后写 HANDOFF.md 追加 §14 M1-R1（真实输出，≤120 行），git add -A && git commit（中文 message，格式 feat(M1): ...），不要 push。

## 7. 收尾回复
≤15 行摘要：文件清单 / 各验收命令真实结果 / 新增 selfcheck 项数 / 遗留问题。别把大段代码回聊天里。