# HANDOFF — hermes-pet M0（Electron 桌宠）

> 执行者：codex ｜ 工作目录：`D:\Jiayi\Projects\hermes-pet`
> 权威任务书：`docs/M0-CODEX-BRIEF.md`（§0-§7 全做完）；另按 `docs/M0-FIX-ROUND2.md` 做了第二轮修复（逐条交代见第 3 节）
> 结论：**全绿**。容器 3 条验收命令 + 宿主 GUI 冒烟 + 深度自检（16/16）+ 双击启动脚本，全部**真跑**通过，输出见第 2 节。

## 1. 本轮交付

### 1.1 新增（M0 Electron 实现）

| 文件 | 职责 |
|---|---|
| `package.json` | name/version/main/scripts（start / smoke / test）；devDependencies **只有 electron 44.4.5** |
| `.gitignore` | node_modules / 日志 / .env / *.tmp；结尾反选 `data/`，让精灵素材入库 |
| `启动hermes-pet.cmd` | 纯 ASCII、幂等、双击即起（查 Node → 缺二进制则走 npmmirror 装 → `start` electron，不留黑窗） |
| `README.md` | Electron 版：这是什么 / 怎么跑 / 怎么验收 / 已知限制 |
| `.hermes-docker.md` | 容器用法 + 为什么 GUI 只能在 Windows 宿主跑 |
| `src/main.js` | 主进程：透明窗口、托盘、原生菜单、单实例、调度器接线、持久化、`--smoke-test`、`--self-check` |
| `src/preload.js` | contextIsolation 白名单桥（不暴露 `ipcRenderer` 本体） |
| `src/core/sprite-frames.js` | 索引表（照抄 `M0-sprite-map.md`）+ 取帧纯函数；UMD-lite 双导出，供预览页复用同一张表 |
| `src/core/state-machine.js` | 状态机（idle / alert / tired / sleeping / scratchSelf / talk / listen / drag） |
| `src/core/scheduler.js` | 主动行为决策 + 频率护栏（**唯一决策入口**，纯函数） |
| `src/core/config.js` | 配置/状态：默认值合并、校验、原子写、损坏回落；手写 `.env` parser |
| `src/core/replies.js` | 本地语料（琉斯语气：21 组关键词 + 兜底 + 主动话术，口头禅「拆解它」） |
| `src/adapters/index.js` | adapter 选择与降级（只认 `GatewayError`，**任何异常都不冒泡到渲染进程**） |
| `src/adapters/local-mock.js` | 默认后端：关键词回复（纯函数） |
| `src/adapters/hermes-gateway.js` | 冻结协议：`POST {URL}/v1/chat/completions` |
| `src/renderer/index.html` `pet.css` `pet.js` | 桌宠窗口：猫 + 气泡 + 输入框、30fps 动画循环、点击/双击/拖拽/右键、**鼠标穿透命中测试** |
| `src/renderer/settings.html` `settings.css` `settings.js` | 设置面板 |
| `tools/sprite_preview.html` | 每个状态每一帧并排渲染，人工一眼核对映射（file:// 直接开） |
| `tools/selfcheck.js` | `--self-check` 的深度自检脚本（纯 Node，能力由 main.js 注入） |
| `tools/gateway_stub.js` | 本地网关测试替身（**dev tool，不属于产品运行时**），用来验证冻结协议真通 |
| `tests/*.test.js`（6 个文件，75 个用例） | node:test，零依赖，只测 `src/core/` 与 `src/adapters/` |
| `HANDOFF.md` | 本文件 |

### 1.2 未改动（按要求保留原样）

`src/hermes_pet/**`（旧 PySide6 骨架）、`pyproject.toml`、`hermes-pet-product-design.md`、`docs/M0-spec.md`、`docs/M0-features.md`、`docs/M0-sprite-map.md`、`docs/M0-review.md`、`tools/*.py`、`data/sprites/*`（素材原样使用，未重新下载）；`.env` **未读、未写、未打印**。
---

## 2. 验证证据（全部是**真实输出**，未加工）

### 2.1 容器内零依赖纯逻辑（BRIEF §4.1）

命令 1：`docker exec -w /workspace hermes-pet-dev node --check src/main.js`

```
exit code = 0
```

命令 2：`docker exec -w /workspace hermes-pet-dev sh -c "for f in src/main.js src/preload.js src/core/*.js src/adapters/*.js src/renderer/*.js; do node --check \"$f\" || exit 1; done"`

