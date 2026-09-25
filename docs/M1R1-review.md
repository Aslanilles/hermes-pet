# hermes-pet M1-R1 独立审查（杠精🔍）

> 审查对象：`docs/M1R1-task.md`（v2，唯一权威）/ `docs/M1R1-spec.md`（v2）/ `docs/M1R1-features.md`（v2）/ `docs/M1R1-supplement.md`
> 审查基线：HEAD `a483826`（工作树干净）；M0 现状 92 单测 / `--self-check` 18/18 / `--smoke-test` SMOKE_OK 5/5
> 方式：**只读**。未改 spec / task / features / 源码 / 产品文档；本文件是唯一产出。
> 已核对的源码事实（行号均为 HEAD `a483826`）：`src/core/config.js`、`state-machine.js`、`window-guards.js`、`position.js`、`scheduler.js`、`src/main.js`、`src/preload.js`、`src/renderer/pet.js`、`tests/*.test.js`、`tools/selfcheck.js`、`HANDOFF.md` §11/§12/§13、`docs/M0-NEXT-SESSION.md`。
> 任务书自报的两条已知事实已采信，未重复验证（`src/main.js:536 applyAutoLaunch()` 真调 `setLoginItemSettings`；`src/renderer/pet.css` body 为 `user-select:none`）。

---

## 0. 结论（先给结果）

**打回 —— 先修订 M1R1-task.md / M1R1-spec.md 的 5 条 P0 与 7 条 P1，再交 codex 开工。**
理由：5 条 P0 里 3 条是「规格自相矛盾 / 数字算不通 / 与 M0 既有机制打架」，执行者无论怎么选都会踩到另一条；另 2 条（A5 所有权、A1 迁移）是功能性缺陷，按现在的文档实现出来就是坏的。这不是「实现水平」问题，是**任务书本身不收敛**。

---

## 1. P0（阻塞，必须先改文档再派单）

### P0-1 ★ A5「别烦我」的穿透所有权仍然有洞（本轮最容易做错的一条，实锤）

- **问题**：spec §7 定了「主进程 `applyIgnoreMouse()` 是唯一裁决点」，但只写了「关 dnd 时 `reassertPassThrough('dnd-off')` 一次恢复」，**没写「开 dnd 的那一瞬间谁来把 ignore 断言成 true」**。同时看门狗链路对 dnd 一无所知。
- **为什么是问题**（三条连锁，全部可在现有代码上复现推演）：
  1. `src/main.js:801-811 applyIgnoreMouse()` 的短路点在最前面，dnd 开时它「吞掉任何 `ignore:false`」——**它只在被调用时才起作用**。若用户是「鼠标正压在猫身上（`ignoreMouseActive === false`，`lastInteractive === true`，M0 的合法状态）时去托盘勾选别烦我」，开 dnd 期间**没有任何一行代码再调 API**，窗口就停在 `ignore=false`：猫的矩形继续吃点击，「别烦我」看起来是坏的（点猫没反应，点它身下的桌面图标也没反应）。
  2. 这时本来该兜底的穿透看门狗正好是**唯一兜不住的那条**：`src/main.js:778-788 ignoreWatchdogTick()` 走 `windowGuard.watchdogAction({ lastInteractive })`，而 `src/core/window-guards.js` 的 `watchdogAction()` **没有 dnd 参数**——`lastInteractive === true` 一律返回 `'noop'`（M0 第五轮为了不打断「点猫」特意加的红线，是对的）。于是 dnd 开启后既没人断言、看门狗又拒绝对手，状态永久卡在 `ignore=false`。
  3. 规格自己写的「③ 看门狗 dnd 下无害」**只在 lastInteractive 为假时成立**；而 lastInteractive 是「最近一次渲染进程上报值」的缓存（`src/main.js:806`），它在 dnd 下会**陈旧为真**：渲染进程按 spec ② 短路后不再上报，缓存永远翻不回来。
- **具体修法**（三条都要落到 task/spec 的文字里，并各配一条确定性断言）：
  1. `setDnd(true)` 的主进程路径**必须无条件**执行一次 `win.setIgnoreMouseEvents(true, { forward: true })` 并把 `lastInteractive = false` —— 直接复用 `reassertPassThrough('dnd-on')`（`src/main.js:746`）即可，别自己另写一份；`setDnd(false)` 保留 `reassertPassThrough('dnd-off')`。要写死的是「**开 / 关两个方向都要重断言**」，而不是只有关的时候。
  2. 给 `watchdogAction()` **加 dnd 维度**（或加一条 `dnd` 短路）：`dnd === true` 时无视 `lastInteractive`，一律 `'force-ignore'`。理由：dnd 的语义就是「这一层像素永远不接点击」，此时 `lastInteractive` 已不是有效信号。同时保留原红线单测（`dnd` 缺省 / false 时，`lastInteractive === true` 仍必须 `'noop'`），别把 M0 的 8 组合穷举测试改红。
  3. 渲染进程短路时**也上报一次** `{ ignore: true }`（或明确「主进程自行把 lastInteractive 置假」），保证缓存不会在 dnd 之下腐烂。
  4. 加两条断言：`dnd-locks-passthrough`（selfcheck）之外，补一条单测「`dnd=true` + `lastInteractive=true` → `watchdogAction` 返回 `force-ignore`」；并把「开 dnd 后 2 秒内 `ignoreMouseActive` 必须为 true」写成冒烟探针字段（可照 M0 第五轮 FIX-1 的 `probeMousePassThrough()` 模式，光标无关）。

