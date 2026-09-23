# M0 第二轮修复任务书（codex）— 依据杠精独立审查的 P0/P1

> 执行者：codex ｜ 工作目录：`D:\Jiayi\Projects\hermes-pet`
> 依据：`docs/M0-review.md`（杠精独立审查，**只审不改**，报告本身不要动）
> 本轮只做修复与补强，**不新增功能**。每条都要在 HANDOFF.md 里给出「改了什么 + 怎么验的」。

---

## P0-1 窗口尺寸与气泡尺寸互斥（**必须改**）

**问题**：窗口尺寸未定义；若窗口按「显示大小 60-180px」建，320px 宽的气泡会被窗口裁掉（Electron 窗口不会因内容溢出自动变大），「点猫→出气泡」验收当场失败。

**改法**（三条硬规定，照做）：
1. **窗口尺寸固定 `360 x 440`**，**不随显示大小变化**；
2. 「显示大小 60-180px」只作用于**猫元素自身 CSS 尺寸**：`#cat { width: var(--cat-size); height: var(--cat-size); }`，`--cat-size` 由设置驱动；
3. 布局写死：
   - 猫：`position:absolute; bottom:0; left:50%; transform:translateX(-50%)`
   - 气泡：`position:absolute; bottom:calc(var(--cat-size) + 8px); left:50%; transform:translateX(-50%); max-width:320px; max-height:400px; overflow:auto`
   - 输入框在气泡内底部
4. 位置持久化与屏幕 clamp **按窗口矩形算**（`win.getBounds()` 与 `screen.getDisplayMatching`），**不要按猫矩形算**（会漂）。

**验收**：窗口 360x440；猫缩小到 60px 时气泡仍完整可见不被裁；调整大小后位置不漂。

---

## P0-2 透明窗口的「看不见的挡板」（**最优先，站长第一分钟就会撞上**）

**问题**：Windows 上 Electron 透明窗口**整矩形接收鼠标事件**（alpha=0 的像素照样吃点击），360x440 里大部分是透明的 → 桌面右下角一块看不见的方块永久挡住下面的图标/文件/按钮。但无脑 `setIgnoreMouseEvents(true)` 又会让猫自己点不动，F3 直接失效。

**改法**（照抄结构）：
1. 主进程建窗后：`win.setIgnoreMouseEvents(true, { forward: true })`（Windows 支持 `forward`，鼠标移动事件仍会送到渲染进程）；
2. 渲染进程在 `mousemove` 里做命中测试：
   ```js
   const hit = document.elementFromPoint(e.clientX, e.clientY);
   const interactive = !!(hit && hit.closest('#cat, #bubble, #bubble *, .panel, .panel *, button, input, textarea'));
   window.pet.setIgnoreMouse(!interactive);
   ```
3. **拖拽期间** `dragLock = true` 强制保持**不穿透**（否则快速拖动会丢鼠标事件）；`mouseup` 后按上一条重判一次；
4. 键盘焦点场景（输入框聚焦时）也要保持不穿透。

**验收（两条都要）**：
- 把猫停在桌面图标上，**在透明区域点击能点到下面的图标**
- **点猫仍能弹出气泡 + 输入框**（穿透逻辑没有误伤猫本体）

---

## P0-3 状态机缺可执行定义

**问题 a**：`docs/M0-sprite-map.md` 只有 idle/alert/tired/sleeping/scratch* / 8 个方向组，**没有 `talk` / `listen` / `drag`** 三组，而 F2 状态列表里有这三个 → 不猜就写不出来。
**改法 a**（在 `docs/M0-sprite-map.md` **末尾追加**小节「M0 状态补充映射（复用，不改动原始 17 组）」）：
- `talk` = 复用 `alert` 帧 `[-7,-3]` + CSS `@keyframes talk-tilt{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}` 0.6s 循环
- `listen` = 复用 `idle` 帧 `[-3,-3]` + 轻微呼吸缩放 CSS
- `drag` = `SE [-5,-1]` / `SW [-5,-3]` 各 4 帧交替（拖向哪边用哪组）
- 并注明「依据：这三组是 M0 的行为态，原始 17 组是位置/动作态；复用以避免自创索引」

**问题 b**：`M0-sprite-map.md` 第 4 节写 `sleeping` 分支「超过 192 帧复位回 idle」（≈6.4 秒），与 F5「空闲 ≥30 分钟才进打盹、一直睡到用户回来」**直接冲突**。
**改法 b**：明确区分两个概念——
- sprite-map 里的「192 帧自动复位」**只适用于 oneko 式 idle 小动作里那一次概率触发的假睡**；
- **30 分钟打盹是独立状态 `nap`**，**只由用户交互或显式唤醒退出**，任何计时器都不得自动退出。

**问题 c**：无状态转移表 → 补一张最小转移表（事件 × 当前状态 → 目标状态），至少覆盖：
| 事件 | 当前状态 | 目标 |
|---|---|---|
| click | sleeping / nap | `alert`（播 8 帧唤醒）→ `talk` |
| click | talk | `talk`（**重置**消失计时，不重复弹） |
| dragStart | talk / listen | `drag` |
| mouseup | drag | **恢复 dragStart 之前的状态**（对话中的猫被拖一下不能丢对话） |
| 鼠标离开 3s | alert | `idle` |
| 任意用户交互 | 任意 | idle 计时器归零 |
| 主动行为到点 | sleeping / nap | **先播唤醒动画再开口**（禁止「睡着说话」） |

再补一句优先级：「用户交互 > 主动行为 > 装饰动画；同级直接覆盖，不排队」。

---