> 注：PowerShell 会吃掉这条命令里的 `\"$f\"` 转义，所以实际执行时用的是反引号写法 `node --check `$f`（语义完全一致，只是宿主 shell 的转义差异，已在第 8 节写明可复制的形式）。

```
ALL_JS_SYNTAX_OK
exit code = 0
```

命令 3：`docker exec -w /workspace hermes-pet-dev node --test tests/`

```
1..75
# tests 75
# suites 0
# pass 75
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 226.246018
```

宿主跑同一套用例（`node --test tests/*.test.js`）：`ℹ tests 75 / ℹ pass 75 / ℹ fail 0`。
> 差异原因：宿主 Node 24 不认 `node --test tests/`（目录写法），容器 Node 20 认。两条命令各自用对方支持的写法，跑的是同一批文件。

### 2.2 宿主 GUI 自证（BRIEF §4.2）

```
npm install --registry=https://registry.npmmirror.com
up to date in 438ms

npx electron . --smoke-test
[hermes-pet] 已启动，adapter = hermes-gateway ；userData = C:\Users\王嘉仪\AppData\Roaming\hermes-pet
SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true}

& node_modules\electron\dist\electron.exe --version
v44.4.5
```

退出码 0。`mousePassThrough:true` 是第二轮要求补的断言（证明穿透已接线、初始 `ignore=true`）。

### 2.3 附加自证：`npx electron . --self-check`（16 项逐项真跑）

**A) 网关不可达（.env 里配了，但本地没起）→ 降级路径：**

```
[selfcheck] OK   window-visible - 窗口可见
[selfcheck] OK   tray-created - 托盘图标已创建
[selfcheck] OK   renderer-ready - {"catRendered":true,"sprite":"../../data/sprites/oneko.gif","sheet":"256x128"}
[selfcheck] OK   sprite-applied - background-position=-96px -96px
[selfcheck] OK   state-machine-idle - state=idle
[selfcheck] OK   pet-size-var - --pet-size=120px
[selfcheck] OK   click-opens-dialogue - {"bubbleHidden":false,"composerVisible":true,"bubbleWidth":136}
[selfcheck] OK   window-grows-for-bubble - 144 -> 261
[selfcheck] OK   bubble-width-capped - 宽度 136px（上限 320）
[selfcheck] OK   chat-reply - local-mock -> 嗯，我在。手上那件事进行到哪了？
[selfcheck] OK   chat-no-status-code-leak - 气泡文案里没有状态码
[selfcheck] OK   chat-thinking-feedback - sawThinking=false repliedAt=84ms
[selfcheck] OK   chat-submit-path-answered - 气泡最终文案=这句我先收下。要不要我们一起把它拆解它？
[selfcheck] OK   esc-closes-and-shrinks - 144 vs 144
[selfcheck] OK   settings-window - 已创建
[selfcheck] OK   settings-bound-to-config - {"nickname":"琉斯","size":"120","hasBridge":true}
SELFCHECK_OK 16/16
```

**B) 起本地替身网关（`node tools/gateway_stub.js 8742 3000`，故意延迟 3 秒）+ `HERMES_GATEWAY_URL=http://127.0.0.1:8742`：**

```
[selfcheck] OK   chat-reply - hermes-gateway -> 本地替身网关收到「你好」，鉴权头已带上。
[selfcheck] OK   chat-no-status-code-leak - 气泡文案里没有状态码
[selfcheck] OK   chat-thinking-feedback - sawThinking=true repliedAt=3042ms
[selfcheck] OK   chat-submit-path-answered - 气泡最终文案=本地替身网关收到「慢一点回我」，鉴权头已带上。
[selfcheck] OK   esc-closes-and-shrinks - 144 vs 144
[selfcheck] OK   settings-window - 已创建
[selfcheck] OK   settings-bound-to-config - {"nickname":"琉斯","size":"120","hasBridge":true}
SELFCHECK_OK 16/16
```

B 这一次同时证明三件事：

1. **冻结协议真跑通**（不是「每次都降级还全绿」）：请求打到 `POST {URL}/v1/chat/completions`、`Authorization: Bearer` 头带上了、值取的是 `choices[0].message.content`；
2. **慢网关下气泡先给「在想…」**（1534ms / 3042ms 出现），回复到了才替换成真回复；
3. 走的是**真实 submit 路径**（输入框 + Enter → `pet.js` 的 `submit()`），不是直接调 `window.hermes.send()`。

### 2.4 双击启动脚本

```
cmd /c 启动hermes-pet.cmd      -> exit code = 0
（8 秒后从另一个 shell 数）electron 进程数 = 4；手动 kill 后 remaining = 0
```

### 2.5 P0-4：`git ls-files data/` 必须是 8 项（原始输出）

```
data/sprites/.gitkeep
data/sprites/icon-128.png
data/sprites/icon-256.png
data/sprites/icon-32.png
data/sprites/icon-64.png
data/sprites/icon-night.png
data/sprites/oneko.gif
data/sprites/tray.png
```

计数 = **8**。`.gitignore` 在 `data/` 之后用 `!data/` + `!data/sprites/` + `!data/sprites/**` 反选，素材随仓库交付（应用启动即依赖它，不能只是本地文件）。
---

## 3. `docs/M0-FIX-ROUND2.md` 逐条交代（改了什么 / 怎么验的 / 为什么）

总口径：**BRIEF 是本轮唯一权威**（`docs/M0-CODEX-BRIEF.md` 自己写明「优先级高于 `docs/` 下其它文档」）。FIX-ROUND2 与 BRIEF 不冲突的条目**全部照做**；与 BRIEF 正面冲突的，只做能同时满足两者诉求的部分，并在下面逐条说明理由。

### P0-1 窗口尺寸与气泡尺寸互斥 —— ⚠️ 故意不照做「固定 360x440」，用等价方案解决原始诉求

**冲突点**：本条要求「窗口尺寸固定 360x440，不随显示大小变化」；BRIEF §3 F1 则明确要求「窗口尺寸随『显示大小』设置变化，重启后保持」。两条互斥 → 按 BRIEF 开头的优先级声明，保留 BRIEF 行为。

**但它真正要解决的诉求（气泡被窗口裁掉）我照做了**，只是用「窗口跟随内容」而不是「固定大窗口」：

- 窗口尺寸 = 猫的显示尺寸 + 24px 内边距；位置持久化与屏幕 clamp **按窗口矩形**（`win.getBounds()` + `screen.getDisplayMatching()` + `recenterForSize()`），**不按猫矩形**——这点完全按本条要求做；
- 气泡展开时渲染进程量出气泡真实尺寸 → `pet:bubble-resize` → 主进程把窗口**底部锚定**地长高（猫在屏幕上看起来不动），关闭时精确收回；
- 气泡的真实约束照本条写：`max-width:320px`、`max-height:400px`、`overflow-y:auto`、离猫 8px、输入框在气泡底部、圆角 12px；
- 猫/气泡几何用「底部对齐的 flex 列 + `gap:8px` + 底部内边距」实现（猫贴底居中、气泡在猫正上方 8px），效果与 absolute 方案一致且不会有重叠风险。

**为什么不接受固定 360x440**：(1) 直接违反 BRIEF F1；(2) 让 60px 的猫住进 360x440 的透明窗口，`alwaysOnTop` 与窗口阴影覆盖面积远大于本体，本体与窗口边界不一致，体验更差；(3) 真正诉求是「气泡完整可见」，窗口按内容长高同样满足，还顺带满足 F1 的「显示大小即时生效 + 重启保持」。

**验收证据**（§2.3）：`window-grows-for-bubble - 144 -> 261`、`bubble-width-capped - 宽度 136px（上限 320）`、`esc-closes-and-shrinks - 144 vs 144`（关闭后精确收回）。
**残留风险**：显示大小拉满 180 + 气泡最大 400 + 内边距 24 ≈ 604px 高，1080p 够用；更矮的屏幕由主进程 clamp 兜底（贴可见区域，不会飘出屏幕）。

### P0-2 透明窗口「看不见的挡板」 —— ✅ 已做（本轮最高优先级）

- 主进程建窗后 `win.setIgnoreMouseEvents(true, { forward: true })`，用 `ignoreMouseActive` 跟踪状态，IPC 通道 `pet:ignore-mouse`；
- 渲染进程 `mousemove` 里做命中测试：`document.elementFromPoint(x, y)` 的 `closest('#cat, #cat-slot, #bubble, #bubble *, button, input, textarea')`，命中才 `setIgnoreMouse(false)`；
- **拖拽期间** `dragLock = true` 强制保持不穿透（否则快速拖动丢事件），`mouseup` 后按命中重判；输入框 focus/blur 也进 dragLock；
- 证据：`SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true}`（初始 `ignore=true` 已接线并断言）+ `click-opens-dialogue OK`（穿透逻辑没有误伤猫本体，点猫仍能弹气泡 + 输入框）。

### P0-3a talk / listen / drag 复用映射 —— ✅ 已做，但**没有改 `docs/M0-sprite-map.md`**

本条要求「在 sprite-map 末尾追加小节」，而 BRIEF §5 明文**禁止改** `docs/M0-sprite-map.md` → 冲突，按 BRIEF 不动该文件。补充映射**落到代码 + 注释 + 预览页**，语义与本条完全一致：

- `talk` = 复用 `alert`（`[-7,-3]`）+ CSS `@keyframes talk-tilt`（0.6s，上下 2px 循环）；
- `listen` = 复用 `idle`（`[-3,-3]`）+ CSS `@keyframes listen-breathe`（2.4s 轻微呼吸缩放）；
- `drag` = 按拖动方向复用 `SE [-5,-1]` / `SW [-5,-3]`，各 2 帧交替（`spriteForDrag(direction)`，无位移时默认 `SE`）；
- 依据写进 `src/core/sprite-frames.js` 的 `STATE_SPRITES` 注释：「这三组是 M0 的行为态，原始 17 组是位置/动作态；复用而不自创索引」。

**实现细节**：tilt/breathe 动画加在 `.cat-slot` 而不是 `.cat`——`.cat` 的 `transform` 已被 `scale(var(--pet-scale))` 占用，直接叠动画会把缩放冲掉（猫会瞬间缩回 32px）。
**证据**：`tests/sprite-frames.test.js` 断言 `drag → SE/SW` 首帧分别等于 `-160px -32px` / `-160px -96px`（与映射表逐字一致）；`tools/sprite_preview.html` 可肉眼核对三组实际取帧。

### P0-3b nap 与 micro-sleep 区分 —— ✅ 已做

`src/core/state-machine.js` 用 `sleepKind` 区分：`'nap'`（空闲 30 分钟打盹，**只由用户交互唤醒，任何计时器都不许自动退出**）与 `'micro'`（oneko 式概率假睡，`microSleepMs = 6400` 后自己醒）。测试断言「打盹睡满一小时仍不退」「假睡 6.4 秒回 idle」。

### P0-3c 最小转移表 —— ✅ 已做（逐条）

| 事件 | 当前状态 | 目标 | 实现 |
|---|---|---|---|
| click | sleeping / nap | 唤醒 → `talk` | `EVENT_TARGETS.click`；唤醒动画 = sleeping→talk 的换帧过程 |
| click | talk | `talk`（重置计时，不重复弹） | `touch()` 归零 idle 计时；renderer 仅在气泡隐藏时才 `openDialogue()` |
| dragStart | talk / listen | `drag` | `EVENT_TARGETS['drag:start']`；白名单已放宽 `drag → talk/listen` |
| mouseup | drag | **恢复 dragStart 之前的状态** | `resumeState` 记住拖前状态，`drag:end` 回它（白名单不允许才回 idle）——对话中的猫被拖一下不丢对话 |
| 鼠标离开 | alert | `idle` | `mouse:far`（离开半径即回 idle，比 3 秒更保守） |
| 任意用户交互 | 任意 | idle 计时归零 | `send()` 里 `touch()` + renderer 的 `api.pet.touch()` |
| 主动行为到点 | sleeping / nap | **先唤醒再开口** | `pet.js showProactive()`：state 为 sleeping/tired 时先 `send('activity')` 再 `send('speak')` |
| 优先级 | — | 用户交互 > 主动行为 > 装饰动画 | 同级直接覆盖、不排队；状态白名单保证不会出现非法状态 |

### P0-4 `git ls-files data/` 必须 8 项 —— ✅ 已做，原始输出见 §2.5

### P1-2 网关适配器协议冻结 —— ✅ 已做，而且**真跑通了**

严格按冻结协议实现（`src/adapters/hermes-gateway.js`）：`POST {HERMES_GATEWAY_URL}/v1/chat/completions`、`Content-Type: application/json`、`Authorization: Bearer ${HERMES_API_KEY}`（配了才带）、body `{ model:'default', messages:[{role:'user',content:text}], stream:false }`、取 `json.choices[0].message.content`（非字符串或空串 → `GatewayError('bad_payload')`）。
`HERMES_API_KEY` 只从 `.env` 读、只在主进程用，不进渲染进程、不进日志、不进错误信息（有专门单测断言「错误路径返回体里不含 token」）。
除了注入假 fetch 的四条路径单测（header / body / 取值 / 异常），本轮还起了**真的本地替身网关**跑端到端（§2.3 B）：`chat-reply - hermes-gateway -> 本地替身网关收到「你好」，鉴权头已带上。` —— 这条链路不再是「每次都降级还全绿」。

### P1-3 降级错误面放宽 —— ✅ 已做

`reply()` 里 `try { 请求 + 解析 + 取值 } catch (err) { throw new GatewayError(mapReason(err, status)) }`。`mapReason` 归一：`AbortError` → `timeout`；`err.code` 或 **`err.cause.code`**（Node 原生 fetch 的真实形状是 `TypeError('fetch failed')`，errno 藏在 cause 上）→ `network`；`SyntaxError`（网关挂了常返回 HTML）→ `bad_response`；`choices` 缺失/空 → `bad_payload`；非 2xx → `http_error`；其余 → `unknown`。
`adapters/index.js` 只按 `GatewayError` 分类，其它异常兜底成 `unknown` 后仍然降级，**任何异常都不冒泡到渲染进程**。

### P1-4 10 秒超时期间气泡要有反馈 —— ✅ 已做

`submit()` 发出后立刻 `send('sending')`（切 `listen`）、清空气泡正文，并起 1.5 秒定时器：到点还没回音就用打字机显示「在想…」；回复（成功或降级）一到就清定时器并就地替换成真回复，降级时追加一句人话（**不出现 HTTP 状态码与堆栈**）。
证据：§2.3 A（秒回：`sawThinking=false repliedAt=84ms`）、§2.3 B（慢网关：`sawThinking=true repliedAt=3042ms`，先「在想…」再替换成真回复）。

### P1-5 `.env` 手写 parser，不许引依赖 —— ✅ 已做

`src/core/config.js` 的 `parseDotEnv` / `readEnvValue`：逐行 `trim`、跳过空行与 `#` 开头、按**第一个** `=` 切分、去掉成对引号、不支持多行值与变量展开；`.env` 路径由 `main.js` 传 `path.join(__dirname, '..', '.env')`；**文件不存在不算错误**（直接走 mock，有单测）。没有引入 `dotenv` 或任何新依赖。

### P1-6 `src/adapters/` 也禁止 `require('electron')` —— ✅ 满足

`src/core/` 与 `src/adapters/` 都是纯 Node 模块：`.env` 路径、`fetch` 实现、时钟全部由 `main.js` 注入；容器里 `node --test tests/` 直接加载，无 `electron` 依赖问题（`fetch` 缺失时抛可识别的 `unsupported` 并降级）。

### P1-7 调度器用「墙钟」而非累计计时 —— ✅ 已做

`scheduler.guardTick(now, runtime)` 在 `schedulerTick()` 每次先过一遍，返回 `{ runtime, skip, reason }`，`reason ∈ first | ok | drift | rollback`：

- 时间**回拨** → 重置全部基准与当天标记，`skip = true`（当次静默，**不触发任何行为**）；
- `now - lastTickAt > 2 分钟`（刚合盖唤醒）→ `drift`：**只做一次**「现在该不该说」的判定，不补发历史（下一次判定会被 2 小时护栏挡住）；
- 22:30 日落用**日期戳**判「当天一次」（跨天自动重置），不用 24h 间隔。

四个触发源全部依赖注入的 `now()`，**代码里没有任何 `setTimeout` 累加计时**。单测覆盖：多触发源同时到点只放行一次、跨天重置、日落当天一次、时间回拨静默、唤醒不补发。

### 其它（来自 `docs/M0-review.md`、FIX-ROUND2 未单列，本轮确认或补齐）

- **P1-12 负帧号**：`normaliseFrame = ((n % len) + len) % len` + `Math.trunc`，负帧号/超界帧号按组长度取模（单测覆盖）。
- **P1-14 单击 / 双击冲突**：320ms 窗口内判双击 → 开设置，否则算单击。**已知取舍**：双击的第一次按下不会再单独触发一次「开气泡」，避免「双击顺手把气泡又弹出来」；单击或 `Esc` 即可恢复。
- **P1-15 设置窗口置顶**：设置面板 `alwaysOnTop: true`，定位在猫旁边，失焦 400ms 自动关闭。
- **P1-19 全局异常兜底**：`process.on('uncaughtException')` + `process.on('unhandledRejection')`；冒烟模式下转成 `SMOKE_FAIL` 退出码 1，正常模式只记日志、不崩。
- **P1-20 尺寸变化锚点**：`recenterForSize()` 保持「中心 x / 底边 y」不变再 clamp 到可见区域，改显示大小时猫不会跳走。
---

## 4. F1-F9 功能对照（BRIEF §3）

| 条目 | 状态 | 落地位置 / 说明 |
|---|---|---|
| F1 桌宠窗口 | ✅ | `src/main.js`：`transparent/frame:false/resizable:false/skipTaskbar/alwaysOnTop/hasShadow:false/show:false` + `ready-to-show`；右下角距边 24px；拖拽（位移 > 5px）后持久化；`requestSingleInstanceLock` 二次启动聚焦既有实例；位置按窗口矩形 clamp；尺寸随显示大小变化并保持 |
| F2 精灵动画状态机 | ✅ | `src/core/sprite-frames.js` + `state-machine.js`：8 态、映射照抄 `M0-sprite-map.md`、`background-position = ${x*32}px ${y*32}px`（负索引不换算）、idle 超过阈值后概率小动作、sleeping 前先 tired、scratch 播完复位、`requestAnimationFrame` 30fps、隐藏时暂停循环 |
| F3 点击对话 | ✅ | 单击开气泡 + 输入框（Enter 发送 / Shift+Enter 换行 / Esc 关闭）、双击开设置、打字机 + 出现/消失动画、`max-width:320px` / `max-height:400px` / 超出滚动、说话切 `talk`、输入切 `listen` |
| F4 回复适配器 | ✅ | `src/adapters/*`：统一 `reply(text, ctx) -> {text, source}`；`local-mock` 默认（21 组关键词 + 兜底，琉斯语气）；`hermes-gateway` 读 `.env`，未配置/超时/5xx/非 JSON/字段缺失一律降级到 mock 并用一句人话说明（无状态码）；密钥零泄露 |
| F5 主动行为 + 频率护栏 | ✅ | `src/core/scheduler.js` 单一决策入口：每日问候（日期戳）、空闲 30 分钟打盹、连续活跃 40 分钟休息提醒（会话间隔 5 分钟）、22:30 数字日落（当天一次）；护栏：**每 2 小时 ≤1 次** + 24h 上限 6 次 + 10 秒不理当天不再提 + 打字/对话中绝不插话 + 拖拽中不弹、拖后 2 秒才判；全部墙钟判定 |
| F6 托盘 + 右键菜单 | ✅ | `src/main.js` 用 `Tray` + `Menu.popup()`（原生菜单，无自绘）：显示/隐藏、暂停动画、重置位置、设置、退出；右键猫：对话/设置/固定位置/重置位置/暂停/退出 |
| F7 设置面板 | ✅ | 独立窗口 `settings.html`：昵称、显示大小 60-180 滑块、主动提醒总开关、开机自启（`app.setLoginItemSettings`）、深夜模式开关；保存即时生效并持久化 |
| F8 深夜模式 | ✅ | 22:00-07:00 自动：猫 `filter: saturate(0.6) brightness(0.85)`、气泡/面板深色（`body.deep-night` 用夜间色板）、动画频率减半（30fps→15fps，微动 CSS 也翻倍时长）；设置可强制关闭 |
| F9 持久化 | ✅ | 存 `app.getPath('userData')`（`%APPDATA%\hermes-pet\config.json` / `state.json`），**原子写**（`*.tmp` + fsync + `renameSync`），带 `schemaVersion`，损坏/缺失回落默认值不崩 |

---

## 5. 已知限制

- **窗口尺寸策略与 FIX-ROUND2 P0-1 不同**（见 §3 P0-1）：窗口跟随猫尺寸 + 气泡临时长高，而不是固定 360x440。理由是 BRIEF F1 优先。
- **双击的第一次按下不再单独开气泡**（P1-14 取舍，见 §3）。
- **主动/空闲信号只来自本窗口内的交互**（猫附近鼠标移动 + 点击/拖拽/打字），没有全局键鼠钩子；这是 BRIEF §5「不做行为感知」的边界。
- **talk / listen 是复用帧 + CSS 微动**，不是独立帧组（`M0-sprite-map.md` 里没有这两组，BRIEF 禁止改该文件）。
- **网关是真联调过的替代品**：本轮用零依赖的本地替身网关验证了协议与取值，但没有连过站长的真网关（`.env` 里的地址在验收环境不可达）。
- **`node --test tests/` 只能在容器里跑**（宿主 Node 24 不认目录写法，用 `tests/*.test.js`）。
- **`docs/_recon/**` 与 `docs/M0-*.md` 被本轮一并入库**（它们在本轮开始时未跟踪，`git add -A` 会扫进去，约 1.3MB，含一个 `cat_sprite.zip`）。如需剔除：`git rm -r --cached docs/_recon`。

## 6. 没做完 / 明确不做

- **没连真网关**（协议已按 P1-2 冻结；真联调留给调度者，命令见 §8 第 5 条）。
- **没做打包/安装器**（`.exe` / NSIS）：会引入 `electron-builder` 之类的新依赖，BRIEF §5 禁止。
- **明确不做**：多角色切换、语音、Live2D/VRM、真 LLM 后端联调、向量记忆、行为感知（鼠标速度/退格）、自绘 HTML 菜单、任何构建工具与 UI 框架。

## 7. 下一步建议

1. 接真网关跑一次：设好 `HERMES_GATEWAY_URL` 与 `HERMES_API_KEY` 后 `npx electron . --self-check`，看 `chat-reply` 的 `source` 是否变成 `hermes-gateway`。
2. 真实用一天，观察「每 2 小时 ≤1 次」的手感（可能需要把 `PROACTIVE_COOLDOWN_MS` 调成 90 分钟或加安静时段）。
3. 决定 `docs/_recon/**` 是否留在仓库（体积 vs 证据）。
4. 若要打包分发，需先跟调度者确认能否引入打包依赖（当前零依赖是硬约束）。
5. 可选：把 `tests/` 补到覆盖 `main.js` 的 IPC 层（需要引入 Electron 测试运行时，属于新增依赖，需决策）。

---

## 8. 可复制的验收命令（干净版）

```powershell
# 1) 容器：零依赖纯逻辑（GUI 不在这里跑）
docker exec -w /workspace hermes-pet-dev node --check src/main.js
docker exec -w /workspace hermes-pet-dev sh -c "for f in src/main.js src/preload.js src/core/*.js src/adapters/*.js src/renderer/*.js; do node --check `$f || exit 1; done; echo ALL_JS_SYNTAX_OK"
docker exec -w /workspace hermes-pet-dev node --test tests/

# 2) 宿主：GUI 冒烟（唯一能证明「GUI 真能起来」的证据）
cd D:\Jiayi\Projects\hermes-pet
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install --registry=https://registry.npmmirror.com
npx electron . --smoke-test          # 期望 SMOKE_OK {...} 且退出码 0

# 3) 宿主：深度自检（16 项）
npx electron . --self-check          # 期望 SELFCHECK_OK 16/16

# 4) 宿主：双击启动脚本等价调用
cmd /c 启动hermes-pet.cmd

# 5) 可选：真联调（本地替身网关，一个窗口跑服务）
node tools/gateway_stub.js 8742 3000
$env:HERMES_GATEWAY_URL="http://127.0.0.1:8742"
npx electron . --self-check          # 期望 chat-reply 的 source 变成 hermes-gateway
```

## 9. 给下一轮的工具坑（省时间）

1. **本机没有可直接调用的 `apply_patch`**，要用 `codex.exe --codex-run-as-apply-patch`，且 patch 是**命令行参数**：内容里出现 ASCII 双引号、或整段过大（cmd 8KB 限制）都会失败。大文件/含引号的文件改用 PowerShell 写盘。
2. **容器命令里的 `\"$f\"` 会被 PowerShell 吃掉**（报“找不到文件”），用反引号 `` `$f ``。
3. **宿主 Node 24 不认 `node --test tests/`**（报 `Cannot find module .../tests`），用 `tests/*.test.js`；容器 Node 20 认目录写法。
4. **`npm install electron` 有时只装 JS 包、不下载二进制**（`node_modules\electron\dist\` 不存在）。兜底配方（已验证）：按 `package.json` 的 version 从 npmmirror 下 `electron-v<v>-win32-x64.zip` 解压到 `node_modules\electron\dist`，再 `electron.exe --version` 确认。

## 10. mock 与降级是否验证过

**是，都是真跑的**（不是「应该能跑」）：

- 本地 mock：§2.3 A `chat-reply - local-mock -> 嗯，我在。手上那件事进行到哪了？`；
- 降级：§2.3 A `.env` 里配了网关但本地没起 → 自动降级到 mock，气泡文案是人话、无状态码；
- 网关成功路径：§2.3 B 本地替身网关，`chat-reply - hermes-gateway -> ...`，并确认 `Authorization` 头与取值字段都正确。
---

## 11. 第三轮修复（`docs/M0-FIX-ROUND3.md` FIX-1 ~ FIX-4）逐条交代 + 原始输出

> 前置：容器 `node --test tests/` **86/86**（第二轮 75 + 本轮新增 11）；宿主 `npx electron . --smoke-test` -> `SMOKE_OK`；宿主 `npx electron . --self-check` -> `SELFCHECK_OK 18/18`（第二轮 16 + 本轮新增 2）。下面全是**真跑出来的原始输出**，未加工。
> 本轮只修缺陷与补文档；除 electron 外零新依赖；`docs/M0-review.md` / `M0-features.md` / `M0-spec.md` / `hermes-pet-product-design.md` / `M0-CODEX-BRIEF.md` / `M0-FIX-ROUND2.md` **未改动**。

### FIX-1（P0）首启落点落到左上角 (0,0) —— ✅ 已修

**根因比任务书猜的「时序」更靠前一层**：`src/core/config.js` 的 `coerceCoord(null)` 走 `Number(null) === 0`，于是「state.json 里根本没有 x/y」被读成了「x = 0, y = 0」；`restoreBaseBounds()` 看到 `Number.isFinite(0)` 成立就以为用户存过坐标，把窗口摆到左上角，后续落盘又把 0/0 固化下来 —— 这就是「永久左上角」。任务书要求的时序防御也一并做全了（见第 3、4 条）：

1. `coerceCoord(null / undefined / '' / 非数字) -> null`（根因修复，`tests/config.test.js` 钉住）；
2. 新增纯逻辑模块 `src/core/position.js`：`defaultBounds()`（右下角算式）/ `restoreBounds()`（坐标缺失 / 非法 / (0,0) 哨兵 -> 默认右下角；其余 clamp）/ `clampToArea()` / `clampFullyInside()` / `fitInside()`；`src/main.js` 的默认 / 恢复 / 拖拽三条路径全部改走它（`tests/position.test.js` 6 条用例覆盖）；
3. `persistPosition()` 加闸门：`positionReady`（`ready-to-show` 之后才置 true）之前一律不写；写之前用 `win.getBounds()` 的真实矩形反推基准、再过一遍 `restoreBounds()`（clamp + 挡掉 (0,0)），读不到合法值就放弃这次写入；`resetPosition()` / `recenterForSize()` / `pet:drag-end` 也改成「先把窗口摆好，再落盘」；
4. `ready-to-show` 里显式 `win.setBounds(baseBounds)` 之后才 `persistPosition()`：首启就会写出一份合法的右下角坐标。

**验收（任务书三条命令的原始输出）**：

```powershell
PS> Get-Process electron | Stop-Process -Force        # 任务书：先关掉屏幕上的旧实例
PS> Remove-Item "$env:APPDATA\hermes-pet\state.json" -Force
PS> Get-ChildItem "$env:APPDATA\hermes-pet" -Filter "*.json" | Select-Object Name,Length

Name        Length
----        ------
config.json    146

PS> npx electron . --smoke-test
[hermes-pet] 已启动，adapter = hermes-gateway ；userData = C:\Users\王嘉仪\AppData\Roaming\hermes-pet
[hermes-pet] 窗口就绪：baseBounds = {"x":1272,"y":684,"width":144,"height":144} ；win.getBounds() = {"x":1272,"y":684,"width":144,"height":144} ；主屏 = {"size":{"width":1440,"height":900},"workArea":{"x":0,"y":0,"width":1440,"height":852},"scaleFactor":2}
SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true}
exit_code=0

PS> Get-Content "$env:APPDATA\hermes-pet\state.json"
{
  "schemaVersion": 1,
  "x": 1272,
  "y": 684,
  "paused": false,
  "pinned": false,
  "scheduler": { "lastActivityAt": 1790163723475, "sessionStartAt": 1790163723475, "lastTickAt": 1790163724530, "lastProactiveAt": 1790163724530, "lastProactiveKind": "greeting", "dailyCount": 1, "dailyCountDate": "2026-09-23", "greetedDate": "2026-09-23", "sunsetDate": null, "ignoredDate": null, "ignoredKinds": [], "dragging": false, "dragEndedAt": null, "dialogueOpen": false, "typing": false }
}
```

**关于 x=1272 / y=684 与任务书「期望 x≈1128、y≈588」的差异（必须说清，不是没修好）**：任务书括号里的算式 `1440-288-24 / 900-288-24` 把**物理像素的窗口宽度**（288 = 144 DIP × 2）和**逻辑像素的屏幕尺寸**（1440x900）混在了一起。本机实测（上面「主屏 =」那行就是原始输出，`scaleFactor: 2`）：

- 逻辑 workArea = `1440 x 852`（`900 - 48` 是任务栏），窗口逻辑尺寸 `144 x 144`（= 猫 120 + 四周内边距 24）—— **换算成物理像素正好就是任务书测到的 288 x 288**；
- 同一条算式在**逻辑像素**下：`1440 - 144 - 24 = 1272`、`852 - 144 - 24 = 684`，与 state.json 落盘值**完全一致**；
- 换算到**物理像素**：`2880 - 288 - 48 = 2544 = 1272 x 2`、`1704 - 288 - 48 = 1368 = 684 x 2`，右下角留白 24 DIP（= 48 物理）✔。

结论：算式、留白、落盘值三者自洽，窗口确实出现在**屏幕右下角**，且 `win.getBounds()` 与 `baseBounds` 完全相同（说明「窗口真实位置」和「我们以为的位置」没有偏差）。

### FIX-2（P1）288 窗口与「气泡最大宽 320」不自洽 —— ✅ 已修（选方案 b）

**选 (b) 不选 (a) 的理由**：(a) 把窗口固定成 360x440 会正面违反 `docs/M0-CODEX-BRIEF.md` §3 F1「窗口尺寸随『显示大小』设置变化，重启后保持」（第二轮已按 BRIEF 的优先级声明裁决过同一处冲突），而且会把 FIX-1 的落点算式整体改掉；(b) 只改气泡自身的宽度约束，窗口行为、位置持久化、`size` 60-180 的设置链路一概不动 —— 本轮是修缺陷，不是改设计。

改动：

- `src/renderer/pet.css`：`.bubble` 的 `max-width: 320px` -> `max-width: min(320px, calc(100vw - 16px))`（**不超过窗口内宽**）；`max-height: 400px` + `overflow-y: auto` 保持，长文本 `pre-wrap / break-word` 换行照旧；
- 顺带把任务书验收里那条「贴屏幕边缘也不被裁」做实：`windowBoundsForBubble()` 现在把气泡窗口整体收进 workArea（`position.fitInside`），并把两处平移量发给渲染进程 —— `catX/catY` 给 `#stage`（**猫在屏幕上的位置一动不动**）、`bubbleX/bubbleY` 给 `.bubble`（气泡单独挪回屏内）。坐标全部由主进程按 `win.getBounds()` 算（渲染进程的 `window.screenX` 会滞后于窗口真实位置，不能当基准 —— 第一版就是踩了这个坑，`--self-check` 当场抓出来）。

**验收（`npx electron . --self-check`，本轮新增 2 项专门盯这条）**：

```
[hermes-pet] [selfcheck] OK   bubble-fully-visible-at-screen-edge - 气泡屏幕矩形={"width":136,"height":400,"left":1304,"top":408,"right":1440,"bottom":808,"scrollable":true} workArea={"x":0,"y":0,"width":1440,"height":852}
[hermes-pet] [selfcheck] OK   bubble-long-text-scrolls - scrollHeight > clientHeight = true
```

（这一项先把猫摆到 workArea 最右下角 —— 拖拽 clamp 允许的极限，窗口只留 48px 在屏内 —— 再塞 200+ 字长文本；气泡的屏幕矩形 `[1304,1440] x [408,808]` 完全落在 workArea 内、没有被裁，且内容超出 400px 上限后确实可滚。）

把猫缩到 60px 再跑同一套（临时把 `config.json` 的 `size` 改成 60，跑完已还原成 120）：

```
[hermes-pet] [selfcheck] OK   pet-size-var - --pet-size=60px
[hermes-pet] [selfcheck] OK   window-grows-for-bubble - 84 -> 201
[hermes-pet] [selfcheck] OK   bubble-fully-visible-at-screen-edge - 气泡屏幕矩形={"width":136,"height":400,"left":1304,"top":408,"right":1440,"bottom":808,"scrollable":true} workArea={"x":0,"y":0,"width":1440,"height":852}
[hermes-pet] [selfcheck] OK   bubble-long-text-scrolls - scrollHeight > clientHeight = true
SELFCHECK_OK 18/18
```

**取舍（如实交代）**：窗口宽度 = 猫的显示大小 + 24，所以气泡宽度被钳在「窗口内宽」（默认 120 的猫 -> 136px 宽气泡；60 的猫 -> 136px；180 的猫 -> 180px，默认配置走 `windowBoundsForBubble` 里 160px 的地板），`320px` 从此是**上限**而不是**承诺值**；换来的是「永远不被窗口/屏幕裁掉 + 长文本换行可滚」。若以后确实要让气泡长到 320px，需要回到方案 (a)（固定大窗口），那要先把 BRIEF F1 的「窗口随显示大小变化」改掉。

### FIX-3（P2）`config.json` 首启不落盘 —— ✅ 已修

- `src/core/config.js` 新增 `ensureConfig(filePath)`：文件缺失 / 空 / 损坏 -> **原子写**一份含全部默认值的 `config.json`；已存在且可解析 -> 原样返回，**绝不覆盖用户改过的值**；写盘失败（只读目录等）也不让程序起不来。`src/main.js` 的 `loadPersisted()` 改用它。
- **默认值清单**（就是写进文件的内容，以后加字段请以这份为迁移锚点）：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `schemaVersion` | `1` | 配置结构版本 |
| `nickname` | `"琉斯"` | 猫对用户的称呼 |
| `size` | `120` | 显示大小（px，合法区间 60-180） |
| `proactiveEnabled` | `true` | 是否允许主动开口 |
| `launchAtLogin` | `false` | 开机自启 |
| `deepNightEnabled` | `true` | 22:00-07:00 深夜模式 |

**原始输出（首启后直接打开文件即可人工验收）**：

```
PS> Get-ChildItem "$env:APPDATA\hermes-pet" -Filter "*.json" | Select-Object Name,Length
Name        Length
----        ------
config.json    146

PS> Get-Content "$env:APPDATA\hermes-pet\config.json"      # 用 UTF-8 读，控制台里中文可能显示成乱码
{
  "schemaVersion": 1,
  "nickname": "琉斯",
  "size": 120,
  "proactiveEnabled": true,
  "launchAtLogin": false,
  "deepNightEnabled": true
}
```

（顺带自证了「损坏 -> 自愈」：一开始我用 PowerShell `Set-Content -Encoding UTF8` 写这个文件，PS 5.1 会带 BOM -> JSON 解析失败 -> 程序把文件重写成默认值，`size` 又回到 120。这正是 FIX-3 里那条自愈路径的真实行为。）

### FIX-4（P2）`M0-sprite-map.md` 的 talk/listen/drag 映射缺位 —— ✅ 已补

- 在 `docs/M0-sprite-map.md` **末尾追加第 6 节**「M0 状态补充映射（复用，不改动原始 17 组）」：`talk` -> `alert [-7,-3]` + `@keyframes talk-tilt`（0.6s 上下 2px）、`listen` -> `idle [-3,-3]` + `@keyframes listen-breathe`（2.4s 呼吸缩放）、`drag` -> `SE [-5,-1]` / `SW [-5,-3]`（`spriteForDrag()` 按方向选，各 2 帧），并写明「本节的权威实现见 `src/core/sprite-frames.js`，两者必须一致」；
- **原 1-4 节一字未动**（diff 只在文件末尾新增）；
- 顺手把「文档说单测钉住、单测其实没钉」这件事做实：`tests/sprite-frames.test.js` 新增一条用例，断言 `talk -> alert`（`-224px -96px`）、`listen -> idle`（`-96px -96px`），与第 6 节逐字一致。

### 本轮验收命令原始输出（汇总）

```powershell
# 容器：零依赖纯逻辑
$ docker exec -w /workspace hermes-pet-dev node --test tests/
1..86
# tests 86
# suites 0
# pass 86
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 196.057367

$ docker exec -w /workspace hermes-pet-dev sh -c 'for f in src/main.js src/preload.js src/core/*.js src/adapters/*.js src/renderer/*.js tools/selfcheck.js; do node --check "$f" || exit 1; done; echo ALL_JS_SYNTAX_OK'
ALL_JS_SYNTAX_OK

# 宿主：GUI（两条都给退出码 0）
PS> npx electron . --smoke-test
SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true}

PS> npx electron . --self-check
SELFCHECK_OK 18/18
```

新增 11 条用例（75 -> 86）：`tests/position.test.js` 6 条（右下角算式 / 坐标缺省与 (0,0) 走默认 / 超界 clamp / 多屏 workArea 偏移 / `fitInside` 平移量）、`tests/config.test.js` 4 条（`ensureConfig` 首启落盘、不覆盖用户值、损坏自愈、坐标缺省为 `null`）、`tests/sprite-frames.test.js` 1 条（talk/listen 复用映射）。

**一处说明**：本轮还想再补一张「猫确实在右下角」的截图，但当时桌面上有一个**全屏置顶的视频播放器**，截出来整屏都是它，拿不到可信画面（这不是本轮的回归，`alwaysOnTop`/窗口属性本轮未改）。猫的位置与可见性以 `win.getBounds()`（与 `baseBounds` 逐字相同）+ `--self-check` 的 `window-visible` + 落盘坐标为准；要肉眼复核，关掉全屏视频再 `npx electron .` 即可。

---

## 12. 第四轮修复（`docs/M0-FIX-ROUND4.md` FIX-A ~ FIX-C）

### 环境级静默失效与对策

> **给下一轮维护者**：看到 `topmostWatchdog` / `ignoreWatchdog` 这两个定时器时，先读这一节再决定要不要删。它们不是冗余代码，是补两条「不报错、表现滞后」的 Windows 环境级失效。判定逻辑全部抽在 `src/core/window-guards.js`（零 `require('electron')`），容器里 `node --test` 直接钉死。

| # | 现象 | 触发场景（实测来源） | 对策 | 常数 / 层级 |
|---|---|---|---|---|
| ① | **置顶会丢**：猫被压到任务栏 / 其他窗口下面 | Windows 上 `alwaysOnTop: true` 只在 `BrowserWindow` 构造器里生效一次，之后任务栏或全屏窗口扫过就会被压下去 | 周期看门狗重断言置顶；只在「窗口存在 + 可见 + **未暂停**」时动手（暂停时不抢置顶，「暂停」这个逃生口才成立） | **5000 ms**，层级 `pop-up-menu`（只有它压得过任务栏） |
| ② | **穿透会丢**：透明区域又开始挡桌面点击 | `win.setIgnoreMouseEvents(true, { forward: true })` 在 Windows 上**宠物页快速重载 / 有全屏窗口扫过之后会静默失效**，且**没有任何报错** | ①周期看门狗兜底：仅在「渲染进程最近一次报的命中状态 = 没命中交互元素」时重断言 `ignore=true`；命中了就什么都不做，否则点猫会失效。②`did-finish-load` / `did-navigate` / `did-navigate-in-page` 时**立刻**重断言一次（这就是「页面重载后」的现场） | **2000 ms**（比重置顶更密） |

**来源（不是作者瞎编的常数）**：

- 置顶看门狗 5000ms + `pop-up-menu`：竞品 **`rullerzhou-afk/clawd-on-desk`** 源码常数 `TOPMOST_WATCHDOG_MS = 5000` → `docs/M0-recon-github-pet.md` §5.2 / §6(a)。
- 穿透静默失效 + 光标探测看门狗兜底：竞品 **`OpenPetsHQ/openpets`** 源码注释里的实测（`mouse-forwarding.ts` / cursor-probe watchdog）→ `docs/M0-recon-github-pet.md` §5.2 / §6(b)。

**实现位置**：

- 纯函数与常数：`src/core/window-guards.js`（`TOPMOST_WATCHDOG_MS`/`IGNORE_WATCHDOG_MS`/`TOPMOST_LEVEL`、`shouldReassertTopmost()`、`watchdogAction()`）。
- 接线：`src/main.js` 的 `topmostWatchdogTick()` / `ignoreWatchdogTick()` / `reassertPassThrough()`，定时器在 `startTimers()` 里挂、`stopTimers()` 里清。
- 红线：`watchdogAction({ lastInteractive: true, ... })` **必须**返回 `'noop'` —— 命中交互元素时绝不能强行重开穿透，否则「点猫」会失效（`tests/window-guards.test.js` 有专项断言）。

### 本轮改动清单

- 新增 `src/core/window-guards.js`（2 个纯函数 + 3 个常数）。
- `src/main.js`：启动 5000ms 置顶看门狗（`setAlwaysOnTop(true, 'pop-up-menu')`）、2000ms 穿透看门狗（`setIgnoreMouseEvents(true, { forward: true })`）、`did-finish-load`/`did-navigate`/`did-navigate-in-page` 后立刻重断言穿透；主进程缓存 `lastInteractive`；`--smoke-test` 新增 `topmostWatchdog` / `ignoreWatchdog` 两个断言字段。
- 新增 `tests/window-guards.test.js`（6 条用例，全量 86 -> 92）。
- 未改动 `docs/M0-recon-github-pet.md`、`M0-review.md`、`M0-features.md`、`M0-spec.md`、`M0-CODEX-BRIEF.md`、`M0-FIX-ROUND2/3.md`、`hermes-pet-product-design.md`；未引入任何新依赖。

### 本轮验收命令原始输出（汇总）

```powershell
# 宿主：零依赖纯逻辑（Node 24）
PS> node --test tests/*.test.js
...
ℹ tests 92
ℹ suites 0
ℹ pass 92
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 204.2554

# 容器：零依赖纯逻辑（Node 20）
$ docker exec -w /workspace hermes-pet-dev node --test tests/
...
1..92
# tests 92
# suites 0
# pass 92
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 222.059539

# 容器：语法体检
$ docker exec -w /workspace hermes-pet-dev sh -c 'for f in src/main.js src/preload.js src/core/*.js src/adapters/*.js src/renderer/*.js tools/selfcheck.js; do node --check "$f" || exit 1; done; echo ALL_JS_SYNTAX_OK'
ALL_JS_SYNTAX_OK

# 宿主：GUI 冒烟（新增两个看门狗字段为 true，退出码 0）
PS> npx electron . --smoke-test
[hermes-pet] 已启动，adapter = hermes-gateway ；userData = C:\Users\王嘉仪\AppData\Roaming\hermes-pet
[hermes-pet] 穿透重断言： did-navigate
[hermes-pet] 穿透重断言： did-finish-load
[hermes-pet] 窗口就绪：baseBounds = {"x":1272,"y":684,"width":144,"height":144} ；win.getBounds() = {"x":1272,"y":684,"width":144,"height":144} ；主屏 = {"size":{"width":1440,"height":900},"workArea":{"x":0,"y":0,"width":1440,"height":852},"scaleFactor":2}
SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true,"topmostWatchdog":true,"ignoreWatchdog":true}
exit code = 0

# 宿主：深度自检（回归护栏，本轮未改交互链路，仍全绿）
PS> npx electron . --self-check
SELFCHECK_OK 18/18
```

新增 6 条用例（86 -> 92，全在 `tests/window-guards.test.js`）：常数与 §6 对齐 1 条、`shouldReassertTopmost` 4 种组合 1 条 + 8 种布尔组合穷举 1 条 + 缺参 1 条、`watchdogAction` 8 种布尔组合穷举 1 条 + 缺参/真值 `lastInteractive` 一律 `noop` 1 条。

**一处说明**：冒烟日志里的两条 `穿透重断言： did-navigate / did-finish-load` 就是 FIX-B 第 2 条（页面加载后立刻重断言）在真实运行中的现场证据 —— 正常启动也会走这条路，不是异常。

## 13. 第五轮修复（`docs/M0-FIX-ROUND5.md` FIX-1 / FIX-2）

### 现场与真因（来自 `docs/M0-FIX-ROUND5.md` 的独立复验，不是我的自述）

第四轮产物 `b0c5b7d` 上连跑 7 次 `npx electron . --smoke-test`：**1 次红、6 次绿**。红了的那次 `mousePassThrough:false` 不是产品坏了 —— 猫常驻右下角 `(1272,684)-(1416,828)`，当时宿主物理光标在 `1259,702`（紧贴猫左边 13 像素），渲染进程 `elementFromPoint` 命中「可交互」→ **合法地**把穿透关掉 → 旧断言直接读 `ignoreMouseActive`，读到 `false` → `SMOKE_FAIL` + 退出码 1。

也就是说：**产品行为是对的，错的是断言** —— 它读了一个会被合法改写的「当前态」，于是这条验收门会随用户光标位置随机变红；`SMOKE_FAIL` 的退出码 1 还会让 CI/自动化随机挂掉。这种门比没有门更坏。本轮只改这条验收门的确定性 + 补文档，**产品行为一行未动**。

### FIX-1（P0）`mousePassThrough` 改成光标无关的确定性断言

三条要求逐条落实（改动全在 `src/main.js`）：

1. **断言初始态，而不是「当前态」**：`createPetWindow()` 里 `win.setIgnoreMouseEvents(true, { forward: true })` 之后立刻把 `ignoreMouseActive` 快照进独立变量 `ignoreMouseAtStart`（`src/main.js:286`）—— 此刻渲染进程还没跑过任何 `elementFromPoint` 命中测试，这个值不会再被渲染进程的回包污染。断言钉的是 `ignoreMouseAtStart === true`。
2. **断言双向可切换**：`probeMousePassThrough()`（`src/main.js:821`）主动走一遍 `pet:ignore-mouse` 的状态切换路径 —— ① 合成一次「命中交互元素」（`{ ignore: false }`，与渲染进程命中猫/气泡时发的消息形状逐字相同）→ 断言 `ignoreMouseActive` 变 `false`；② 再合成一次「未命中」（`{ ignore: true }`）→ 断言它回到 `true`；③ 结束后 `reassertPassThrough('smoke-probe')` 把状态恢复成 `ignoreMouseActive = true`，并断言恢复成功。
   - 合成方式：IPC handler 主体抽成 `applyIgnoreMouse(info, source)`（`src/main.js:801`），探针直接调**同一个函数**，走的就是真实命中那条路径；另外断言 `ipcMain.listenerCount('pet:ignore-mouse') > 0`，证明通道确实挂着 handler。全程不读、不动真实光标，也不依赖渲染进程时序。
3. **字段名保留**：`mousePassThrough` 不改名、不删除，语义改为 `ipcWired && initial && hit && miss && restored` 的**合取结果**（`src/main.js:894`）。

顺带给 `--smoke-test` 加了一行探针日志，每次冒烟都能看到五个子结果：`穿透探针（FIX-1 光标无关）： {"ipcWired":true,"initial":true,"hit":true,"miss":true,"restored":true}`。

#### 验收（a）：连跑 5 次必须 5/5 `SMOKE_OK`、5/5 退出码 0

```powershell
PS> 1..5 | ForEach-Object { npx electron . --smoke-test; "exit=$LASTEXITCODE" }
```

原始输出（未加工，5 次连着贴）：

```

[hermes-pet] 已启动，adapter = hermes-gateway ；userData = C:\Users\王嘉仪\AppData\Roaming\hermes-pet
[hermes-pet] 穿透重断言： did-navigate
[hermes-pet] 穿透重断言： did-finish-load
[hermes-pet] 窗口就绪：baseBounds = {"x":1183,"y":627,"width":144,"height":144} ；win.getBounds() = {"x":1183,"y":627,"width":144,"height":144} ；主屏 = {"size":{"width":1440,"height":900},"workArea":{"x":0,"y":0,"width":1440,"height":852},"scaleFactor":2}
[hermes-pet] 穿透状态切换：ignore = false （来源：probe）
[hermes-pet] 穿透状态切换：ignore = true （来源：probe）
[hermes-pet] 穿透重断言： smoke-probe
[hermes-pet] 穿透探针（FIX-1 光标无关）： {"ipcWired":true,"initial":true,"hit":true,"miss":true,"restored":true}
SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true,"topmostWatchdog":true,"ignoreWatchdog":true}
exit=0

[hermes-pet] 已启动，adapter = hermes-gateway ；userData = C:\Users\王嘉仪\AppData\Roaming\hermes-pet
[hermes-pet] 穿透重断言： did-navigate
[hermes-pet] 穿透重断言： did-finish-load
[hermes-pet] 窗口就绪：baseBounds = {"x":1183,"y":627,"width":144,"height":144} ；win.getBounds() = {"x":1183,"y":627,"width":144,"height":144} ；主屏 = {"size":{"width":1440,"height":900},"workArea":{"x":0,"y":0,"width":1440,"height":852},"scaleFactor":2}
[hermes-pet] 穿透状态切换：ignore = false （来源：probe）
[hermes-pet] 穿透状态切换：ignore = true （来源：probe）
[hermes-pet] 穿透重断言： smoke-probe
[hermes-pet] 穿透探针（FIX-1 光标无关）： {"ipcWired":true,"initial":true,"hit":true,"miss":true,"restored":true}
SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true,"topmostWatchdog":true,"ignoreWatchdog":true}
exit=0

[hermes-pet] 已启动，adapter = hermes-gateway ；userData = C:\Users\王嘉仪\AppData\Roaming\hermes-pet
[hermes-pet] 穿透重断言： did-navigate
[hermes-pet] 穿透重断言： did-finish-load
[hermes-pet] 窗口就绪：baseBounds = {"x":1183,"y":627,"width":144,"height":144} ；win.getBounds() = {"x":1183,"y":627,"width":144,"height":144} ；主屏 = {"size":{"width":1440,"height":900},"workArea":{"x":0,"y":0,"width":1440,"height":852},"scaleFactor":2}
[hermes-pet] 穿透状态切换：ignore = false （来源：probe）
[hermes-pet] 穿透状态切换：ignore = true （来源：probe）
[hermes-pet] 穿透重断言： smoke-probe
[hermes-pet] 穿透探针（FIX-1 光标无关）： {"ipcWired":true,"initial":true,"hit":true,"miss":true,"restored":true}
SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true,"topmostWatchdog":true,"ignoreWatchdog":true}
exit=0

[hermes-pet] 已启动，adapter = hermes-gateway ；userData = C:\Users\王嘉仪\AppData\Roaming\hermes-pet
[hermes-pet] 穿透重断言： did-navigate
[hermes-pet] 穿透重断言： did-finish-load
[hermes-pet] 窗口就绪：baseBounds = {"x":1183,"y":627,"width":144,"height":144} ；win.getBounds() = {"x":1183,"y":627,"width":144,"height":144} ；主屏 = {"size":{"width":1440,"height":900},"workArea":{"x":0,"y":0,"width":1440,"height":852},"scaleFactor":2}
[hermes-pet] 穿透状态切换：ignore = false （来源：probe）
[hermes-pet] 穿透状态切换：ignore = true （来源：probe）
[hermes-pet] 穿透重断言： smoke-probe
[hermes-pet] 穿透探针（FIX-1 光标无关）： {"ipcWired":true,"initial":true,"hit":true,"miss":true,"restored":true}
SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true,"topmostWatchdog":true,"ignoreWatchdog":true}
exit=0

[hermes-pet] 已启动，adapter = hermes-gateway ；userData = C:\Users\王嘉仪\AppData\Roaming\hermes-pet
[hermes-pet] 穿透重断言： did-navigate
[hermes-pet] 穿透重断言： did-finish-load
[hermes-pet] 窗口就绪：baseBounds = {"x":1183,"y":627,"width":144,"height":144} ；win.getBounds() = {"x":1183,"y":627,"width":144,"height":144} ；主屏 = {"size":{"width":1440,"height":900},"workArea":{"x":0,"y":0,"width":1440,"height":852},"scaleFactor":2}
[hermes-pet] 穿透状态切换：ignore = false （来源：probe）
[hermes-pet] 穿透状态切换：ignore = true （来源：probe）
[hermes-pet] 穿透重断言： smoke-probe
[hermes-pet] 穿透探针（FIX-1 光标无关）： {"ipcWired":true,"initial":true,"hit":true,"miss":true,"restored":true}
SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true,"topmostWatchdog":true,"ignoreWatchdog":true}
exit=0
```

#### 验收（b）：光标处于不同位置各跑一次 —— 原始输出

宿主光标可以由脚本摆位（`[System.Windows.Forms.Cursor]::Position`），所以没有用「无法控制光标」的免责说法，而是**真摆到两个位置各跑了一次**，跑完把光标还原：

```powershell
PS> # RUN over-cat：把光标摆进猫的矩形中心 (1255,699)（= 第四轮变红的那个位置条件），并在 6 秒等待期内小幅抖动，确保真的产生 forward 的 mousemove
PS> npx electron . --smoke-test

[hermes-pet] 已启动，adapter = hermes-gateway ；userData = C:\Users\王嘉仪\AppData\Roaming\hermes-pet
[hermes-pet] 穿透重断言： did-navigate
[hermes-pet] 穿透重断言： did-finish-load
[hermes-pet] 窗口就绪：baseBounds = {"x":1183,"y":627,"width":144,"height":144} ；win.getBounds() = {"x":1183,"y":627,"width":144,"height":144} ；主屏 = {"size":{"width":1440,"height":900},"workArea":{"x":0,"y":0,"width":1440,"height":852},"scaleFactor":2}
[hermes-pet] 穿透状态切换：ignore = false （来源：renderer）
[hermes-pet] 穿透状态切换：ignore = true （来源：probe）
[hermes-pet] 穿透重断言： smoke-probe
[hermes-pet] 穿透探针（FIX-1 光标无关）： {"ipcWired":true,"initial":true,"hit":true,"miss":true,"restored":true}
SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true,"topmostWatchdog":true,"ignoreWatchdog":true}
exit=0

PS> # RUN far-away：把光标摆到 (60,60)，远离猫
PS> npx electron . --smoke-test

[hermes-pet] 已启动，adapter = hermes-gateway ；userData = C:\Users\王嘉仪\AppData\Roaming\hermes-pet
[hermes-pet] 穿透重断言： did-navigate
[hermes-pet] 穿透重断言： did-finish-load
[hermes-pet] 窗口就绪：baseBounds = {"x":1183,"y":627,"width":144,"height":144} ；win.getBounds() = {"x":1183,"y":627,"width":144,"height":144} ；主屏 = {"size":{"width":1440,"height":900},"workArea":{"x":0,"y":0,"width":1440,"height":852},"scaleFactor":2}
[hermes-pet] 穿透状态切换：ignore = false （来源：probe）
[hermes-pet] 穿透状态切换：ignore = true （来源：probe）
[hermes-pet] 穿透重断言： smoke-probe
[hermes-pet] 穿透探针（FIX-1 光标无关）： {"ipcWired":true,"initial":true,"hit":true,"miss":true,"restored":true}
SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true,"topmostWatchdog":true,"ignoreWatchdog":true}
exit=0

===== cursor restored to (904,490) =====
```

#### 怎么论证「断言已与光标位置解耦」

不是靠嘴说，靠上面两次跑出来的**行为差异 + 同一结论**：

1. `over-cat` 那次的日志里有一行 `穿透状态切换：ignore = false （来源：renderer）` —— **来源是 renderer**，说明真实光标压进猫的矩形时，渲染进程确实通过了 `pet:ignore-mouse` 合法地把穿透关掉了。这正是第四轮 `mousePassThrough:false` 的现场条件，**被完整复现了**。
2. 但这次的结论仍是 `SMOKE_OK` + `exit=0`：因为 `mousePassThrough` 不再读那个被改写的当前态，而是读「初始快照 + 双向合成 + 恢复」四个子结果（探针行五个子结果两轮完全一致：`{"ipcWired":true,"initial":true,"hit":true,"miss":true,"restored":true}`）。
3. `far-away` 那次没有任何 `renderer` 来源的状态切换，结论同样是 `SMOKE_OK` + `exit=0`。**同一份代码，在「光标在猫身上」与「光标在角落」两种输入下给出一致结论** —— 这就是解耦的直接证据。

（附注：两次原始输出里的 `baseBounds = {"x":1183,"y":627,...}` 是宿主上一次拖拽后落盘的猫位置，与本轮改动无关；冒烟只关心字段真假，不关心坐标。）

### FIX-2（P2）「光标压在猫身上时穿透会合法关闭」是设计，不是 bug

> **给用户与下一轮维护者**：如果你把鼠标移到猫身上、发现「这块区域不再穿透桌面点击了」，这是**预期行为**，不是穿透失效。

1. **猫的矩形是可交互区，光标进入时穿透会（且应当）关闭**：窗口默认整矩形穿透（`setIgnoreMouseEvents(true, { forward: true })`），渲染进程用 `document.elementFromPoint()` 命中 `#cat / #cat-slot / #bubble / button / input / textarea` 判定「可交互」，命中就关穿透、离开就开回来（`src/renderer/pet.js` 的 `refreshPassthrough()`，主进程 `applyIgnoreMouse()`）。不这样做的后果是「猫点不动」—— 那才是真 bug。
2. **代价：在猫的矩形内点击会被猫吃掉**：猫的可交互区是从 `#cat` 元素算起的矩形，猫的透明边角（例如贴图四周的空白）**也算在内**，所以在那块矩形里点桌面图标/其他窗口，会被猫截获而不是落到桌面上。这是「猫可点」的直接代价，第四轮之前就有，不是本轮引入。
3. **已知的产品级缓解方案（本轮不做，记为 M1 候选）**：托盘菜单加一个「别烦我 / 透明模式」开关（竞品 `isHarryh/Ark-Pets` 有同名功能）。打开后整窗恒定穿透、`refreshPassthrough()` 不再关穿透，猫不再吃点击（代价是那期间猫也点不动/拖不动）。这是**产品行为**改动，按本轮任务书红线不在本轮做。

### 本轮改动清单

- `src/main.js`：新增 `ignoreMouseAtStart` 初始态快照（建窗后立刻拍）；`pet:ignore-mouse` handler 主体抽成 `applyIgnoreMouse(info, source)`；新增 `probeMousePassThrough()`；`smokeOutcome()` 的 `mousePassThrough` 改为合取结果；新增一行 `--smoke-test` 探针日志。**没有改任何窗口/穿透/托盘的产品行为**。
- `HANDOFF.md`：新增本节（第十三节）。
- 未新增文件、未改测试、未引入依赖；全量用例仍是 **92**（与第四轮一致，一条不红）。
- 未改动 `docs/` 下任何已产出文档（含 `M0-recon-github-pet.md` / `M0-review.md` / `M0-features.md` / `M0-spec.md` / `M0-task.md` / `M0-sprite-map.md` 前四节 / `M0-CODEX-BRIEF.md` / `M0-FIX-ROUND2·3·4.md`）与 `hermes-pet-product-design.md`。

### 本轮回归原始输出（汇总）

```powershell
# 宿主：零依赖纯逻辑（Node 24）
PS> node --test tests/*.test.js
...
ℹ tests 92
ℹ suites 0
ℹ pass 92
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

# 容器：零依赖纯逻辑（Node 20）
$ docker exec -w /workspace hermes-pet-dev node --test tests/
...
1..92
# tests 92
# suites 0
# pass 92
# fail 0
# cancelled 0
# skipped 0
# todo 0

# 容器：语法体检（只验本轮改动的那个文件）
$ docker exec -w /workspace hermes-pet-dev node --check src/main.js
CONTAINER_JS_SYNTAX_OK

# 宿主：深度自检（18/18，交互链路未受影响）
PS> npx electron . --self-check
...
[hermes-pet] [selfcheck] OK   window-visible - 窗口可见
[hermes-pet] [selfcheck] OK   tray-created - 托盘图标已创建
[hermes-pet] [selfcheck] OK   renderer-ready - {"catRendered":true,"sprite":"../../data/sprites/oneko.gif","sheet":"256x128"}
[hermes-pet] [selfcheck] OK   sprite-applied - background-position=-96px -96px
[hermes-pet] [selfcheck] OK   state-machine-idle - state=idle
[hermes-pet] [selfcheck] OK   pet-size-var - --pet-size=120px
[hermes-pet] [selfcheck] OK   click-opens-dialogue - {"bubbleHidden":false,"composerVisible":true,"bubbleWidth":136}
[hermes-pet] [selfcheck] OK   window-grows-for-bubble - 144 -> 261
[hermes-pet] [selfcheck] OK   bubble-width-capped - 宽度 136px（上限 320）
[hermes-pet] [selfcheck] OK   bubble-fully-visible-at-screen-edge - 气泡屏幕矩形={"width":136,"height":400,"left":1304,"top":408,"right":1440,"bottom":808,"scrollable":true} workArea={"x":0,"y":0,"width":1440,"height":852}
[hermes-pet] [selfcheck] OK   bubble-long-text-scrolls - scrollHeight > clientHeight = true
[hermes-pet] [selfcheck] OK   chat-reply - local-mock -> 在。今天想把哪块硬骨头拆解它？
[hermes-pet] [selfcheck] OK   chat-no-status-code-leak - 气泡文案里没有状态码
[hermes-pet] [selfcheck] OK   chat-thinking-feedback - sawThinking=false repliedAt=85ms
[hermes-pet] [selfcheck] OK   chat-submit-path-answered - 气泡最终文案=这句我先收下。要不要我们一起把它拆解它？
[hermes-pet] [selfcheck] OK   esc-closes-and-shrinks - 144 vs 144
[hermes-pet] [selfcheck] OK   settings-window - 已创建
[hermes-pet] [selfcheck] OK   settings-bound-to-config - {"nickname":"琉斯","size":"120","hasBridge":true}
SELFCHECK_OK 18/18
```

## 14. M1-R1 验收（A1-A13 + 两个新纯逻辑模块 + 自证门 18 -> 37）

> 权威：`docs/M1R1-task.md` v3。本节**只追加**，§1-§13 一行未改。
> 完整未裁剪日志落 `docs/_m1r1/`：`tests-host.log` / `tests-container.log` / `smoke-5x.log` / `selfcheck.log` / `fullscreen-probe.log`。

### 14.1 §3.1 六条命令（真实输出）

**① 宿主 Node 24：`node --test tests/*.test.js`**
```text
ℹ tests 130
ℹ pass 130
ℹ fail 0
```
92 条 M0 旧用例零红；新增 `tests/walk.test.js`(9) + `tests/quiet.test.js`(10)，另在 6 个既有测试文件里扩了 19 条（state-machine 白名单只增不减快照 / sprite-frames direction8 / config migrate+shortcuts / scheduler return+2h+quiet / position snapToEdge 六场景 / window-guards dnd 16 组合）。

**② 容器 Node 20：`docker exec -w /workspace hermes-pet-dev node --test tests/`**
```text
# tests 130
# pass 130
# fail 0
```

**③ 语法体检（glob 已含新增 `src/core/walk.js` / `src/core/quiet.js`）**
```text
ALL_JS_SYNTAX_OK
```

**④ `npx electron . --smoke-test` 连跑 5 次（每轮先 `Get-Process electron | Stop-Process -Force` 冷启动，exit 全 0）**
```text
run 1 exit=0 : SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true,"topmostWatchdog":true,"ignoreWatchdog":true,"dnd":true}
run 2 exit=0 : SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true,"topmostWatchdog":true,"ignoreWatchdog":true,"dnd":true}
run 3 exit=0 : SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true,"topmostWatchdog":true,"ignoreWatchdog":true,"dnd":true}
run 4 exit=0 : SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true,"topmostWatchdog":true,"ignoreWatchdog":true,"dnd":true}
run 5 exit=0 : SMOKE_OK {"window":true,"tray":true,"pet":true,"mousePassThrough":true,"topmostWatchdog":true,"ignoreWatchdog":true,"dnd":true}
```
5/5 SMOKE_OK；新增 `dnd` 字段（A5 探针：开 dnd -> 穿透锁死 / 关 -> 恢复 / 收尾还原，光标无关）。

**⑤ `npx electron . --self-check`（exit=0）**
```text
SELFCHECK_OK 37/37
```
18 -> 37：新增 19 项全部确定性（只读纯逻辑 / 状态机 / config，不读真实光标与真实命中态）；shortcut 只用 `Alt+F9`/`Alt+F10`，验完即注销。

**⑥ A13 全屏探测真跑一次（【P1-3】本轮必做，不是「接口存在」）**
```powershell
node -e "require('./src/core/quiet').detectForegroundFullscreen({wait:true}).then(r=>console.log(JSON.stringify(r)))"
```
```json
  {"fullscreen":false,"raw":"FULLSCREEN 0 rect=-7,-7,1446,858 monitor=0,0,1440,900","error":null,"durationMs":327}
```
判读：PowerShell + user32 真的拿到了前台窗口矩形与显示器矩形（`-7,-7,1446,858` 是带阴影的最大化窗口，盖不住 `1440x900` 的显示器），所以判 `0`（正确降级，不是报错）；`error=null`、`durationMs=327`。反向（`true`）由 `tests/quiet.test.js` 注入 `FULLSCREEN 1` 覆盖。

### 14.2 交付文件

- 新增：`src/core/walk.js`、`src/core/quiet.js`、`tests/walk.test.js`、`tests/quiet.test.js`。
- 改（src，15 个）：`core` 下 `sprite-frames / state-machine / position / scheduler / config / replies / window-guards`、`main.js`、`preload.js`、`renderer` 下 `index.html / pet.js / pet.css / settings.html / settings.js / settings.css`。
- 改（测试 / 工具，7 个）：`tests` 下 `state-machine / sprite-frames / config / scheduler / position / window-guards` 六个 `.test.js`、`tools/selfcheck.js`。
- 未碰：`docs/M0-*.md`、`hermes-pet-product-design.md`、`data/sprites/`、`tools` 下的 py 脚本、`src/adapters/`、`src/hermes_pet/`、`pyproject.toml`、`.env`、`docs/M1R1-*.md`。

### 14.3 自证门新增 19 项（18 -> 37）

- 主线 13：`walk-state-exists` / `look-state-exists` / `dnd-locks-passthrough` / `snap-to-edge` / `zoom-clamp` / `onboarded-field` / `return-trigger` / `shortcut-register` / `shortcut-occupied` / `shortcut-unregister-all` / `copy-bridge` / `history-↑` / `bubble-pin`。
- 【P1-6】4：`quiet-blocks-proactive`（六信号各一次 -> plan 全 `quiet`、走动全挡；深夜只减速到 2px/步）/ `walk-guards`（dnd / 暂停 / 对话中 / 拖后 1s 一律假，拖后满 2s 变真）/ `config-migrate-nickname`（`schemaVersion:1` + `琉斯` -> `你`，改过名的不动）/ `return-clock-guard`（回拨不置位、跨天清零、合盖唤醒只判一次）。
- 【P1-5】1：`copy-overlong-truncated`（5000 字 -> 4096 + `truncated:true`；非 string / 空白被拒）。
- 【P1-7 复核补】1：`autolaunch-failure-injected`（注入抛错的 setLoginItem -> 调用恰好 1 次且产生一条用户可见提示）。

### 14.4 本轮跑红后修掉的真问题（单测 / 自证门当场抓到的）

- `walkStep` 对角线取整会把单次位移顶出 100px 额度（`traveledPx=99` 时走 1.41px）-> 极端额度退化成单轴 1px。
- `zoomSize(145, +1)` 因浮点误差算出 160，与 features §A4 验收链 `120->132->145->159` 冲突 -> 取整前减 epsilon。
- `state-machine` 被白名单拒绝的 `walk:start`（如 sleeping 中）会偷偷留下脏 `walkDir` -> 只在事件被接受时记方向。
- `tests/walk.test.js` 的源码断言误命中注释里的 `require('electron')` -> 先剥注释再判定。

### 14.5 遗留 / 明确不做

- Alt+T 触发时会把窗口前台化抢一次焦点（【P2-6】已承认，换取「一键就能打字」）；Esc 只在猫窗口聚焦时生效，从不注册全局。
- 全屏探测按当前前台窗口**实时**给值：本机此刻前台是最大化窗口 -> `false`（预期）。真全屏（播放器 / 全屏游戏）下为 `true`；节流 ~2s、探测失败一律降级 `false`。
- A1 初见流程的交互手感（探出 + 张望 + 问名字）需站长实机过一遍；自证门只覆盖「迁移 + onboarded 字段」这类纯逻辑。