### P0-2 ★ A1 的 nickname 是破坏性语义变更，但迁移策略完全缺失

- **问题**：task §2.7 / spec §3、§9 只说「`config.nickname` = 用户名字（语义纠正）」「旧文件缺字段 → merge 补默认」「**schemaVersion 保持 1（加字段非破坏性）**」。**没有任何一条迁移规则**处理「老 `config.json` 里 `nickname:"琉斯"`」。
- **为什么是问题**：这不是「加字段」，是**同一个字段名换语义**，属于破坏性变更，`schemaVersion` 保持 1 这个结论是错的：
  1. 老用户升级后，`config.json` 里的值就是 `"琉斯"`（`src/core/config.js:24 NICKNAME_DEFAULT='琉斯'`，`ensureConfig()` 首启就把它写进盘）。M0 的打招呼链路是 `src/main.js:695 replies.proactiveLine(kind, { nickname: config.nickname, ... })` → `src/core/replies.js:267 name: opts.nickname || '你'`。**现象就是「猫管用户叫琉斯」**——正是站长最可能一眼看出来的坏味道（第一屏就错）。
  2. 初见流程挡不住这条：`onboarded` 在 `state.json` 里、老文件也没有，所以首启确实会问一次名字；但用户**按 Esc 跳过 / 用拒绝词（不要、算了）**时，spec §3 的分支只写「拒绝 → nickname='你'」——「跳过（Esc/skipOnboarding）」这条路径**没写要不要动 nickname**。不写，codex 就保留 `"琉斯"`，破坏性变更照样落到用户脸上。
  3. 更硬的一条红线：`tests/config.test.js:39` 明确钉着 `coerceConfig({ nickname: '  琉斯  ' }).nickname === '琉斯'`。只要把「把 '琉斯' 当旧默认值改写掉」的迁移塞进 `coerceNickname()`，**M0 的 92 条旧用例当场红一条**——而 task §2.14 又写死「92 条旧用例一条不许红」。**规格给的两条硬要求在这里互斥，codex 只能自己仲裁。**
- **具体修法**：
  1. 明确「迁移只发生在 `loadConfig/ensureConfig` 这一层，不下沉进 `coerceNickname()`」——`coerceNickname` 保持「值合法就原样」（保住 `tests/config.test.js:39`），迁移逻辑单独一个纯函数（如 `migrateConfig(raw)`），单测单独写。
  2. 给出规则（写进 spec §9，并声明 `schemaVersion: 1 → 2`）：`schemaVersion < 2` 且 `nickname === '琉斯'`（M0 唯一默认值）且 `state.json` 无 `onboarded` 字段 → 判定为「旧语义残留」，`nickname` 落 `'你'`（兜底称呼）+ `onboarded=false` 走初见流程。**同时必须写清**：升级后第一条主动话术**不得**出现「琉斯」称呼（这就是验收判据）。
  3. 补上被漏掉的分支：`skipOnboarding`（Esc/跳过）时 `nickname` 落什么，写死一个值（建议 `'你'`）。
  4. 顺手把 `NICKNAME_DEFAULT` 的语义在 config.js 注释里写清（现在这行注释就是「猫对用户的称呼」，值却是猫名，下一个人还会踩）。
  5. 迁移要能被验收：`--self-check` 加一条确定性项「把一份 `schemaVersion:1 + nickname:"琉斯"` 的配置喂给迁移函数，结果 nickname 不得为 '琉斯'」——**这条是本轮唯一能自动化验证迁移的地方，别漏。**

### P0-3 task 自相矛盾：`HANDOFF.md` 到底改不改（「唯一权威」文件自己打架）

- **问题**：task §4「不要做什么」第 2 条写 **`不改 docs/M0-*.md、HANDOFF.md、hermes-pet-product-design.md…`**；task §6「自我迭代条款」写 **`完成后写 HANDOFF.md 追加本节（真实输出），git add -A && git commit`**。
- **为什么是问题**：这正是 `docs/M0-NEXT-SESSION.md` §6 记过的事故（「本轮出过一次自相矛盾（BRIEF §5 禁止改 sprite-map × FIX 书要求在该文件末尾追加），codex 只能仲裁」）。文件开头刚写了「**本文件为本轮唯一权威，冲突以本文件为准**」，结果权威文件内部先冲突——codex 只能猜，改也错、不改也错。
- **具体修法**：§4 那条改成边界显式句：「不改 `HANDOFF.md` 第 1-13 节的既有内容；**只允许在文末追加** `§14 M1-R1`，追加不得修改任何已有行」。这既满足 §6 的交接诉求，又不破坏「既有记录不许动」的初衷。

### P0-4 A2 的节拍数字算不通，而且与它自己的验收互相打架

