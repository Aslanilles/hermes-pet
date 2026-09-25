# M1-R1 规格设计（hermes-pet）

> 版本：v3（依 docs/M1R1-review.md 与 docs/M1R1-decisions.md 修订）
> 作者：包工头👷（架构） ｜ 执行者：codex
> 增补来源与站长原话：A7-A13 来自站长 2026-09-23 亲口指示——「总之在操作上要不断优化、人性化。」本轮最高指导原则即此句。
> v3 修订依据：杠精 docs/M1R1-review.md（P0×5 / P1×7 / P2×9）+ 代理裁定 docs/M1R1-decisions.md。代理对杠精方案有三处改动（以本文件为准）：P0-4 A2 节拍、P1-2 Alt+M 语义、P1-3 全屏真探测。
> 权威链（P2 采纳）：数字类冲突以 docs/M1R1-features.md 为准，架构类冲突以 docs/M1R1-task.md 为准。
> 原则：照 M0 架构扩展，不重造；不破坏 M0 护栏；只设计，不写实现。

## 0. v3 修订对照索引（供杠精逐条检索，编号=review 原文）

| 编号 | 修订结论 | 落地位置 |
|---|---|---|
| P0-1 | A5 穿透所有权：开/关双向重断言 + watchdogAction 加 dnd 维度 + 渲染短路上报 | §7 |
| P0-2 | A1 nickname 迁移：migrateConfig 独立纯函数 + schemaVersion 1→2 + skip 落「你」 | §3、§9 |
| P0-3 | HANDOFF 追加边界：只许文末追加 §14，不改 1-13 节 | task §4 |
| P0-4 | A2 节拍：冷却 180s + 抽签 1/300，平均约 4 分钟，验收 10 分钟 2-3 次 | §4 |
| P0-5 | A6 吸附顺序：clampFullyInside → snapToEdge → 兜底，优先级 左>右>上>下 | §8 |
| P1-1 | walk/look 补用户交互出口（只增不减） | §2 |
| P1-2 | Alt+M = proactiveEnabled（非 paused） | §11 |
| P1-3 | A13 全屏本轮真探测（删降级许可） | §12.6 |
| P1-4 | A6 回来招呼判据：猫窗口内活动 + guardTick 之后置位 | §8 |
| P1-5 | 安全：textContent / normaliseUserName 净化 / copyText 约束 | §12 |
| P1-6 | 补 4 条自证门 | task §2.13 |
| P1-7 | A12 失败路径可注入 | §12.5 |

## 1. 改动面总表