## P0-4 素材没进 git（**已自修，需自证**）

`.gitignore` 现在是 `!data/sprites/**` 放行 → 提交后**必须**自证：
```powershell
git ls-files data/
```
输出**必须列出 8 项**（`data/sprites/oneko.gif`、`icon-256/128/64/32.png`、`icon-night.png`、`tray.png`、`.gitkeep`），把**原始输出**贴进 HANDOFF.md。若仍被忽略，兜底 `git add -f data/sprites/`。

---

## P1-2 网关适配器协议冻结（**必须写死，否则永远是假降级**）

`docs/M0-review.md` P1-2 指出：协议/鉴权全未定义 → codex 只能猜；不带 `Authorization` 头则每次都 401 → 每次都降级到 mock → 冒烟全绿但这条链路**从未跑通过**。

**改法**：F4 补「网关协议（M0 冻结版）」：
- `POST {HERMES_GATEWAY_URL}/v1/chat/completions`
- headers：`Content-Type: application/json`、`Authorization: Bearer ${HERMES_API_KEY}`
- body：`{ model:'default', messages:[{role:'user',content:text}], stream:false }`
- 取值：`json.choices[0].message.content`，**非字符串即抛 `GatewayError`**
- `HERMES_API_KEY` 只从 `.env` 读、**只在主进程用**、绝不进渲染进程、绝不进日志
- 若今天不真联调，至少保证：**适配器可被单测覆盖**（注入假 fetch 验证 header/body/取值/异常四条路径）

---

## P1-3 降级错误面放宽（**必须**）

降级条件改成「**除成功取值外的任何情况**」：
```js
try { /* 请求 + 解析 + 取值 */ }
catch (e) { throw new GatewayError(mapReason(e)); }
```
`mapReason` 归一四类：`e.name === 'AbortError'`（超时）/ `e.code`（ECONNREFUSED、ENOTFOUND）/ `e instanceof SyntaxError`（响应不是 JSON，网关挂了常返回 HTML）/ 字段缺失（无 `choices`）。
`adapters/index.js` 只 catch `GatewayError` 并降级；**任何异常都不允许冒泡到渲染进程**（否则气泡不动或白屏）。

## P1-4 10 秒超时期间气泡要有反馈（**必须**）

发送后**立刻**把气泡切到 `listen`；1.5 秒内未返回 → 显示「在想…」（打字机省略号）；`GatewayError` 命中后**就地替换**为 mock 回复，并追加一句人话（如「网关没连上，我先用自己的话答你」）。**禁止出现 HTTP 状态码与堆栈。**（本地网关没起时这 10 秒 100% 会复现，不补就是「对话功能坏了」。）

## P1-5 `.env` 用手写 parser，不许引依赖（**必须**）

禁止 `require('dotenv')`（本轮除 electron 外零依赖）。在 `src/core/config.js` 里手写约 10 行 parser：按行 `trim`、跳过空行与 `#` 开头、按**第一个** `=` 切分、去掉成对引号；不支持多行值与变量展开。路径由 `main.js` 用 `path.join(__dirname,'..','.env')` 传参。`.env` 不存在**不算错误**，直接走 mock。

## P1-6 `src/adapters/` 也禁止 `require('electron')`（**必须**）

把禁令从 `src/core/` 扩到 `src/adapters/`：两者同为纯 Node 模块。`.env` 路径、`fetch` 实现、时钟**全部由 main.js 通过函数参数注入**，便于单测注入假 fetch。否则容器里 `node --test` 会因 `electron` 不可 require 而**整批加载失败**。

## P1-7 调度器用「墙钟」而非累计计时（**必须**）

四个触发源（每日问候 / 30 分钟打盹 / 40 分钟休息提醒 / 22:30 日落）都**不许用 `setTimeout` 累加**。合盖 3 小时或手改系统时间（站长验收时很可能手调到 1:00 测深夜模式）会让累计计时器错乱、并集中补发一串气泡。
改法：调度器只依赖**注入的 `now()` 墙钟**做决策（纯函数，可单测），每个触发源各自记录「上次触发时间戳」到 `state.json`；
- 每次判定前做**漂移检测**：若 `now - lastTick > 2 分钟`（说明刚从睡眠唤醒）→ 只做一次「现在该不该说」的判定，**不补发历史**；
- 系统时间**回拨**（`now < lastTick`）→ 重置所有计时基准，不触发任何行为；
- 22:30 日落「当天只触发一次」用日期戳判断（跨天重置），不用 24h 间隔。

**单测必须覆盖**：多触发源同时到点只放行一次（每 2 小时护栏不可被绕过）、跨天重置、22:30 当天只触发一次、时间回拨不触发、唤醒后不补发。

---

## 交付纪律

- 改完**必须重跑**：容器内 `node --check` 全量 + `node --test tests/` 全绿；宿主 `npm install` 后 `npx electron . --smoke-test` 打印 `SMOKE_OK`
- `--smoke-test` 里**增加两项断言**：`window`（窗口创建）、`mousePassThrough`（穿透逻辑已接线，至少验证 IPC 通道存在且初始状态为 ignore=true）
- 更新 `HANDOFF.md`（P0/P1 逐条：改了什么 / 怎么验的 / 原始输出）
- `git add -A && git commit`（**不要 push**）
- 最终回复 **≤15 行摘要**，不要把代码贴进聊天
- ❌ 不要修改 `docs/M0-review.md`、`docs/M0-features.md`、`docs/M0-spec.md`、`hermes-pet-product-design.md`
- ❌ **禁止在 `D:\Jiayi\` 根目录新建任何文件**
- ❌ 不引入任何新 npm 依赖