- **问题**：features §2 写「每个光标 tick（200ms）抽签一次，概率 0.4%（1/250）→ 期望约 50 秒想走一次」，features A2 的验收却写「**5 分钟内能看到猫至少向光标方向挪动 2-3 次**」。两个数差 2.4 倍。
- **自己算一遍**（按 task 要求）：
  - 期望间隔 = 200ms × 250 = **50s**；1 小时 = 3600/50 = **期望 72 次**（≈每 50 秒一次，等于每分钟 1.2 次）。
  - 加上 45s 硬下限后：`E[max(45s, X)]，X~Exp(50s)` = 45 + 50·e^(−45/50) ≈ 45 + 20.3 = **65s → 约 55 次/小时**。
  - 而「5 分钟 2-3 次」= **24-36 次/小时**，且 features 自己的定位是「低频、安静陪伴、余光里它动了一下，不是追着鼠标满屏跑」。
  - 附带一个参数设计问题：**45s 硬下限在 p=0.4% 下几乎不起作用**（每次抽签 `P(45s 内抽中) = 1 − 0.996^225 ≈ 59%`），也就是说这个下限不是「防连续走」的保险，而是主要节拍器——说明这组参数不是按「安静」调的。
- **为什么是问题**：这是 A2 的核心手感参数，也是「安静陪伴 vs 闹心玩意」的分水岭（脑洞自己写的）。按 0.4% 实现 → 站长人工验收（5 分钟 2-3 次）必红；按验收反推（5 分钟一次）→ codex 得自己改 task 里写死的常数。**文档不给唯一答案，交付必失败一条。**
- **具体修法**：二选一并在 task/spec/features 里三处对齐：
  - (a) 保「安静」意图：抽签概率降到 ~1/1500（200ms × 1500 = 5 min），或保留 0.4% 抽签但加「**上次散步结束 → 冷却 ≥4-5 分钟**」，让期望落进「5 分钟 2-3 次」；
  - (b) 保现有常数：把验收改成「5 分钟内 4-6 次」并同步改 features A2 的表述。
  - 无论选哪个，**把「期望约 50 秒」这句从文档里删掉或改写**——它会被 codex 当成「已经调好了」的证据照抄。
  - 另外建议把「多久一次」写成可脚本化判据：注入 `random/now` 跑 1 小时虚拟时间，断言散步次数落在区间内（纯函数可测，正好是 `src/core/walk.js` 的活）。

### P0-5 A6 吸附与 M0 的 `clampToArea(MIN_VISIBLE=48)` 打架 → 拖到边缘不贴边

- **问题**：task §2.8 只说「`pet:drag-end` 加 `snapToEdge`」，**没说清与既有 drag-end 里那次 clamp 的先后与判据**。M0 现在的 drag-end（`src/main.js:600-614`）是「先 `clampToWorkArea` 再 `syncWindowBounds`」，而 `src/core/position.js` 的 `clampToArea()` 语义是**「允许窗口部分出屏，至少留 48px 可见」**（`minX = workArea.x − width + 48`、`maxX = workArea.x + workArea.width − 48`）。以本机（workArea 1440×852、窗口 144×144）算：`x ∈ [−96, 1392]`，**松手后窗口最多有 96px 在屏外**。
- **为什么是问题**：A6 的阈值是按「窗口边到 workArea 边的距离 ≤20px」定义的，而 features A6 的验收期望值是 `x = 屏宽 − 窗宽 − 4 = 1292`。可「把猫推到边缘」（最自然的用户动作）松手后窗口落在 `x = 1392`：
  - 按有符号距离算：右边缘外溢 96px → 距离 = −96 → 不满足「≤20px」；
  - 按绝对距离算：96 > 20 → 同样不吸附。
  - 结果：**猫停在离屏 96px、只剩 48px 露在屏内，且永不吸附**。人工验收「拖到边缘松手吸附贴边（留 4px）」确定性失败，且是**必现**（不是概率）。
  - 反向也怪：把窗口留在 `x = 1392` 再点 `resize`（A4 滚轮放大）时，窗口更大、出屏更多。
- **具体修法**（把顺序与判据写死进 spec §8，并配单测）：
  1. drag-end 顺序固定为：`clampFullyInside(窗口矩形, workAreaFor(窗口矩形))` → **然后** `snapToEdge(bounds, workArea, 20, 4)` → 再 `clampFullyInside` 一次兜底。即「吸附只在**完整在屏内**的窗口上判距离」。
  2. `snapToEdge` 判据写死：取窗口左右边到 workArea 左右边、上边到上边、下边到下边的距离，**四边取最小**；命中哪边就 `x = workArea.x + breathe` / `x = workArea.right − width − breathe`（上下同理）；**多边同时命中时的优先级写死**（建议 左>右>上>下 或按「距离最小者优先，并列取列在前者」）——spec 只说「多边优先级写死并测试」，但没给值，codex 会自己编。
  3. 坐标一律 DIP（沿用 `src/main.js:100 workAreaFor()` + `screen.getDisplayMatching`），多屏取「窗口所在显示器」的 workArea；本机 scaleFactor=2，单测/自证里**不要出现物理像素算式**（M0 第三轮就是这么错的）。
  4. 单测（`tests/position.test.js` 追加）：四条边内侧 10px / 严谨边界 20px、21px / 已在屏外 96px / 窗口大于 workArea / 多屏偏移 workArea。

---

## 2. P1（必修，不阻塞开工但会红一条验收）

### P1-1 `walk` / `look` 的转移表缺「被用户交互打断」的出口