| 文件 | 动作 | 改动 |
|---|---|---|
| src/core/sprite-frames.js | 改 | direction8() / spriteForWalk() / spriteForLook()；STATE_SPRITES、PET_STATES 加 walk/look |
| src/core/state-machine.js | 改 | 新增 walk/look 状态与事件；ALLOWED/EVENT_TARGETS 扩展（P1-1 出口）；walkDir/gazeDir/walkCadenceMs |
| src/core/walk.js | 新增 | 走动纯逻辑（冷却 180s + 抽签 1/300 + 走速/停距/上限/光标安静规则/禁止态） |
| src/core/quiet.js | 新增 | A13 静默判定纯函数（foregroundFullscreen/typingBurst 归一为 quiet） |
| src/core/position.js | 改 | snapToEdge()（四边取最小、优先级左>右>上>下、breathe=4） |
| src/core/scheduler.js | 改 | return 触发源、RETURN_AFTER_ABSENCE_MS、returnPending（guardTick 后置位）；plan() 接入 quiet + 2h 降档 |
| src/core/config.js | 改 | dnd/shortcuts/onboarded 字段；zoomSize()/normaliseUserName()/coerceShortcuts()/migrateConfig()（P0-2） |
| src/core/window-guards.js | 改 | watchdogAction() 加 dnd 维度（P0-1） |
| src/core/replies.js | 改 | PROACTIVE_LINES 复用 wake（return）；A1 问名/回名文案 |
| src/main.js | 改 | walk 定时器、dnd 裁决、onboard IPC、drag-end 吸附顺序、return 接线、globalShortcut、A12 失败提示（注入式）、A13 全屏探测、smoke/selfcheck |
| src/preload.js | 改 | completeOnboarding/skipOnboarding/setDnd/setShortcut/copyText（P1-5 约束） |
| src/renderer/pet.js | 改 | onboarding 气泡、walk/look、wheel、dnd、悬停、A8 复制、A9 ↑、A10 固定、A13 单击/双击（P2-1 保持 320） |
| src/renderer/pet.css | 改 | 入场动画、look 过渡、A10 图钉、A11 拖拽半透明 |
| src/renderer/settings.html/js | 改 | A7 快捷键区块 + 静音=proactiveEnabled 文案（P1-2） |
| tools/selfcheck.js | 改 | 新增 A1-A13 + P1-6 四条自证门 |
| tests/*.test.js | 改/增 | walk.test.js/quiet.test.js；扩展 state-machine/sprite-frames/config/scheduler/position/window-guards |

不改：docs/M0-*.md、HANDOFF.md 第 1-13 节、hermes-pet-product-design.md、data/sprites/、tools/*.py、src/adapters/、src/hermes_pet/、pyproject.toml。

## 2. 状态机整合（A2/A3 核心）

### 2.1 新增状态与方向
新增 walk 与 look，复用 oneko 8 方向组 N/NE/E/SE/S/SW/W/NW：walk 按运动方向取 8 向、2 帧交替；look 按「猫中心→光标」角度取 8 向单帧（走帧第一帧）。新增 direction8(dx, dy)，walk/look 共用，边界写死并单测。

### 2.2 转移表（【P1-1】补用户交互出口，只增不减）
```
walk:start(dir)  : idle|alert -> walk
walk:step(dir)   : walk -> walk（只更新方向）
walk:end         : walk -> idle
look:start(dir)  : idle|alert -> look
look:end         : look -> idle
```
【P1-1】ALLOWED.walk = ['idle','talk','listen','drag','walk','look']；ALLOWED.look = ['idle','talk','listen','drag','walk','look']。EVENT_TARGETS 明确：收到 talk/listen/drag 类事件时先隐式 walk:end（走动中点猫→talk、走动中 drag:start→drag，用户主动永远优先，对齐 A13 反向边界）。单测：walk 中 click 到 talk、walk 中 drag:start 到 drag。M0 既有 8 态条目一条不改（只增不减，92 旧用例零红）。

### 2.3 取帧与节拍
cadenceFor：walk 用 walkCadenceMs（白天 250ms≈4fps，深夜减半 500ms）；look 单帧。8 向映射是新函数，不复用 drag 的 SE/SW 二选一。

## 3. A1 初见与命名（【P0-2】迁移）

### 3.1 字段与迁移
- config.nickname = 用户名字（猫名「琉斯」写死不进此字段）；state.onboarded（bool，默认 false）。
- 【P0-2-1】迁移不下沉进 coerceNickname()（否则 tests/config.test.js:39 的「'  琉斯  ' → '琉斯'」当场红）。新增独立纯函数 migrateConfig(raw)，只在 loadConfig/ensureConfig 层调用；单测单独写。
- 【P0-2-2】规则：schemaVersion < 2 且 nickname === '琉斯' 且 state.json 无 onboarded 字段 → 判旧语义残留：nickname = '你'、onboarded = false（走初见流程）。schemaVersion 1 → 2。
- 【P0-2-3】skipOnboarding（Esc/跳过）时 nickname 落「你」（别留「琉斯」）。
- 【P0-2-4】NICKNAME_DEFAULT 注释改为「猫对用户的称呼（猫名『琉斯』写死在自我介绍里，不进此字段）」。
- 【P0-2-5】验收硬判据：升级后第一条主动话术不得出现「琉斯」称呼；selfcheck 加 config-migrate-nickname（喂 schemaVersion:1 + nickname:'琉斯'，断言结果非「琉斯」）。

### 3.2 交互链路
首启 onboarded===false → 入场动画 → 气泡「你好，我是琉斯。你叫什么名字？」→ composer。completeOnboarding 走 normaliseUserName（【P1-5】先去控制字符与 \r\n → trim → 截断 24 字，顺序写死）：空/纯空白继续等；拒绝词（不要/不/算了/随便/不知道）→ nickname='你'、onboarded=true；正常记名 onboarded=true；脏话不审查原样截断。skipOnboarding → nickname='你'、onboarded=true。改名字入口=设置面板昵称框。

## 4. A2 走路 + 偶尔追鼠标（【P0-4】代理方案）

### 4.1 纯逻辑 src/core/walk.js（常数=代理裁定，非杠精 a/b）
```js
WALK_COOLDOWN_MS = 180000  // 上次散步结束起 3 分钟硬冷却，冷却期内不抽签
WALK_CHANCE = 1/300        // 冷却过后每个 200ms tick 抽签 0.33%，期望再等约 60s
                            // → 平均 180s + 60s = 240s ≈ 4 分钟一次（约 15 次/小时）
WALK_SPEED_PX_S = 40       // 白天；深夜 20
WALK_STOP_DIST_PX = 120    // 距光标 ≤120px 立即停（追不到）
WALK_MAX_DIST_PX = 100     // 单次位移上限
WALK_MAX_MS = 3000         // 单次持续上限（先到先停）
CURSOR_QUIET_MS = 5000     // 近 5s 光标累计位移
CURSOR_QUIET_PX = 120      // 累计位移 >120px = 高频操作 = 禁止散步
shouldStartWalk({ now, lastWalkAt, cursorQuiet, state }) -> bool
walkStep({ from, cursor, dir }) -> { dir, dx, dy, done }
```
【P0-4】删掉「期望约 50 秒想走一次」表述。验收改写为「10 分钟内能看到 2-3 次」（与 3-5 分钟节拍自洽）。必须加可脚本化判据：注入 random/now 跑 1 小时虚拟时间，断言散步次数落在 [10, 20]。
【P0-4 红线】「光标近 5s 累计位移 >120px 就不走」这条全篇最漂亮，调频率时不许碰；120px 停距、40px/s（深夜 20）、单次 ≤100px/≤3s、四类禁止态全部保留不动。

### 4.2 主进程接线
walkTimer 100ms 步进 4px（40px/s）；dnd/paused/拖拽中(含拖后2s)/对话中/打盹睡觉/隐藏/高频操作/quiet → 停走。【P2-4】walkTick 每步同步 baseBounds；bubbleContent 非空或 dialogueOpen 停走；走动期间 pet:bubble-resize 先 walk:end 再 syncWindowBounds。走动期间不落盘，走完才 persistPosition。

## 5. A3 悬停反应（【P2-2】坐标）
- 【P2-2】方向计算用主进程下发的窗口矩形（复用 pet:window-shift 的 catX/catY）修正后再量化；不得用渲染进程 window.screenX（HANDOFF §13 记过它滞后）。
- 连续≥500ms → look:start(direction8)；离开延迟 300ms(debounce)→look:end；快速扫过(<500ms)不触发。look 复用 8 向单帧。

## 6. A4 滚轮缩放
- zoomSize(size, delta)：+1→round(size*1.1)、-1→round(size*0.9)，再 clampSize(60-180)。
- 只在猫矩形内监听 wheel，排除气泡滚动区/composer聚焦/拖拽/dnd；100ms debounce；写回 config:set→recenterForSize。
- 【P2-5】缩放落盘（debounce 那次）顺带走一遍 snapToEdge：贴着哪条边就还贴哪条边。
## 7. A5 别烦我 / 透明模式（【P0-1】穿透所有权，本轮最容易做错）

- 现状：主进程默认 setIgnoreMouseEvents(true,{forward:true})；渲染 refreshPassthrough() 命中测试；两条看门狗。
- 决定权：主进程 applyIgnoreMouse() 是穿透状态唯一裁决点，dnd 为真时无条件输出 ignore=true。
- 【P0-1-1】setDnd(true) **无条件**执行一次 reassertPassThrough('dnd-on')（直接复用 src/main.js:746 那个函数，别另写），并把 lastInteractive = false；setDnd(false) 保留 reassertPassThrough('dnd-off')。**写死「开 / 关两个方向都要重断言」**（堵「鼠标正压在猫身上时开 dnd，状态卡在 ignore=false」的洞）。
- 【P0-1-2】watchdogAction() 加 dnd 维度：dnd === true 时无视 lastInteractive，一律返回 'force-ignore'。同时保留原红线：dnd 缺省/false 时 lastInteractive === true 仍必须 'noop'（M0 的 8 组合穷举测试不许改红，只追加 dnd 维度）。
- 【P0-1-3】渲染进程在 dnd 短路时也要上报一次 { ignore: true }，保证 lastInteractive 缓存不在 dnd 下腐烂。
- 【P0-1-4】两条断言：单测「dnd=true + lastInteractive=true → force-ignore」；selfcheck/冒烟加 dnd-locks-passthrough（开 dnd 后 2 秒内 ignoreMouseActive 必须 true，照 M0 第五轮 probeMousePassThrough() 光标无关模式做）。
- 字段 config.dnd（bool，默认 false）。托盘菜单可勾选项；dnd 开 → 托盘 icon-night.png（不改素材）+ tooltip「别烦我：开」。点猫静默。
- 【P2-3】dnd 下：不听主动话术、不走动；仍可看光标（look，被动反应保留）。三处（features §4 表 / features §2 / spec §10）对齐此句。

## 8. A6 边缘吸附 + 回来招呼（【P0-5】吸附顺序 +【P1-4】判据）

### 8.1 边缘吸附（【P0-5】）
- 【P0-5-1】drag-end 顺序写死：clampFullyInside(窗口矩形, workAreaFor(矩形)) → 然后 snapToEdge(bounds, workArea, 20, 4) → 再 clampFullyInside 一次兜底。即吸附只在「完整在屏内」的窗口上判距离（堵 M0 clampToArea(MIN_VISIBLE=48) 允许窗口出屏 96px 导致永不吸附的洞）。
- 【P0-5-2】snapToEdge 判据：窗口四边到 workArea 四边距离取最小；命中即贴该边并留 breathe = 4px。
- 【P0-5-3】多边同时命中优先级写死：距离最小者优先；并列时 左 > 右 > 上 > 下。
- 【P0-5-4】坐标一律 DIP；多屏取窗口所在显示器 workArea；自证里禁止出现物理像素算式（M0 第三轮已错一次）。
- 【P0-5-5】单测：四边内侧 10px / 边界 20px、21px / 已在屏外 96px / 窗口大于 workArea / 多屏偏移 workArea。

### 8.2 回来招呼（【P1-4】）
- 【P1-4-1】判据文案：距上一次「猫窗口内活动」≥30 分钟（删「期间无鼠标/键盘」——M0 无全局键鼠钩子，HANDOFF §5）。
- 【P1-4-2】markActivity 里 returnPending 置位必须在 guardTick 之后：时间回拨 → 不置位；drift（合盖唤醒 now-lastTickAt>2min）→ 允许置位一次，写明「唤醒后允许一次『回来了』」是预期行为。
- 【P1-4-3】单测：跨天重置 / 时间回拨不置位 / 2 分钟内不置位 / 31 分钟置位。
- pickTrigger 优先级 sunset>greeting>return>break；recordSpoken/recordIgnored 消费 returnPending；额度耗尽只做醒来动作不开口（复用 wake 文案）。占主动说话额度。

## 9. 持久化 schema 变更（【P0-2】迁移，schemaVersion 1→2）

| 文件 | 字段 | 默认值 | 兼容 |
|---|---|---|---|
| config.json | schemaVersion | 2 | 1→2，见 migrateConfig |
| config.json | dnd | false | 旧文件缺字段 → merge 补 false |
| config.json | shortcuts | { toggle:Alt+H, chat:Alt+T, settings:Alt+S, mute:Alt+M } | 缺字段 → merge 补默认 |
| state.json | onboarded | false | 缺字段 → merge 补 false |
| state.scheduler | returnPending | false | 缺字段 → 补 false |

【P0-2】migrateConfig(raw)：schemaVersion<2 且 nickname==='琉斯' 且 state 无 onboarded → nickname='你' + onboarded=false。只在 loadConfig/ensureConfig 层调用，不下沉 coerceNickname。shortcuts 校验（coerceShortcuts：四键名合法 + 加速度串格式，非法回落默认）。

## 10. 护栏与额度判定
- A2 走动 = 不占主动说话额度，独立低频护栏（冷却 180s + 抽签 1/300），被 paused / dnd / quiet 禁掉。
- A6 回来招呼 = 占主动说话额度，走 scheduler.plan() 全量护栏。
- A13 静默 = quiet 与 paused/hidden/dnd 并列接入 plan() 与 walk；只禁主动打扰，不禁用户召唤。
- 连续工作 2h+ = 更安静：activeSessionMs≥2h 时除 break 外主动触发降为动作不开口。

## 11. A7 全局快捷键（【P1-2】Alt+M +【P2-6】）
- globalShortcut 四个可改键存 config.shortcuts（toggle/chat/settings/mute），Esc 不进、不可自定义。
- 注册失败降级：register 返回 false 即被占用，捕获后 settings「被占用」标红 + 托盘提示，绝不静默；register 可能抛异常也要 catch。逐个尝试，失败不影响其它键。
- Esc 不许全局抢：渲染进程窗口聚焦时局部 keydown 监听。
- 退出 unregisterAll；改键先 unregister 旧再 register 新（失败回滚保留旧键）；每次 register 前先 unregister 同键（幂等）。
- 【P1-2】Alt+M = 切换 config.proactiveEnabled（静音=不主动说话），**不复用 paused**、不新增 muted 字段。理由：paused 会连带动 shouldReassertTopmost 与托盘「暂停动画」勾选态串味；proactiveEnabled 是 M0 已有的主动提醒总开关，最诚实对应「静音」。设置面板文案改「静音（不主动说话）」，托盘同步；幂等（再按恢复）。
- 【P2-6】① Alt+T 抢焦点取舍写进文档承认（触发后前台化窗口）；② 被占用列表放主进程运行时内存 + 通道广播，不写 config.json（运行时态别污染偏好文件）。
- smoke/self-check 不注册真实快捷键（会抢用户键位）；selfcheck 用不常用测试加速键验完即注销。

## 12. A8-A13 增补（操作人性化）

### 12.1 A8 双击气泡 → 复制文本（【P1-5】安全）
- 事实：pet.css body 已 user-select:none，气泡文字选不中是刻意，保留不改（杠精已确认「不是冲突」）；双击复制是唯一取文途径。
- 【P1-5】copyText(text)：preload 侧校验 typeof==='string'、长度上限 4096（超出截断并在气泡说明）、只允许写当前气泡可见文本（不接受任意来源）。dblclick → 全文进剪贴板 + 右上角「已复制」1s 淡出（非系统通知）。空文本不提示。

### 12.2 A9 输入框 ↑ 编辑上一条
仅在输入框为空时按 ↑ 回填上一条（历史栈内存态，连续 ↑ 更早）；非空不劫持。

### 12.3 A10 长按气泡 → 固定气泡
长按 ≥1s → 固定（跳过 10s 超时）+ 图钉/边框标记（必须可辨）。打断信号（单击/拖拽/打字）仍优先，固定不锁死。再长按/Esc 解除。

### 12.4 A11 长按拖拽准备（砍长按门槛，杠精已确认）
保留 M0 直接拖拽（按住即拖、无 1s 等待）；补拖拽瞬间即时视觉反馈（半透明 + 方向帧 spriteForDrag）。此结论已被杠精确认「不是冲突」，不改。

### 12.5 A12 开机自启（【P1-7】可注入）
- 事实：applyAutoLaunch() 已真调 app.setLoginItemSettings({ openAtLogin: Boolean(config.launchAtLogin) })，带 try/catch、SMOKE_TEST 跳过。已接线，不是「只存字段」。
- 【P1-7】失败路径做成可注入：applyAutoLaunch(options.injectSetLoginItem)；selfcheck 注入抛错替身，断言「调用一次 + 产生一条用户可见提示（托盘 tooltip 或气泡）」。人工验收改「打开开关 → 系统登录项出现 hermes-pet（可脚本查 HKCU\Software\Microsoft\Windows\CurrentVersion\Run）」。

### 12.6 A13 被打扰边界（【P1-3】全屏真探测 +【P1-5】安全 +【P2-1】双击）
- 原则：猫一切主动行为让位于用户当前状态；信号优先级 = 前台窗口类型 > 输入活跃度 > 时间。
- 单击误触：位移>5px 判拖拽不弹对话；原地 click 才开对话；【P2-1】保持 DOUBLE_CLICK_MS=320，只把单击动作延迟到该窗口之后（不改常数）。
- 静默场景清单（任一满足 → 闭嘴且别乱动，保留呼吸/待机）：全屏程序前台 / 高速打字（近3s持续击键）/ 网课录屏开会（全屏+麦克风占用）/ 深夜 / dnd / paused。反向边界：用户主动点击/快捷键永远优先。
- 连续工作 2h+：更安静，除 break 外主动触发降为动作不开口。
- 【P1-3】quiet.js signals 必须含 foregroundFullscreen（可注入 + true/false 单测）。探测实现本轮做：主进程 PowerShell 探测，节流~2s、失败降级 false、可注入/mock。**删掉「拿不准可先只落打字/dnd/深夜、全屏留待拍板」的降级许可**（不许「可跳过」与「必须过」并存）。
- 【P1-5】所有含用户输入或 AI 回复的 DOM 写入必须走 textContent/setText；onboarding 气泡、「已复制」标记、固定图钉标记一律不得用 innerHTML/insertAdjacentHTML。nickname 流向托盘 tooltip/state.json/设置面板同样净化。

## 13. 风险
1. P0-1 A5 穿透打架（最高风险）：已用 §7 开/关双向重断言 + watchdogAction dnd 维度堵死。
2. P0-2 A1 nickname 破坏性迁移：migrateConfig 独立函数 + schemaVersion 2 + 不下沉 coerceNickname，避开 tests/config.test.js:39。
3. P0-4 A2 节拍：已按代理裁定冷却 180s + 1/300，删「50 秒」表述。
4. P0-5 A6 吸附：drag-end 顺序 clampFullyInside→snapToEdge→兜底，优先级左>右>上>下。
5. A7 快捷键抢键/幽灵占用：降级/注销/幂等/回滚已写死。
6. A13 全屏探测可行性：本轮真探测（PowerShell 探测，节流+降级+mock），无跳过许可。
7. 状态机白名单回归 + 验收门耦合物理环境：只增不减、selfcheck 全确定性断言。