- **问题**：spec §2.2 写「`ALLOWED`：仅 idle/alert 目标追加 walk、look；……walk/look 自身**只回 idle**」。但 M0 的每个状态几乎都能被 click / typing / drag 打断（`src/core/state-machine.js` 的 `ALLOWED` 里 talk/listen/drag 是可从多数状态到达的），walk/look 是**新增状态里唯一没有用户交互出口的**。
- **为什么是问题**：猫在走（每次最多 3s、按 P0-4 的频率会经常发生）时用户点它：`click → talk`，但 `ALLOWED.walk` 不含 talk / listen → `enter()` 返回 false → **状态卡在 walk**（`src/core/state-machine.js:141-160`：迁移失败时只 `touch()`，不改状态）。后果是「走动中点猫没反应/气泡开了但猫还在播走帧」；同理 `typing:start`、`drag:start` 也会被白名单拒绝（**走动中拖不动猫**）。这与 A13 自己写的反向边界「用户主动点击永远优先，静默只禁主动打扰不禁用户召唤」直接冲突。
- **具体修法**：给 walk/look 补出口（只增不减，不动 M0 既有条目）：`walk: ['idle','talk','listen','drag','walk','look']`、`look: ['idle','talk','listen','drag','walk','look']`；并在 `EVENT_TARGETS` 里明确「收到 talk/listen/drag 类事件时先隐式 `walk:end`」。同时补单测：「walk 中收到 click 必须到 talk」「walk 中 `drag:start` 必须到 drag」。

### P1-2 `Alt+M`（静音）的语义在权威文件里没有定案

- **问题**：spec §11 末尾写「**待对齐**：Alt+M 的『静音』在当前无音频的猫里语义需对齐，**建议**映射到 paused……spec 标『静音≈暂停』」。task §2.8 只写「A7：globalShortcut 注册/冲突/注销」，**没写 Alt+M 按下之后做什么**；task §3.2 的验收只有一句「Alt+M 静音」。
- **为什么是问题**：执行者拿不到唯一答案，而这是**站长验收栏里的一格**。更实际的是：`paused` 已经是 M0 的会话级状态（`state.paused`），托盘菜单里叫「暂停动画」（`src/main.js:388`），映射成 paused 后会有两个用户可见后果：① 托盘勾选态变化（用户按 Alt+M，托盘「暂停动画」自己勾上了，语义串味）；② `setPaused` 会发 `pet:pause`、`shouldReassertTopmost` 返回 false（暂停时不抢置顶）——Alt+M 一按，猫的置顶行为都变了。
- **具体修法**：在 task 里**落定一条**并写进验收判据（建议：Alt+M = 复用 `setPaused`，且托盘菜单项文案改成「静音 / 暂停动画」并把 `paused` 作为唯一事实源，别新增第二个 muted 字段）。同时明确「Alt+M 打开后再按一次恢复」的幂等语义。

### P1-3 A13「全屏静默」：task 一边当必验项、一边给了跳过许可

- **问题**：task §2.4 要求 `quiet.js` 的 signals 含 `foregroundFullscreen`；task §3.2 把「全屏前台时猫不主动说话/走动、退出恢复、全屏中点击仍能唤对话」列为**人工验收项**；但 task §5.6 又写「若拿不准可先只落『高速打字 + dnd/paused + 深夜』确定信号，全屏留待拍板」。
- **为什么是问题**：codex 走 §5.6 的降级路径（完全合理——容器里没有全屏程序可测）→ `foregroundFullscreen` 恒为 false → 验收表里那条**必红**。同一份权威文件里「可跳过」和「必须过」并存，等于没有判据。
- **具体修法**：把「全屏」拆成两级并写死：(1) **接口必须落**——`quiet.js` 的 signals 含 `foregroundFullscreen`，可注入、有单测（true/false 都覆盖）；(2) **探测实现**明确选一条：要么本轮做 PowerShell 探测（task §5.6 有节流/降级/mock 三条要求，可接受），要么本轮**明确不做**、并从 §3.2 验收表里删掉「全屏」那半句，只保留「打字/深夜/dnd」的验收。别两样都留着。

### P1-4 A6「离开 >30 分钟回来」的判据与 M0 只能拿到窗口内信号的事实不符

- **问题**：features A6 写「离开 >30 分钟（**期间无鼠标/键盘**）回来后…动一下鼠标即触发」；但 `docs/HANDOFF.md` §5 明确「主动/空闲信号**只来自本窗口内的交互**，没有全局键鼠钩子」（M0 的边界）。实际可用的「活动」信号只有 `markActivity`，它由 `src/main.js:562 pet:activity`（渲染进程窗口内交互）和 `src/main.js:701-715 tickCursor()`（光标距猫中心 ≤ `ACTIVITY_NEAR_PX` 且位移 ≥20px、带节流）触发。
- **为什么是问题**：`returnPending` 由 `markActivity` 检测「gap > 30min」得出（task §2.6）。按现有信号，这个 gap 测的是「**光标的最后活动点不在猫附近**」，不是「用户离开座位」——用户在别处全屏看视频 40 分钟、光标一直没动，回来鼠标一进猫附近 → 触发「回来了。」（正确）；但反过来「用户一直在别处敲字、光标全程不靠近猫」再回来碰到猫，也会触发（也还算对）。真正会错的是：**跨天 / 合盖唤醒 / 墙钟回拨**这三种情况下 `idleMs ≥ 30min` 的产物，以及 `guardTick` 的 `skip=true` 分支（时间回拨当次静默）与 `returnPending` 的先后关系——task §2.6 完全没写。
- **具体修法**：在 spec §8 写死三条：① 判据文案改成「距上一次**猫窗口内**活动 ≥30 分钟」（别写「无鼠标/键盘」，这是 M0 明确做不到的）；② `markActivity` 里 `returnPending` 的置位必须在 `guardTick` 之后（回拨 → 不置位；`drift`（合盖唤醒，`now - lastTickAt > 2min`）→ 允许置位但要写明「唤醒后允许一次『回来了』」是预期还是不要）；③ 加单测：跨天重置、时间回拨不置位、2 分钟内不置位/31 分钟置位。

### P1-5 🛡️ 安全：新增的三处「文本回流」和剪贴板桥都要写死约束

- **问题**：task/spec 没有把 M0 的 SEC-001（**气泡内容一律 `textContent`**）带进本轮新增面：
  1. **A1 会把用户输入原样回显进气泡**：「{名字}，记住了。以后叫我琉斯就行。」（spec §3 / features §3）。老用户/新用户都可能输入 `<img src=x onerror=...>` 这类串——虽是自注入、且 M0 目前用 `setText()`（`src/renderer/pet.js:56` 是 `textContent`），但新写的 onboarding 气泡是**新代码路径**，没有红线就等于给下一个人留口子。
  2. `nickname` 还会流向**托盘 tooltip / state.json / 设置面板数据**（`src/main.js:349` 现在写死中文，M1 若改成动态拼接昵称就是新的注入面），且 `normaliseUserName` 只做了 trim/截断/拒绝词，**没做控制字符与换行清理**（`\n`、`\r`、`\u0000` 进 nickname 会破气泡排版）。
  3. **A8 剪贴板桥**：`copyText(text)` 由 preload 暴露（task §2.9）。没有写「长度上限」「只允许当前气泡文本」——一个失控的 adapter 回复（M0 的 hermes-gateway 取的是上游 `choices[0].message.content`，长度不受控）可以被静默写进系统剪贴板，覆盖用户刚复制的内容。这是典型的「静默副作用入口」。
- **为什么是问题**：M0 的 SEC-001 是**一票否决**项，本轮新增了三处文本路径却没有任何一条继承该约束；剪贴板是跨应用的数据出口，风险面比气泡大。
- **具体修法**（写进 task §2.10 / §2.9 / §4）：
  1. 明确「**所有含用户输入或 AI 回复的 DOM 写入必须走 `textContent`/`setText`，本轮新增的 onboarding 气泡、『已复制』标记、固定图钉标记一律不得用 `innerHTML`/`insertAdjacentHTML`**」——这条写成 §4 的「不要做什么」第 N 条。
  2. `normaliseUserName` 增加：去掉 `\u0000-\u001F` 控制字符与 `\r\n`、再 trim、再截断 24 字（顺序写死）。
  3. `copyText(text)`：preload 侧校验 `typeof text === 'string'`、`text.length` 上限（建议 4096，超出截断并在气泡提示「内容太长，已复制前 N 字」或直接拒绝），**只允许写当前气泡可见文本**（不接受任意字符串来源）；`--self-check` 加一条 `copy-bridge` 的同时加一条「超长文本被截断/拒绝」的断言。

### P1-6 验收清单缺项：quiet / walk 护栏 / 迁移 / 跨天回拨都没进自证门

- **问题**：task §2.13 列的 selfcheck 新增项是 walk-state-exists / look-state-exists / dnd-locks-passthrough / snap-to-edge / zoom-clamp / onboarded-field / return-trigger / shortcut×3 / copy-bridge / history-↑ / bubble-pin。**没有一条覆盖 A13 的 quiet**（本轮两条主线之一），也没有「walk 在 dnd / paused / quiet 下不启动」，没有「config 迁移」（P0-2），没有「跨天重置 / 墙钟回拨下的 return」（P1-4）。
- **为什么是问题**：selfcheck 是本项目唯一的端到端自证门（M0 五轮都在靠它兜），缺项 = 这些行为**只靠人工看不出来**（尤其 quiet / 护栏，人是感觉不到「该静默时是否真的静默」的）。
- **具体修法**：把下面 4 项补进 §2.13，全部做成确定性（不读真实光标、不读会被合法改写的活状态）：
  - `quiet-blocks-proactive`（注入 `foregroundFullscreen/typingBurst/dnd/paused/hidden/deepNight` 六种信号各一次，断言 `plan()` 不开口 / `walk` 不发散步）；
  - `walk-guards`（dnd / paused / 对话中 / 拖拽结束后 2s 内 四种情况下 `shouldWalk` 为假）；
  - `config-migrate-nickname`（P0-2 的迁移，喂旧文件断言不再叫「琉斯」）；
  - `return-clock-guard`（回拨不置位、跨天重置、合盖唤醒只判一次）。

### P1-7 A12 的「失败提示」验收项在验收环境里无法复现

- **问题**：features A12 验收写「模拟失败场景（受限权限）时用户收到人话提示」；task §3.2 A12 写「失败有人话提示（非静默）」。
- **为什么是问题**：站长/复验者无法在正常权限下稳定制造 `setLoginItemSettings` 抛错（要么改注册表，要么真有权限问题）。**这就是「该验却验不了」的验收项**——最后只能靠 codex 自己说「我 catch 了」。
- **具体修法**：把失败路径做成**可注入**：`applyAutoLaunch(options.injectSetLoginItem)`，selfcheck 注入一个抛错的替身，断言「调用了一次、且产生了一条用户可见提示（托盘 tooltip 或气泡文案）」。把人工验收改成「打开开关 → 系统登录项出现 hermes-pet（可脚本查 `HKCU\...\Run`）」。

---

## 3. P2（建议 / 一致性）

| # | 问题 | 为什么 | 修法 |
|---|---|---|---|
| P2-1 | 单击/双击窗口数字不一致：task §2.10 与 features A13 写「延迟约 **250ms** 判双击」，实测 M0 是 `DOUBLE_CLICK_MS = 320`（`src/renderer/pet.js:32`） | 执行者不知道是「改 320→250」还是「保持 320 只加延迟」，两种都能过人工验收 → 白扯一轮 | 明确写「把 `DOUBLE_CLICK_MS` 从 320 改成 250（行为变更，需在 HANDOFF 记一笔）」，或「保持 320，只把单击动作延迟到该窗口之后」。顺带确认 M0 自证门不受影响（`tools/selfcheck.js:82-104` 派发 mousedown/mouseup 后有 600ms 等待，容量够） |
| P2-2 | A3 的 8 方向要用「猫中心 → 光标」算，但渲染进程里 `window.screenX` 会滞后 | `HANDOFF.md` §13/FIX-2 明确记过「渲染进程的 `window.screenX` 会滞后于窗口真实位置，**不能当基准**」，而 `src/renderer/pet.js:onCursor()` 现在拿 `window.screenX + rect` 算 near —— A3 把同一套坐标用于**方向量化**，灵敏度更高 | 方向计算用主进程下发的窗口矩形（或复用 `pet:window-shift` 的 `catX/catY`）修正后再量化；或把 `lastClient` 的屏幕坐标也由主进程 ticks 一并下发 |
| P2-3 | features §4 的表**自己和自己打架**，且与 features §2 / spec §10 冲突 | 表里第 2 行「主动说话 / 主动动作 = 停」，第 5 行「悬停看向光标 / 偶尔走动 = **可**」；而 features §2 的禁止清单第 4 条写「别烦我（dnd 开）禁止走动」，spec §10 写「A2 走动被 paused / dnd / quiet 禁掉」 | 三处对齐成一句：「dnd 下：不听主动话术、不走动；仍可看光标（look）」。**「看光标」要不要保留也请明确**——dnd 语义是「不接点击」，看光标属于被动反应，保留合理 |
| P2-4 | 走动会移动窗口，但没说清怎么和 M0 的 `baseBounds` 基准对齐 | `baseBounds` 是 `tickCursor` 判 near/alert（`src/main.js:701-715`）、`tickCursor` 的 alert 半径、`windowBoundsForBubble`（气泡窗口矩形与 `windowShift` 平移量）、`persistPosition` 闸门的共同基准。走动 100px 后若不同步 `baseBounds`，猫的「感应圈」会跟本体错位；走动中正好气泡展开/收起也会打架 | task §2.8 补一句：「walkTick 每步同步 `baseBounds`；`bubbleContent` 非空或 `dialogueOpen` 时停走（已在禁止清单里）；走动期间若发生 `pet:bubble-resize`，先 `walk:end` 再 `syncWindowBounds`」 |
| P2-5 | A4 滚轮改大小后没有重算吸附 | 贴边（留 4px）状态下放大，窗口右边界会外溢；`recenterForSize()` 只保「中心 x / 底边 y」不跳走，不负责吸附 | 缩放后（debounce 落盘那次）顺带走一遍 A6 的 `snapToEdge`（贴着哪条边就还贴哪条边）；或明确「缩放后允许脱吸」，但要在验收里写清 |
| P2-6 | A7 的两个细节没定：① Alt+T 会在用户打字时**全局抢焦点**；② 「被占用」这一运行时状态存哪 | ①与 spec 对 Esc 的判断逻辑同源（「全局抢键是灾难」），Alt+T 抢的是**当前焦点**，比 Esc 温和但同类；②spec 说「settings 标红 + 托盘提示」，但注册发生在启动时，设置窗口可能还没开，需要一个载体 | ①至少在文档里承认这个取舍并写清触发后的行为（唤出输入框 = 前台化窗口）；②「占用列表」放主进程运行时内存 + `config:changed`/新通道广播，**不要写进 config.json**（运行时态别混进偏好文件，会污染 `ensureConfig` 的「不覆盖用户值」语义） |
| P2-7 | ⛽ token/上下文：§0 让人「读 `HANDOFF.md` §11/§12/§13」，但 `HANDOFF.md` 现在 **60KB**，而且 §6 还要求继续追加 | M0 轮已经踩过「整读大文件」的浪费；HANDOFF 越大越贵 | 改成「用查找定位小节标题后只读该节」（给出可复制命令），或先把 §11-§13 摘到一个 `docs/_m1r1/handoff-digest.md`（中间产物本来就允许放 `docs\_m1r1\`）。同理 features(28KB)+spec(15KB)+supplement+sprite-map+BRIEF §4/§5 请给「最小必要片段」清单 |
| P2-8 | ⛽ 输出无上限：§3.1 第 4 条要求「连跑 5 次 5/5」，但没约束怎么贴证据 | M0 第五轮 HANDOFF 贴了 5 份完整冒烟日志（每份十几行），一半是重复 | 写一句「证据只贴每轮 `SMOKE_OK {...}` 行 + 汇总行；完整日志落 `docs\_m1r1\` 文件，正文只给路径」 |
| P2-9 | M0 遗留：`src/preload.js` 暴露了 `bubbleClosed → 'bubble:closed'`，但 `src/main.js` 只挂了 `bubble:ignored`，没有 `bubble:closed` handler | 死通道（不算本轮回归，但 M1 要动 preload，顺手对齐成本为零） | 要么补 handler，要么删掉这个暴露；在 HANDOFF 记一笔 |

---

## 4. 逐维度对照（10 项，按要求逐条过）

| # | 维度 | 结论 |
|---|---|---|
| 1 | ★ A5 与既有穿透机制的所有权冲突 | **不通过** —— 见 P0-1。「唯一裁决点」定对了，但漏了「开 dnd 时的第一次断言」，且 `watchdogAction()` 无 dnd 维度 + `lastInteractive` 陈旧为真会把状态锁死。 |
| 2 | ★ A1 nickname 破坏性语义变更 | **不通过** —— 见 P0-2。**零迁移规则**，`schemaVersion` 保持 1 的结论错误；且与 `tests/config.test.js:39` + 「92 条旧用例不许红」互斥。 |
| 3 | A2 走动与护栏 / 节拍数字 | **不通过** —— 见 P0-4。禁止清单本身较完整（对话/拖拽+2s/打盹/别烦我/暂停/光标安静 5s>120px；全屏与打字由 quiet 兜住 ✓），但节拍数字与验收差 2.4 倍；45s 下限在 0.4% 下形同虚设。 |
| 4 | 新增状态与状态机白名单 | **部分通过** —— 走动/看向复用 8 方向帧、只增不减的做法对；M0 的 `tests/state-machine.test.js` 也不会红（我逐条核过：无 `deepEqual(ALLOWED.*)` 断言，`白名单拒绝越界迁移` 断的是 sleeping→scratchSelf）。**但缺 walk/look 的用户交互出口**（见 P1-1）。 |
| 5 | A4 滚轮与既有交互的冲突面 | **基本通过** —— 「只绑 `#cat-slot/#cat`、绝不绑 window」的写法天然避开了气泡滚动区 / 设置面板 / 拖拽（拖拽中 `dragLock` 会保持非穿透，但 wheel 仍会到猫身上 → **拖拽中滚轮仍会缩放**，spec 已列「排除拖拽」✓）。漏项：缩放后不重算吸附（P2-5）、`config:set` 写盘节奏（100ms debounce ✓）。 |
| 6 | A6 吸附的坐标系 | **不通过** —— 见 P0-5。DIP 提醒写得好（task §5.2 + `workAreaFor`），但**与 M0 `clampToArea(MIN_VISIBLE=48)` 的「允许部分出屏」语义打架**，推到边缘必不吸附；多屏/DPI 本身没问题。 |
| 7 | A7 全局快捷键边界 | **基本通过** —— spec §11 五条纪律齐全（捕获 `register=false`、Esc 绝不全局、`will-quit unregisterAll`、改键先 unregister 再 register + 失败回滚、每次 register 前 unregister 同键幂等、smoke 下跳过、selfcheck 用测试键验完即注销）。缺项：Alt+M 语义未定案（P1-2）、`register` 可能**抛异常**（不止返回 false）未写、「被占用」状态载体未定（P2-6）、Alt+T 抢焦点未承认（P2-6）。 |
| 8 | 验收清单可信度 | **部分通过** —— ✅ 已明确「92 条旧用例一条不许红」（§2.14 + §3.1）和「selfcheck 门数 18 → 约 34」（§2.13）；人工项交站长、没让 codex 验 GUI 审美（对）。**缺**：quiet/walk 护栏/迁移/跨天回拨 无自证门（P1-6）；A12 失败路径不可复现（P1-7）；A13 全屏自相矛盾（P1-3）。 |
| 9 | 🛡️ 安全 | **不通过（一票否决级风险）** —— 见 P1-5。本轮新增 3 条文本回流路径 + 剪贴板桥，M0 的 SEC-001（`textContent`）没有被继承；`copyText` 无长度/来源约束。 |
| 10 | ⛽ token / 上下文效率 | **部分通过** —— ✅ 有「≤15 行摘要」、有「中间产物放 `docs\_m1r1\`」、没让 codex 读 `docs/_recon/**`（1.3MB）。**缺**：`HANDOFF.md` 60KB 被要求整读（P2-7）、5 次冒烟的贴法无上限（P2-8）、没有 HANDOFF/AGENTS 的篇幅边界（建议 task 里写「HANDOFF 追加节 ≤120 行，只贴关键行 + 落盘路径」）。 |

---

## 5. 冲突点清单（供按权威顺序裁决，逐条列）

1. **task §4 × task §6**：`不改 HANDOFF.md` × `完成后写 HANDOFF.md 追加本节`。（P0-3，同一文件内冲突）
2. **task §2.14 × task §2.7（+spec §9）**：「92 条旧用例一条不许红」 × 「nickname 语义纠正 + `schemaVersion` 保持 1 + 无迁移」——`tests/config.test.js:39` 钉住 `'琉斯'` 可被保留，迁移写进 `coerceNickname` 必红，两条硬要求互斥。（P0-2）
3. **features §2 × features A2 验收**：「期望约 50 秒一次」（≈72 次/小时） × 「5 分钟内 2-3 次」（24-36 次/小时）。（P0-4）
4. **spec §7 × spec §7 自身**：「① `applyIgnoreMouse` 首行 dnd 短路（吞掉任何 `ignore=false`）」+「③ 看门狗 dnd 下无害」 × 「关 dnd 时 `reassertPassThrough('dnd-off')` 一次恢复」——**开 dnd 方向无人断言**，且 `watchdogAction` 无 dnd 维度。（P0-1）
5. **features §4 表内 × features §4 表内**：「主动说话 / 主动动作 = 停」 × 「悬停看向光标 / 偶尔走动 = 可」。（P2-3）
6. **features §4 × features §2（+spec §10）**：dnd 下「偶尔走动 = 可」 × 禁止清单「别烦我（dnd 开）禁止走动」 / spec「A2 被 paused/dnd/quiet 禁掉」。（P2-3）
7. **task §5.6 × task §2.4/§3.2**：「全屏探测拿不准可先只落『高速打字+dnd/paused+深夜』」 × A13 验收含「全屏前台时猫不主动说话/走动」/`quiet.js` signals 含 `foregroundFullscreen`。（P1-3）
8. **task §2.10/features A13 × `src/renderer/pet.js:32`**：「延迟约 250ms 判双击」 × M0 实装 `DOUBLE_CLICK_MS = 320`。（P2-1）
9. **spec §3/features A6 × `docs/HANDOFF.md` §5**：「离开 >30 分钟（期间无鼠标/键盘）」 × 「主动/空闲信号只来自本窗口内的交互，没有全局键鼠钩子」。（P1-4）
10. **task §2.8 × `src/main.js:600-614` + `src/core/position.js`**：`pet:drag-end 加 snapToEdge`（阈值为「窗口边距 ≤20px」）× 既有 `clampToWorkArea` 允许窗口 96px 出屏（`MIN_VISIBLE=48`）。（P0-5）
11. **supplement A8「气泡里的长文本应可选中」 × spec §12.1/task §4**：脑洞已核实 `user-select:none` 是刻意并**保留不改**，task §4 也写明「不改 `user-select:none`」——**这一条我已确认为「不是冲突」**，三份文档结论一致（脑洞 §6 A8 事实纠正 → spec §12.1 → task §4），列在此处仅为标记已核。（✅）
12. **task 开头「本文件为本轮唯一权威」 × spec 开头「冲突时 features 的数字优先、本文件的架构优先」**：两份文件都自称裁决位（spec 还让 features 在数字上压过自己，而 task 又写「spec 定怎么落、features 定数字多大」）。严格说不算硬冲突，但**「数字以 features 为准」这条在 task 里没有明文继承**——P0-4 那种数字矛盾只有靠它才能裁。建议 task §0 补一句：「数字类冲突以 features 为准，架构类冲突以本文件为准」。（⚠️）

---

## 6. ✅ 亮点（该夸就夸）

- **A5 的第一性判断对了**：`applyIgnoreMouse()` 作为唯一裁决点、渲染命中测试与看门狗「退居其次」，这个方向就是 M0 第五轮 FIX-2 记下的产品级方案，方向没错（只是落点漏一处）。
- **A11 的「砍长按门槛」是这轮最有人味的决定**：给了三条理由、对齐了「人性化≠照抄文档」，还保留「mousedown 即 drag 态 + 半透明 + 方向帧」的反馈。这条我完全同意。
- **A7 的五条纪律**（捕获 false / Esc 不全局 / `unregisterAll` / 改键先注销再注册+回滚 / 同键幂等）覆盖得很干净，连「smoke 下跳过注册、selfcheck 只用不常用测试键」都想到了。
- **A12 的事实纠正**（已真调 `setLoginItemSettings`）与 **A8 的 `user-select` 核实**都是「先验证再设计」的正确姿势，没有靠猜。
- **「92 旧用例一条不许红」「selfcheck 门数从 18 增到 ~34」写进了任务书**，且 §5 第 3 条「自证门与物理环境解耦」把第五轮的教训显式继承下来了。
- **A2 的「光标近 5s 累计位移 >120px 就不走」是全篇最漂亮的一条规则**——「你停下来思考它才靠近」。这条留住，别在调频率的时候把它一起改掉。

---

## 7. 结论

**打回。**
P0 = 5 条（A5 所有权洞 / A1 迁移缺失 / HANDOFF 自相矛盾 / A2 数字与验收互斥 / A6 吸附与 clamp 打架），P1 = 7 条，P2 = 9 条，另有 1 条已核实为「不是冲突」。
最致命的一条：**P0-1 A5「别烦我」的所有权仍有一个未覆盖的状态转移**——「鼠标正压在猫身上时开 dnd」，此刻既没有断言方、看门狗又因 `lastInteractive` 陈旧为真而拒绝出手，窗口会永久停在「不穿透」，站长第一眼看到的就是「勾了别烦我，点猫还是被吃」——本轮自己点名的「最容易做错的一条」，确实还差一口气。
修订 5 条 P0 + 7 条 P1（并把 §5 冲突清单里的 12 条按权威顺序落定）后，可重新派单；届时 M0 的 92 条旧用例零红、selfcheck 18→34 的硬要求可以照旧执行。